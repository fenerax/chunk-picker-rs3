import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

// Node's test runner isolates this file. Select before any application import.
process.env.RS3_DATASET = 'open-f2p';
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const { sharedJSONBytes, sharedBuffer } = await import('../app/tasks/shared-bytes.mjs');
const { reuseEquivalentDataset } = await import('../app/startup.mjs');
const { genericWorkerData } = await import('./helpers/worker-dataset.mjs');
const { buildWorld } = await import('../app/data/world.mjs');

test('shared JSON bytes are one SharedArrayBuffer that workers receive without a copy', () => {
  const value = { chunks: { '12341': { Nickname: 'Ålesund – test' } }, list: [1, 2, 3] };
  const bytes = sharedJSONBytes(value);
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.buffer instanceof SharedArrayBuffer);
  assert.equal(bytes.toString('utf8'), JSON.stringify(value));
  assert.equal(sharedBuffer(bytes), bytes.buffer, 'A whole shared view is passed as its own backing store');
  const ordinary = Buffer.from('{"a":1}');
  const copied = sharedBuffer(ordinary);
  assert.ok(copied instanceof SharedArrayBuffer);
  assert.equal(Buffer.from(copied).toString(), '{"a":1}');
  const partial = sharedBuffer(bytes.subarray(1, 4));
  assert.notEqual(partial, bytes.buffer, 'A partial view is copied, never widened');
  assert.equal(Buffer.from(partial).toString(), bytes.subarray(1, 4).toString());
});

test('an equivalent second dataset resolution keeps the import-time provider', () => {
  const provider = (digest, selection) => ({ digest, workerSelection: () => selection });
  const imported = provider('a'.repeat(64), { datasetId: 'x', digest: 'a'.repeat(64), root: '/game' });
  assert.equal(reuseEquivalentDataset(provider('a'.repeat(64), { datasetId: 'x', digest: 'a'.repeat(64), root: '/game' }), imported), imported);
  const elsewhere = provider('a'.repeat(64), { datasetId: 'x', digest: 'a'.repeat(64), root: '/other' });
  assert.equal(reuseEquivalentDataset(elsewhere, imported), elsewhere, 'Different worker inputs are not equivalent');
  const changed = provider('b'.repeat(64), imported.workerSelection());
  assert.equal(reuseEquivalentDataset(changed, imported), changed);
  const broken = { digest: imported.digest, workerSelection() { throw new Error('unavailable'); } };
  assert.equal(reuseEquivalentDataset(broken, imported), broken);
  assert.equal(reuseEquivalentDataset(changed, undefined), changed);
});

test('a task worker releases its definition transfer input once compiled', { timeout: 120000 }, async t => {
  const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
    challenges: { Quest: { 'Present quest': { Chunks: ['12341'] } } } };
  const world = buildWorld(definitions);
  const workerUrl = new URL('../app/tasks/worker.mjs', import.meta.url);
  // Report what the worker module still references when it announces ready.
  const instrumented = `
    import { parentPort, workerData } from 'node:worker_threads';
    const post = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = (message, ...rest) => post(message?.type === 'ready'
      ? { ...message, retained: ['definitionBytes', 'definitions'].filter(key => key in workerData) } : message, ...rest);
    await import(${JSON.stringify(workerUrl.href)});
  `;
  for (const input of [{ definitionBytes: sharedJSONBytes(definitions).buffer }, { definitions }]) {
    const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`), {
      workerData: genericWorkerData({ ...input, world: { chunks: world.chunks, surface: world.surface } }) });
    t.after(() => worker.terminate());
    const [ready] = await once(worker, 'message');
    assert.equal(ready.type, 'ready');
    assert.ok(ready.catalogue.some(row => row.label === 'Present quest'), 'The worker compiled the transferred definitions');
    assert.deepEqual(ready.retained, []);
  }
});

test('the server keeps one dataset provider and serves shared definition bytes in every encoding', { timeout: 120000 }, async t => {
  const { createServer } = await import('../app/server.mjs');
  const imported = selectedDataset;
  const directory = await mkdtemp(path.join(tmpdir(), 'server-memory-sharing-'));
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  app = await createServer({ dataDir: path.join(directory, 'game'), packsDir: path.join(directory, 'packs'),
    packSelection: path.join(directory, 'packs', 'selection.json'), port: 0, host: '127.0.0.1',
    publicOrigin: undefined, loopbackPort: undefined, predictionPrewarm: false,
    idleMemoryOptions: { delayMs: 60000 }, shutdownDeadlineMs: 2000 });
  await app.listen();
  assert.equal(app.dataset, imported, 'The import-time provider serves the application');
  assert.equal(selectedDataset, imported);
  const origin = `http://127.0.0.1:${app.address().port}`;
  const joined = await fetch(`${origin}/join/${app.store.getAccessToken()}`, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  for (const encoding of ['identity', 'gzip', 'br']) {
    const response = await fetch(`${origin}/api/definitions`, { headers: { Cookie: cookie, 'Accept-Encoding': encoding } });
    assert.equal(response.status, 200);
    const definitions = await response.json();
    assert.ok(Object.keys(definitions.chunks).includes(String(imported.gameDefaults.startingCell)));
  }
});

test('a process-worker host collects relay garbage once enough bytes pass', async () => {
  const { createRelayCollector, envelopeBytes } = await import('../app/tasks/relay-collector.mjs');
  const timers = [];
  const clock = { setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); } };
  let collections = 0;
  const relay = createRelayCollector({ collect: () => { collections++; }, clock, delayMs: 500, minBytes: 1024 * 1024 });
  relay.note(512 * 1024);
  assert.equal(timers.length, 0, 'Small relays wait for more garbage');
  relay.note(600 * 1024); relay.note(8 * 1024 * 1024);
  assert.equal(timers.length, 1, 'One collection covers a burst');
  assert.equal(timers[0].ms, 500);
  await timers.shift().callback();
  assert.equal(collections, 1);
  relay.note(512 * 1024);
  assert.equal(timers.length, 0, 'The relayed byte count restarts after a collection');
  relay.note(Infinity);
  assert.equal(timers.length, 1);
  relay.close();
  assert.equal(timers.length, 0, 'Closing cancels a pending collection');
  relay.note(Infinity);
  assert.equal(timers.length, 0);
  assert.deepEqual(relay.diagnostics(), { available: true, pending: false, collections: 1 });
  assert.equal(createRelayCollector({ collect: undefined, clock }).diagnostics().available, false);
  assert.equal(envelopeBytes({ data: {}, shared: [{ bytes: Buffer.alloc(3) }, { bytes: Buffer.alloc(5) }], views: [] }), 8);
  assert.equal(envelopeBytes({ data: {}, shared: [], views: [] }), 0);
});
