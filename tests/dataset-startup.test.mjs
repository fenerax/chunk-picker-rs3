import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { buildDataPack } from '../scripts/build-data-pack.mjs';
import { resolveDataset, datasetDigest, encodeDatasetValue, DATASET_CONTRACT, DATASET_OVERLAY_ORDER, datasetCapabilities, datasetEnvironment } from '../app/datasets.mjs';
import { bindingPath } from '../app/dataset-binding.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, '.local', 'dataset-startup-tests');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
async function fixture(t) {
  await mkdir(testRoot, { recursive: true }); const directory = await mkdtemp(path.join(testRoot, 'run-'));
  t.after(async () => {
    const target = path.resolve(directory), relative = path.relative(path.resolve(testRoot), target);
    assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Cleanup must stay inside this worktree test root.');
    await rm(target, { recursive: true, force: true });
  });
  return { directory, packsDir: path.join(directory, 'packs'), selectionPath: path.join(directory, 'selection.json') };
}
async function storageFixture(directory) {
  const dataDir = path.join(directory, 'synthetic-storage'); await mkdir(path.join(dataDir, 'backups'), { recursive: true });
  await writeFile(path.join(dataDir, 'state.json'), '{"synthetic":true,"revision":17}\r\n');
  await writeFile(path.join(dataDir, 'history.jsonl'), '{"synthetic":"event"}\r\n');
  await writeFile(path.join(dataDir, 'backups', 'synthetic.bin'), Buffer.from([0, 255, 10, 13, 88]));
  return dataDir;
}
async function storageBytes(directory) {
  const entries = [];
  async function visit(relative = '') {
    for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      entries.push([name.split(path.sep).join('/'), entry.isDirectory() ? 'directory' : await readFile(path.join(directory, name))]);
      if (entry.isDirectory()) await visit(name);
    }
  }
  await visit(); return entries;
}
async function child(options, config) {
  const configPath = path.join(options.directory, `child-${config.mode}-${Date.now()}.json`); await writeFile(configPath, encode(config));
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./helpers/dataset-startup-child.mjs', import.meta.url)), configPath], {
    cwd: root, windowsHide: true, timeout: 90000, maxBuffer: 256 * 1024,
    env: { ...process.env, RS3_PACKS_DIR: options.packsDir, RS3_PACK_SELECTION: options.selectionPath,
      RS3_MAP_ASSETS_DIR: path.join(options.directory, 'absent-map'), RS3_TERRAIN_ASSETS_DIR: path.join(options.directory, 'absent-terrain'), RS3_ICON_ASSETS_DIR: path.join(options.directory, 'absent-icons'), RS3_GAME_DATA_DIR: path.join(options.directory, 'absent-game'),
      RS3_LOOPBACK_PORT: '', RS3_PUBLIC_ORIGIN: '' },
  });
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}
async function failureSelection(options, scenario) {
  const choice = { id: 'duo-data', version: '1.0.0', sha256: 'a'.repeat(64) };
  let selection = { schemaVersion: 1, data: choice, rulesText: { id: 'duo-rules-text', version: '1.0.0', sha256: 'b'.repeat(64) } };
  if (scenario === 'malformed') { await writeFile(options.selectionPath, '{'); return; }
  if (scenario === 'missing-required-text') delete selection.rulesText;
  if (scenario === 'incompatible-contract' || scenario === 'corrupt-manifest') {
    const directory = path.join(options.packsDir, 'duo-data', '1.0.0'); await mkdir(directory, { recursive: true });
    const manifest = { schemaVersion: 1, id: choice.id, version: choice.version, kind: 'data', distribution: 'private-local', requires: { ...DATASET_CONTRACT, datasetId: 'incompatible-fixture' },
      ruleContractHash: 'c'.repeat(64), overlayOrder: DATASET_OVERLAY_ORDER, capabilities: datasetCapabilities({}), environment: datasetEnvironment({}), catalogues: {}, files: [] };
    const bytes = encode(manifest); await writeFile(path.join(directory, 'pack.json'), bytes);
    if (scenario === 'incompatible-contract') selection.data.sha256 = hash(bytes);
  }
  await writeFile(options.selectionPath, encode(selection));
}

test('selected pack startup failures leave every gameplay file and directory entry untouched', async t => {
  for (const scenario of ['missing-manifest', 'corrupt-manifest', 'missing-required-text', 'incompatible-contract', 'malformed']) {
    const options = await fixture(t), dataDir = await storageFixture(options.directory), before = await storageBytes(dataDir);
    await failureSelection(options, scenario);
    const result = await child(options, { mode: 'failure', dataDir });
    assert.deepEqual(result, { failed: true, code: 'DATASET_PACK_INVALID', name: 'Error' }, scenario);
    assert.deepEqual(await storageBytes(dataDir), before, scenario);
  }
});

test('binding mismatch fails before store preparation and preserves exact gameplay and binding bytes', async t => {
  const options = await fixture(t), dataDir = await storageFixture(options.directory), before = await storageBytes(dataDir);
  await writeFile(options.selectionPath, encode({ schemaVersion: 1, data: null }));
  const binding = encode({ schemaVersion: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'f'.repeat(64) }); await writeFile(bindingPath(dataDir), binding);
  const result = await child(options, { mode: 'failure', dataDir });
  assert.deepEqual(result, { failed: true, code: 'DATASET_BINDING_MISMATCH', name: 'Error' });
  assert.deepEqual(await storageBytes(dataDir), before); assert.deepEqual(await readFile(bindingPath(dataDir)), binding);
});

