import { emptyMetadataDataset } from './helpers/server-dataset.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { projectDisplayWorld, hydrateDisplayWorld } from '../app/display-world.mjs';
import { applySandboxChanges } from '../app/sandbox.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { SURFACE_GRID, surfaceCoordinates } from '../app/data/surface-grid.mjs';
import { taskRuleDefinitions } from '../app/data/settings.mjs';

const questVisibilityRule = taskRuleDefinitions.some(row => row.id === 'Show Quest Tasks') ? 'Show Quest Tasks' : 'Quests';
const fixtureRules = createRuleRegistry();
const geometricMode = fixtureRules.get('roll.neighborMode').options.find(value => value === 'frontier' || value === 'geometric');

// Four adjacent synthetic cells ending at the northern edge fit either grid.
const firstChunk = surfaceCoordinates('12344') ? 12341 : SURFACE_GRID.startId - 3;
const chunkId = index => String(firstChunk + index);

const definitions = {
  chunks: { [chunkId(0)]: {}, [chunkId(1)]: {}, [chunkId(2)]: {}, [chunkId(3)]: {} },
  walkableChunks: [chunkId(0), chunkId(1), chunkId(2), chunkId(3)], walkableChunksF2P: [chunkId(0), chunkId(1), chunkId(2), chunkId(3)],
  challenges: { Quest: { Present: { Chunks: [chunkId(0)] }, Future: { Chunks: [chunkId(1)] }, Further: { Chunks: [chunkId(2)] } } },
};
async function fixture(t, options = {}) {
  const tempRoot = path.resolve('.local/test-tmp'); await mkdir(tempRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(tempRoot, 'sandbox-server-'));
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: [chunkId(0)] }, { id: 'two', name: 'Two', unlocked: [chunkId(3)] }]);
  initialState.rules['roll.neighborMode'] = geometricMode;
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); }
  });
  app = await createServer({ dataset: await emptyMetadataDataset(), dataDir, port: 0, initialState, definitions, taskMap: {}, predictionPrewarm: false, shutdownDeadlineMs: 500,
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'), ...options });
  await app.listen();
  const invitation = new URL(app.inviteUrl), origin = invitation.origin;
  const headers = { Authorization: `Bearer ${invitation.pathname.slice('/join/'.length)}` };
  const request = (route, options = {}) => fetch(origin + route, { ...options, headers: { ...headers, ...options.headers } });
  const body = changes => ({ memberId: 'one', baseRevision: app.store.getInfo().revision,
    changes: { unlockChunks: [], lockChunks: [], doneTasks: [], ...changes } });
  const post = (value, route = '/api/sandbox/evaluate', options = {}) => request(route, { method: 'POST',
    body: JSON.stringify(value), ...options, headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers } });
  return { app, dataDir, origin, request, post, body };
}

