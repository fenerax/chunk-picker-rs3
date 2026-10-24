// Builds a release folder from one commit that GitHub has already tested, then
// proves it opens a copy of the live save. This is all the release PC runs: an
// export, the data packs built from that export, the profile/addon build and
// the startup probes. The test suites belong to GitHub; nothing here runs them.
//
//   node scripts/release/pc/quick-build.mjs build --repo <checkout> --commit <sha>
//     --current <current.json> --releases <folder> --release <id>
//   node scripts/release/pc/quick-build.mjs verify --repo <checkout> --release-dir <folder>
//   node scripts/release/pc/quick-build.mjs prepare-swap --current <current.json> --release-dir <folder>
//
// Game data comes from the release's own core. Only the art pack and the six
// local map/game caches the public repository lacks are carried from live,
// each checked against its live hash. When the data differs from live, the
// save's dataset binding must change with the pointer: the build proves the
// swap both ways on save copies and writes pack-transition.json, and
// prepare-swap proves it again on the latest save just before a go-live. The
// live save is only read; probes open disposable copies.
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const REPOSITORY = 'fenerax/chunk-picker-rs3';
// Every job GitHub runs for a commit: tests (test.yml), the coverage gate over
// both test lanes, the gallery screens and the release rehearsal on each OS.
export const REQUIRED_CHECKS = Object.freeze(['test', 'windows', 'coverage', 'secrets', 'gallery',
  'rehearsal (ubuntu-latest)', 'rehearsal (windows-latest)']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

// GitHub's check runs for the exact commit. A rerun replaces its earlier
// attempt, so only the newest run of each name counts. Every newest run must
// be green and each required job must be among them.
export function evaluateChecks(runs, required = REQUIRED_CHECKS) {
  const latest = new Map();
  for (const run of runs) {
    if (run?.app?.slug !== 'github-actions' || typeof run.name !== 'string') continue;
    if (!latest.has(run.name) || latest.get(run.name).id < run.id) latest.set(run.name, run);
  }
  const missing = required.filter(name => !latest.has(name));
  const pending = [...latest.values()].filter(run => run.status !== 'completed').map(run => run.name);
  const failing = [...latest.values()].filter(run => run.status === 'completed'
    && !(run.conclusion === 'success' || (run.conclusion === 'skipped' && !required.includes(run.name)))).map(run => run.name);
  return { ok: !missing.length && !pending.length && !failing.length, missing, pending, failing,
    checks: [...latest.values()].map(run => ({ name: run.name, conclusion: run.conclusion, completedAt: run.completed_at ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)) };
}

function githubChecks(commit) {
  const raw = execFileSync('gh', ['api', '--method', 'GET', `repos/${REPOSITORY}/commits/${commit}/check-runs?per_page=100`],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return evaluateChecks(JSON.parse(raw).check_runs ?? []);
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
}

// Regular files only, with their blob ids, so the export can be proven exact.
export function treeEntries(repo, commit) {
  const rows = git(repo, 'ls-tree', '-r', '-z', commit).toString().split('\0').filter(Boolean);
  return rows.map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(row);
    if (!match) throw new Error('Only regular files can be released.');
    return { blob: match[2], path: match[3] };
  });
}

const blobId = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// Every exported file must equal its blob, and nothing else may be present.
export async function verifyExport(root, entries) {
  const expected = new Map(entries.map(entry => [entry.path, entry.blob]));
  const seen = new Set();
  async function walk(directory, prefix) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name, full = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Release core contains a link.');
      if (item.isDirectory()) { await walk(full, relative); continue; }
      if (!expected.has(relative) || blobId(await readFile(full)) !== expected.get(relative)) throw new Error('Release core differs from its commit.');
      seen.add(relative);
    }
  }
  await walk(root, '');
  if (seen.size !== expected.size) throw new Error('Release core is missing files.');
}

async function absent(target) {
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Release folder already exists; every release gets a new id.');
}

async function treeShape(root) {
  const rows = [];
  async function walk(directory, prefix) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name, full = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Pack folder contains a link.');
      if (item.isDirectory()) await walk(full, relative);
      else rows.push(relative + ':' + (await stat(full)).size);
    }
  }
  await walk(root, '');
  return rows.sort().join('\n');
}

