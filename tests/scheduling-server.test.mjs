import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get as httpGet } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { constants, crc32, gzipSync, inflateRawSync } from 'node:zlib';

// Only this three-chunk reference and controlled workers enter these servers.
// Every durable save lives in an owned, ignored directory inside this worktree.
const definitions = { chunks: { '12341': {}, '12342': {}, '12343': {} },
  walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'], challenges: {} };
const scratchRoot = fileURLToPath(new URL('../.local/tests/', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Controlled request did not arrive.'); await delay(5); }
}
function sharedJSON(value) {
  const bytes = Buffer.from(JSON.stringify(value)), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes); return shared;
}
function laneFactory() {
  const workers = [], calls = [];
  const create = () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true }, evaluationMs: 0 }));
      else if (message.type !== 'cancel' && message.type !== 'supersede') calls.push({ worker, message });
    };
    worker.terminate = async () => { worker.emit('exit', 0); };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], dynamicCatalogue: [], compileMs: 0 }));
    return worker;
  };
  const finish = (index = calls.length - 1) => {
    const { worker, message } = calls[index];
    const result = { tasks: [], presentation: { tasks: [], alternatives: {} }, access: { areas: [] }, metrics: { availableCount: 0, elapsedMs: 0 } };
    const value = message.type === 'evaluate' ? { resultJSON: sharedJSON(result), playJSON: sharedJSON({ ...result, format: 'play-v1' }),
      duoJSON: sharedJSON({ ...result, format: 'play-v1', projection: 'duo-v1' }), duoSidebarJSON: sharedJSON({ ...result, format: 'play-v1', projection: 'duo-sidebar-v1' }) }
      : { result: message.type === 'death-estimates' ? { estimates: [] }
        : message.type === 'chunk-planning' ? { format: 'chunk-planning-v1', rows: [] }
          : { delta: { tasksAdded: [] }, unusedPredictionDetail: 'Not an acknowledgement field' } };
    worker.emit('message', { id: message.id, ...value, evaluationMs: 0 });
  };
  return { create, workers, calls, finish };
}
async function fixture(t, { serializedStateInput = false, predictionPrewarm = false } = {}) {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(path.join(scratchRoot, 'scheduling-server-'));
  assert.equal(path.dirname(directory), path.resolve(scratchRoot));
  const foreground = laneFactory(), peer = laneFactory(), side = laneFactory(), death = laneFactory(), clock = createManualClock();
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initialState.members[0].unlocked = ['12341']; initialState.members[1].unlocked = ['12342'];
  if (predictionPrewarm) initialState.members[0].selected = ['12343'];
  const webRoot = path.join(directory, 'web'); await mkdir(webRoot); await writeFile(path.join(webRoot, 'index.html'), '<p>Synthetic scheduling fixture</p>');
  const dataDir = path.join(directory, 'data');
  let application;
  t.after(async () => { try { await application?.close(); } finally { application = undefined; await rm(directory, { recursive: true, force: true }); } });
  application = await createServer({ dataset: fixtureDataset, definitions, taskMap: {}, initialState, webRoot, dataDir, port: 0, predictionPrewarm, shutdownDeadlineMs: 500, schedulingClock: clock,
    taskWorkerOptions: { workerFactory: foreground.create, duoWorkerFactory: peer.create, predictionWorkerFactory: side.create,
      deathWorkerFactory: death.create, serializedStateInput, deadlineMs: 3000, predictionDeadlineMs: 3000, deathDeadlineMs: 3000 } });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const api = (route, body, transportHeaders = {}) => fetch(`${origin}${route}`, { headers: { Authorization: `Bearer ${application.store.getAccessToken()}`, Origin: origin, ...transportHeaders,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const revision = application.store.getInfo().revision;
  return { application, api, revision, foreground, peer, side, death, dataDir, clock };
}
const groupPath = revision => `/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`;
const peerPath = revision => `/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=${revision}`;

test('intent accepts exact locked partner-owned chunks, returns only acknowledgement and leaves durable state unchanged', async t => {
  const f = await fixture(t), before = f.application.store.getState();
  const durableBefore = await readFile(path.join(f.dataDir, 'state.json'));
  const requested = f.api('/api/prediction-intent', { memberId: 'actor1', chunkId: '12342', revision: f.revision });
  await until(() => f.side.calls.length === 1);
  assert.equal(f.side.calls[0].message.type, 'predict'); assert.equal(f.side.calls[0].message.memberId, 'actor1');
  assert.equal(f.side.calls[0].message.chunkId, '12342'); assert.equal(f.side.calls[0].message.state.revision, f.revision);
  f.side.finish(); const response = await requested; assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { memberId: 'actor1', chunkId: '12342', stateRevision: f.revision, prepared: true });
  assert.deepEqual(f.application.store.getState(), before);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), durableBefore);
});