test('authenticated sandbox computes multi-chunk tasks, saved-baseline delta, pools and hypothetical Preview without durable changes', async t => {
  const { app, dataDir, request, post, body } = await fixture(t);
  const saved = app.store.getState(), diskBefore = await readFile(path.join(dataDir, 'state.json'));
  const before = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  const response = await post({ ...body({ unlockChunks: [chunkId(1)], lockChunks: [chunkId(0)] }), previewChunkId: chunkId(2), planningChunkId: chunkId(1) });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  const value = await response.json();
  assert.equal(value.format, 'sandbox-v1'); assert.equal(value.result.format, 'play-v1');
  assert.equal(value.memberId, 'one'); assert.equal(value.stateRevision, saved.revision);
  assert.equal(value.result.memberId, 'one'); assert.equal(value.result.stateRevision, saved.revision);
  assert.deepEqual(value.delta.tasksAdded.map(row => row.label), ['Future']);
  assert.deepEqual(value.delta.tasksRemoved.map(row => row.label), ['Present']);
  assert.deepEqual(value.prediction.delta.tasksAdded.map(row => row.label), ['Further']);
  assert.equal(value.planning.format, 'chunk-planning-v1');
  assert.equal(value.planning.chunkId, chunkId(1));
  assert.deepEqual(value.planning.access.bases, [chunkId(1)]);
  assert.ok(value.planning.rows.some(row => row.task.label === 'Future' && row.task.status === 'available'));
  assert.deepEqual(value.result.access.bases, [chunkId(1)]);
  assert.equal(value.possibleCount, value.result.metrics.availableCount);
  assert.deepEqual(Object.keys(value.rollPool).sort(), ['accessible', 'eligible', 'excluded', 'partnerConnections']);
  assert.ok(value.rollPool.eligible.some(row => row.id === chunkId(2)));
  assert.ok(!value.rollPool.eligible.some(row => row.id === chunkId(1)));
  const browserWorld = hydrateDisplayWorld(projectDisplayWorld(app.world));
  const renderer = { cells: new Map(), deathMarkers: new Map(), dirty: {}, initialized: true, schedule() {} };
  const hypothetical = applySandboxChanges(saved, 'one', value.changes);
  assert.doesNotThrow(() => ChunkMap.prototype.setModel.call(renderer, {
    world: browserWorld, state: hypothetical, memberId: 'one', pool: value.rollPool,
  }), 'A hydrated browser map must adopt the real endpoint pool without a server-side resolver');
  assert.equal(renderer.connections, value.rollPool.partnerConnections);
  assert.ok(renderer.unlocked.has(chunkId(1))); assert.ok(!renderer.unlocked.has(chunkId(0)));
  assert.ok(value.result.presentation.tasks.every(row => Object.keys(row).length === 1));
  assert.ok(value.result.tasks.every(row => !Object.hasOwn(row, 'record') && !Object.hasOwn(row, 'sources')));
  assert.deepEqual(app.store.getState(), saved);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), diskBefore);
  const after = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  assert.deepEqual(after.tasks, before.tasks, 'Hypothetical results cannot replace saved task snapshots');
  assert.deepEqual(after.access, before.access);
  const empty = await (await post(body())).json();
  assert.deepEqual(empty.delta.tasksAdded, []); assert.deepEqual(empty.delta.tasksRemoved, []);
  assert.equal(empty.cache.timingMs.engineMs, 0, 'Empty drafts reuse the saved advisory baseline');
});

test('normalized drafts share bounded worker cache, rule changes and Preview variants remain distinct', async t => {
  const { app, post, body } = await fixture(t);
  const first = await (await post(body({ unlockChunks: [chunkId(2), chunkId(1)] }))).json();
  const again = await (await post(body({ unlockChunks: [chunkId(1), chunkId(2)] }))).json();
  assert.equal(first.cache.hit, false); assert.equal(again.cache.hit, true);
  assert.equal(first.cache.poolHit, false); assert.equal(again.cache.poolHit, true);
  assert.ok(first.cache.timingMs.sandboxProjectionMs >= 0);
  assert.ok(first.cache.timingMs.sandboxSerializationMs >= 0);
  assert.ok(first.cache.timingMs.sandboxPoolMs >= 0);
  assert.deepEqual(again.delta, first.delta);
  const changed = await (await post(body({ unlockChunks: [chunkId(1), chunkId(2)], taskRules: { [questVisibilityRule]: false } }))).json();
  assert.equal(changed.cache.hit, false); assert.equal(changed.result.presentation.tasks.length, 0);
  const preview = await (await post({ ...body({ unlockChunks: [chunkId(1), chunkId(2)] }), previewChunkId: chunkId(3) })).json();
  assert.equal(preview.cache.hit, false); assert.ok(preview.prediction);
  const planning = await (await post({ ...body({ unlockChunks: [chunkId(1), chunkId(2)] }), planningChunkId: chunkId(2) })).json();
  assert.equal(planning.cache.hit, false); assert.equal(planning.planning.chunkId, chunkId(2));
  assert.equal(planning.cache.hypotheticalHit, true);
  assert.equal(planning.cache.poolHit, true);
  assert.equal(planning.cache.timingMs.engineMs, 0, 'Focused planning reuses this draft instead of re-evaluating it');
  const saved = app.store.getState(), taskId = saved.tasks.find(row => row.label === 'Present').id;
  const done = await post(body({ doneTasks: [taskId] })); assert.equal(done.status, 200);
  const doneValue = await done.json();
  assert.deepEqual(doneValue.delta.tasksRemoved.map(row => row.id), [taskId]);
  assert.deepEqual(app.store.getState(), saved);
  assert.ok(app.server.listening);
});

