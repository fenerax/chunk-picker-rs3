import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { partnerConnections } from '../app/core/rules.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';
import { projectPlayState } from '../app/play-view.mjs';

const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  sections: { '12341': { '0': [] }, '12342': { '0': [] } }, challenges: { Quest: { Example: { Chunks: ['12341'] } } } };
async function fixture(t, options = {}) {
  const { beforeListen, ...serverOptions } = options;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-play-server-'));
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]);
  state.provenance = { retainedArchive: { original: 'archived '.repeat(2000) }, restore: { previousHistory: [{ id: 'archived-event', revision: 0, type: 'import', at: '2026-10-01T00:00:00.000Z' }] } };
  let app = await createServer({ dataDir, definitions, taskMap: {}, initialState: state, port: 0, predictionPrewarm: false, shutdownDeadlineMs: 500,
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'), ...serverOptions });
  t.after(async () => {
    try { await app?.close(); }
    finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); }
  });
  beforeListen?.(app);
  await app.listen(); const invite = new URL(app.inviteUrl), origin = invite.origin;
  const auth = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = (route, { headers = {}, body, method } = {}) => fetch(origin + route, { method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...auth, ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, origin, request };
}
test('play state, acknowledgement and conflict retain coherent revisions and exact personal connections', async t => {
  const { app, request } = await fixture(t), world = buildWorld(definitions);
  const full = await (await request('/api/state')).json(), play = await (await request('/api/state?view=play-v1')).json();
  assert.equal(play.format, 'play-v1'); assert.equal(play.state.provenance, undefined); assert.ok(full.state.provenance.retainedArchive);
  for (const field of ['members', 'tasks', 'rules', 'legacy', 'history']) assert.deepEqual(play.state[field], projectPlayState(full.state)[field]);
  for (const owner of full.state.members) assert.deepEqual(play.pools[owner.id].partnerConnections, partnerConnections(world, full.state, owner.id));
  assert.deepEqual((await (await request('/api/history')).json()).previousHistory, full.state.provenance.restore.previousHistory);
  const calculation = app.store.getCalculationState(); assert.deepEqual(calculation.history, []); assert.equal(calculation.provenance, undefined);
  assert.deepEqual(calculation.identityRegistry, full.state.identityRegistry); assert.deepEqual(app.store.getRules(), full.state.rules);
  const body = { expectedRevision: full.state.revision, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Saved' } };
  const saved = await (await request('/api/command?view=play-v1', { body })).json();
  assert.equal(saved.format, 'play-v1'); assert.equal(saved.state.revision, full.state.revision + 1);
  assert.equal(saved.baseRevision, play.state.revision); assert.ok(saved.unchangedFields.includes('tasks')); assert.ok(saved.unchangedFields.includes('identityRegistry'));
  const merged = mergeCommandState(play.state, saved);
  const conflict = await request('/api/command?view=play-v1', { body }); assert.equal(conflict.status, 409);
  const latest = await conflict.json(); assert.deepEqual(latest.state, merged); assert.deepEqual(latest.pools, saved.pools);
  assert.equal((await (await request('/api/backup')).json()).state.provenance.retainedArchive.original, full.state.provenance.retainedArchive.original);
  const taskPlay = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  const taskFull = await (await request('/api/tasks?memberId=one')).json();
  assert.equal(taskPlay.format, 'play-v1'); assert.deepEqual(taskPlay.tasks.map(row => row.id), taskFull.tasks.map(row => row.id));
  assert.deepEqual(taskPlay.presentation.tasks.map(row => row.id), taskFull.presentation.tasks.map(row => row.id));
  const metrics = ({ elapsedMs, ...counts }) => counts;
  assert.deepEqual(metrics(taskPlay.metrics), metrics(taskFull.metrics)); assert.equal(taskPlay.tasks[0].record, undefined); assert.ok(taskFull.tasks[0].record);
  assert.equal(taskPlay.stateRevision, saved.state.revision);
  assert.equal((await (await request('/api/tasks?memberId=one')).json()).cache.hit, true);
});
test('cached GET, conditional GET and HEAD all authenticate before returning representation bytes', async t => {
  const { request, origin } = await fixture(t);
  const routes = ['/api/state?view=play-v1', '/api/display-world', '/api/rules', '/api/definitions', '/api/definitions?view=display-v1', '/main.mjs', '/style.css', '/display-world.mjs'];
  for (const route of routes) {
    const headers = { 'Accept-Encoding': 'identity' }, first = await request(route, { headers });
    assert.equal(first.status, 200, route); const etag = first.headers.get('etag'); assert.ok(etag, route);
    assert.match(first.headers.get('cache-control'), /^private/); await first.arrayBuffer();
    for (const method of ['GET', 'HEAD']) {
      const conditional = await request(route, { method, headers: { ...headers, 'If-None-Match': etag } });
      assert.equal(conditional.status, 304, `${method} ${route}`); assert.equal((await conditional.arrayBuffer()).byteLength, 0);
      assert.match(conditional.headers.get('cache-control'), /^private/); assert.equal(conditional.headers.get('vary'), 'Accept-Encoding');
      const anonymous = await fetch(origin + route, { method, headers: { ...headers, 'If-None-Match': etag } });
      assert.equal(anonymous.status, 401, route); assert.equal(anonymous.headers.get('cache-control'), 'private, no-store');
    }
  }
  const created = await (await request('/api/invites', { body: { label: 'Temporary' } })).json();
  const joined = await fetch(created.link, { redirect: 'manual' }), cookie = joined.headers.get('set-cookie').split(';')[0];
  const authenticatedCached = [];
  for (const route of ['/api/display-world', '/api/state?view=play-v1']) {
    const before = await fetch(origin + route, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity' } });
    assert.equal(before.status, 200); authenticatedCached.push([route, before.headers.get('etag')]); await before.arrayBuffer();
  }
  await request(`/api/invites/${created.invite.id}/revoke`, { body: {} });
  for (const [route, etag] of authenticatedCached) for (const method of ['GET', 'HEAD']) assert.equal((await fetch(origin + route, { method, headers: { Cookie: cookie, 'If-None-Match': etag } })).status, 401);
});
test('readiness prepares only the play response, authenticated compressed cache reads reuse it and the next revision remains exact', async t => {
  const views = []; let originalSnapshot;
  const { app, request } = await fixture(t, { beforeListen(application) {
    originalSnapshot = application.store.getStateSnapshot;
    application.store.getStateSnapshot = options => { views.push(options.view); return originalSnapshot(options); };
  } });
  assert.deepEqual(views, ['play-v1']);
  app.store.getStateSnapshot = () => { throw new Error('Initial play response was not prepared'); };
  let initialETag;
  for (const encoding of ['br', 'gzip']) {
    const response = await request('/api/state?view=play-v1', { headers: { 'Accept-Encoding': encoding } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), encoding); assert.match(response.headers.get('cache-control'), /^private/);
    assert.equal((await response.json()).state.revision, 0);
    if (encoding === 'br') initialETag = response.headers.get('etag');
    const head = await request('/api/state?view=play-v1', { method: 'HEAD', headers: { 'Accept-Encoding': encoding, 'If-None-Match': response.headers.get('etag') } });
    assert.equal(head.status, 304); assert.equal(await head.text(), ''); assert.equal(head.headers.get('vary'), 'Accept-Encoding');
  }
  app.store.getStateSnapshot = originalSnapshot;
  await request('/api/command?view=play-v1', { body: { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'New revision' } } });
  const next = await request('/api/state?view=play-v1', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': initialETag } });
  assert.equal(next.status, 200); assert.notEqual(next.headers.get('etag'), initialETag);
  assert.deepEqual((await next.json()).state, projectPlayState(app.store.getState()));
  const diagnostics = await (await request('/api/diagnostics')).json();
  assert.ok(diagnostics.startupTimingMs.variantMs >= 0); assert.ok(diagnostics.startupTimingMs.stateResponseMs >= 0);
});
test('display definitions contain exactly full-definition chunks and have independent encoded validators', async t => {
  const { request } = await fixture(t), identity = { 'Accept-Encoding': 'identity' };
  const fullResponse = await request('/api/definitions', { headers: identity }), full = await fullResponse.json();
  const displayResponse = await request('/api/definitions?view=display-v1', { headers: identity }), display = await displayResponse.json();
  assert.deepEqual(Object.keys(display), ['chunks']); assert.deepEqual(display.chunks, full.chunks); assert.ok(full.challenges);
  assert.notEqual(displayResponse.headers.get('etag'), fullResponse.headers.get('etag'));
  const compressed = await request('/api/definitions?view=display-v1', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.deepEqual(await compressed.json(), display); assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.notEqual(compressed.headers.get('etag'), displayResponse.headers.get('etag'));
  const cached = await request('/api/definitions?view=display-v1', { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': compressed.headers.get('etag') } });
  assert.equal(cached.status, 304); assert.match(cached.headers.get('cache-control'), /^private/); assert.equal(cached.headers.get('vary'), 'Accept-Encoding');
});
test('refused identity encoding on error bodies cannot reject the HTTP handler or stop the server', async t => {
  const { request, origin } = await fixture(t), headers = { 'Accept-Encoding': 'gzip, identity;q=0' };
  const missing = await request('/missing', { headers });
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('content-encoding'), 'gzip');
  assert.equal((await missing.json()).message, 'Not found.');
  const anonymous = await fetch(origin + '/api/state', { headers });
  assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get('content-encoding'), 'gzip'); await anonymous.json();
  for (const route of ['/missing', '/api/session']) {
    const refused = await request(route, { headers: { 'Accept-Encoding': '*;q=0' } });
    assert.equal(refused.status, 406); assert.equal(await refused.text(), ''); assert.equal(refused.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await request('/api/health')).status, 200);
});
test('chunk planning is authenticated, bounded and revision scoped without returning the full task result', async t => {
  const { request, origin } = await fixture(t), route = '/api/chunk-planning?memberId=one&chunkId=12341';
  const anonymous = await fetch(origin + route); assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('cache-control'), 'private, no-store');
  for (const suffix of ['memberId=one', 'memberId=missing&chunkId=12341', 'memberId=one&chunkId=unknown', `memberId=one&chunkId=${'1'.repeat(257)}`]) {
    assert.equal((await request('/api/chunk-planning?' + suffix)).status, 400, suffix);
  }
  const response = await request(route), planning = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(planning.format, 'chunk-planning-v1'); assert.equal(planning.chunkId, '12341');
  assert.equal(planning.memberId, 'one'); assert.equal(planning.stateRevision, 0); assert.equal(planning.cache.worker, true);
  assert.ok(planning.rows.length); assert.equal(planning.tasks, undefined); assert.equal(planning.currentBiS, undefined);
  assert.ok(planning.rows.every(row => !row.task.record || Object.keys(row.task.record).every(key => key === 'ClueTier')));
  const head = await request(route, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await request('/tasks/chunk-planning-index.mjs')).status, 200);
  await request('/api/command?view=play-v1', { body: { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Saved' } } });
  assert.equal((await (await request(route)).json()).stateRevision, 1);
});
test('native task and planning routes validate captured metadata and dispatch serialized state without materializing the full object', async t => {
  const { app, request, origin } = await fixture(t, { taskWorkerOptions: { serializedStateInput: true,
    workerFactory: data => new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData(data) }) } }), original = app.store.getCalculationSnapshot;
  let snapshots = 0, bytesReads = 0;
  app.store.getCalculationSnapshot = () => {
    snapshots++;
    return new Proxy(original(), { get(target, key, receiver) {
      if (key === 'state') throw new Error('Native route materialized the calculation object');
      if (key === 'stateJSON') bytesReads++;
      return Reflect.get(target, key, receiver);
    } });
  };
  assert.equal((await fetch(origin + '/api/tasks?memberId=one')).status, 401); assert.equal(snapshots, 0);
  assert.equal((await request('/api/tasks?memberId=missing')).status, 400); assert.equal(bytesReads, 0);
  const compact = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  const full = await (await request('/api/tasks?memberId=two')).json();
  const planning = await (await request('/api/chunk-planning?memberId=one&chunkId=12341')).json();
  assert.equal(compact.memberId, 'one'); assert.equal(full.memberId, 'two'); assert.equal(planning.memberId, 'one');
  assert.ok(full.tasks[0].record); assert.equal(compact.stateRevision, 0); assert.equal(full.stateRevision, 0); assert.equal(planning.stateRevision, 0);
  assert.equal(snapshots, 1); assert.equal(compact.stateJSON, undefined); assert.equal(full.stateJSON, undefined);
  await request('/api/command?view=play-v1', { body: { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Next revision' } } });
  const next = await (await request('/api/tasks?memberId=one&view=play-v1')).json();
  assert.equal(next.stateRevision, 1); assert.equal(snapshots, 2);
});
test('custom worker factories retain full object input unless they explicitly support serialized native state', async t => {
  const messages = [], workerFactory = () => {
    const worker = new EventEmitter(); worker.terminate = async () => {};
    worker.postMessage = message => {
      messages.push(message);
      if (message.type === 'evaluate') queueMicrotask(() => worker.emit('message', { id: message.id, result: { tasks: [], metrics: {} }, evaluationMs: 1 }));
    };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const { app, request } = await fixture(t, { taskWorkerOptions: { workerFactory } });
  assert.equal((await request('/api/tasks?memberId=one&view=play-v1')).status, 200);
  const input = messages.find(message => message.type === 'evaluate');
  assert.deepEqual(input.state, app.store.getCalculationState()); assert.equal(input.stateJSON, undefined); assert.equal(input.stateTransport, undefined);
});
test('optional startup preparation failure leaves degraded worker diagnostics and durable saves available', async t => {
  let preparationRequests = 0;
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.terminate = async () => {};
    worker.postMessage = message => {
      if (message.type === 'prepare-rules') {
        preparationRequests++;
        queueMicrotask(() => worker.emit('error', new Error('Injected preparation interruption')));
      }
    };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const { app, request } = await fixture(t, { taskWorkerOptions: { workerFactory, serializedStateInput: true, maxRestarts: 0 } });
  assert.equal(preparationRequests, 1); assert.equal(app.server.listening, true);
  const health = await (await request('/api/health')).json();
  assert.equal(health.ready, false); assert.equal(health.savesReady, true); assert.equal(health.worker.status, 'restart-required');
  const diagnostics = await (await request('/api/diagnostics')).json();
  assert.equal(diagnostics.startupPrepared.variant, false); assert.equal(diagnostics.startupPrepared.stateResponse, true);
  assert.ok(Number.isFinite(diagnostics.startupTimingMs.variantMs));
  const timing = app.getStartupTimingMs(); timing.variantMs = -1;
  assert.ok(app.getStartupTimingMs().variantMs >= 0); assert.deepEqual(Object.keys(app.getStartupTimingMs()), ['cataloguesMs', 'workerAndReferencesMs', 'storeMs', 'authMs', 'variantMs', 'stateResponseMs']);
  const saved = await request('/api/command?view=play-v1', { body: { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Still durable' } } });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).state.revision, 1);
  assert.equal(app.store.getState().members[0].notes['12341'], 'Still durable');
  assert.equal((await request('/api/tasks?memberId=one')).status, 503);
});
test('two authenticated clients receive each play commit over SSE and merge coherent own and peer revisions', async t => {
  const { request, origin } = await fixture(t), clients = [];
  const readRevision = async (reader, revision) => {
    let text = ''; const deadline = setTimeout(() => { for (const client of clients) client.controller.abort(); }, 5000);
    try {
      while (!text.includes(`data: {"revision":${revision}}`)) {
        const chunk = await reader.read(); assert.equal(chunk.done, false); text += new TextDecoder().decode(chunk.value);
        assert.ok(text.length < 65536);
      }
    } finally { clearTimeout(deadline); }
  };
  try {
    for (const label of ['Client one', 'Client two']) {
      const created = await (await request('/api/invites', { body: { label } })).json();
      const joined = await fetch(created.link, { redirect: 'manual' }), cookie = joined.headers.get('set-cookie').split(';')[0];
      const controller = new AbortController(), events = await fetch(origin + '/api/events', { headers: { Cookie: cookie }, signal: controller.signal });
      assert.equal(events.status, 200); assert.equal(events.headers.get('cache-control'), 'private, no-store');
      const reader = events.body.getReader(); clients.push({ cookie, controller, reader }); await readRevision(reader, 0);
    }
    const get = client => fetch(origin + '/api/state?view=play-v1', { headers: { Cookie: client.cookie } }).then(response => response.json());
    let state = (await get(clients[0])).state;
    for (let revision = 1; revision <= 2; revision++) {
      const client = clients[revision - 1];
      const saved = await fetch(origin + '/api/command?view=play-v1', { method: 'POST', headers: { Cookie: client.cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision - 1, command: { type: 'set-note', memberId: revision === 1 ? 'one' : 'two', chunkId: revision === 1 ? '12341' : '12342', note: 'Own committed note' } }) });
      assert.equal(saved.status, 200); state = mergeCommandState(state, await saved.json()); assert.equal(state.revision, revision);
      await Promise.all(clients.map(value => readRevision(value.reader, revision)));
      for (const value of clients) assert.deepEqual((await get(value)).state, state);
    }
  } finally {
    for (const client of clients) { client.controller.abort(); await client.reader.cancel().catch(() => {}); }
  }
});
