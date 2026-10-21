import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, realpath, lstat, mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { deserialize } from 'node:v8';
import { loadPerfInputs, perfDatasetMetadata } from './inputs.mjs';

// Deliberately no app imports until the shared heavy-work lock is acquired.
// No server, scheduler, writable store, invitations or original backend.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FORMAT = 'unlock-equivalence-v1';
const BASELINE = '395ceb0c4f56b890947273b2f6188c53a19d73e7';
const PROJECTION_BASELINE = 'f49a3fc07d9e6b41123d24d464a37f9ccd654cf7';
const REFERENCE_HELPERS = ['scripts/research/local-parity-model.mjs', 'scripts/lib/provenance-hash.mjs'];
const LOCK = path.join(os.tmpdir(), 'claude/C--Users-User-Projects-chunk-picker-rs3/981cc3e7-cbb2-4474-a361-2dc50f0e409b/scratchpad/speed-heavy.lock');
const NORMALIZATION = ['elapsedMs', 'timingMs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = filename => path.relative(ROOT, filename).replaceAll('\\', '/');
const inside = (base, filename) => { const value = path.relative(base, filename); return !!value && !path.isAbsolute(value) && value !== '..' && !value.startsWith(`..${path.sep}`); };
const overlap = (a, b) => a === b || inside(a, b) || inside(b, a);
const numberSort = (a, b) => Number(a) - Number(b) || a.localeCompare(b);

// JSON semantics (undefined, nonfinite numbers, toJSON) precede canonical key
// ordering. Arrays retain their complete order. Public metrics are never pruned.
function canonical(value) {
  return JSON.stringify(value, (key, child) => {
    if (NORMALIZATION.includes(key)) return undefined;
    if (!child || typeof child !== 'object' || Array.isArray(child)) return child;
    return Object.fromEntries(Object.keys(child).sort().map(name => [name, child[name]]));
  });
}
const valueHash = value => sha(canonical(value));
const serializable = value => JSON.stringify(value, (key, child) => NORMALIZATION.includes(key) ? undefined : child);
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
function firstDifference(before, after, location = '') {
  if (Object.is(before, after)) return null;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return { path: location || '/', reason: 'value' };
  if (Array.isArray(before) !== Array.isArray(after)) return { path: location || '/', reason: 'type' };
  if (Array.isArray(before)) {
    for (let index = 0; index < Math.max(before.length, after.length); index++) {
      if (index >= before.length || index >= after.length) return { path: `${location}/${index}`, reason: 'array-length' };
      const difference = firstDifference(before[index], after[index], `${location}/${index}`);
      if (difference) return difference;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const next = `${location}/${pointer(key)}`;
    if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) return { path: next, reason: 'object-key' };
    const difference = firstDifference(before[key], after[key], next);
    if (difference) return difference;
  }
  return null;
}
function firstOrderDifference(before, after, location = '') {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return null;
  const keys = Object.keys(before), other = Object.keys(after);
  for (let index = 0; index < keys.length; index++) if (keys[index] !== other[index]) return { path: `${location}/${pointer(keys[index])}`, reason: 'serialized-property-order' };
  for (const key of keys) { const difference = firstOrderDifference(before[key], after[key], `${location}/${pointer(key)}`); if (difference) return difference; }
  return null;
}

function options() {
  const args = process.argv.slice(2), result = { mode: 'write', chunks: 24, limit: 32, reference: '.local/perf/unlock-reference', output: '.local/perf/unlock-compare', resume: false };
  const names = new Map([['--mode', 'mode'], ['--source', 'source'], ['--reference', 'reference'], ['--output', 'output'], ['--chunks-per-member', 'chunks'], ['--limit', 'limit'], ['--baseline-dir', 'baselineDir'], ['--projection-dir', 'projectionDir']]);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help' || args[index] === '--self-test') return { [args[index].slice(2).replace('-', '')]: true };
    if (args[index] === '--resume') { result.resume = true; continue; }
    const key = names.get(args[index]), value = args[++index];
    if (!key || !value || value.startsWith('--')) throw new Error('Invalid option; use --help.');
    result[key] = ['chunks', 'limit'].includes(key) ? Number(value) : value;
  }
  if (!['write', 'compare'].includes(result.mode) || !result.source) throw new Error('--mode write|compare and explicit frozen --source are required.');
  if ((result.baselineDir || result.projectionDir) && (result.mode !== 'write' || !result.baselineDir || !result.projectionDir)) throw new Error('Both archive roots are required, and supported only in write mode.');
  if (!Number.isSafeInteger(result.chunks) || result.chunks < 24) throw new Error('--chunks-per-member must be at least 24.');
  if (!Number.isSafeInteger(result.limit) || result.limit < 1) throw new Error('--limit must be a positive full-evaluation count.');
  return result;
}

