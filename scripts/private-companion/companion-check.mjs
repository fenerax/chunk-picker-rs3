// Run from the companion; prepare an isolated assembly or check it and clean up.
import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, lstat, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { assertReviewedCoreOverlays } from './core-overlay-guard.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relativePath = name => {
  if (typeof name !== 'string' || /[\\:%\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Private input path refused.');
  return name;
};
const companion = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function noLinks(filename, { absent = false } = {}) {
  const absolute = path.resolve(filename), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Input link refused.'); }
    catch (error) { if (absent && error.code === 'ENOENT') return; throw error; }
  }
  if (!equalPath(await realpath(absolute), absolute)) throw new Error('Input canonical path differs.');
}
async function containedFile(directory, filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !inside(directory, filename)) throw new Error('Private input containment refused.');
  await noLinks(filename);
  if (!(await lstat(filename)).isFile()) throw new Error('Private input file required.');
  return filename;
}
const options = {};
if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: companion-check.mjs --core ABS --lane quick|full|addon|profile|prepare|prepare-text [--receipt ABS] [--output ABS]');process.exit(0);}
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index], value = process.argv[index + 1];
  if (!['--core', '--lane', '--output', '--receipt'].includes(flag) || !value || Object.hasOwn(options, flag)) throw new Error('Arguments invalid.');
  options[flag] = value;
}
const core = options['--core'], lane = options['--lane'];
if (!core || !path.isAbsolute(core) || !['quick', 'full', 'addon', 'profile', 'prepare', 'prepare-text'].includes(lane)) throw new Error('Use --core <absolute public checkout> --lane quick|full|addon|profile|prepare|prepare-text [--receipt <absolute receipt>].');
if (['addon', 'profile', 'prepare', 'prepare-text'].includes(lane) && (!options['--output'] || !path.isAbsolute(options['--output']))) throw new Error('Build and prepare lanes require an explicit absent absolute --output.');
if (options['--receipt'] && !path.isAbsolute(options['--receipt'])) throw new Error('Receipt must be absolute.');
if (lane === 'full') {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Run full checks through the shared heavy lock.');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy lock ownership differs.');
  process.kill(Number(pid), 0);
}
await noLinks(core); await noLinks(companion);
const receipt = JSON.parse(await readFile(await containedFile(companion, options['--receipt'] ?? path.join(companion, 'companion.json')), 'utf8'));
if (options['--receipt']) {
  if (receipt.schemaVersion !== 1 || !path.isAbsolute(receipt.coreRoot ?? '')) throw new Error('Companion core differs.');
  await noLinks(receipt.coreRoot);
  if (!equalPath(await realpath(core), await realpath(receipt.coreRoot))) throw new Error('Companion core differs.');
}
const privateRoot = path.join(companion, 'checks/private-source'), expected = new Map();
await noLinks(privateRoot);
if (options['--receipt']) {
  if (!Array.isArray(receipt.privateFiles)) throw new Error('Private manifest required.');
  for (const record of receipt.privateFiles) {
    relativePath(record.path);
    if (expected.has(record.path) || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error('Private manifest invalid.');
    expected.set(record.path, record.sha256);
  }
}
let privateFiles = 0;
const privateNames = new Set();
async function verifyPrivate(relative = '') {
  for (const entry of await readdir(path.join(privateRoot, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Private source link refused.');
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    relativePath(name);
    if (entry.isDirectory()) await verifyPrivate(name);
    else {
      if (!entry.isFile()) throw new Error('Private source file required.');
      if (options['--receipt'] && expected.get(name) !== sha(await readFile(path.join(privateRoot, name)))) throw new Error('Private source changed.');
      privateNames.add(name); privateFiles++;
    }
  }
}
await verifyPrivate();
if (options['--receipt'] && expected.size !== privateFiles) throw new Error('Private source manifest differs.');
const overrides = [], overridden = new Set();
if (receipt.textOverrides !== undefined && !Array.isArray(receipt.textOverrides)) throw new Error('Text overrides invalid.');
for (const record of receipt.textOverrides ?? []) {
  if (!['app/data/changelog.json', 'app/data/roadmap.json'].includes(record.path) || overridden.has(record.path)
    || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error('Text overrides invalid.');
  const bytes = await readFile(await containedFile(companion, record.source));
  if (sha(bytes) !== record.sha256) throw new Error('Text override changed.');
  overrides.push({ path: record.path, bytes }); overridden.add(record.path);
}
// Assembly and the standalone object-only preflight share the same review rule,
// including explicit review for identical copies.
const reviewedOverlays = await readFile(path.join(privateRoot, 'tests/core-overlays.json'), 'utf8')
  .then(JSON.parse, error => { if (error.code === 'ENOENT') return { schemaVersion: 1, files: {} }; throw error; });
let livePayload, liveRules;
const liveProof = receipt.practiceInventory?.proof?.livePayload ?? receipt.practiceLivePayload;
if (liveProof !== undefined) {
  if (!options['--receipt']) throw new Error('Practice live payload requires an explicit practice receipt.');
  const release = path.dirname(options['--receipt']);
  await noLinks(path.join(release, 'release.json'));
  const manifest = JSON.parse(await readFile(path.join(release, 'release.json'), 'utf8'));
  if (manifest.practice !== true || manifest.releaseId !== 'practice-candidate' || manifest.revision !== liveProof.liveRevision) throw new Error('Practice live payload requires a matching practice release.');
  liveRules = await import('./live-payload-rules.mjs');
  livePayload = await liveRules.reopenLivePayloadContext(liveProof, { source: privateRoot, core, revision: manifest.revision });
}
const local = path.join(companion, '.local'), persistent = ['prepare','prepare-text'].includes(lane);
let scratch;
if (persistent) {
  scratch = path.resolve(options['--output']);
  if (!inside(companion, scratch) || [core, privateRoot, (receipt.packsDir ?? path.join(companion, 'packs')), path.join(companion, 'tools'), path.join(companion, 'operator')]
    .some(directory => equalPath(directory, scratch) || inside(directory, scratch) || inside(scratch, directory))) throw new Error('Unsafe prepared output.');
  await noLinks(path.dirname(scratch), { absent: true });
  try { await lstat(scratch); throw new Error('Prepared output exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(scratch), { recursive: true }); await noLinks(path.dirname(scratch));
  await mkdir(scratch);
} else {
  await mkdir(local, { recursive: true }); await noLinks(local);
  scratch = await mkdtemp(path.join(local, 'check-'));
}
let prepared = false;
try {
  await cp(core, scratch, { recursive: true, filter: async name => {
    if (['.git', '.local', 'node_modules', 'var'].includes(path.basename(name))) return false;
    if ((await lstat(name)).isSymbolicLink()) throw new Error('Shared source link refused.');
    return true;
  } });
  if (livePayload !== undefined) await liveRules.assertLivePayloadTarget(livePayload, { core: scratch });
  // Review the frozen copied bytes, not a potentially changing checkout.
  const coreTests = new Map();
  for (const name of privateNames) if (name.startsWith('tests/')) {
    try { coreTests.set(name, await readFile(path.join(scratch, name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const overlayInputs = { manifest: reviewedOverlays, coreFiles: coreTests, privateFiles: privateNames };
  if (livePayload !== undefined) {
    const review = liveRules.reviewLivePayloadOverlays({ livePayload, ...overlayInputs });
    if (review.findings.length) throw new Error(review.findings.map(row => row.message).join('\n'));
    await liveRules.assertLivePayloadTarget(livePayload, { source: privateRoot });
    console.log(JSON.stringify({ practiceLivePayload: { identity: liveProof.digest, tolerated: review.tolerated } }));
  } else assertReviewedCoreOverlays(overlayInputs);
  const copiedPrivate = new Set();
  async function overlay(directory, relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Private source link refused.');
      const name = path.join(relative, entry.name), target = path.join(scratch, name);
      if (entry.isDirectory()) await overlay(directory, name);
      else {
        const portableName = name.split(path.sep).join('/');
        if (!privateNames.has(portableName)) throw new Error('Private source inventory changed during assembly.');
        copiedPrivate.add(portableName);
        // Private tests and runner config deliberately retain all private scenarios.
        if (!name.startsWith('tests' + path.sep) && !['test-selection.mjs', 'test.mjs','adaptive-test-runner.mjs'].some(file => name === path.join('scripts', file))) {
          try { await readFile(target); throw new Error('Private overlay would replace shared code.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const bytes = await readFile(path.join(directory, name));
        if (options['--receipt'] && sha(bytes) !== expected.get(name.split(path.sep).join('/'))) throw new Error('Private source changed during assembly.');
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
      }
    }
  }
  await overlay(privateRoot);
  if (copiedPrivate.size !== privateNames.size) throw new Error('Private source inventory changed during assembly.');
  if (lane === 'prepare' && receipt.practiceInventory !== undefined) {
    const release = path.dirname(options['--receipt']);
    const manifest = JSON.parse(await readFile(path.join(release, 'release.json'), 'utf8'));
    if (manifest.practice !== true || manifest.releaseId !== 'practice-candidate') throw new Error('Practice inventory requires a practice release.');
    await mkdir(path.join(scratch, '.local'), { recursive: true });
    await writeFile(path.join(scratch, '.local/practice-inventory.json'), JSON.stringify({ release, inventory: receipt.practiceInventory }) + '\n', { flag: 'wx' });
  }
  for (const record of overrides) await writeFile(path.join(scratch, record.path), record.bytes);
  if(lane==='prepare-text') {
    prepared=true;
    console.log(JSON.stringify({prepared:true,privateFiles,textOnly:true}));
  } else
  if (['addon', 'profile'].includes(lane)) {
    const module = await import(pathToFileURL(path.join(scratch, 'scripts', lane === 'addon' ? 'build-private-addon.mjs' : 'build-dataset-profile.mjs')));
    const result = lane === 'addon'
      ? await module.buildPrivateAddon({ sourceRoot: scratch, output: options['--output'] })
      : await module.buildDatasetProfile({ sourceRoot: scratch, packsDir: (receipt.packsDir ?? path.join(companion, 'packs')), output: options['--output'] });
    console.log(JSON.stringify({ built: lane, sha256: result.sha256 }));
  } else {
  // Materialize private optional inputs from pinned packs, without retaining a second application source.
  const selection = JSON.parse(await readFile(await containedFile(companion, path.join(receipt.packsDir ?? path.join(companion, 'packs'), 'selection.json')), 'utf8'));
  if (JSON.stringify(selection) !== JSON.stringify(receipt.packs)) throw new Error('Selected packs changed; rebuild the companion receipt.');
  if (selection.schemaVersion !== 1 || ['data', 'rulesText', 'art'].some(kind => !selection[kind] || !/^[a-f0-9]{64}$/.test(selection[kind].sha256 ?? ''))) throw new Error('Selected pack pins required.');
  let packFiles = 0;
  for (const [kind, choice] of Object.entries(selection).filter(([key]) => ['data', 'rulesText', 'art'].includes(key))) {
    relativePath(choice.id); relativePath(choice.version);
    const directory = path.join(receipt.packsDir ?? path.join(companion,'packs'), choice.id, choice.version);
    const manifestBytes = await readFile(await containedFile(directory, path.join(directory, 'pack.json')));
    if (sha(manifestBytes) !== choice.sha256) throw new Error('Pack manifest changed.');
    const manifest = JSON.parse(manifestBytes);
    for (const record of manifest.files) {
      let name = relativePath(record.path);
      const source = await containedFile(directory, path.join(directory, name));
      const bytes = await readFile(source);
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw new Error('Pack payload changed.');
      packFiles++;
      if (kind === 'art') {
        if (name.startsWith('resources/')) { /* same path */ }
        else if (name.startsWith('world-images/')) name = 'reference/original-picker/' + name.slice(13);
        else if (name.startsWith('map-assets/')) name = '.local/' + name;
        else if (name.startsWith('task-item-artwork.')) name = 'app/web/' + name;
        else continue;
      } else if (name.startsWith('local-map/')) name = '.local/map-assets/' + name.slice(10);
      else if (name.startsWith('local-game/')) name = '.local/game-data/' + name.slice(11);
      else if (/^(?:indexes\/|provenance\.json$)/.test(name)) continue;
      const target = path.join(scratch, name);
      try { await readFile(target); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
    }
  }
  if (persistent) {
    prepared = true;
    console.log(JSON.stringify({ prepared: true, privateFiles, packFiles, textOverrides: overrides.length }));
  } else {
  const env = { ...process.env, RS3_PUBLIC_BROWSER_SCREEN_HARNESS:path.join(core,'tests/browser-screen-harness.mjs'), RS3_GAME_DATA_DIR: path.join(scratch, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(scratch, '.local/map-assets') };
  for (const key of ['RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET']) delete env[key];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/test.mjs', lane], { cwd: scratch, windowsHide: true, env, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
  }
  }
} finally {
  if (!prepared) {
    if (persistent ? !inside(companion, scratch) : path.dirname(scratch) !== local || !path.basename(scratch).startsWith('check-')) throw new Error('Cleanup refused.');
    await noLinks(scratch);
    await rm(scratch, { recursive: true, force: true });
  }
}
