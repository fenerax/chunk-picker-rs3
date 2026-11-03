import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { mkdtemp, writeFile, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { preparedCollectionKey, encodePreparedCollection, decodePreparedCollection, createWorkerPreparation,
  validPreparedCollectionEntry, PREPARED_COLLECTION_LIMIT, readPreparedCollectionFile } from '../app/tasks/prepared-collection.mjs';
import { createCalculatorPool } from '../app/tasks/calculator-pool.mjs';
import { canonical } from '../tools/calc-check/compare.mjs';

process.env.RS3_DATASET = 'open-f2p';
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const { createCollectionEngine } = await import('../app/tasks/collection.mjs');
const { createTaskEngine } = await import('../app/tasks/engine.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { ProcessWorker } = await import('../app/tasks/process-worker.mjs');
const { createTaskScheduler } = await import('../app/tasks/scheduler.mjs');
const { genericWorkerData } = await import('./helpers/worker-dataset.mjs');

const definitions = {
  chunks: { '12341': { Monster: { 'Test creature': true }, Shop: { 'Test shop': true } }, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'], sections: {},
  challenges: { Quest: { 'Test quest': { Chunks: ['12341'], level: 2 } } },
  drops: { 'Test creature': { 'Test table': { '1': '1/2' } } },
  shopItems: { 'Test shop': { 'Test item': true } },
  codeItems: { dropTables: { 'Test table': { 'Test item': { '1': 'Always', '2': '1/2' }, 'Test table': { '1': 'Always' } } } },
};
const init = () => genericWorkerData({ definitions, datasetOptions: { cacheWalking: false, reviewedOverlays: false } });
function state() {
  const value = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  for (const member of value.members) member.unlocked = ['12341'];
  return value;
}
function prepared() {
  let snapshot;
  const collection = createCollectionEngine(definitions, { onPrepared: value => { snapshot = value; } });
  const key = preparedCollectionKey(init());
  return { collection, snapshot, key, entry: encodePreparedCollection(key, snapshot) };
}

test('preparation key covers dataset, definition bytes, dataset options and inherited stages', () => {
  const data = init(), key = preparedCollectionKey(data);
  assert.match(key, /^[a-f0-9]{64}$/);
  for (const changed of [
    { ...data, datasetDigest: '0'.repeat(64) },
    { ...data, definitions: { ...definitions, challenges: {} } },
    { ...data, datasetOptions: { reviewedOverlays: true } },
    { ...data, preparedDatasetStages: ['equipmentCorrections'] },
  ]) assert.notEqual(preparedCollectionKey(changed), key);
  const bytes = Buffer.from(JSON.stringify(definitions)), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes);
  assert.equal(preparedCollectionKey({ ...data, definitions: undefined, definitionBytes: shared }), key);
  assert.equal(preparedCollectionKey({ get datasetDigest() { throw Error('unreadable'); } }), undefined);
});

test('mismatched hashes, corrupt/truncated entries and invalid decoded shapes fall back to rebuilding', () => {
  const { entry, key } = prepared();
  assert.ok(validPreparedCollectionEntry(entry, key));
  assert.ok(entry.bytes.length < PREPARED_COLLECTION_LIMIT);
  const badBytes = Buffer.from(entry.bytes); badBytes[0] ^= 1;
  const malformed = serialize({ channels: [], catalogue: new Map([['bad', {}]]), completionGroups: new Map() });
  for (const bad of [undefined, { ...entry, key: '0'.repeat(64) }, { ...entry, sha256: '0'.repeat(64) },
    { ...entry, bytes: badBytes }, { ...entry, bytes: entry.bytes.subarray(0, 4) },
    { ...entry, bytes: malformed, sha256: createHash('sha256').update(malformed).digest('hex') },
    { get key() { throw Error('unreadable'); } }]) {
    const decoded = decodePreparedCollection(bad, key);
    assert.equal(decoded, undefined);
    assert.deepEqual(createCollectionEngine(definitions, { prepared: decoded }).catalogue, prepared().collection.catalogue);
  }
});

test('restored collection catalogue, completion families and all generator results equal a normal build', () => {
  const { entry, key, collection } = prepared();
  const restored = createCollectionEngine(definitions, { prepared: decodePreparedCollection(entry, key) });
  assert.deepEqual(restored.catalogue, collection.catalogue);
  assert.ok(Object.isFrozen(restored.catalogue));
  const engine = createTaskEngine(definitions);
  for (const switches of [{}, { 'Kill X': true }, { 'Every Drop': true }, { 'All Droptables': true }, { 'All Shops': true },
    { 'Every Drop': true, 'All Droptables': true, 'All Shops': true }]) {
    const current = state();
    for (const member of current.members) member.taskRules = switches;
    current.rules['content.f2p'] = false;
    for (const member of current.members) {
      const result = engine.evaluate(current, member.id);
      const query = { obligationQueries: collection.catalogue.map(row => row.id) };
      assert.deepEqual(restored.evaluate(current, member.id, result, query), collection.evaluate(current, member.id, result, query));
    }
  }
});

test('catalogue-only variants defer geography; lazy and explicitly prepared evaluations are equivalent', () => {
  let reads = 0;
  const data = { ...definitions, get chunks() { reads++; return definitions.chunks; } };
  const lazy = createTaskEngine(data), afterCatalogue = reads;
  assert.ok(lazy.catalogue.length > 0);
  assert.equal(reads, afterCatalogue);
  const current = state();
  lazy.prepare(current.rules);
  assert.ok(reads > afterCatalogue, 'geography is first read by preparation');
  const cold = createTaskEngine(definitions);
  assert.deepEqual(cold.catalogue, lazy.catalogue);
  for (const member of current.members) assert.deepEqual(canonical(cold.evaluate(current, member.id)), canonical(lazy.evaluate(current, member.id)));
});

test('one scheduler entry is shared by lanes and removed on clear', () => {
  const cache = createWorkerPreparation(init(), { mode: 'memory' }), { entry } = prepared();
  assert.equal(cache.input().collectPreparedCollection, true);
  const ready = { preparedCollection: entry };
  cache.accept(ready);
  assert.equal(ready.preparedCollection, undefined);
  assert.equal(cache.input().preparedCollection, entry);
  assert.equal(cache.input().collectPreparedCollection, false);
  cache.accept({ preparedCollection: { ...entry, key: 'wrong' } });
  assert.equal(cache.input().preparedCollection, entry);
  cache.clear(); assert.equal(cache.input().preparedCollection, undefined);
});

async function runWorker(data, current) {
  const worker = new ProcessWorker(data);
  try {
    const [ready] = await once(worker, 'message');
    const results = [];
    for (const [index, member] of current.members.entries()) {
      const reply = once(worker, 'message');
      worker.postMessage({ id: index + 1, type: 'evaluate', state: current, memberId: member.id });
      const [message] = await reply;
      assert.equal(message.error, undefined); results.push(canonical(message.result));
    }
    return { ready, results };
  } finally { await worker.terminate(); }
}
test('process workers use prepared data and safely rebuild on wrong-hash or corrupt entries', async () => {
  const current = state(), cache = createWorkerPreparation(init(), { mode: 'memory' });
  const normal = await runWorker(cache.input(), current);
  assert.ok(normal.ready.preparedCollection);
  cache.accept(normal.ready);
  for (const entry of [cache.input().preparedCollection, { ...cache.input().preparedCollection, key: 'wrong' },
    { ...cache.input().preparedCollection, bytes: Buffer.from('corrupt') }]) {
    const restored = await runWorker({ ...cache.input(), preparedCollection: entry, omitReadyCatalogue: true }, current);
    assert.equal(restored.ready.catalogue, undefined);
    assert.equal(restored.ready.dynamicCatalogueBytes, undefined);
    assert.deepEqual(restored.results, normal.results);
  }
});

test('file preparation is published completely, verified on use and removed on close', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createWorkerPreparation(init(), { directory }), { entry, key, collection } = prepared();
  cache.accept({ preparedCollection: entry });
  await cache.settled();
  const reference = cache.input().preparedCollectionFile;
  assert.equal(cache.input().preparedCollection, undefined, 'no large buffer crosses the wake IPC boundary');
  assert.equal(reference.bytes, entry.bytes.length);
  const read = () => decodePreparedCollection(readPreparedCollectionFile(reference, key), key);
  assert.deepEqual(createCollectionEngine(definitions, { prepared: read() }).catalogue, collection.catalogue);
  assert.equal(readPreparedCollectionFile({ ...reference, key: 'wrong' }, key), undefined);
  assert.equal(readPreparedCollectionFile({ ...reference, bytes: reference.bytes + 1 }, key), undefined);
  const bytes = await readFile(reference.file); bytes[0] ^= 1;
  await writeFile(reference.file, bytes);
  assert.equal(read(), undefined, 'corruption is checked against the parent-pinned checksum');
  await unlink(reference.file); assert.equal(read(), undefined, 'missing files are ordinary misses');
  await cache.clear(); assert.deepEqual(await readdir(directory), []);
});

test('file write failure disables preparation and close waits for its owned write/cleanup', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blocked = path.join(directory, 'blocked'); await writeFile(blocked, 'fixture');
  const cache = createWorkerPreparation(init(), { directory: blocked }), { entry } = prepared();
  cache.accept({ preparedCollection: entry }); await cache.settled();
  assert.equal(cache.input().collectPreparedCollection, undefined);
  await cache.clear();
  const racing = createWorkerPreparation(init(), { directory });
  racing.accept({ preparedCollection: entry }); await racing.clear();
  assert.deepEqual(await readdir(directory), ['blocked']);
});