test('intent rejects wrong revisions and nonexact, unknown, owned or invalid-player chunks before dispatch', async t => {
  const f = await fixture(t), valid = { memberId: 'actor1', chunkId: '12342', revision: f.revision };
  for (const [change, status] of [[{ revision: f.revision + 1 }, 409], [{ revision: String(f.revision) }, 409],
    [{ chunkId: '12342-1' }, 400], [{ chunkId: '99999' }, 400], [{ chunkId: 12342 }, 400], [{ chunkId: '12341' }, 400], [{ memberId: 'missing' }, 400]]) {
    const response = await f.api('/api/prediction-intent', { ...valid, ...change }); assert.equal(response.status, status); await response.arrayBuffer();
  }
  assert.equal(f.side.calls.length, 0); assert.equal(f.application.store.getInfo().revision, f.revision);
});


test('absent and failed Group peers keep bulk preparation paused beyond the startup grace', async t => {
  const f = await fixture(t, { predictionPrewarm: true }), selected = f.api(groupPath(f.revision));
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); await selected;
  await f.clock.advance(14999); assert.equal(f.side.calls.length, 0, 'Missing peer holds warming just before grace expiry');
  await f.clock.advance(1); assert.equal(f.side.calls.length, 0, 'Missing peer holds warming at grace expiry');
  await f.clock.advance(1000); assert.equal(f.side.calls.length, 0, 'Missing peer cannot release warming after the 15-second grace');
  const failed = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 1);
  const { worker, message } = f.peer.calls[0]; worker.emit('message', { id: message.id, error: { name: 'Error', message: 'Controlled peer failure' } });
  assert.equal((await failed).status, 503);
  await f.clock.advance(1100); assert.equal(f.side.calls.length, 0, 'Failed calculation does not settle its player');
  const retried = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 2); f.peer.finish(); assert.equal((await retried).status, 200);
  await f.clock.advance(1000);
  await until(() => f.side.calls.length > 0); assert.equal(f.side.calls[0].message.type, 'predict'); f.side.finish(0);
});

test('Personal gate releases side work after its own compact result without requiring a peer', async t => {
  const f = await fixture(t), selected = f.api('/api/tasks?memberId=actor1&view=play-v1');
  await until(() => f.foreground.calls.length === 1);
  const planning = f.api('/api/chunk-planning?memberId=actor1&chunkId=12342');
  await delay(40); assert.equal(f.side.calls.length, 0);
  f.foreground.finish(); assert.equal((await selected).status, 200);
  await until(() => f.side.calls.length === 1); f.side.finish(); assert.equal((await planning).status, 200); assert.equal(f.peer.calls.length, 0);
});

test('Personal refresh releases planning while an abandoned Group peer is still active', async t => {
  const f = await fixture(t), selected = f.api(groupPath(f.revision));
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); await selected;
  const peer = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 1);
  const personal = await f.api('/api/tasks?memberId=actor1&view=play-v1'); assert.equal(personal.status, 200); await personal.arrayBuffer();
  const planning = f.api('/api/chunk-planning?memberId=actor1&chunkId=12342');
  await until(() => f.side.calls.length === 1); f.side.finish(); assert.equal((await planning).status, 200);
  f.peer.finish(); assert.equal((await peer).status, 200);
});



