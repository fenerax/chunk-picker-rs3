import { readFile, realpath, mkdir, writeFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// This module deliberately imports no application modules before selection.
export async function requireHeavyLock() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Run measurements through the shared heavy-work wrapper.');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy-work lock ownership differs.');
  process.kill(Number(pid), 0);
}

export async function selectCompanion(output) {
  const root = process.env.RS3_PERF_COMPANION_ROOT;
  if (!root) return; // Existing RS3_DATASET / profile / pack environment also works.
  const receipt = JSON.parse(await readFile(path.join(root, 'companion.json'), 'utf8'));
  await mkdir(output, { recursive: true });
  const selection = path.resolve(output, 'pack-selection.json');
  await writeFile(selection, JSON.stringify(receipt.packs));
  process.env.RS3_DATASET = 'duo-legacy';
  process.env.RS3_DATASET_PROFILE = path.resolve(root, receipt.profile.path);
  process.env.RS3_DATASET_PROFILE_SHA256 = receipt.profile.sha256;
  process.env.RS3_PACKS_DIR = path.resolve(root, 'packs');
  process.env.RS3_PACK_SELECTION = selection;
  if (receipt.addons) {
    process.env.RS3_PRIVATE_ADDON = path.resolve(root, receipt.addons.path);
    process.env.RS3_PRIVATE_ADDON_SHA256 = receipt.addons.sha256;
  }
}

export async function readScratchState(filename, { calculationOnly = false } = {}) {
  if (!filename) throw new Error('Set RS3_PERF_STATE to a disposable state.json copy.');
  const resolved = await realpath(filename);
  // Read only explicitly designated scratch; never open an installed game.
  if (!resolved.replaceAll('\\', '/').includes('/perfwalk/')) throw new Error('Save copy must be inside a perfwalk scratch directory.');
  const bytes = await readFile(resolved), document = JSON.parse(bytes);
  const state = document.state ?? document;
  const omitted = new Set(['provenance', 'history', 'taskClaims', 'progressSnapshots', 'finishLine', 'groupGoals', 'ruleReviews']);
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key)
      || !/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)) throw new Error('Invalid scratch static reference.');
    if (calculationOnly && omitted.has(key)) continue;
    const content = gunzipSync(await readFile(path.join(path.dirname(resolved), 'static', reference.id)));
    if (createHash('sha256').update(content).digest('hex') !== reference.sha256) throw new Error('Scratch static checksum differs.');
    state[key] = JSON.parse(content);
  }
  if (calculationOnly) for (const key of omitted) delete state[key];
  state.tasks ??= []; state.history ??= [];
  return { state, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export const mib = bytes => Math.round(bytes / 1048576 * 10) / 10;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

// Check the lexical path before realpath: resolving first would hide an ancestor link.
export async function rejectPathLinks(filename) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Benchmark paths cannot contain a symlink or junction.');
  }
  return realpath(absolute);
}

export async function resolvePerfApplication(root, { appDir, serverEntry } = {}) {
  const selected = await rejectPathLinks(appDir ?? root);
  const applicationRoot = path.basename(selected) === 'app' ? path.dirname(selected) : selected;
  const entry = path.resolve(serverEntry ?? path.join(applicationRoot, 'app/server.mjs'));
  if (!within(applicationRoot, entry) || !entry.endsWith('.mjs')) throw new Error('Server entry must be an .mjs file inside the selected worktree.');
  const resolved = await rejectPathLinks(entry);
  if (!within(applicationRoot, resolved) || !(await lstat(resolved)).isFile()) throw new Error('Server entry resolved outside the selected worktree.');
  return { applicationRoot, serverEntry: resolved };
}

export async function fingerprintPerfApplication(root, serverEntry = path.join(root, 'app/server.mjs')) {
  const files = [];
  async function visit(directory) {
    await rejectPathLinks(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Measured application source cannot contain a symlink or junction.');
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push({ path: path.relative(root, filename).split(path.sep).join('/'), sha256: hash(await readFile(filename)) });
    }
  }
  await visit(path.join(root, 'app'));
  for (const name of ['rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json', 'tasksMap.json']) {
    const filename = path.join(root, name);
    try { await rejectPathLinks(filename); files.push({ path: name, sha256: hash(await readFile(filename)) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!files.some(file => file.path === path.relative(root, serverEntry).split(path.sep).join('/'))) {
    await rejectPathLinks(serverEntry);
    files.push({ path: path.relative(root, serverEntry).split(path.sep).join('/'), sha256: hash(await readFile(serverEntry)) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { root, scope: 'app-and-reference-data', files, sha256: hash(JSON.stringify(files)) };
}

// Use the selected provider for pack inputs, retaining the historical PC loader
// and correction boundary for tracked-file benchmarks and archived apps.
export async function loadPerfInputs({ root, legacyInputRoot = root, dataset, applyEquipmentCorrections, applyCacheShops }) {
  let raw, taskMap, taskMapHistory, definitions, preparedDatasetStages = [];
  if (dataset?.packed) {
    const moduleAt = name => import(pathToFileURL(path.join(root, 'app', name)).href);
    const [{ loadDatasetInputs }, pipeline] = await Promise.all([moduleAt('dataset-bootstrap.mjs'), moduleAt('dataset-pipeline.mjs')]);
    const inputs = await loadDatasetInputs(dataset);
    raw = inputs.definitionBytes;
    taskMap = JSON.parse(inputs.taskBytes);
    taskMapHistory = await dataset.json('app/data/legacy-task-history.json');
    definitions = pipeline.prepareServerDefinitions(JSON.parse(raw), dataset);
    preparedDatasetStages = pipeline.preparedDefinitionStages(definitions);
  } else {
    raw = await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'));
    definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(raw)));
    taskMap = JSON.parse(await readFile(path.join(legacyInputRoot, 'reference/original-picker/tasksMap.json'), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(path.join(legacyInputRoot, 'tasksMap.json'), 'utf8');
    }));
    taskMapHistory = JSON.parse(await readFile(path.join(legacyInputRoot, 'app/data/legacy-task-history.json'), 'utf8'));
  }
  return { raw, definitions, definitionBytes: Buffer.from(JSON.stringify(definitions)), taskMap, taskMapHistory, preparedDatasetStages };
}

export function perfDatasetMetadata(dataset) {
  return dataset ? { datasetId: dataset.datasetId, digest: dataset.digest, packed: dataset.packed === true } : null;
}