test('persistent collection launches and publication do no body I/O or hashing on the server thread', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-responsive-'));
  const cache = createWorkerPreparation(init(), { persistentDirectory: directory });
  t.after(async () => { await cache.clear(); await rm(directory, { recursive: true, force: true }); });
  const { key, snapshot } = prepared();
  const entry = encodePreparedCollection(key, { ...snapshot, syntheticPadding: 'x'.repeat(4 * 1024 * 1024) });
  const reads = [], writes = [], hashes = [];
  const read = fs.readSync, write = fs.writeFileSync, hash = crypto.createHash;
  t.mock.method(fs, 'readSync', (...args) => { if (args[4] >= 76) reads.push(args[3]); return read(...args); });
  t.mock.method(fs, 'writeFileSync', (...args) => { if (args[0].endsWith('.tmp') || args[0].endsWith('.warm')) writes.push(args[0]); return write(...args); });
  t.mock.method(crypto, 'createHash', (...args) => {
    const digest = hash(...args), update = digest.update;
    digest.update = function(bytes, ...rest) {
      if (bytes.byteLength >= entry.bytes.byteLength) hashes.push(bytes.byteLength);
      return update.call(this, bytes, ...rest);
    };
    return digest;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const ready = { preparedCollection: entry };
  cache.accept(ready);
  assert.equal(ready.preparedCollection, undefined);
  // A foreground launch proceeds immediately while optional publication runs.
  assert.equal(cache.input().collectPreparedCollection, true);
  await cache.settled();
  const reference = cache.input().preparedCollectionFile;
  assert.ok(reference?.warm);
  const reopened = createWorkerPreparation(init(), { persistentDirectory: directory });
  try {
    assert.deepEqual(reopened.input().preparedCollectionFile, reference);
    assert.deepEqual(reopened.input().preparedCollectionFile, reference);
    cache.accept({ preparedCollection: entry }); await cache.settled();
    assert.deepEqual(reads, [], 'full-file validation belongs to calculators/publisher');
    assert.deepEqual(writes, [], 'publication belongs to the publisher');
    assert.deepEqual(hashes, [], 'neither launch nor accept hashes the collection body');
  } finally { await reopened.clear(); }
});

test('publisher rejects a wrong collection checksum and can retry a complete entry', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-publisher-integrity-'));
  const cache = createWorkerPreparation(init(), { persistentDirectory: directory }), { entry } = prepared();
  t.after(async () => { await cache.clear(); await rm(directory, { recursive: true, force: true }); });
  cache.accept({ preparedCollection: { ...entry, sha256: '0'.repeat(64) } });
  await cache.settled(); assert.equal(cache.input().preparedCollectionFile, undefined);
  cache.accept({ preparedCollection: entry });
  await cache.settled(); assert.ok(cache.input().preparedCollectionFile?.warm);
});