test('a save cancels an intent waiting for an older Group revision without dispatching prediction work', async t => {
  const f = await fixture(t), selected = f.api(groupPath(f.revision));
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); await selected;
  const intent = f.api('/api/prediction-intent', { memberId: 'actor1', chunkId: '12342', revision: f.revision });
  await delay(40); assert.equal(f.side.calls.length, 0);
  const saved = await f.api('/api/command', { expectedRevision: f.revision, command: { type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'New revision' } });
  assert.equal(saved.status, 200); await saved.arrayBuffer();
  const stale = await intent; assert.equal(stale.status, 409); assert.ok(!(await stale.json()).prepared);
  assert.equal(f.side.calls.length, 0); assert.equal(f.application.store.getInfo().revision, f.revision + 1);
});

test('full hydration follows compact settlement on the side lane and leaves foreground map switching free', async t => {
  const f = await fixture(t, { serializedStateInput: true }), selected = f.api('/api/tasks?memberId=actor1&view=play-v1');
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); assert.equal((await selected).status, 200);
  const full = f.api('/api/tasks?memberId=actor1'); await until(() => f.side.calls.length === 1);
  assert.equal(f.side.calls[0].message.type, 'evaluate'); assert.equal(f.side.calls[0].message.resultView, 'full');
  const switched = f.api('/api/tasks?memberId=reed&view=play-v1'); await until(() => f.foreground.calls.length === 2);
  assert.equal(f.foreground.calls[1].message.memberId, 'reed'); assert.equal(f.foreground.calls[1].message.resultView, 'play-v1');
  f.foreground.finish(); assert.equal((await switched).status, 200);
  f.side.finish(); assert.equal((await full).status, 200);
});

test('full hydration waits for the complete Group list before entering the side lane', async t => {
  const f = await fixture(t, { serializedStateInput: true }), selected = f.api(groupPath(f.revision));
  await until(() => f.foreground.calls.length === 1); f.foreground.finish(); assert.equal((await selected).status, 200);
  const full = f.api('/api/tasks?memberId=actor1'); await delay(50);
  assert.equal(f.side.calls.length, 0); assert.equal(f.foreground.calls.length, 1);
  const peer = f.api(peerPath(f.revision)); await until(() => f.peer.calls.length === 1); f.peer.finish(); assert.equal((await peer).status, 200);
  await until(() => f.side.calls.length === 1);
  assert.equal(f.side.calls[0].message.resultView, 'full'); f.side.finish(); assert.equal((await full).status, 200);
});

test('fresh compact tasks use fast accepted gzip and preserve explicit Brotli-only clients', async t => {
  const f = await fixture(t), route = '/api/tasks?memberId=actor1&view=play-v1';
  const selected = f.api(route, undefined, { 'Accept-Encoding': 'gzip, br' });
  await until(() => f.foreground.calls.length === 1); f.foreground.finish();
  const response = await selected; assert.equal(response.headers.get('Content-Encoding'), 'gzip');
  assert.equal((await response.json()).memberId, 'actor1');
  const onlyBrotli = await f.api(route, undefined, { 'Accept-Encoding': 'br, gzip;q=0, identity;q=0' });
  assert.equal(onlyBrotli.headers.get('Content-Encoding'), 'br'); assert.equal((await onlyBrotli.json()).memberId, 'actor1');
});