// Same copy rule as release-pack-check's snapshot, retried while the live
// picker is writing, because the save stays in use during the build.
async function snapshotSave(dataDir, target, { saveIdentity, digestValue }) {
  for (let attempt = 1; ; attempt++) {
    const before = digestValue(await saveIdentity(dataDir));
    await rm(target, { recursive: true, force: true });
    await mkdir(target);
    await cp(path.join(dataDir, 'state.json'), path.join(target, 'state.json'), { errorOnExist: true, force: false });
    for (const name of ['static', 'history']) {
      try { await cp(path.join(dataDir, name), path.join(target, name), { recursive: true, errorOnExist: true, force: false }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (digestValue(await saveIdentity(target)) === before && digestValue(await saveIdentity(dataDir)) === before) return;
    if (attempt === 5) throw new Error('The live save kept changing while it was copied; try again in a minute.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function runProbe(script, config, dataDir, output, sanitize) {
  const env = sanitize(process.env, { overrides: { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir,
    RS3_PACK_SELECTION: config.selection.path, RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256,
    RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256, RS3_TASK_WORKER_MODE: 'process' } });
  return new Promise((resolve, reject) => {
    const child = spawn(config.nodePath, ['--max-old-space-size=2048', script, 'probe', config.coreRoot, dataDir, output], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let detail = ''; child.stderr.on('data', bytes => { detail = (detail + bytes.toString()).slice(-2048); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Startup probe timed out.')); }, 180000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Startup probe failed to start.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(json(output)) : reject(new Error('Startup probe refused: ' + detail.trim().split('\n').pop())); });
  });
}

// Each step opens a disposable copy: of the live save for the first step, of
// the previous step's result after that, under the binding its dataset needs.
// Identities, progress and history must survive every step; from the third
// step on, the saved identity registry must too.
async function probeChain(core, dataDir, steps, lap = () => {}) {
  const check = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-pack-check.mjs')).href);
  const identity = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-identity.mjs')).href);
  const script = path.join(core, 'scripts/private-companion/release-pack-check.mjs');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-'));
  const probes = [];
  try {
    for (const [index, step] of steps.entries()) {
      const copy = path.join(scratch, step.name);
      await snapshotSave(index ? path.join(scratch, steps[index - 1].name) : dataDir, copy, { saveIdentity: check.saveIdentity, digestValue: identity.digestValue });
      await writeFile(copy + '.dataset.json', step.binding, { flag: 'wx' });
      const report = await runProbe(script, step.config, copy, path.join(scratch, step.name + '.json'), identity.sanitizeExecutionEnvironment);
      if (index) {
        const before = probes.at(-1);
        check.assertStableIdentities(before, report);
        check.assertPreserved(before, report);
        if (index > 1 && before.registryDigest !== report.registryDigest) throw new Error(`The ${step.name} step changed saved registry data.`);
      }
      probes.push(report);
      lap('probe-' + step.name);
    }
  } finally { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  return probes.map((r, i) => ({ step: steps[i].name, tasks: r.taskIds.length, saved: Object.keys(r.saved).length, history: r.historyEvents.length, lostRecords: r.migrationSummary.lostRecords }));
}

// The six local caches are data inputs the public repository does not carry.
// They come from the live data pack, byte for byte.
export async function carryLocalInputs(liveDataManifest, liveDataDir, mapAssetsDir, gameDataDir) {
  const records = liveDataManifest.files.filter(record => /^local-(?:map|game)\//.test(record.path));
  for (const record of records) {
    const [prefix, ...rest] = record.path.split('/');
    const target = path.join(prefix === 'local-map' ? mapAssetsDir : gameDataDir, ...rest);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(liveDataDir, ...record.path.split('/')), target);
    const bytes = await readFile(target);
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw new Error('A local data input differs from the live pack.');
  }
  return records;
}

export async function build({ repo, commit, current, releases, release, now = () => Date.now() }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(release ?? '')) throw new Error('Release id refused.');
  for (const value of [repo, current, releases]) if (!value || !path.isAbsolute(value)) throw new Error('Absolute paths required.');
  const started = now(), seconds = {};
  const lap = (name, since) => { seconds[name] = Math.round((now() - since) / 100) / 10; return now(); };
  let t = now();
  const full = git(repo, 'rev-parse', '--verify', `${commit}^{commit}`).toString().trim();
  const tree = git(repo, 'rev-parse', `${full}^{tree}`).toString().trim();
  const github = githubChecks(full);
  if (!github.ok) throw new Error(`GitHub has not passed ${full.slice(0, 7)}: missing=${github.missing.join(',') || '-'} pending=${github.pending.join(',') || '-'} failing=${github.failing.join(',') || '-'}`);
  t = lap('github', t);

  const pointer = await json(current);
  if (pointer.schemaVersion !== 2 || sha(await readFile(pointer.config.path)) !== pointer.config.sha256) throw new Error('Live pointer or config changed.');
  const liveConfig = await json(pointer.config.path);
  const dir = path.join(releases, release);
  await absent(dir);
  await mkdir(dir, { recursive: true });
  const core = path.join(dir, 'core');
  await mkdir(core);
  const entries = treeEntries(repo, full);
  const archive = path.join(dir, 'core.tar');
  try {
    git(repo, 'archive', '--format=tar', '-o', archive, full);
    execFileSync(tarExe, ['-xf', archive, '-C', core], { windowsHide: true });
  } finally { await rm(archive, { force: true }); }
  await verifyExport(core, entries);
  t = lap('export', t);

  // Art is the one pack carried from live, copied so each release keeps its
  // own immutable inputs. The data and rules-text packs are built from core.
  const packsDir = path.join(dir, 'packs'), selectionPath = path.join(packsDir, 'selection.json');
  const liveSelectionBytes = await readFile(liveConfig.selection.path);
  if (sha(liveSelectionBytes) !== liveConfig.selection.sha256) throw new Error('Live pack selection changed.');
  const liveSelection = JSON.parse(liveSelectionBytes);
  const artFrom = path.join(liveConfig.packsDir, liveSelection.art.id, liveSelection.art.version);
  const artTo = path.join(packsDir, liveSelection.art.id, liveSelection.art.version);
  await cp(artFrom, artTo, { recursive: true, errorOnExist: true, force: false });
  if (await treeShape(artTo) !== await treeShape(artFrom)) throw new Error('Art pack copy differs.');
  const artPack = path.join(artTo, 'pack.json');
  if (sha(await readFile(artPack)) !== liveConfig.packs.art.sha256) throw new Error('Art pack differs from live.');
  await writeFile(selectionPath, encode({ schemaVersion: 1, art: liveSelection.art }), { flag: 'wx' });
  t = lap('art', t);

  const liveDataBytes = await readFile(liveConfig.packs.data.path);
  if (sha(liveDataBytes) !== liveConfig.packs.data.sha256) throw new Error('Live data pack changed.');
  const liveData = JSON.parse(liveDataBytes);
  const inputs = path.join(dir, 'inputs'), mapAssetsDir = path.join(inputs, 'map-assets'), gameDataDir = path.join(inputs, 'game-data');
  const { buildDataPack } = await import(pathToFileURL(path.join(core, 'scripts/build-data-pack.mjs')).href);
  let carried;
  try {
    carried = await carryLocalInputs(liveData, path.dirname(liveConfig.packs.data.path), mapAssetsDir, gameDataDir);
    await buildDataPack({ sourceRoot: core, packsDir, selectionPath, version: `1.1.0-c${full.slice(0, 7)}`,
      mapAssetsDir, gameDataDir, environment: liveData.environment });
  } finally { await rm(inputs, { recursive: true, force: true }); }
  const selection = await json(selectionPath);
  const packs = { art: { path: artPack, sha256: liveConfig.packs.art.sha256 } };
  for (const kind of ['data', 'rulesText']) {
    const file = path.join(packsDir, selection[kind].id, selection[kind].version, 'pack.json');
    packs[kind] = { path: file, sha256: sha(await readFile(file)) };
  }
  const builtData = await json(packs.data.path);
  const builtLocal = new Map(builtData.files.filter(record => /^local-(?:map|game)\//.test(record.path)).map(record => [record.path, record.sha256]));
  if (builtLocal.size !== carried.length || carried.some(record => builtLocal.get(record.path) !== record.sha256)) throw new Error('Built data pack lost a local input.');
  t = lap('data', t);

  // Public source carries placeholder members. The live member defaults stay
  // on this PC: they come from the live profile, never from the repository.
  const { buildDatasetProfile } = await import(pathToFileURL(path.join(core, 'scripts/build-dataset-profile.mjs')).href);
  const { buildPrivateAddon } = await import(pathToFileURL(path.join(core, 'scripts/build-private-addon.mjs')).href);
  const builtPath = path.join(dir, 'profile.source.json');
  await buildDatasetProfile({ packsDir, output: builtPath, sourceRoot: core });
  const built = await json(builtPath), liveProfile = await json(liveConfig.profile.path);
  await rm(builtPath);
  if (!liveProfile.gameDefaults || !Array.isArray(liveProfile.gameDefaults.members)) throw new Error('Live profile has no member defaults.');
  const profileBytes = encode({ ...built, gameDefaults: liveProfile.gameDefaults });
  const profilePath = path.join(dir, 'profile.json');
  await writeFile(profilePath, profileBytes, { flag: 'wx' });
  const addon = await buildPrivateAddon({ sourceRoot: core, output: path.join(dir, 'addons') });
  const addonBytes = await readFile(addon.path);
  t = lap('profile-addon', t);

  const config = { ...liveConfig, coreRoot: core, packsDir,
    selection: { path: selectionPath, sha256: sha(await readFile(selectionPath)) }, packs,
    profile: { path: profilePath, sha256: sha(profileBytes) }, addons: { path: addon.path, sha256: sha(addonBytes) } };
  const configPath = path.join(dir, 'config.json'), configBytes = encode(config);
  await writeFile(configPath, configBytes, { flag: 'wx' });
  await writeFile(path.join(dir, 'pointer.json'), encode({ schemaVersion: 2, releaseId: release, config: { path: configPath, sha256: sha(configBytes) } }), { flag: 'wx' });

  // Old code opens the save, new code opens that result, then old code opens
  // the new result: the swap and a swap back both keep every saved record.
  // A data change puts the new binding on the new side, and new code must
  // also reopen what old code wrote after a swap back.
  const check = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-pack-check.mjs')).href);
  const identity = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-identity.mjs')).href);
  const from = await check.configDescriptor(pointer.config.path), to = await check.configDescriptor(configPath);
  const binding = await readFile(liveConfig.dataDir + '.dataset.json'), bound = JSON.parse(binding);
  if (bound.requiresPack !== true || ['datasetId', 'datasetContractVersion', 'digest'].some(key => bound[key] !== from.descriptor[key])) throw new Error('Live binding does not match the live data pack.');
  const dataChanged = identity.digestValue(from.descriptor) !== identity.digestValue(to.descriptor);
  const newBinding = dataChanged ? check.bindingBytes(to.descriptor) : binding;
  const steps = [{ name: 'live', config: liveConfig, binding }, { name: 'candidate', config, binding: newBinding },
    { name: 'swap-back', config: liveConfig, binding }, ...(dataChanged ? [{ name: 'forward', config, binding: newBinding }] : [])];
  const probes = await probeChain(core, liveConfig.dataDir, steps, name => { t = lap(name, t); });
  let transition = null;
  if (dataChanged) {
    // The managed operator's transition format, so either path can read it.
    const plan = { schemaVersion: 1, oldConfig: from.pin, newConfig: to.pin,
      old: { ...from.descriptor, bindingSha256: sha(binding) }, new: { ...to.descriptor, bindingSha256: sha(newBinding) },
      oldBindingBase64: binding.toString('base64'), newBindingBase64: newBinding.toString('base64') };
    const planBytes = encode(plan);
    await writeFile(path.join(dir, 'pack-transition.json'), planBytes, { flag: 'wx' });
    transition = { sha256: sha(planBytes), from: from.descriptor.digest, to: to.descriptor.digest };
  }

  const receipt = { schemaVersion: 1, releaseId: release, commit: full, tree, repository: REPOSITORY, checks: github.checks,
    live: { releaseId: pointer.releaseId, configSha256: pointer.config.sha256 },
    sameAsLive: { data: !dataChanged, profile: sha(profileBytes) === liveConfig.profile.sha256, addon: sha(addonBytes) === liveConfig.addons.sha256 },
    dataPack: builtData.version, transition, probes,
    seconds: { ...seconds, total: Math.round((now() - started) / 100) / 10 }, builtAt: new Date().toISOString() };
  await writeFile(path.join(dir, 'quick-build.json'), encode(receipt), { flag: 'wx' });
  return receipt;
}

// Before a swap: the core still equals its commit and every pin still holds.
export async function verify({ repo, releaseDir }) {
  const receipt = await json(path.join(releaseDir, 'quick-build.json'));
  await verifyExport(path.join(releaseDir, 'core'), treeEntries(repo, receipt.commit));
  const pointer = await json(path.join(releaseDir, 'pointer.json'));
  if (pointer.releaseId !== receipt.releaseId || sha(await readFile(pointer.config.path)) !== pointer.config.sha256) throw new Error('Release pointer changed.');
  const config = await json(pointer.config.path);
  const transition = receipt.transition ? [{ path: path.join(releaseDir, 'pack-transition.json'), sha256: receipt.transition.sha256 }] : [];
  for (const pin of [config.selection, config.profile, config.addons, ...Object.values(config.packs), ...transition]) {
    if (sha(await readFile(pin.path)) !== pin.sha256) throw new Error('Release input changed since the build.');
  }
  return receipt;
}

// Just before a go-live: which binding the save needs after the swap, proven
// again on the latest save. Going forward uses the candidate's transition;
// going back uses the live release's, and the candidate must open the save as
// the live release left it. With no transition for the pair the data must match.
export async function prepareSwap({ current, releaseDir }) {
  const pointer = await json(current), candidatePointer = await json(path.join(releaseDir, 'pointer.json'));
  if (sha(await readFile(pointer.config.path)) !== pointer.config.sha256 || sha(await readFile(candidatePointer.config.path)) !== candidatePointer.config.sha256) throw new Error('A release config changed.');
  const liveConfig = await json(pointer.config.path), config = await json(candidatePointer.config.path);
  const read = async file => { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const forward = await read(path.join(releaseDir, 'pack-transition.json'));
  const backward = await read(path.join(path.dirname(pointer.config.path), 'pack-transition.json'));
  const same = (pin, actual) => pin?.path === actual.path && pin?.sha256 === actual.sha256;
  const pair = forward && same(forward.oldConfig, pointer.config) && same(forward.newConfig, candidatePointer.config) ? { plan: forward, from: 'old', to: 'new' }
    : backward && same(backward.newConfig, pointer.config) && same(backward.oldConfig, candidatePointer.config) ? { plan: backward, from: 'new', to: 'old' } : null;
  const check = await import(pathToFileURL(path.join(config.coreRoot, 'scripts/private-companion/release-pack-check.mjs')).href);
  const identity = await import(pathToFileURL(path.join(config.coreRoot, 'scripts/private-companion/release-identity.mjs')).href);
  const from = await check.configDescriptor(pointer.config.path), to = await check.configDescriptor(candidatePointer.config.path);
  const bindingPath = liveConfig.dataDir + '.dataset.json', binding = await readFile(bindingPath);
  if (!pair) {
    if (identity.digestValue(from.descriptor) !== identity.digestValue(to.descriptor)) throw new Error('The data differs from live and neither release has a transition for this pair.');
    return { binding: null };
  }
  const bytes = side => Buffer.from(pair.plan[side + 'BindingBase64'], 'base64');
  for (const side of ['old', 'new']) if (sha(bytes(side)) !== pair.plan[side].bindingSha256) throw new Error('Transition binding bytes differ.');
  if (pair.plan[pair.from].digest !== from.descriptor.digest || pair.plan[pair.to].digest !== to.descriptor.digest) throw new Error('Transition does not describe these releases.');
  if (sha(binding) !== pair.plan[pair.from].bindingSha256) throw new Error('The save binding is not the one the live release uses.');
  const steps = [{ name: 'live', config: liveConfig, binding }, { name: 'candidate', config, binding: bytes(pair.to) },
    ...(pair.to === 'new' ? [{ name: 'swap-back', config: liveConfig, binding }, { name: 'forward', config, binding: bytes('new') }] : [])];
  const probes = await probeChain(config.coreRoot, liveConfig.dataDir, steps);
  return { binding: { path: bindingPath, fromSha256: sha(binding), toSha256: pair.plan[pair.to].bindingSha256,
    fromBase64: binding.toString('base64'), toBase64: bytes(pair.to).toString('base64') }, probes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: {
      repo: { type: 'string' }, commit: { type: 'string' }, current: { type: 'string' }, releases: { type: 'string' },
      release: { type: 'string' }, 'release-dir': { type: 'string' } } });
    const result = command === 'build' ? await build(values)
      : command === 'verify' ? await verify({ repo: values.repo, releaseDir: values['release-dir'] })
      : command === 'prepare-swap' ? await prepareSwap({ current: values.current, releaseDir: values['release-dir'] })
      : (() => { throw new Error('Use build, verify or prepare-swap.'); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Quick build refused: ' + String(error?.message ?? error).replace(/https?:\/\/[^\s]+/gi, '[address redacted]'));
    process.exitCode = 1;
  }
}
