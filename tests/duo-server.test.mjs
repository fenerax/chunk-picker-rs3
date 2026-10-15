import { emptyMetadataDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';

const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { Example: { Chunks: ['12341'] } } } };
const peerRoute = (revision = 0) => `/api/tasks?memberId=two&view=play-v1&lane=duo-v1&peerFor=one&revision=${revision}`;
const sidebarRoute = (revision = 0) => `/api/tasks?memberId=one&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`;
const inspectionRoute = (revision = 0, memberId = 'one') => `/api/tasks?memberId=${memberId}&view=play-v1&projection=duo-inspection-v1&revision=${revision}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!await predicate()) { if (Date.now() > deadline) assert.fail('Condition did not become true.'); await delay(5); }
}
const sharedBytes = value => { const bytes = Buffer.from(JSON.stringify(value)), shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes); return shared; };
const evaluations = worker => worker?.messages.filter(message => message.type === 'evaluate') ?? [];
function factory() {
  const workers = [];
  const create = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => {
      worker.messages.push(message);
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
    };
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    worker.finish = (message = evaluations(worker).at(-1)) => {
      const row = { id: 'rs3:task:example', label: 'Example', category: 'Quest', status: 'available' };
      const play = { format: 'play-v1', tasks: [row], presentation: { tasks: [{ id: row.id }], completedTasks: [] }, metrics: { availableCount: 1 }, access: { areas: [] } };
      const full = { ...play, format: undefined, tasks: [{ ...row, record: { Description: 'Full evidence' } }], currentBiS: { full: true }, activity: { full: true } };
      worker.emit('message', { id: message.id, playJSON: sharedBytes(play), ...(message.resultView === 'full' ? { resultJSON: sharedBytes(full) } : {}),
        ...(message.duoProjection ? { duoJSON: sharedBytes({ ...play, tasks: [{ ...row, label: 'Peer projection' }] }) } : {}),
        ...(message.duoSidebarProjection ? { duoSidebarJSON: sharedBytes({ ...play, projection: 'duo-sidebar-v1', tasks: [{ ...row, label: 'Sidebar projection' }] }) } : {}),
        cancelled: false, evaluationMs: 2, timingMs: { engineMs: 1, totalMs: 2 } });
    };
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 })); return worker;
  };
  return { create, workers };
}
async function fixture(t, options = {}) {
  const base = path.resolve('.local/duo-server-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'server-'));
  assert.equal(path.dirname(directory), base);
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]);
  initialState.provenance = { privateFixture: 'Synthetic archive excluded from calculation bytes' };
  const app = await createServer({ dataset: await emptyMetadataDataset(), dataDir: directory, definitions, taskMap: {}, initialState, port: 0, predictionPrewarm: false,
    mapAssetsDir: path.join(directory, 'assets'), gameDataDir: path.join(directory, 'game-data'), ...options });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen(); const invite = new URL(app.inviteUrl), origin = invite.origin;
  const auth = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = (route, { body, signal } = {}) => fetch(origin + route, { signal, method: body ? 'POST' : 'GET',
    headers: { ...auth, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const diagnostics = async () => (await request('/api/diagnostics')).json();
  return { app, origin, request, diagnostics };
}
function mockOptions(own, peer, extras = {}) { return { taskWorkerOptions: { workerFactory: own.create, duoWorkerFactory: peer.create, serializedStateInput: true, ...extras } }; }

test('peer routing authenticates and rejects malformed or stale requests before worker admission', async t => {
  const own = factory(), peer = factory(), { app, request, origin } = await fixture(t, mockOptions(own, peer));
  const preferenceModule = await request('/duo-task-preferences.mjs');
  assert.equal(preferenceModule.status, 200);
  assert.match(await preferenceModule.text(), /export function readDuoPersonalFilter/);
  assert.equal((await fetch(origin + '/duo-task-preferences.mjs')).status, 401);
  let byteReads = 0;
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => new Proxy(snapshot(), { get(target, key, receiver) {
    if (key === 'stateJSON') byteReads++;
    if (key === 'state') throw new Error('Route validation materialized calculation state');
    return Reflect.get(target, key, receiver);
  } });
  const anonymous = await fetch(origin + peerRoute()); assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('cache-control'), 'private, no-store');
  const invalid = [
    '/api/tasks?memberId=two&view=play-v1&lane=duo-v1&revision=0',
    '/api/tasks?memberId=two&view=play-v1&lane=duo-v1&peerFor=two&revision=0',
    '/api/tasks?memberId=two&view=play-v1&lane=duo-v1&peerFor=unknown&revision=0',
    '/api/tasks?memberId=unknown&view=play-v1&lane=duo-v1&peerFor=one&revision=0',
    '/api/tasks?memberId=two&lane=duo-v1&peerFor=one&revision=0',
    '/api/tasks?memberId=two&view=full&lane=duo-v1&peerFor=one&revision=0',
    '/api/predict?memberId=two&chunkId=12341&view=play-v1&lane=duo-v1&peerFor=one&revision=0',
    '/api/chunk-planning?memberId=two&chunkId=12341&view=play-v1&lane=duo-v1&peerFor=one&revision=0',
    '/api/tasks?memberId=two&view=play-v1&lane=unknown&peerFor=one&revision=0',
  ];
  for (const route of invalid) { const response = await request(route); assert.equal(response.status, 400, route); await response.arrayBuffer(); }
  for (const revision of ['1', '-1', '00', '']) {
    const response = await request(peerRoute(revision)); assert.equal(response.status, 409, revision); await response.arrayBuffer();
  }
  assert.equal(byteReads, 0); assert.equal(peer.workers.length, 0); assert.equal(evaluations(own.workers[0]).length, 0);
});

test('both lanes share exact captured native state and peer compact promotion preserves ordinary full hydration', async t => {
  const own = factory(), peer = factory(), side = factory(), { app, request, diagnostics } = await fixture(t, mockOptions(own, peer, { predictionWorkerFactory: side.create }));
  let snapshots = 0;
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => {
    snapshots++;
    return new Proxy(snapshot(), { get(target, key, receiver) {
      if (key === 'state') throw new Error('Native dispatch materialized the calculation object');
      return Reflect.get(target, key, receiver);
    } });
  };
  const selected = request('/api/tasks?memberId=one&view=play-v1'); await until(() => evaluations(own.workers[0]).length === 1);
  const partner = request(peerRoute()); await until(() => evaluations(peer.workers[0]).length === 1);
  const selectedInput = evaluations(own.workers[0])[0], partnerInput = evaluations(peer.workers[0])[0];
  for (const input of [selectedInput, partnerInput]) {
    assert.equal(input.state, undefined); assert.equal(input.stateTransport, 'json-shared-v1'); assert.equal(input.resultView, 'play-v1');
    assert.equal(input.stateRevision, 0); assert.deepEqual(input.stateMemberIds, ['one', 'two']); assert.ok(input.stateJSON instanceof SharedArrayBuffer);
  }
  assert.equal(partnerInput.memberId, 'two'); assert.equal(selectedInput.memberId, 'one');
  assert.equal(partnerInput.duoProjection, true); assert.equal(selectedInput.duoProjection, undefined);
  assert.equal(partnerInput.stateJSON, selectedInput.stateJSON); assert.equal(partnerInput.input, selectedInput.input); assert.equal(partnerInput.snapshotKey, selectedInput.snapshotKey);
  const captured = JSON.parse(Buffer.from(partnerInput.stateJSON).toString('utf8'));
  assert.equal(captured.revision, 0); assert.deepEqual(captured.members.map(member => member.id), ['one', 'two']); assert.equal(captured.provenance, undefined);
  peer.workers[0].finish(); const peerPayload = await (await partner).json();
  own.workers[0].finish(); await selected;
  assert.equal(peerPayload.format, 'play-v1'); assert.equal(peerPayload.memberId, 'two'); assert.equal(peerPayload.stateRevision, 0); assert.equal(peerPayload.tasks[0].record, undefined);
  for (const field of ['currentBiS', 'activity', 'stateJSON', 'stateInput']) assert.equal(peerPayload[field], undefined);
  const switched = await (await request('/api/tasks?memberId=two&view=play-v1')).json();
  assert.equal(switched.cache.hit, true); assert.equal(evaluations(own.workers[0]).length, 1);
  assert.equal((await diagnostics()).counts.promoted, 1);
  const full = request('/api/tasks?memberId=two'); await until(() => evaluations(side.workers[0]).length === 1);
  const fullInput = evaluations(side.workers[0])[0];
  assert.equal(fullInput.resultView, 'full'); assert.equal(fullInput.stateTransport, 'json-shared-v1');
  assert.equal(fullInput.stateJSON, selectedInput.stateJSON); assert.equal(fullInput.input, selectedInput.input);
  assert.equal(fullInput.snapshotKey, selectedInput.snapshotKey); assert.equal(fullInput.memberId, 'two');
  assert.equal(fullInput.state, undefined); assert.equal(fullInput.stateRevision, 0);
  assert.deepEqual(fullInput.stateMemberIds, ['one', 'two']);
  assert.equal(evaluations(own.workers[0]).length, 1, 'Full hydration leaves the foreground lane free');
  side.workers[0].finish();
  assert.equal((await (await full).json()).tasks[0].record.Description, 'Full evidence'); assert.equal(snapshots, 1);
});

test('native peer worker thins peer tasks while preserving the ordinary member catalogue and full details', async t => {
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12342'] }, { id: 'two', name: 'Two', unlocked: ['12341'] }]);
  const data = { ...definitions, challenges: { Quest: { Example: { Chunks: ['12341'] }, Future: { Chunks: ['12342'] } } } };
  const { app, request } = await fixture(t, { initialState, definitions: data });
  let snapshots = 0;
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => { snapshots++; return new Proxy(snapshot(), { get(target, key, receiver) {
    if (key === 'state') throw new Error('Native worker dispatch materialized calculation state');
    return Reflect.get(target, key, receiver);
  } }); };
  const compact = await (await request(peerRoute())).json();
  assert.equal(compact.format, 'play-v1'); assert.equal(compact.memberId, 'two'); assert.equal(compact.stateRevision, 0); assert.ok(compact.tasks.length);
  assert.ok(compact.tasks.every(task => task.record === undefined)); assert.equal(compact.currentBiS, undefined); assert.equal(compact.activity, undefined);
  const switched = await (await request('/api/tasks?memberId=two&view=play-v1')).json(); assert.equal(switched.cache.hit, true);
  assert.ok(compact.tasks.length < switched.tasks.length);
  assert.deepEqual(compact.presentation, switched.presentation); assert.deepEqual(compact.access, switched.access);
  assert.deepEqual(compact.collectionPlanning, switched.collectionPlanning);
  for (const row of compact.tasks) assert.ok(switched.tasks.some(task => task.id === row.id));
  const full = await (await request('/api/tasks?memberId=two')).json(); assert.ok(full.tasks.some(task => task.record));
  assert.deepEqual(full.tasks.map(task => task.id), switched.tasks.map(task => task.id)); assert.equal(full.memberId, 'two'); assert.equal(full.stateRevision, 0);
  assert.equal(snapshots, 1);
});

test('HTTP peer disconnect preserves a coalesced follower and abandoned bytes never promote', async t => {
  const own = factory(), peer = factory(), { request, diagnostics } = await fixture(t, mockOptions(own, peer));
  const firstController = new AbortController(), secondController = new AbortController();
  const first = request(peerRoute(), { signal: firstController.signal }), firstRejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => evaluations(peer.workers[0]).length === 1);
  const second = request(peerRoute(), { signal: secondController.signal }), secondRejected = assert.rejects(second, { name: 'AbortError' });
  await until(async () => (await diagnostics()).duoLane.counts.coalesced === 1);
  firstController.abort(); await firstRejected; await delay(10);
  assert.equal((await diagnostics()).duoLane.counts.cancelled, 0);
  secondController.abort(); await secondRejected; await until(() => peer.workers[0].messages.at(-1).type === 'cancel');
  peer.workers[0].finish(); await until(async () => (await diagnostics()).duoLane.queue.active === 0);
  const info = await diagnostics(); assert.equal(info.cache.entries, 1, 'Only startup rule preparation remains cached'); assert.equal(info.counts.promoted, 0); assert.equal(info.duoLane.cache.entries, 0);
  const retry = request(peerRoute()); await until(() => evaluations(peer.workers[0]).length === 2); peer.workers[0].finish();
  assert.equal((await retry).status, 200); assert.equal((await diagnostics()).counts.promoted, 1);
});

test('overtaken display revisions do not promote old peer responses and gameplay saves supersede them', async t => {
  const own = factory(), peer = factory(), { request, diagnostics } = await fixture(t, mockOptions(own, peer));
  const old = request(peerRoute()); await until(() => evaluations(peer.workers[0]).length === 1);
  const saved = await request('/api/command?view=play-v1', { body: { expectedRevision: 0, command: { type: 'set-preference', memberId: 'one', preferenceId: 'ids', value: true } } });
  assert.equal(saved.status, 200); peer.workers[0].finish(); assert.equal((await (await old).json()).stateRevision, 0);
  assert.equal((await diagnostics()).counts.promoted, 0);
  assert.equal((await request(peerRoute())).status, 409);
  assert.equal((await (await request(peerRoute(1))).json()).cache.hit, true); assert.equal((await diagnostics()).counts.promoted, 1);
  const pending = request('/api/tasks?memberId=one&view=play-v1&lane=duo-v1&peerFor=two&revision=1');
  await until(() => evaluations(peer.workers[0]).length === 2);
  const changed = await request('/api/command?view=play-v1', { body: { expectedRevision: 1, command: { type: 'set-rule', ruleId: 'access.shared', value: false } } });
  assert.equal(changed.status, 200); assert.equal((await pending).status, 409); peer.workers[0].finish();
  assert.equal((await diagnostics()).counts.promoted, 1, 'Superseded response did not add a promotion');
});

test('dedicated startup queue is bounded and closing during startup rejects and terminates both lanes', async t => {
  const own = factory(), booting = new EventEmitter(); let terminated = false;
  booting.postMessage = () => {}; booting.terminate = async () => { terminated = true; };
  const scheduler = await createTaskScheduler({ workerFactory: own.create, duoWorkerFactory: () => booting, maxDuoQueue: 1, startupDeadlineMs: 1000 });
  t.after(() => scheduler.close());
  const peer = key => scheduler.evaluate({ revision: 0 }, 'two', 'evaluate', undefined, key, key, undefined, [], 'play-v1', undefined, 'duo');
  const waiting = peer('one'), rejected = assert.rejects(waiting, /closing/);
  await assert.rejects(peer('two'), error => error.status === 429);
  assert.equal(scheduler.getDiagnostics().duoLane.queue.depth, 1); await scheduler.close(); await rejected;
  assert.equal(terminated, true); assert.equal(own.workers[0].terminated, true);
  booting.emit('message', { type: 'ready', catalogue: [] }); assert.equal(scheduler.getHealth().duo.status, 'closed');
});

test('dedicated recovery has a lifetime restart bound while foreground stays available', async t => {
  const own = factory(), peer = factory(), scheduler = await createTaskScheduler({ workerFactory: own.create, duoWorkerFactory: peer.create, maxRestarts: 1, backoffMs: 5 });
  t.after(() => scheduler.close());
  const evaluatePeer = key => scheduler.evaluate({ revision: 0 }, 'two', 'evaluate', undefined, key, key, undefined, [], 'play-v1', undefined, 'duo');
  const interrupted = evaluatePeer('one'), interruptedRejected = assert.rejects(interrupted, /recovering/);
  await until(() => evaluations(peer.workers[0]).length); peer.workers[0].emit('error', new Error('Synthetic peer crash')); await interruptedRejected;
  await until(() => peer.workers.length === 2 && scheduler.getHealth().duo.ready);
  const restored = evaluatePeer('one'); await until(() => evaluations(peer.workers[1]).length); peer.workers[1].finish(); await restored;
  const failing = evaluatePeer('two'), failingRejected = assert.rejects(failing, /recovering/);
  await until(() => evaluations(peer.workers[1]).length === 2); peer.workers[1].emit('error', new Error('Synthetic second peer crash')); await failingRejected;
  assert.equal(scheduler.getHealth().duo.restartRequired, true); assert.equal(scheduler.getHealth().duo.restarts, 1); assert.equal(peer.workers.length, 2);
  await assert.rejects(evaluatePeer('three'), error => error.status === 503);
  const selected = scheduler.evaluate({ revision: 0 }, 'one', 'evaluate', undefined, 'selected', 'selected', undefined, [], 'play-v1');
  own.workers[0].finish(); await selected; assert.equal(scheduler.getHealth().ready, true);
  await scheduler.close(); assert.ok(peer.workers.every(worker => worker.terminated)); assert.equal(own.workers[0].terminated, true);
});

test('sidebar projection routing authenticates and validates revision and mode before reading state bytes', async t => {
  const own = factory(), peer = factory(), { app, request, origin } = await fixture(t, mockOptions(own, peer));
  let byteReads = 0;
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => new Proxy(snapshot(), { get(target, key, receiver) {
    if (key === 'stateJSON') byteReads++;
    if (key === 'state') throw new Error('Sidebar validation materialized calculation state');
    return Reflect.get(target, key, receiver);
  } });
  assert.equal((await fetch(origin + sidebarRoute())).status, 401);
  for (const route of [
    '/api/tasks?memberId=one&view=play-v1&projection=unknown&revision=0',
    '/api/tasks?memberId=one&view=play-v1&projection=&revision=0',
    '/api/tasks?memberId=unknown&view=play-v1&projection=duo-sidebar-v1&revision=0',
    '/api/tasks?memberId=one&projection=duo-sidebar-v1&revision=0',
    '/api/tasks?memberId=one&view=full&projection=duo-sidebar-v1&revision=0',
    '/api/predict?memberId=one&view=play-v1&projection=duo-sidebar-v1&revision=0',
    '/api/chunk-planning?memberId=one&chunkId=12341&view=play-v1&projection=duo-sidebar-v1&revision=0',
    `${peerRoute()}&projection=duo-sidebar-v1`,
  ]) { const response = await request(route); assert.equal(response.status, 400, route); await response.arrayBuffer(); }
  for (const revision of ['1', '-1', '00', '']) { const response = await request(sidebarRoute(revision)); assert.equal(response.status, 409, revision); await response.arrayBuffer(); }
  assert.equal((await request('/api/tasks?memberId=one&view=play-v1&projection=duo-sidebar-v1')).status, 409);
  assert.equal(byteReads, 0); assert.equal(evaluations(own.workers[0]).length, 0); assert.equal(peer.workers.length, 0);
});

test('sidebar API sends selected sidebar bytes while ordinary, full and peer requests retain their respective bytes', async t => {
  const own = factory(), peer = factory(), side = factory(), { app, request } = await fixture(t, mockOptions(own, peer, { predictionWorkerFactory: side.create }));
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => new Proxy(snapshot(), { get(target, key, receiver) {
    if (key === 'state') throw new Error('Sidebar dispatch materialized native state');
    return Reflect.get(target, key, receiver);
  } });
  const pending = request(sidebarRoute()); await until(() => evaluations(own.workers[0]).length === 1);
  const input = evaluations(own.workers[0])[0];
  assert.equal(input.duoSidebarProjection, true); assert.equal(input.duoProjection, undefined); assert.equal(input.resultView, 'play-v1');
  assert.equal(input.stateTransport, 'json-shared-v1'); assert.equal(input.stateRevision, 0); assert.ok(input.stateJSON instanceof SharedArrayBuffer);
  own.workers[0].finish(); const sidebar = await (await pending).json();
  assert.equal(sidebar.projection, 'duo-sidebar-v1'); assert.equal(sidebar.tasks[0].label, 'Sidebar projection'); assert.equal(sidebar.memberId, 'one'); assert.equal(sidebar.stateRevision, 0);
  const peerPending = request(peerRoute()); await until(() => evaluations(peer.workers[0]).length === 1);
  assert.equal(evaluations(peer.workers[0])[0].duoSidebarProjection, undefined); assert.equal(evaluations(peer.workers[0])[0].stateJSON, input.stateJSON);
  const fullPending = request('/api/tasks?memberId=one');
  await delay(30);
  assert.equal(side.workers.length, 0, 'Full hydration waits for the required peer list');
  assert.equal(evaluations(own.workers[0]).length, 1);
  peer.workers[0].finish(); const partner = await (await peerPending).json(); assert.equal(partner.tasks[0].label, 'Peer projection'); assert.equal(partner.projection, undefined);
  await until(() => evaluations(side.workers[0]).length === 1);
  const fullInput = evaluations(side.workers[0])[0];
  assert.equal(fullInput.duoSidebarProjection, undefined); assert.equal(fullInput.resultView, 'full');
  assert.equal(fullInput.stateTransport, 'json-shared-v1'); assert.equal(fullInput.stateJSON, input.stateJSON);
  assert.equal(fullInput.stateRevision, 0); assert.equal(fullInput.state, undefined);
  assert.equal(fullInput.input, input.input); assert.equal(fullInput.snapshotKey, input.snapshotKey);
  side.workers[0].finish();
  const full = await (await fullPending).json(); assert.equal(full.tasks[0].record.Description, 'Full evidence'); assert.equal(full.projection, undefined);
  const ordinary = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  assert.equal(ordinary.projection, undefined); assert.equal(ordinary.tasks[0].label, 'Example'); assert.equal(ordinary.cache.hit, true); assert.equal(evaluations(own.workers[0]).length, 1);
});

test('sidebar API coalesces with active normal work and falls back to ordinary cached bytes without rerunning', async t => {
  const own = factory(), peer = factory(), { request, diagnostics } = await fixture(t, mockOptions(own, peer));
  const pending = request('/api/tasks?memberId=one&view=play-v1'); await until(() => evaluations(own.workers[0]).length === 1);
  const sidebarPending = request(sidebarRoute()); await until(async () => (await diagnostics()).counts.coalesced === 1);
  assert.equal(evaluations(own.workers[0])[0].duoSidebarProjection, undefined); own.workers[0].finish();
  const ordinary = await (await pending).json(), sidebar = await (await sidebarPending).json();
  assert.equal(sidebar.tasks[0].label, ordinary.tasks[0].label); assert.equal(sidebar.projection, undefined); assert.equal(sidebar.cache.hit, true);
  const cached = await (await request(sidebarRoute())).json(); assert.equal(cached.tasks[0].label, 'Example'); assert.equal(cached.projection, undefined); assert.equal(cached.cache.hit, true);
  assert.equal(evaluations(own.workers[0]).length, 1); assert.equal(peer.workers.length, 0);
});

test('inspection API reuses and caches complete ordinary bytes without entering any worker lane', async t => {
  const data = { ...definitions, challenges: { Quest: { Example: { Chunks: ['12341'] }, Future: { Chunks: ['12342'] },
    Excluded: { Chunks: ['12341'], NeverShow: true } } } };
  const { app, request, diagnostics } = await fixture(t, { definitions: data });
  const ordinary = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  await until(async () => (await diagnostics()).viewerTaskCache.entries === 1);
  const before = await diagnostics();
  const snapshot = app.store.getCalculationSnapshot;
  app.store.getCalculationSnapshot = () => { throw new Error('Cached inspection materialized calculation state'); };
  const first = await (await request(inspectionRoute())).json();
  const retained = await diagnostics();
  assert.equal(first.projection, 'duo-inspection-v1'); assert.equal(first.cache.savedResult, true); assert.equal(first.cache.worker, false);
  assert.deepEqual(first.tasks, ordinary.tasks); assert.deepEqual(first.presentation, ordinary.presentation);
  assert.deepEqual(first.collectionPlanning, ordinary.collectionPlanning); assert.deepEqual(first.access, ordinary.access);
  assert.deepEqual(first.neverShowIds, first.tasks.filter(task => task.label === 'Excluded').map(task => task.id));
  assert.equal(ordinary.neverShowIds, undefined);
  assert.ok(first.tasks.length > first.presentation.tasks.length);
  assert.ok(retained.viewerTaskCache.playBytes > before.viewerTaskCache.playBytes);
  const second = await (await request(inspectionRoute())).json(); assert.deepEqual(second, first);
  assert.equal((await diagnostics()).viewerTaskCache.playBytes, retained.viewerTaskCache.playBytes);
  assert.equal((await diagnostics()).counts.requested, before.counts.requested);
  app.store.getCalculationSnapshot = snapshot;
  const unchanged = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  assert.equal(unchanged.projection, undefined); assert.deepEqual(unchanged.tasks, ordinary.tasks);
  assert.equal((await request('/api/command?view=play-v1', { body: { expectedRevision: 0,
    command: { type: 'set-preference', memberId: 'one', preferenceId: 'ids', value: true } } })).status, 200);
  assert.equal((await request(inspectionRoute())).status, 409);
  const rebound = await (await request(inspectionRoute(1))).json();
  assert.equal(rebound.stateRevision, 1); assert.equal(rebound.cache.worker, false); assert.deepEqual(rebound.tasks, first.tasks);
  assert.equal((await request('/api/command?view=play-v1', { body: { expectedRevision: 1,
    command: { type: 'set-chunk', memberId: 'one', chunkId: '12342', status: 'unlocked' } } })).status, 200);
  assert.equal((await diagnostics()).viewerTaskCache.entries, 0);
});

test('cold inspection coalesces with ordinary play work and caches its projection after response', async t => {
  const own = factory(), peer = factory(), { request, diagnostics } = await fixture(t, mockOptions(own, peer));
  const ordinaryPending = request('/api/tasks?memberId=one&view=play-v1'); await until(() => evaluations(own.workers[0]).length === 1);
  const inspectionPending = request(inspectionRoute()); await until(async () => (await diagnostics()).counts.coalesced === 1);
  const input = evaluations(own.workers[0])[0];
  assert.equal(input.duoSidebarProjection, undefined); assert.equal(input.duoProjection, undefined);
  own.workers[0].finish();
  const ordinary = await (await ordinaryPending).json(), inspection = await (await inspectionPending).json();
  assert.equal(inspection.projection, 'duo-inspection-v1'); assert.deepEqual(inspection.tasks, ordinary.tasks);
  await until(async () => (await diagnostics()).viewerTaskCache.entries === 1);
  assert.equal((await (await request(inspectionRoute())).json()).cache.worker, false);
  assert.equal(evaluations(own.workers[0]).length, 1); assert.equal(peer.workers.length, 0);
});

test('inspection validates scope and revision before worker admission and rejects a revision changed during work', async t => {
  const own = factory(), peer = factory(), { request } = await fixture(t, mockOptions(own, peer));
  for (const route of [inspectionRoute().replace('&view=play-v1', ''), inspectionRoute() + '&lane=duo-v1&peerFor=two',
    inspectionRoute().replace('/api/tasks', '/api/predict'), inspectionRoute(0, 'missing')]) {
    assert.equal((await request(route)).status, 400, route);
  }
  for (const revision of ['1', '-1', '00', '']) assert.equal((await request(inspectionRoute(revision))).status, 409);
  assert.equal((await request(inspectionRoute().replace('&revision=0', ''))).status, 409);
  assert.equal(evaluations(own.workers[0]).length, 0);
  const pending = request(inspectionRoute()); await until(() => evaluations(own.workers[0]).length === 1);
  assert.equal((await request('/api/command?view=play-v1', { body: { expectedRevision: 0,
    command: { type: 'set-preference', memberId: 'one', preferenceId: 'ids', value: true } } })).status, 200);
  own.workers[0].finish(); assert.equal((await pending).status, 409);
});

test('viewer inspection reads only saved ordinary results and never admits missing work', async t => {
  const own = factory(), peer = factory(), { request, origin, diagnostics } = await fixture(t, mockOptions(own, peer));
  const invite = await (await request('/api/invites', { body: { label: 'Inspection viewer', viewer: true } })).json();
  const joined = await fetch(origin + new URL(invite.link).pathname, { redirect: 'manual' });
  assert.equal(joined.status, 303);
  const cookie = joined.headers.get('set-cookie')?.split(';')[0];
  const viewer = route => fetch(origin + route, { headers: { Cookie: cookie } });
  const before = await diagnostics();
  const missing = await viewer(inspectionRoute()); assert.equal(missing.status, 409); assert.equal((await missing.json()).code, 'TASK_RESULTS_UNAVAILABLE');
  assert.equal((await diagnostics()).counts.requested, before.counts.requested);
  const pending = request('/api/tasks?memberId=one&view=play-v1'); await until(() => evaluations(own.workers[0]).length === 1);
  own.workers[0].finish(); const ordinary = await (await pending).json();
  await until(async () => (await diagnostics()).viewerTaskCache.entries === 1);
  const ready = await diagnostics(), loaded = await (await viewer(inspectionRoute())).json();
  assert.equal(loaded.projection, 'duo-inspection-v1'); assert.equal(loaded.cache.worker, false); assert.deepEqual(loaded.tasks, ordinary.tasks);
  assert.equal((await diagnostics()).counts.requested, ready.counts.requested);
  assert.equal((await viewer(inspectionRoute(1))).status, 409); assert.equal((await viewer(inspectionRoute(0, 'two'))).status, 409);
  assert.equal(peer.workers.length, 0);
});