test('file-backed process workers return identical lists on hit, corrupt-file fallback and missing-file fallback', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-process-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createWorkerPreparation(init(), { directory });
  t.after(() => cache.clear());
  const current = state(), normal = await runWorker(cache.input(), current);
  cache.accept(normal.ready); await cache.settled();
  const reference = cache.input().preparedCollectionFile;
  assert.ok(reference);
  for (const condition of ['hit', 'corrupt', 'missing']) {
    if (condition === 'corrupt') await writeFile(reference.file, Buffer.alloc(reference.bytes));
    if (condition === 'missing') await unlink(reference.file);
    const restored = await runWorker({ ...cache.input(), omitReadyCatalogue: true }, current);
    assert.equal(restored.ready.catalogue, undefined);
    assert.deepEqual(restored.results, normal.results);
  }
});

test('body-corrupt persistent collections rebuild, publish a repair and restore on the next calculator', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prepared-body-repair-'));
  let cache = createWorkerPreparation(init(), { persistentDirectory: directory });
  t.after(async () => { await cache.clear(); await rm(directory, { recursive: true, force: true }); });
  const current = state(), cold = await runWorker(cache.input(), current);
  assert.ok(cold.ready.preparedCollection);
  cache.accept(cold.ready); await cache.settled();
  const reference = cache.input().preparedCollectionFile, original = await readFile(reference.file);
  const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] ^= 1;
  await writeFile(reference.file, corrupt);
  assert.deepEqual(corrupt.subarray(0, 76), original.subarray(0, 76), 'the header and length stay intact');
  assert.equal(corrupt.length, original.length);
  await cache.clear();
  cache = createWorkerPreparation(init(), { persistentDirectory: directory });
  const input = cache.input();
  assert.ok(input.preparedCollectionFile?.warm, 'header-only launch validation accepts the reference');
  assert.equal(input.collectPreparedCollection, false, 'the calculator must enable collection after a body miss');
  assert.equal(readPreparedCollectionFile(input.preparedCollectionFile, reference.key), undefined);
  const rebuilt = await runWorker({ ...input, omitReadyCatalogue: true }, current);
  assert.deepEqual(rebuilt.results, cold.results, 'cold fallback preserves calculation results');
  assert.ok(validPreparedCollectionEntry(rebuilt.ready.preparedCollection, reference.key), 'the rebuilt preparation is returned for publication');
  cache.accept(rebuilt.ready); await cache.settled();
  assert.deepEqual(await readFile(reference.file), original, 'the publisher replaces the corrupt body');
  await cache.clear();
  cache = createWorkerPreparation(init(), { persistentDirectory: directory });
  const warm = await runWorker({ ...cache.input(), omitReadyCatalogue: true }, current);
  assert.deepEqual(warm.results, cold.results);
  assert.equal(warm.ready.preparedCollection, undefined, 'a valid warm restore needs no further rebuild/publication');
});

