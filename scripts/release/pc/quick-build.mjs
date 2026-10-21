// Builds a release folder from one commit that GitHub has already tested, then
// proves it opens a copy of the live save. This is all the release PC runs: an
// export, a pack copy, the profile/addon build and three startup probes. The
// test suites belong to GitHub; nothing here runs them.
//
//   node scripts/release/pc/quick-build.mjs build --repo <checkout> --commit <sha>
//     --current <current.json> --releases <folder> --release <id>
//   node scripts/release/pc/quick-build.mjs verify --repo <checkout> --release-dir <folder>
//
// Pack changes are refused: a pack upgrade needs a transition plan, which this
// path does not make. The live save is only read; probes open disposable copies.
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

  // Same packs as live, copied so each release keeps its own immutable inputs.
  const packsDir = path.join(dir, 'packs');
  await cp(liveConfig.packsDir, packsDir, { recursive: true, errorOnExist: true, force: false });
  if (await treeShape(packsDir) !== await treeShape(liveConfig.packsDir)) throw new Error('Pack copy differs.');
  const selectionPath = path.join(packsDir, 'selection.json'), selectionBytes = await readFile(selectionPath);
  if (sha(selectionBytes) !== liveConfig.selection.sha256) throw new Error('Pack selection differs from live.');
  const selection = JSON.parse(selectionBytes);
  const packs = {};
  for (const kind of ['data', 'rulesText', 'art']) {
    const file = path.join(packsDir, selection[kind].id, selection[kind].version, 'pack.json');
    if (sha(await readFile(file)) !== liveConfig.packs[kind].sha256) throw new Error('Pack differs from live; pack upgrades need the full release path.');
    packs[kind] = { path: file, sha256: liveConfig.packs[kind].sha256 };
  }
  t = lap('packs', t);

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
    selection: { path: selectionPath, sha256: liveConfig.selection.sha256 }, packs,
    profile: { path: profilePath, sha256: sha(profileBytes) }, addons: { path: addon.path, sha256: sha(addonBytes) } };
  const configPath = path.join(dir, 'config.json'), configBytes = encode(config);
  await writeFile(configPath, configBytes, { flag: 'wx' });
  await writeFile(path.join(dir, 'pointer.json'), encode({ schemaVersion: 2, releaseId: release, config: { path: configPath, sha256: sha(configBytes) } }), { flag: 'wx' });

  // Old code opens the save, new code opens that result, then old code opens
  // the new result: the swap and a swap back both keep every saved record.
  const check = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-pack-check.mjs')).href);
  const identity = await import(pathToFileURL(path.join(core, 'scripts/private-companion/release-identity.mjs')).href);
  const from = await check.configDescriptor(pointer.config.path), to = await check.configDescriptor(configPath);
  if (identity.digestValue(from.descriptor) !== identity.digestValue(to.descriptor)) throw new Error('Candidate dataset differs from live.');
  const binding = await readFile(liveConfig.dataDir + '.dataset.json');
  const script = path.join(core, 'scripts/private-companion/release-pack-check.mjs');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-quick-'));
  const probes = [];
  try {
    const steps = [['live', liveConfig, liveConfig.dataDir], ['candidate', config, 'live'], ['swap-back', liveConfig, 'candidate']];
    for (const [name, probeConfig, source] of steps) {
      const copy = path.join(scratch, name);
      await snapshotSave(source === liveConfig.dataDir ? source : path.join(scratch, source), copy, { saveIdentity: check.saveIdentity, digestValue: identity.digestValue });
      await writeFile(copy + '.dataset.json', binding, { flag: 'wx' });
      probes.push(await runProbe(script, probeConfig, copy, path.join(scratch, name + '.json'), identity.sanitizeExecutionEnvironment));
      if (probes.length > 1) {
        const [a, b] = probes.slice(-2);
        check.assertStableIdentities(a, b);
        check.assertPreserved(a, b);
        if (name === 'swap-back' && a.registryDigest !== b.registryDigest) throw new Error('Swap back dropped saved registry data.');
      }
      t = lap('probe-' + name, t);
    }
  } finally { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }

  const receipt = { schemaVersion: 1, releaseId: release, commit: full, tree, repository: REPOSITORY, checks: github.checks,
    live: { releaseId: pointer.releaseId, configSha256: pointer.config.sha256 },
    sameAsLive: { profile: sha(profileBytes) === liveConfig.profile.sha256, addon: sha(addonBytes) === liveConfig.addons.sha256 },
    probes: probes.map((r, i) => ({ step: ['live', 'candidate', 'swap-back'][i], tasks: r.taskIds.length, saved: Object.keys(r.saved).length, history: r.historyEvents.length, lostRecords: r.migrationSummary.lostRecords })),
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
  for (const pin of [config.selection, config.profile, config.addons, ...Object.values(config.packs)]) {
    if (sha(await readFile(pin.path)) !== pin.sha256) throw new Error('Release input changed since the build.');
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: {
      repo: { type: 'string' }, commit: { type: 'string' }, current: { type: 'string' }, releases: { type: 'string' },
      release: { type: 'string' }, 'release-dir': { type: 'string' } } });
    const result = command === 'build' ? await build(values)
      : command === 'verify' ? await verify({ repo: values.repo, releaseDir: values['release-dir'] })
      : (() => { throw new Error('Use build or verify.'); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Quick build refused: ' + String(error?.message ?? error).replace(/https?:\/\/[^\s]+/gi, '[address redacted]'));
    process.exitCode = 1;
  }
}