async function freePort() {
  const range = { first: 8900, last: 8999 };
  for (let port = range.first; port <= range.last; port++) {
    const probe = net.createServer();
    try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => probe.close(resolve)); return port; }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No dataset fixture test port is available.');
}

test('lost selection cannot open pack-bound storage even when tracked digest matches', async t => {
  const options = await fixture(t), dataDir = await storageFixture(options.directory), before = await storageBytes(dataDir);
  const tracked = await resolveDataset({ ...options, selection: null, mapAssetsDir: path.join(options.directory, 'absent-map'), gameDataDir: path.join(options.directory, 'absent-game') });
  await writeFile(bindingPath(dataDir), encode({ schemaVersion: 1, datasetId: tracked.datasetId, datasetContractVersion: tracked.datasetContractVersion, digest: tracked.digest, requiresPack: true }));
  assert.deepEqual(await child(options, { mode: 'failure', dataDir }), { failed: true, code: 'DATASET_BINDING_MISMATCH', name: 'Error' });
  assert.deepEqual(await storageBytes(dataDir), before);
});

test('fresh server process serves selected training bytes and authenticated runtime without retired JSON fallback', async t => {
  const runtime = await import('../app/dataset-runtime.mjs'), values = await runtime.materializeDatasetValues();
  // The legacy pack catalogue retains this transcription; rel2 no longer imports it.
  const retainedKey = 'app/web/rules-model.mjs#actualDefaults';
  if (!Object.hasOwn(values, retainedKey)) values[retainedKey] = encodeDatasetValue(runtime.selectedDataset.value(retainedKey));
  const options = await fixture(t), built = await buildDataPack({ ...options, values, select: false, mapAssetsDir: path.join(options.directory, 'absent-map'), gameDataDir: path.join(options.directory, 'absent-game') });
  const selected = await resolveDataset({ ...options, selection: built.selection }), key = 'app/data/training/methods.f2p.json', sentinel = 'dataset-startup-selected-fixture';
  const training = selected.json(key); training.version = sentinel; const bytes = encode(training), trainingPath = path.join(built.directory, key); await writeFile(trainingPath, bytes);
  const records = selected.files.map(record => record.path === key ? { ...record, bytes: bytes.length, sha256: hash(bytes) } : record);
  const digest = datasetDigest(records, selected.capabilities, selected.definitionOverlays), manifest = structuredClone(built.manifest);
  Object.assign(manifest.files.find(record => record.path === key), { bytes: bytes.length, sha256: hash(bytes) }); manifest.datasetDigest = digest;
  const manifestBytes = encode(manifest); await writeFile(path.join(built.directory, 'pack.json'), manifestBytes);
  const selection = structuredClone(built.selection); selection.data.sha256 = hash(manifestBytes); await writeFile(options.selectionPath, encode(selection));
  const result = await child(options, { mode: 'browser', dataDir: path.join(options.directory, 'fresh-synthetic-storage'), port: await freePort(), trainingPath, sentinel, digest });
  assert.deepEqual(result, { ok: true, sentinel, selectedDigest: digest });
});

function fakeFactory(digest) {
  const workers = [], descriptors = [];
  return { workers, descriptors, create(workerData) {
    descriptors.push(structuredClone(workerData));
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => { worker.messages.push(message); if (message.id !== undefined) queueMicrotask(() => worker.emit('message', { id: message.id, result: { tasks: [] } })); };
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], datasetDigest: digest }));
    return worker;
  } };
}
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

test('eager, lazy and restarted worker lanes retain the pinned descriptor after operator receipt edits', async t => {
  const options = await fixture(t), digest = 'a'.repeat(64), selection = { schemaVersion: 1, data: { id: 'duo-data', version: '1.0.0', sha256: 'c'.repeat(64) }, rulesText: { id: 'duo-rules-text', version: '1.0.0', sha256: 'd'.repeat(64) } };
  await writeFile(options.selectionPath, encode(selection));
  const workerData = { datasetDigest: digest, datasetSelection: { root, packsDir: options.packsDir, selection, digest } }, factory = fakeFactory(digest);
  const scheduler = await createTaskScheduler({ workerData, workerFactory: factory.create, maxRestarts: 0, deadlineMs: 1000, startupDeadlineMs: 1000 }); t.after(() => scheduler.close());
  await writeFile(options.selectionPath, encode({ schemaVersion: 1, data: null }));
  await scheduler.evaluate({ revision: 0 }, 'fixture', 'evaluate', undefined, 'lazy-fixture', 'lazy-input', undefined, [], 'full', undefined, 'side');
  assert.equal(factory.workers.length, 2);
  factory.workers[0].emit('error', new Error('Synthetic worker replacement'));
  await scheduler.restartUnhealthy(); await flush(); assert.equal(factory.workers.length, 3);
  for (const descriptor of factory.descriptors) assert.deepEqual(descriptor, workerData);
  assert.equal(scheduler.getHealth().ready, true);
});

test('wrong worker ready digest is rejected before ready and cannot change synthetic storage', async t => {
  const options = await fixture(t), dataDir = await storageFixture(options.directory), before = await storageBytes(dataDir), factory = fakeFactory('b'.repeat(64));
  await assert.rejects(createTaskScheduler({ workerData: { datasetDigest: 'a'.repeat(64), datasetSelection: { selection: { schemaVersion: 1, data: null } } }, workerFactory: factory.create,
    maxRestarts: 0, deadlineMs: 1000, startupDeadlineMs: 1000 }), /restart|digest|dataset/i);
  assert.equal(factory.workers.length, 1); assert.equal(factory.workers[0].terminated, true);
  assert.deepEqual(await storageBytes(dataDir), before);
});