test('the pool labels physical foreground/advisory allocations for bounded preparation residency', async () => {
  const groups = [];
  const pool = createCalculatorPool({ limit: 2, idleMs: 1000,
    workerData: (include, group) => { groups.push(group); return {}; },
    workerFactory() {
      const worker = new EventEmitter();
      worker.terminate = async () => {}; worker.postMessage = () => {};
      queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
      return worker;
    },
  });
  try {
    await once(pool.createEndpoint(true), 'message');
    const advisory = pool.createEndpoint(false); await once(advisory, 'message');
    advisory.schedule(() => ({ pickerId: 'legacy-shared', interactive: true }), () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(groups, ['foreground', 'advisory']);
  } finally { await pool.close(); }
});

test('native foreground preserves catalogues through idle retirement and a coalesced wake', async t => {
  const scheduler = await createTaskScheduler({ workerData: init(), idleMs: 50 });
  t.after(() => scheduler.close());
  const catalogue = scheduler.catalogue, dynamic = scheduler.dynamicCatalogue;
  const deadline = Date.now() + 5000;
  while (scheduler.getHealth().status !== 'sleeping') {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
  }
  const current = state();
  const [a, b] = await Promise.all([scheduler.evaluate(current, 'a'), scheduler.evaluate(current, 'a')]);
  assert.deepEqual(a.result, b.result);
  assert.equal(scheduler.catalogue, catalogue); assert.equal(scheduler.dynamicCatalogue, dynamic);
  assert.equal(scheduler.getHealth().restarts, 0);
});