async function rejectLinks(filename, base) {
  if (filename !== base && !inside(base, filename)) throw new Error('Path escaped its authorized area.');
  let current = base;
  for (const part of path.relative(base, filename).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink/junction forbidden: ${relative(current)}`); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}
async function paths(configuration) {
  const local = await realpath(path.join(ROOT, '.local'));
  await rejectLinks(local, ROOT);
  const source = path.resolve(ROOT, configuration.source), reference = path.resolve(ROOT, configuration.reference), output = path.resolve(ROOT, configuration.output);
  for (const filename of [source, reference, output]) await rejectLinks(filename, local);
  const perf = path.join(local, 'perf'), duo = path.join(local, 'duo');
  if (!inside(local, source) || overlap(source, duo) || overlap(source, perf)) throw new Error('Source must be a copied save under .local outside .local/duo and .local/perf.');
  if (![reference, output].every(filename => inside(perf, filename) && !overlap(filename, source)) || overlap(reference, output)) throw new Error('Separate reference and comparison directories must stay under .local/perf.');
  await realpath(source);
  const destination = configuration.mode === 'write' ? reference : output;
  await mkdir(destination, { recursive: true });
  await rejectLinks(destination, local);
  if (!inside(perf, await realpath(destination))) throw new Error('Output escaped .local/perf.');
  return { source, reference, output, destination, local };
}
async function atomicJSON(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, filename);
}
async function optionalJSON(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function readReferenceManifest(directory) {
  const filename = path.join(directory, 'manifest.json');
  await rejectLinks(filename, directory);
  const bytes = await readFile(filename);
  return { document: JSON.parse(bytes), sha256: sha(bytes) };
}
function verifyReferencePin(actual, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Cannot resume comparison without a pinned reference manifest; use a fresh output directory.');
  assert.equal(actual, expected, 'Pinned reference manifest changed');
}
async function verifyReferenceManifest(directory, expected) {
  const filename = path.join(directory, 'manifest.json');
  await rejectLinks(filename, directory);
  verifyReferencePin(sha(await readFile(filename)), expected);
}
async function sourceFingerprint(directory) {
  await rejectLinks(path.join(directory, 'state.json'), directory);
  const bytes = await readFile(path.join(directory, 'state.json')), document = JSON.parse(bytes), dependencies = [];
  for (const [field, reference] of Object.entries(document.storage?.fields ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(reference?.id ?? '')) throw new Error('Invalid copied static dependency.');
    const filename = path.join(directory, 'static', reference.id);
    await rejectLinks(filename, directory);
    dependencies.push({ field, file: reference.id, sha256: sha(await readFile(filename)) });
  }
  return { stateSha256: sha(bytes), dependencies };
}
async function appFingerprint(root = ROOT) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Application fingerprint cannot follow links.');
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push({ file: path.relative(root, filename).replaceAll('\\', '/'), sha256: sha(await readFile(filename)) });
    }
  }
  await visit(path.join(root, 'app'));
  await visit(path.join(root, 'archive/data')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const taskMapFile = await lstat(path.join(root, 'reference/original-picker/tasksMap.json')).then(() => 'reference/original-picker/tasksMap.json').catch(error => { if (error.code !== 'ENOENT') throw error; return 'tasksMap.json'; });
  for (const name of ['rs3-chunkpicker-chunkinfo-export.json', taskMapFile, ...REFERENCE_HELPERS]) {
    const bytes = await readFile(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (bytes) files.push({ file: name, sha256: sha(bytes) });
  }
  return { sha256: valueHash(files), files };
}

// Archives have no git metadata. Every application/definition/reader byte must
// match its pinned commit before any module is imported or worker is started.
async function verifiedArchive(directory, commit, local) {
  const root = path.resolve(ROOT, directory);
  await rejectLinks(root, local);
  assert.ok(inside(local, root), 'Reference archive must stay under this worktree .local');
  assert.equal(await realpath(root), root, 'Reference archive path changed');
  const tree = execFileSync('git', ['ls-tree', '-r', '-z', commit, '--', 'app', 'archive/data', 'rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json', 'tasksMap.json', ...REFERENCE_HELPERS], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const expected = new Set();
  for (const row of tree.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    assert.ok(match, 'Archive tree contains a link or unsupported entry');
    const [, , hash, name] = match, filename = path.join(root, name);
    await rejectLinks(filename, root);
    const bytes = await readFile(filename);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), hash, `Archive differs from ${commit}: ${name}`);
    expected.add(name);
  }
  const fingerprint = await appFingerprint(root);
  assert.deepEqual(new Set(fingerprint.files.map(row => row.file)), expected, 'Archive has extra or missing application/helper files');
  return { root, commit, ...fingerprint, readerSha256: sha(await readFile(path.join(root, 'scripts/research/local-parity-model.mjs'))) };
}

function verifyInheritedLock({ inheritedPath, inheritedToken, inheritedPid, parentPid, owner, marker }) {
  assert.equal(path.resolve(inheritedPath ?? ''), path.resolve(LOCK), 'Inherited heavy lock path differs');
  assert.match(inheritedToken ?? '', /^[a-f0-9]{32}$/, 'Invalid inherited heavy lock token');
  assert.equal(Number(inheritedPid), parentPid, 'Heavy lock must belong to the direct wrapper parent');
  assert.equal(owner.pid, parentPid, 'Heavy lock owner PID differs');
  assert.equal(owner.script, '.local/with-heavy.ps1', 'Heavy lock owner is not the wrapper');
  assert.equal(owner.token, inheritedToken, 'Heavy lock ownership token differs');
  assert.equal(marker.replace(/^\uFEFF/, '').trim(), owner.owner, 'Heavy lock owner marker differs');
}

function candidatesFor(state, member, world, registry, evaluateRollPool, count) {
  const locked = id => /^[1-9]\d*$/.test(id) && world.chunks.has(id) && world.surface.has(id) && !member.unlocked.includes(id);
  const pool = evaluateRollPool(world, state, member.id, registry).eligible.map(row => row.id).filter(locked).sort(numberSort);
  const adjacent = [...new Set(member.unlocked.flatMap(id => world.neighbors.get(id) ?? []))].filter(locked).sort(numberSort);
  const selected = [...new Set(member.selected)].filter(locked).sort(numberSort);
  const pending = [...new Set(member.pendingRoll)].filter(locked).sort(numberSort);
  const all = [...world.surface].filter(locked).sort(numberSort);
  const special = all.filter(id => /island|crandor|entrana|karamja|daemonheim|port|ship|ferry|mos le/i.test(world.chunks.get(id).name));
  const distance = id => {
    const x = Number(id) >> 8, y = Number(id) & 255;
    return Math.min(...member.unlocked.map(owned => Math.abs(x - (Number(owned) >> 8)) + Math.abs(y - (Number(owned) & 255))));
  };
  const far = [...all].sort((a, b) => distance(b) - distance(a) || numberSort(a, b));
  const chosen = [];
  const add = (ids, quota = Infinity) => { let added = 0; for (const id of ids) if (!chosen.includes(id) && added < quota) { chosen.push(id); added++; } };
  // Reserve each lane before filling: reviewed 13617, pending, selected,
  // roll-pool, arbitrary neighbours, named island/transport, distant regions.
  add(['13617'].filter(locked)); add(pending); add(selected, 3); add(pool, 6);
  add(adjacent.filter(id => !pool.includes(id)), 4); add(adjacent, 2); add(special, 4); add(far, 3);
  const reservedSize = chosen.length;
  add(pool); add(adjacent); add(all);
  const ids = chosen.slice(0, Math.max(count, reservedSize));
  if (ids.length < count) throw new Error(`Insufficient locked chunks for ${member.id}.`);
  const classified = ids.map(id => ({ id, name: world.chunks.get(id).name, pool: pool.includes(id), adjacent: adjacent.includes(id), selected: selected.includes(id), pendingRoll: pending.includes(id), islandOrTransport: special.includes(id), far: distance(id) >= 10, reviewed13617: id === '13617' }));
  if (pool.length && !classified.some(row => row.pool) || adjacent.length && !classified.some(row => row.adjacent)
    || selected.length && !classified.some(row => row.selected) || pending.length && !classified.some(row => row.pendingRoll)
    || special.length && !classified.some(row => row.islandOrTransport) || !classified.some(row => row.far)) throw new Error(`Diversity reservation failed for ${member.id}; increase --chunks-per-member.`);
  return classified;
}
function scenariosFor(state, candidates) {
  const scenarios = [{ id: 'baseline', ownerId: null, unlocks: [] }];
  for (const set of candidates) {
    for (const chunk of set.chunks) scenarios.push({ id: `single-${set.memberId}-${chunk.id}`, ownerId: set.memberId, unlocks: [chunk.id] });
    scenarios.push({ id: `pending-${set.memberId}`, ownerId: set.memberId, unlocks: [], syntheticPendingOffer: true });
    const groups = [set.chunks.filter(row => row.pool), set.chunks.filter(row => row.adjacent), set.chunks.filter(row => row.far || row.islandOrTransport || row.reviewed13617)];
    for (let chain = 0; chain < 3; chain++) {
      const ids = [...new Set([...groups[chain].map(row => row.id), ...set.chunks.map(row => row.id)])].slice(0, 3);
      assert.equal(ids.length, 3);
      for (let step = 1; step <= 3; step++) scenarios.push({ id: `chain-${set.memberId}-${chain + 1}-${step}`, ownerId: set.memberId, unlocks: ids.slice(0, step), chain: chain + 1, step });
    }
  }
  return scenarios.flatMap(scenario => state.members.map(member => ({ ...scenario, evaluatedMemberId: member.id, key: `${scenario.id}--${member.id}` })));
}

async function startWorker(definitionBytes, world, root = ROOT, dataset, preparedDatasetStages = []) {
  const shared = new SharedArrayBuffer(definitionBytes.length); Buffer.from(shared).set(definitionBytes);
  const worker = new Worker(pathToFileURL(path.join(root, 'app/tasks/worker.mjs')), { workerData: { definitionBytes: shared, world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [],
    ...(dataset?.packed ? { datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, preparedDatasetStages } : {}) } });
  let resolveReady, rejectReady, sequence = 0, stopping = false;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }), pending = new Map();
  const timer = setTimeout(() => rejectReady(new Error('Worker startup exceeded 120s.')), 120000);
  const fail = error => { clearTimeout(timer); rejectReady(error); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  worker.on('error', fail); worker.on('exit', code => { if (!stopping) fail(new Error(`Worker exited ${code}.`)); });
  worker.on('message', message => {
    if (message.type === 'ready') { clearTimeout(timer); resolveReady(message.dynamicCatalogueBytes === undefined ? message : { ...message, dynamicCatalogue: deserialize(message.dynamicCatalogueBytes) }); return; }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${message.error.name}: ${message.error.message}`)); else entry.resolve(message);
  });
  const close = async () => { stopping = true; fail(new Error('Worker stopped.')); await worker.terminate(); };
  try {
    return { ready: await ready, close, evaluate(state, memberId, input) {
      return new Promise((resolve, reject) => {
        const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(new Error('Full evaluation exceeded 120s.')); }, 120000);
        pending.set(id, { resolve, reject, timer: timeout });
        try { worker.postMessage({ id, type: 'evaluate', state, memberId, input, resultView: 'full', resultTransport: 'json-shared-v1' }); }
        catch (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
      });
    } };
  } catch (error) { await close(); throw error; }
}