test('prepared owner and peer HTTP responses complete one gzip member with current saved metadata', async t => {
  const f = await fixture(t, { serializedStateInput: true });
  const command = { type: 'set-chunk', memberId: 'actor1', chunkId: '12342', status: 'unlocked' };
  const hypothetical = applyCommand(f.application.store.getCalculationSnapshot().state, command, { world: buildWorld(definitions) });
  const preparing = f.api('/api/prediction-intent', { memberId: 'actor1', chunkId: '12342', revision: f.revision });
  await until(() => f.side.calls.length === 1);
  const prepared = memberId => {
    const raw = sharedJSON({ format: 'play-v1', tasks: [], metrics: { availableCount: 0 }, marker: `Prepared ${memberId}` });
    const prefix = Buffer.from(raw).subarray(0, raw.byteLength - 1);
    const compressed = gzipSync(prefix, { level: 1, finishFlush: constants.Z_SYNC_FLUSH });
    const gzip = new SharedArrayBuffer(compressed.length); Buffer.from(gzip).set(compressed);
    const metadata = { crc32: crc32(prefix), rawLength: prefix.length };
    return { taskInputKey: taskReuseInputKey(hypothetical), memberId, sourceRevision: f.revision, priority: 3,
      playJSON: raw, duoJSON: raw, duoSidebarJSON: raw, gzipJSONPrefixes: { playJSON: gzip, duoJSON: gzip, duoSidebarJSON: gzip },
      gzipJSONPrefixMetadata: { playJSON: metadata, duoJSON: metadata, duoSidebarJSON: metadata } };
  };
  const { worker, message } = f.side.calls[0];
  worker.emit('message', { id: message.id, result: { delta: {} }, unlockReuse: prepared('actor1'), partnerUnlockReuse: prepared('reed') });
  assert.equal((await preparing).status, 200);
  const saved = await f.api('/api/command', { expectedRevision: f.revision, command }); assert.equal(saved.status, 200); await saved.arrayBuffer();
  for (const [memberId, route] of [['actor1', groupPath(f.revision + 1)], ['reed', peerPath(f.revision + 1)]]) {
    const response = await f.api(route, undefined, { 'Accept-Encoding': 'gzip, br' });
    assert.equal(response.headers.get('Content-Encoding'), 'gzip');
    const value = await response.json();
    assert.equal(value.marker, `Prepared ${memberId}`); assert.equal(value.memberId, memberId); assert.equal(value.stateRevision, f.revision + 1);
    assert.equal(value.cache.unlockPredictionHit, true); assert.equal(value.cache.evaluationMs, 0);
    const wire = await new Promise((resolve, reject) => {
      const request = httpGet({ hostname: '127.0.0.1', port: f.application.address().port, path: route,
        headers: { Authorization: `Bearer ${f.application.store.getAccessToken()}`, 'Accept-Encoding': 'gzip' } }, response => {
        const buffers = []; response.on('data', data => buffers.push(data)); response.on('error', reject);
        response.on('end', () => resolve({ bytes: Buffer.concat(buffers), headers: response.headers }));
      });
      request.on('error', reject);
    });
    assert.equal(Number(wire.headers['content-length']), wire.bytes.length);
    assert.equal(wire.headers['cache-control'], 'private, no-store');
    assert.equal(wire.headers.vary, 'Accept-Encoding');
    const decoded = inflateRawSync(wire.bytes.subarray(10), { info: true });
    assert.equal(wire.bytes.length - 10 - decoded.engine.bytesWritten, 8, 'exactly one member and one final trailer, as required by Chrome HTTP decoding');
    assert.equal(JSON.parse(decoded.buffer).stateRevision, f.revision + 1);
    for (const [accept, encoding] of [['', null], ['gzip;q=0, identity', null], ['br, gzip;q=0, identity;q=0', 'br']]) {
      const fallback = await f.api(route, undefined, { 'Accept-Encoding': accept, 'If-None-Match': '*' });
      assert.equal(fallback.status, 200, 'saved tasks remain unconditional and cannot settle from a cached 304');
      assert.equal(fallback.headers.get('Content-Encoding'), encoding);
      const value = await fallback.json();
      assert.equal(value.marker, `Prepared ${memberId}`); assert.equal(value.memberId, memberId); assert.equal(value.stateRevision, f.revision + 1);
      assert.equal(value.cache.unlockPredictionHit, true);
    }
    const unacceptable = await f.api(route, undefined, { 'Accept-Encoding': 'br;q=0, gzip;q=0, identity;q=0' });
    assert.equal(unacceptable.status, 406); assert.equal((await unacceptable.arrayBuffer()).byteLength, 0);
  }
  assert.equal(f.foreground.calls.length, 0); assert.equal(f.peer.calls.length, 0);
});