test('sandbox rejects missing access, wrong origin, malformed inputs, oversized bodies and stale revisions', async t => {
  const { origin, request, post, body } = await fixture(t);
  const unauthenticated = await fetch(origin + '/api/sandbox/evaluate', { method: 'POST', headers: { Origin: origin,
    'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await post(body(), undefined, { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await post({ ...body(), baseRevision: 99 })).status, 409);
  assert.equal((await post({ ...body({ doneTasks: ['removed-at-a-new-revision'] }), baseRevision: 99 })).status, 409);
  for (const invalid of [
    { ...body(), memberId: 'absent' }, { ...body(), revision: 0 }, body({ unlockChunks: [chunkId(1)], lockChunks: [chunkId(1)] }),
    body({ unlockChunks: ['12342-0'] }), body({ doneTasks: ['not-a-task'] }), body({ taskRules: { 'Show Quest Tasks': 1 } }),
    { ...body(), planningChunkId: 'Unknown area' },
  ]) assert.equal((await post(invalid)).status, 400);
  assert.equal((await request('/api/sandbox/evaluate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await post({ ...body(), padding: 'x'.repeat(65536) })).status, 413);
});

test('sandbox cache eviction and durable revisions discard old draft results', async t => {
  const { app, request, post, body } = await fixture(t, { taskWorkerOptions: { predictionCacheLimit: 2 } });
  const response = changes => post(body(changes)).then(async value => { assert.equal(value.status, 200); return value.json(); });
  assert.equal((await response({ unlockChunks: [chunkId(1)] })).cache.hit, false);
  assert.equal((await response({ unlockChunks: [chunkId(2)] })).cache.hit, false);
  assert.equal((await response({ unlockChunks: [chunkId(1), chunkId(2)] })).cache.hit, false);
  assert.equal((await response({ unlockChunks: [chunkId(1)] })).cache.hit, false);
  assert.equal(app.store.getInfo().revision, 0);
  assert.equal((await request('/api/diagnostics')).status, 200);
  const old = body({ unlockChunks: [chunkId(1)] });
  const saved = await post({ expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: chunkId(0), note: 'Next revision' } }, '/api/command');
  assert.equal(saved.status, 200);
  assert.equal((await post(old)).status, 409);
  const current = await response({ unlockChunks: [chunkId(1)] });
  assert.equal(current.stateRevision, 1); assert.equal(current.cache.hit, false);
  assert.equal(current.cache.poolHit, false);
});

test('sandbox calculations stay on the advisory lane and a concurrent save supersedes their result', async t => {
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message); worker.terminate = async () => {};
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const { app, post, body } = await fixture(t, { taskWorkerOptions: { workerFactory } });
  const pending = post(body({ unlockChunks: [chunkId(1)] }));
  for (let index = 0; index < 100 && !workers[1]?.messages.some(row => row.type === 'sandbox'); index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(workers.length, 2);
  assert.ok(workers[1].messages.some(row => row.type === 'sandbox'));
  assert.ok(!workers[0].messages.some(row => row.type === 'sandbox'));
  const saved = await post({ expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } }, '/api/command');
  assert.equal(saved.status, 200); assert.equal((await pending).status, 409);
  assert.equal(app.store.getState().rules['access.shared'], false);
});

test('sandbox shared inputs resend one captured saved snapshot and keep normalized drafts independent', async t => {
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => {
      worker.messages.push(message);
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
      if (message.type === 'sandbox') queueMicrotask(() => worker.emit('message', { id: message.id,
        result: { format: 'sandbox-v1', memberId: message.memberId, stateRevision: message.stateRevision,
          changes: message.chunkId.changes, result: { format: 'play-v1', tasks: [] }, delta: {}, possibleCount: 0 } }));
    };
    worker.terminate = async () => {}; workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const { post, body } = await fixture(t, { taskWorkerOptions: { workerFactory, serializedStateInput: true } });
  assert.equal((await post(body({ unlockChunks: [chunkId(1)] }))).status, 200);
  assert.equal((await post(body({ unlockChunks: [chunkId(2)] }))).status, 200);
  const messages = workers[1].messages.filter(row => row.type === 'sandbox');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].state, undefined); assert.equal(messages[0].stateTransport, 'json-shared-v1');
  assert.ok(messages[0].stateJSON instanceof SharedArrayBuffer);
  assert.equal(messages[0].resultTransport, 'json-shared-v1');
  assert.equal(messages[1].stateJSON, undefined); assert.equal(messages[1].snapshotKey, messages[0].snapshotKey);
  assert.deepEqual(messages.map(row => row.chunkId.changes.unlockChunks), [[chunkId(1)], [chunkId(2)]]);
});

test('native sandbox shared output preserves direct object consumers and sends only compact immutable bytes', async t => {
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, areas: world.areas, surface: world.surface } }),
  });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message'); assert.equal(ready.type, 'ready');
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: [chunkId(0)] }]);
  state.tasks = ready.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const send = async options => {
    const pending = once(worker, 'message');
    worker.postMessage({ id: 1, type: 'sandbox', state, memberId: 'one',
      chunkId: { changes: { unlockChunks: [chunkId(1)], lockChunks: [], doneTasks: [] } }, ...options });
    const [response] = await pending; assert.equal(response.error, undefined); return response;
  };
  const direct = await send({});
  assert.ok(direct.result); assert.equal(direct.sandboxJSON, undefined);
  const shared = await send({ resultTransport: 'json-shared-v1' });
  assert.equal(shared.result, undefined); assert.ok(shared.sandboxJSON instanceof SharedArrayBuffer);
  const projected = JSON.parse(Buffer.from(shared.sandboxJSON).toString('utf8'));
  const { cache, ...expected } = direct.result;
  assert.deepEqual(projected, JSON.parse(JSON.stringify(expected)));
  assert.equal(shared.resultCache.baselineHit, true); assert.equal(shared.resultCache.hypotheticalHit, true);
  assert.ok(shared.timingMs.sandboxSerializationMs >= 0);
  assert.ok(projected.result.tasks.every(row => !Object.hasOwn(row, 'record') && !Object.hasOwn(row, 'sources')));
});