function prepareArtifact(value, canonicalHash = valueHash) {
  const text = serializable(value);
  return { text, sha256: canonicalHash(value), serializedSha256: sha(text), jsonBytes: Buffer.byteLength(text) };
}
function verifyReferenceMetadata(entry) {
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !/^[a-f0-9]{64}$/.test(entry.serializedSha256 ?? '')
    || !Number.isSafeInteger(entry.jsonBytes) || entry.jsonBytes < 1) throw new TypeError('Invalid reference artifact metadata.');
}
async function compareArtifact(directory, expected, value, canonicalHash = valueHash) {
  verifyReferenceMetadata(expected);
  const text = serializable(value), serializedSha256 = sha(text), jsonBytes = Buffer.byteLength(text);
  if (serializedSha256 === expected.serializedSha256) {
    // Reference entries were fully validated at capture. Exact normalized JSON
    // bytes imply equal canonical bytes, so its pinned canonical hash is reusable.
    // Check the retained compressed bytes without decoding the same JSON again.
    assert.equal(jsonBytes, expected.jsonBytes, 'Serialized artifact length');
    await verifyRetainedArtifact(directory, expected);
    return { prepared: { text, sha256: expected.sha256, serializedSha256, jsonBytes }, difference: null };
  }
  const prepared = { text, sha256: canonicalHash(value), serializedSha256, jsonBytes };
  const before = await readArtifact(directory, expected, true), actual = JSON.parse(text);
  const difference = firstDifference(before, actual) ?? firstOrderDifference(before, actual);
  assert.ok(difference, 'Hash mismatch without a structural difference');
  return { prepared, difference };
}
async function artifact(destination, key, view, value, prepared = prepareArtifact(value)) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Unsafe scenario artifact key.');
  const { text } = prepared, file = `${key}.${view}.json.gz`, bytes = gzipSync(text, { level: 1 });
  await writeFile(path.join(destination, file), bytes, { flag: 'wx' });
  return { sha256: prepared.sha256, serializedSha256: prepared.serializedSha256, compressedSha256: sha(bytes), jsonBytes: prepared.jsonBytes, compressedBytes: bytes.length, file };
}
async function readArtifact(directory, entry, parse = false) {
  verifyReferenceMetadata(entry);
  if (!/^[a-zA-Z0-9_-]+\.(full|play|duo|sidebar)\.json\.gz$/.test(entry.file)) throw new Error('Unsafe reference artifact path.');
  const filename = path.join(directory, entry.file); await rejectLinks(filename, directory);
  const bytes = await readFile(filename);
  verifyCompressedBytes(bytes, entry);
  const text = gunzipSync(bytes).toString('utf8'); assert.equal(Buffer.byteLength(text), entry.jsonBytes, 'Serialized artifact length');
  assert.equal(sha(text), entry.serializedSha256, 'Serialized artifact checksum');
  if (!parse) return null;
  const value = JSON.parse(text); assert.equal(valueHash(value), entry.sha256, 'Canonical artifact checksum');
  return value;
}
function verifyCompressedBytes(bytes, entry) {
  if (!Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 1
    || !/^[a-f0-9]{64}$/.test(entry.compressedSha256 ?? '')) throw new TypeError('Invalid compressed artifact metadata.');
  assert.equal(bytes.length, entry.compressedBytes, 'Compressed artifact length');
  assert.equal(sha(bytes), entry.compressedSha256, 'Compressed artifact checksum');
}
async function verifyRetainedArtifact(directory, entry) {
  if (!/^[a-zA-Z0-9_-]+\.(full|play|duo|sidebar)\.json\.gz$/.test(entry.file)) throw new Error('Unsafe reference artifact path.');
  const filename = path.join(directory, entry.file); await rejectLinks(filename, directory);
  verifyCompressedBytes(await readFile(filename), entry);
}