test('shared sandbox results stay lazy through scheduler caching and obey byte quotas', async t => {
  const workers = [], output = { format: 'sandbox-v1', lazyMarker: true }, bytes = Buffer.from(JSON.stringify(output));
  const shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => {
      worker.messages.push(message);
      if (message.type === 'sandbox') queueMicrotask(() => worker.emit('message', { id: message.id,
        sandboxJSON: shared, resultCache: { baselineHit: true, hypotheticalHit: true }, evaluationMs: 1 }));
    };
    worker.terminate = async () => {}; workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory, predictionCacheBytes: 1024 });
  t.after(() => scheduler.close());
  const state = createGroupState([{ id: 'one', name: 'One' }]), draft = { changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } };
  const parse = JSON.parse; let parses = 0;
  JSON.parse = (value, ...args) => { if (typeof value === 'string' && value.includes('"lazyMarker"')) parses++; return parse(value, ...args); };
  t.after(() => { JSON.parse = parse; });
  const first = await scheduler.evaluate(state, 'one', 'sandbox', draft, 'draft', 'saved');
  const second = await scheduler.evaluate(state, 'one', 'sandbox', draft, 'draft', 'saved');
  assert.equal(second.hit, true); assert.equal(parses, 0);
  assert.deepEqual(first.resultCache, { baselineHit: true, hypotheticalHit: true });
  assert.ok(scheduler.getDiagnostics().predictionLane.cache.bytes >= bytes.length);
  assert.equal(parses, 0);
  assert.deepEqual(first.result, { ...output, cache: first.resultCache });
  assert.equal(second.result, first.result); assert.equal(parses, 1, 'Coalesced/cache waiters share the same memoized parse');
  const oversized = await createTaskScheduler({ workerFactory, predictionCacheBytes: 1 });
  t.after(() => oversized.close());
  await oversized.evaluate(state, 'one', 'sandbox', draft, 'large', 'saved');
  assert.equal(oversized.getDiagnostics().predictionLane.cache.entries, 0);
  assert.equal((await oversized.evaluate(state, 'one', 'sandbox', draft, 'large', 'saved')).hit, false);
});

test('sandbox static assets require authentication', async t => {
  const { origin, request } = await fixture(t);
  for (const route of ['/sandbox.mjs', '/sandbox.css', '/sandbox-rules.mjs']) {
    assert.equal((await fetch(origin + route)).status, 401);
    const response = await request(route); assert.equal(response.status, 200, route);
    assert.match(response.headers.get('cache-control'), /private/); await response.arrayBuffer();
  }
});