async function run(configuration) {
  const locations = await paths(configuration);
  const calculationArchive = configuration.baselineDir ? await verifiedArchive(configuration.baselineDir, BASELINE, locations.local) : null;
  const projectionArchive = configuration.projectionDir ? await verifiedArchive(configuration.projectionDir, PROJECTION_BASELINE, locations.local) : null;
  const calculationRoot = calculationArchive?.root ?? ROOT, inputRoot = projectionArchive?.root ?? ROOT;
  const moduleAt = (root, name) => import(pathToFileURL(path.join(root, name)).href);
  // mkdir is exclusive, with no stale-lock guessing or takeover. Each bounded
  // batch owns the lock until the worker has terminated and inputs rechecked.
  const inheritedPath = process.env.RS3_HEAVY_LOCK_PATH;
  const inheritedToken = process.env.RS3_HEAVY_LOCK_TOKEN;
  const inheritedPid = process.env.RS3_HEAVY_LOCK_PID;
  const hasInheritedLock = [inheritedPath, inheritedToken, inheritedPid].some(value => value !== undefined);
  let ownsLock = false, ownedMarker;
  if (hasInheritedLock) {
    const owner = JSON.parse((await readFile(path.join(LOCK, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
    verifyInheritedLock({ inheritedPath, inheritedToken, inheritedPid, parentPid: process.ppid, owner, marker: await readFile(path.join(LOCK, 'owner'), 'utf8') });
    process.kill(process.ppid, 0);
  } else {
    await mkdir(path.dirname(LOCK), { recursive: true });
    let announcedWait = false;
    for (;;) {
      try { await mkdir(LOCK); ownsLock = true; break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!announcedWait) { console.error(`Waiting for shared heavy-work lock (20s checks, no takeover): ${LOCK}`); announcedWait = true; }
        await new Promise(resolve => setTimeout(resolve, 20000));
      }
    }
  }
  let worker, copiedBefore, appBefore, referenceBefore;
  try {
    const startedAt = new Date().toISOString();
    if (ownsLock) {
      ownedMarker = `engine ${process.pid} ${startedAt}`;
      await writeFile(path.join(LOCK, 'owner'), `${ownedMarker}\n`, { flag: 'wx' });
      await writeFile(path.join(LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, script: relative(fileURLToPath(import.meta.url)), mode: configuration.mode, startedAt }) + '\n', { flag: 'wx' });
    }
    const manifestFile = path.join(locations.destination, 'manifest.json'), saved = await optionalJSON(manifestFile);
    if (saved && !configuration.resume) throw new Error('Destination already has a manifest; use --resume or a fresh destination.');
    const pinnedReference = configuration.mode === 'compare' ? await readReferenceManifest(locations.reference) : null;
    const reference = pinnedReference?.document ?? null;
    referenceBefore = pinnedReference?.sha256;
    if (configuration.mode === 'compare' && (!reference || reference.format !== FORMAT || !reference.complete)) throw new Error('Comparison requires a complete reference.');
    copiedBefore = await sourceFingerprint(locations.source); appBefore = await appFingerprint(calculationRoot);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (configuration.mode === 'write' && !calculationArchive) {
      const baselineDiff = execFileSync('git', ['diff', '--name-only', BASELINE, '--', 'app', 'archive/data', 'rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json', 'tasksMap.json'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(baselineDiff, '', 'Reference app/ and definitions must match the unchanged baseline');
      const dirtyApp = execFileSync('git', ['status', '--porcelain', '--', 'app'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(dirtyApp, '', 'Reference app/ must have no local edits');
    }
    const environment = Object.fromEntries(['RS3_CACHE_SHOP_CONTENTS', 'RS3_RESOURCE_CONTENTS', 'RS3_ARCHAEOLOGY_CONTENTS', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR'].map(key => [key, process.env[key] ?? null]));
    if (process.env.RS3_PACKS_DIR || process.env.RS3_PACK_SELECTION) {
      for (const key of ['RS3_DATASET', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION']) environment[key] = process.env[key] ?? null;
    }
    for (const key of ['RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR']) {
      if (!environment[key] && !(environment.RS3_PACKS_DIR || environment.RS3_PACK_SELECTION)) throw new Error(`${key} must explicitly point to the read-only main data directory.`);
      if (environment[key]) await realpath(environment[key]);
    }
    const existing = saved ?? reference;
    if (existing) {
      assert.equal(existing.format, FORMAT); assert.deepEqual(existing.normalization, NORMALIZATION);
      assert.deepEqual(existing.inputs.source, copiedBefore, 'Frozen copied save changed');
      assert.deepEqual(existing.inputs.environment, environment, 'Content flags/data paths changed');
      assert.equal(existing.chunksPerMember, configuration.chunks, 'Chunk-count configuration changed');
    }
    if (saved) {
      assert.equal(saved.inputs.app.sha256, appBefore.sha256, 'Cannot resume across app edits');
      assert.deepEqual(saved.inputs.referenceSources ?? null, calculationArchive ? { calculation: calculationArchive, inputAndProjection: projectionArchive } : null, 'Cannot resume across reference archive edits');
      if (reference) verifyReferencePin(referenceBefore, saved.inputs.referenceManifestSha256);
    }
    const [{ readCopiedState }, { applyCommand }, { createRuleRegistry, evaluateRollPool }, { buildWorld }, { applyEquipmentCorrections }, { applyCacheShops }, migration, { projectPlayResult }, { projectDuoPlayResult, projectDuoSidebarResult }, { createGameplayFingerprint }] = await Promise.all([
      moduleAt(inputRoot, 'scripts/research/local-parity-model.mjs'), moduleAt(inputRoot, 'app/core/state.mjs'), moduleAt(inputRoot, 'app/core/rules.mjs'), moduleAt(calculationRoot, 'app/data/world.mjs'),
      moduleAt(calculationRoot, 'app/data/equipment-corrections.mjs'), moduleAt(calculationRoot, 'app/data/cache-shops.mjs'), moduleAt(inputRoot, 'app/tasks/migration.mjs'),
      moduleAt(inputRoot, 'app/play-view.mjs'), moduleAt(inputRoot, 'app/duo-play-view.mjs'), moduleAt(inputRoot, 'app/storage/gameplay-fingerprint.mjs'),
    ]);
    // Old archived application roots predate dataset providers and keep their original constructors.
    const { selectedDataset } = await moduleAt(calculationRoot, 'app/dataset-runtime.mjs').catch(error => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
    });
    if (existing?.inputs.dataset) assert.deepEqual(existing.inputs.dataset, perfDatasetMetadata(selectedDataset), 'Selected dataset changed');
    const registry = createRuleRegistry(), loaded = await readCopiedState(locations.source, registry);
    const { raw, definitions, definitionBytes, taskMap, taskMapHistory, preparedDatasetStages } = await loadPerfInputs({ root: calculationRoot, legacyInputRoot: inputRoot,
      dataset: selectedDataset, applyEquipmentCorrections, applyCacheShops });
    const world = buildWorld(definitions, { dataset: selectedDataset });
    worker = await startWorker(definitionBytes, world, calculationRoot, selectedDataset, preparedDatasetStages);
    const registered = new Set(loaded.state.tasks.map(row => row.id));
    const migrationReused = worker.ready.catalogue.every(row => registered.has(row.id)) && loaded.state.identityRegistry?.schemaVersion === 1
      && migration.hasCurrentProgressAliasMigration(loaded.state)
      && loaded.state.members.every(member => member.sourceMapId == null || loaded.state.legacy?.gameplayMigration?.schemaVersion >= 2 && migration.hasGameplayMigration(loaded.state, member))
      && loaded.state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => migration.resolveSavedTaskId(loaded.state.identityRegistry, id) === id)
        && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || migration.resolveSavedTaskId(loaded.state.identityRegistry, id, category) === id)));
    const state = migrationReused ? loaded.state : migration.migrateOwnedGameplay(loaded.state, { definitions, catalogue: worker.ready.catalogue, dynamicCatalogue: worker.ready.dynamicCatalogue,
      taskMap, taskMapHistory }).state;
    const stateSha256 = valueHash(state), stateSerializedSha256 = sha(serializable(state)), candidates = existing?.candidates ?? state.members.map(member => ({ memberId: member.id, chunks: candidatesFor(state, member, world, registry, evaluateRollPool, configuration.chunks) }));
    const scenarios = existing?.scenarios ?? scenariosFor(state, candidates), fingerprint = createGameplayFingerprint();
    if (existing) assert.equal(existing.inputs.calculationStateSha256, stateSha256, 'Detached calculation/migration state changed');
    const report = saved ?? { format: FORMAT, mode: configuration.mode, createdAt: new Date().toISOString(), baselineHead: BASELINE, node: process.version,
      normalization: NORMALIZATION, chunksPerMember: configuration.chunks, migrationReused, candidates, scenarios,
      inputs: { source: copiedBefore, sourcePath: relative(locations.source), app: appBefore, head, environment, dataset: perfDatasetMetadata(selectedDataset), definitionSha256: sha(raw), effectiveDefinitionSha256: sha(definitionBytes), calculationStateSha256: stateSha256, scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
        ...(calculationArchive ? { referenceSources: { calculation: calculationArchive, inputAndProjection: projectionArchive } } : {}),
        ...(reference ? { referenceManifestSha256: referenceBefore } : {}) },
      ...(reference ? { referenceAppSha256: reference.inputs.app.sha256 } : {}), results: {}, complete: false, equivalent: configuration.mode === 'compare' ? true : null };
    await atomicJSON(manifestFile, report);
    let processed = 0;
    for (const scenario of scenarios) {
      if (report.results[scenario.key]) {
        // These indexed blobs already passed full validation when written.
        // Exact compressed bytes prove that content is unchanged on resume.
        for (const entry of Object.values(report.results[scenario.key].views)) await verifyRetainedArtifact(locations.destination, entry);
        continue;
      }
      if (processed >= configuration.limit) break;
      let after = state, pendingOffer = null;
      if (scenario.syntheticPendingOffer) {
        // Produce a valid offered pair through the public command with a fixed
        // RNG, then resolve it through the same command as the real UI. This is
        // an explicit in-memory fixture: the copied save has no pending offer.
        if (!after.members.find(member => member.id === scenario.ownerId).pendingRoll.length) after = applyCommand(after,
          { type: 'roll', memberId: scenario.ownerId, count: 2 }, { world, registry, random: () => 0, now: new Date('2026-10-12T00:01:00.000Z') });
        pendingOffer = [...after.members.find(member => member.id === scenario.ownerId).pendingRoll];
        after = applyCommand(after, { type: 'unlock-selection', memberId: scenario.ownerId, chunkId: pendingOffer[0] },
          { world, registry, now: new Date('2026-10-12T00:01:01.000Z') });
      }
      for (const [index, chunkId] of scenario.unlocks.entries()) {
        const pendingChoice = after.members.find(member => member.id === scenario.ownerId).pendingRoll.includes(chunkId);
        after = applyCommand(after, pendingChoice ? { type: 'unlock-selection', memberId: scenario.ownerId, chunkId }
          : { type: 'set-chunk', memberId: scenario.ownerId, chunkId, status: 'unlocked' },
        { world, registry, now: new Date(Date.UTC(2026, 9, 12, 0, 0, index)) });
      }
      for (const member of state.members) if (member.id !== scenario.ownerId) assert.deepEqual(after.members.find(row => row.id === member.id), member, 'Peer ownership/progress changed');
      const message = await worker.evaluate(after, scenario.evaluatedMemberId, fingerprint(after));
      const full = JSON.parse(Buffer.from(message.resultJSON).toString('utf8')), play = projectPlayResult(full);
      const views = { full, play, duo: projectDuoPlayResult(play, after), sidebar: projectDuoSidebarResult(play, after, registry, scenario.evaluatedMemberId) };
      const row = { inputSha256: valueHash(after), ...(pendingOffer ? { pendingOffer, chosen: pendingOffer[0] } : {}), views: {}, equivalent: configuration.mode === 'compare' ? true : null, differences: [] };
      const expected = reference?.results[scenario.key];
      if (reference) { assert.ok(expected, 'Missing reference scenario'); assert.equal(expected.inputSha256, row.inputSha256, 'Scenario state differs from reference'); }
      for (const [name, value] of Object.entries(views)) {
        const comparison = reference ? await compareArtifact(locations.reference, expected.views[name], value) : null;
        const prepared = comparison?.prepared ?? prepareArtifact(value);
        // An interrupted batch may leave an unindexed completed artifact. It is
        // adopted only after proving it exactly matches this new calculation.
        const filename = path.join(locations.destination, `${scenario.key}.${name}.json.gz`);
        try {
          const bytes = await readFile(filename), text = gunzipSync(bytes).toString('utf8');
          assert.equal(Buffer.byteLength(text), prepared.jsonBytes, 'Orphan artifact length differs from fresh calculation');
          assert.equal(sha(text), prepared.serializedSha256, 'Orphan artifact differs from fresh calculation');
          row.views[name] = { sha256: prepared.sha256, serializedSha256: prepared.serializedSha256, compressedSha256: sha(bytes), jsonBytes: prepared.jsonBytes, compressedBytes: bytes.length, file: path.basename(filename) };
        } catch (error) { if (error.code !== 'ENOENT') throw error; row.views[name] = await artifact(locations.destination, scenario.key, name, value, prepared); }
        if (comparison?.difference) {
          row.differences.push({ view: name, ...comparison.difference, expectedSha256: expected.views[name].sha256, actualSha256: row.views[name].sha256,
            expectedSerializedSha256: expected.views[name].serializedSha256, actualSerializedSha256: row.views[name].serializedSha256 });
          row.equivalent = false; report.equivalent = false;
        }
      }
      report.results[scenario.key] = row; processed++;
      report.complete = Object.keys(report.results).length === scenarios.length;
      report.updatedAt = new Date().toISOString();
      await atomicJSON(manifestFile, report);
      console.error(`${configuration.mode} ${Object.keys(report.results).length}/${scenarios.length}: ${scenario.key}${row.equivalent === false ? ' DIFFERENT' : ''}`);
      assert.equal(sha(serializable(state)), stateSerializedSha256, 'Unlock mutated frozen baseline');
    }
    report.complete = Object.keys(report.results).length === scenarios.length;
    report.updatedAt = new Date().toISOString(); await atomicJSON(manifestFile, report);
    console.log(JSON.stringify({ mode: configuration.mode, processed, completed: Object.keys(report.results).length, total: scenarios.length, complete: report.complete, equivalent: report.equivalent,
      differences: Object.values(report.results).reduce((sum, row) => sum + row.differences.length, 0), manifest: relative(manifestFile) }));
    if (report.equivalent === false) process.exitCode = 1;
  } finally {
    try {
      if (worker) await worker.close();
      if (referenceBefore) await verifyReferenceManifest(locations.reference, referenceBefore);
      if (copiedBefore) assert.deepEqual(await sourceFingerprint(locations.source), copiedBefore, 'Frozen copied save changed during batch');
      if (appBefore) assert.deepEqual(await appFingerprint(calculationRoot), appBefore, 'Application changed during batch');
      if (projectionArchive) assert.deepEqual(await verifiedArchive(configuration.projectionDir, PROJECTION_BASELINE, locations.local), projectionArchive, 'Input/projection archive changed during batch');
    } finally {
      // An inherited wrapper owns cleanup; only our exclusive mkdir authorizes it.
      if (ownsLock && (await readFile(path.join(LOCK, 'owner'), 'utf8')).trim() === ownedMarker) await rm(LOCK, { recursive: true });
    }
  }
}

const configuration = options();
if (configuration.help) console.log('node scripts/perf/unlock-equivalence.mjs --mode write|compare --source .local/speed-save [--reference .local/perf/unlock-reference] [--output .local/perf/unlock-compare] [--chunks-per-member 24] [--limit 32] [--resume] [--baseline-dir .local/baseline-395ceb0 --projection-dir .local/projection-f49a3fc]\nOne serial native full worker; frozen scenarios include both baselines, 24 unlocks/member and 3 length-3 chains/member, evaluated for every peer. Compressed full/play/duo/sidebar results remain private. Each bounded batch acquires/releases the shared heavy-work mkdir lock, or verifies ownership inherited from .local/with-heavy.ps1. Archive write mode verifies pinned 395ceb0 calculation and f49a3fc input/projection sources under this worktree .local. --resume continues the exact source/app generation. Set RS3_GAME_DATA_DIR and RS3_MAP_ASSETS_DIR to read-only main directories. --self-test loads no app/game data.');
else if (configuration.selftest) {
  assert.equal(canonical({ b: 2, a: { z: 3, elapsedMs: 9, passes: 4, checks: 5 }, timingMs: { totalMs: 99 } }), '{"a":{"checks":5,"passes":4,"z":3},"b":2}');
  assert.equal(valueHash({ a: 1, b: 2 }), valueHash({ b: 2, a: 1 }));
  assert.notEqual(valueHash([1, 2]), valueHash([2, 1]));
  assert.notEqual(sha(serializable({ a: 1, b: 2 })), sha(serializable({ b: 2, a: 1 })));
  assert.deepEqual(firstOrderDifference({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }), { path: '/a/x', reason: 'serialized-property-order' });
  assert.deepEqual(firstDifference({ 'a/b': [1, 2] }, { 'a/b': [1, 3] }), { path: '/a~1b/1', reason: 'value' });
  assert.deepEqual(firstDifference([1], [1, 2]), { path: '/1', reason: 'array-length' });
  assert.equal(firstDifference(JSON.parse(canonical({ a: 1, elapsedMs: 1 })), JSON.parse(canonical({ elapsedMs: 2, a: 1 }))), null);
  const ids = Array.from({ length: 100 }, (_, index) => String(10000 + index));
  const fixtureWorld = { chunks: new Map([...ids.map(id => [id, { name: Number(id) >= 10060 && Number(id) <= 10063 ? 'Island transport' : `Chunk ${id}` }]), ['13617', { name: 'Reviewed chunk' }]]),
    surface: new Set([...ids, '13617']), neighbors: new Map([['7495', ids.slice(8, 20)]]) };
  const fixtureMember = { id: 'fixture', unlocked: ['7495'], selected: ['10025'], pendingRoll: ['10050'] };
  const fixtureCandidates = candidatesFor({}, fixtureMember, fixtureWorld, {}, () => ({ eligible: ids.slice(0, 8).map(id => ({ id })) }), 24);
  assert.equal(fixtureCandidates.length, 24);
  for (const lane of ['pool', 'adjacent', 'selected', 'pendingRoll', 'islandOrTransport', 'far', 'reviewed13617']) assert.ok(fixtureCandidates.some(row => row[lane]), `Missing fixture lane ${lane}`);
  const fixtureState = { members: [fixtureMember, { ...fixtureMember, id: 'peer' }] };
  const fixtureScenarios = scenariosFor(fixtureState, fixtureState.members.map(member => ({ memberId: member.id, chunks: fixtureCandidates })));
  assert.equal(fixtureScenarios.length, 138);
  assert.equal(fixtureScenarios.filter(row => row.syntheticPendingOffer).length, 4);
  assert.equal(fixtureScenarios.filter(row => row.step).length, 36);
  const compressed = gzipSync('{"fixture":true}'), retained = { compressedBytes: compressed.length, compressedSha256: sha(compressed) };
  verifyCompressedBytes(compressed, retained);
  const tampered = Buffer.from(compressed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => verifyCompressedBytes(tampered, retained), /Compressed artifact checksum/);
  assert.throws(() => verifyCompressedBytes(compressed.subarray(0, compressed.length - 1), retained), /Compressed artifact length/);
  assert.throws(() => verifyCompressedBytes(compressed, { ...retained, compressedBytes: undefined }), /Invalid compressed artifact metadata/);
  assert.throws(() => verifyCompressedBytes(compressed, { ...retained, compressedSha256: 'invalid' }), /Invalid compressed artifact metadata/);
  await assert.rejects(verifyRetainedArtifact(ROOT, { ...retained, file: '../fixture.full.json.gz' }), /Unsafe reference artifact path/);
  const fixtureParent = path.join(ROOT, '.local', 'perf');
  await rejectLinks(fixtureParent, ROOT);
  await mkdir(fixtureParent, { recursive: true });
  const fixtureParentReal = await realpath(fixtureParent);
  assert.ok(inside(ROOT, fixtureParentReal), 'Self-test parent escaped worktree');
  const fixtureDirectory = await mkdtemp(path.join(fixtureParentReal, 'oracle-self-test-'));
  try {
    const manifestFile = path.join(fixtureDirectory, 'manifest.json');
    await writeFile(manifestFile, '{"fixture":"reference"}\n');
    const pinnedFixture = await readReferenceManifest(fixtureDirectory);
    verifyReferencePin(pinnedFixture.sha256, pinnedFixture.sha256);
    await verifyReferenceManifest(fixtureDirectory, pinnedFixture.sha256);
    assert.throws(() => verifyReferencePin(pinnedFixture.sha256, undefined), /fresh output directory/);
    await writeFile(manifestFile, '{"fixture":"changed"}\n');
    await assert.rejects(verifyReferenceManifest(fixtureDirectory, pinnedFixture.sha256), /Pinned reference manifest changed/);
    assert.throws(() => verifyReferencePin(sha('{"fixture":"changed"}\n'), pinnedFixture.sha256), /Pinned reference manifest changed/);
    const before = { nested: { a: 1, b: 2 }, passes: 3, checks: 4, elapsedMs: 10 };
    const entry = await artifact(fixtureDirectory, 'fixture', 'full', before);
    let canonicalCalls = 0;
    const countedCanonical = value => { canonicalCalls++; return valueHash(value); };
    const exact = await compareArtifact(fixtureDirectory, entry, { ...before, elapsedMs: 999 }, countedCanonical);
    assert.equal(canonicalCalls, 0, 'Exact normalized bytes must skip canonical hashing');
    assert.equal(exact.difference, null);
    assert.equal(exact.prepared.sha256, entry.sha256);
    const written = await artifact(fixtureDirectory, 'fresh', 'full', before, exact.prepared);
    assert.deepEqual(await readFile(path.join(fixtureDirectory, written.file)), await readFile(path.join(fixtureDirectory, entry.file)));
    assert.deepEqual(await readArtifact(fixtureDirectory, written, true), JSON.parse(serializable(before)));
    const changed = await compareArtifact(fixtureDirectory, entry, { ...before, nested: { a: 1, b: 9 } }, countedCanonical);
    assert.equal(canonicalCalls, 1, 'Mismatching bytes must hash fresh canonical content');
    assert.deepEqual(changed.difference, { path: '/nested/b', reason: 'value' });
    const reordered = await compareArtifact(fixtureDirectory, entry, { ...before, nested: { b: 2, a: 1 } }, countedCanonical);
    assert.equal(canonicalCalls, 2);
    assert.equal(reordered.prepared.sha256, entry.sha256);
    assert.deepEqual(reordered.difference, { path: '/nested/a', reason: 'serialized-property-order' });
    await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, jsonBytes: entry.jsonBytes + 1 }, before), /Serialized artifact length/);
    for (const field of ['sha256', 'serializedSha256']) await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, [field]: 'invalid' }, before), /Invalid reference artifact metadata/);
    await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, compressedBytes: undefined }, before), /Invalid compressed artifact metadata/);
    await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, compressedSha256: '0'.repeat(64) }, before), /Compressed artifact checksum/);
    await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, file: '../fixture.full.json.gz' }, before), /Unsafe reference artifact path/);
    await assert.rejects(compareArtifact(fixtureDirectory, { ...entry, sha256: '0'.repeat(64) }, { ...before, checks: 5 }), /Canonical artifact checksum/);
    const filename = path.join(fixtureDirectory, entry.file), original = await readFile(filename), corrupt = Buffer.from(original);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(filename, corrupt);
    await assert.rejects(compareArtifact(fixtureDirectory, entry, before), /Compressed artifact checksum/);
    await writeFile(filename, original.subarray(0, original.length - 1));
    await assert.rejects(compareArtifact(fixtureDirectory, entry, before), /Compressed artifact length/);
  } finally {
    const cleanupTarget = path.resolve(fixtureDirectory);
    assert.ok(inside(fixtureParentReal, cleanupTarget) && path.dirname(cleanupTarget) === fixtureParentReal
      && path.basename(cleanupTarget).startsWith('oracle-self-test-'), 'Unsafe self-test cleanup target');
    await rejectLinks(cleanupTarget, ROOT);
    assert.equal(await realpath(cleanupTarget), cleanupTarget, 'Self-test cleanup target changed');
    await rm(cleanupTarget, { recursive: true });
  }
  console.log('Pinned reference manifest: unchanged, missing resume pin and tampered reference checks passed.');
  console.log('Exact-byte comparison: zero canonical calls, mismatch canonical checks, first path/order, fresh artifact and corrupt reference checks passed.');
  console.log('Retained compressed bytes: exact, tampered, truncated, metadata and unsafe-path checks passed.');
  console.log('Canonicalization, preserved counters/array order and first-difference self-tests passed.');
} else await run(configuration);
