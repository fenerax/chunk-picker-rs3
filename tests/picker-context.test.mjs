import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createUsageRateLimit } from '../app/usage-route.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { createPickerContext } from '../app/picker-context.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createRateLimits, createStreamLimits, requestContext } from '../app/security/request.mjs';
import { createRepresentation, createResponseCache } from '../app/http-response.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const clock = () => Date.parse('2026-10-21T12:00:00.000Z');
const taskId = 'rs3:task:context-fixture';
const clientId = '40000000-0000-4000-8000-000000000001';
const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const note = text => ({ type: 'set-note', memberId: 'one', chunkId: '12341', note: text });

// The same runtime (including calculator facade and admission budgets) is passed
// to both contexts. It holds no saved state, private result cache or writer lock.
function sharedRuntime() {
  const callbacks = new Map();
  const subscribe = kind => callback => {
    if (!callbacks.has(kind)) callbacks.set(kind, new Set());
    callbacks.get(kind).add(callback);
    return () => callbacks.get(kind).delete(callback);
  };
  const worker = {
    catalogue: [], dynamicCatalogue: [], closeCalls: 0,
    supports: () => false,
    getHealth: () => ({ status: 'idle', ready: true, resident: false }), getDiagnostics: () => ({}),
    subscribe: subscribe('worker'), subscribePredictions: subscribe('prediction'), subscribeResidency: subscribe('residency'),
    setRevision() {}, supersedeDisplay() {}, cancelPrewarm() {}, resumePrewarm() {},
    cancelRankingPrewarm() {}, notePredictionUse() {}, prepareRules() {},
    peekPrediction: () => undefined,
    async evaluate(state, memberId, type) {
      await worker.beforeEvaluate?.(state, memberId, type);
      return { result: { tasks: state.tasks, marker: state.tasks[0].label, metrics: {} },
        playJSON: Buffer.from(JSON.stringify({ format: 'play-v1', tasks: state.tasks, metrics: {} })), hit: false };
    },
    async close() { worker.closeCalls++; },
  };
  const world = buildWorld(definitions);
  world.surface = new Set(['12341', '12342']);
  world.neighbors = new Map([['12341', ['12342']], ['12342', ['12341']]]);
  return {
    dataset: { ...selectedDataset, capabilities: { ...selectedDataset.capabilities, features: { ...selectedDataset.capabilities.features, runeMetrics: true, originalSync: true, externalNames: true } } }, indexedWorld: world, ruleRegistry: createRuleRegistry(),
    taskWorker: worker, taskWorkerOptions: { workerFactory() {} },
    parsedDefinitions: definitions, parsedTaskMap: {}, identityHistory: {}, sandboxCatalogue: [],
    xpChoiceCatalogue: { choices: [], byId: new Map() }, membersStartBanks: {},
    webRoot: path.join(ROOT, 'app/web'), requestContextFor: requestContext,
    limits: createRateLimits(), admitStream: createStreamLimits(), usageAdmission: createUsageRateLimit(),
    definitionCache: createRepresentation('{}'), taskCache: createRepresentation('{}'),
    staticCache: createResponseCache(), releaseReferences() {},
    appVersion: 'synthetic',
    originalSyncIntegration: {
      createOriginalSyncClient: () => ({ snapshot: async () => ({ document: {}, warnings: [], cached: false }), close() {} }),
      previewOriginalSync: state => ({ preview: { stateRevision: state.revision, marker: state.tasks[0].label } }),
    },
  };
}

async function send(context, route, { body, key, cookie, stream = false } = {}) {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(bytes.length ? [bytes] : []);
  Object.assign(request, { method: body === undefined ? 'GET' : 'POST', url: route,
    socket: { remoteAddress: '127.0.0.1' }, complete: true,
    headers: { host: '127.0.0.1:8788', 'accept-encoding': 'identity',
      ...(cookie ? { cookie } : { authorization: `Bearer ${key ?? context.store.getAccessToken()}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(bytes.length) }) } });
  const chunks = [], headers = new Map();
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.setHeader = (key, value) => headers.set(key.toLowerCase(), value);
  response.getHeader = key => headers.get(key.toLowerCase());
  response.writeHead = (status, values = {}) => {
    response.statusCode = status; response.headersSent = true;
    for (const [key, value] of Object.entries(values)) response.setHeader(key, value);
    return response;
  };
  await context.handle(request, response);
  if (!stream) assert.ok(response.writableEnded, `${route} finished`);
  const text = () => Buffer.concat(chunks).toString('utf8');
  return { status: response.statusCode, body: stream ? undefined : JSON.parse(text() || 'null'),
    headers, response, request, text };
}
async function fixture(t, { runtimeOptions = {}, ...options } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-context-'));
  const runtime = { ...sharedRuntime(), ...runtimeOptions }, contexts = [];
  t.after(async () => {
    await Promise.all(contexts.map(context => context.close()));
    assert.equal(runtime.taskWorker.closeCalls, 0, 'contexts do not close the shared calculator');
    await rm(root, { recursive: true, force: true });
  });
  async function open(id, extra = {}) {
    const initialState = createGroupState([{ id: 'one', name: 'Explorer', unlocked: [id === 'a' ? '12341' : '12342'], selected: [id === 'a' ? '12342' : '12341'] }]);
    initialState.tasks = [{ id: taskId, category: 'Custom', label: id }];
    initialState.legacy = { contextFixture: id };
    const context = await createPickerContext({ pickerId: id, dataDir: path.join(root, id), runtime,
      initialState, predictionPrewarm: false, progressSources: { clock }, ...options, ...extra });
    contexts.push(context); return context;
  }
  const a = await open('a'), b = await open('b');
  return { root, runtime, a, b, open };
}
async function command(context, command, expectedRevision = context.store.getInfo().revision, extra = {}) {
  const result = await send(context, '/api/command?view=play-v1', { body: { command, expectedRevision, ...extra } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body;
}
async function viewer(context) {
  const created = await send(context, '/api/invites', { body: { label: 'Observer', viewer: true } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const url = new URL(created.body.link, 'http://127.0.0.1:8788');
  // The join route is deliberately handled by the same context boundary.
  const joined = await send(context, url.pathname);
  assert.equal(joined.status, 303);
  return String(joined.headers.get('set-cookie')).split(';')[0];
}

test('two contexts isolate durable state, private static fields, history and undo at colliding revisions', async t => {
  const { a, b, open } = await fixture(t);
  await command(a, note('alpha')); await command(b, note('beta'));
  assert.equal(a.store.getInfo().revision, b.store.getInfo().revision);
  assert.equal((await send(a, '/api/state')).body.state.members[0].notes['12341'], 'alpha');
  assert.equal((await send(b, '/api/state')).body.state.members[0].notes['12341'], 'beta');
  assert.equal((await send(a, '/api/history')).body.history[0].command.note, 'alpha');
  assert.equal((await send(b, '/api/history')).body.history[0].command.note, 'beta');
  await command(a, { type: 'undo' });
  assert.equal(a.store.getState().members[0].notes?.['12341'], undefined);
  assert.equal(b.store.getState().members[0].notes['12341'], 'beta');
  await a.close(); await b.close();
  const reloadedA = await open('a'), reloadedB = await open('b');
  assert.equal(reloadedA.store.getState().tasks[0].label, 'a');
  assert.equal(reloadedB.store.getState().tasks[0].label, 'b');
  assert.equal(reloadedA.store.getState().legacy.contextFixture, 'a');
  assert.equal(reloadedB.store.getState().legacy.contextFixture, 'b');
  assert.equal(reloadedB.store.getUndoEligibility().canUndo, true);
});

test('identical action sessions, request IDs and receipt revisions have independent replay and acknowledgement', async t => {
  const { root, a, b, open } = await fixture(t);
  const registered = await send(a, '/api/action-session', { body: { clientId } });
  assert.equal(registered.status, 200);
  const session = registered.body;
  await a.close(); await b.close();
  await rm(path.join(root, 'b'), { recursive: true, force: true });
  // Public synthetic storage only: deliberately collide even the durable scope.
  await cp(path.join(root, 'a'), path.join(root, 'b'), { recursive: true });
  const left = await open('a'), right = await open('b');
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const alpha = await command(left, note('alpha'), 0, { requestId, requestAck: 0 });
  const beta = await command(right, note('beta'), 0, { requestId, requestAck: 0 });
  assert.equal(alpha.receipt.requestId, beta.receipt.requestId);
  assert.equal((await command(left, note('alpha'), 0, { requestId, requestAck: 0 })).state.members[0].notes['12341'], 'alpha');
  const ack = await send(left, '/api/action-session', { body: { clientId, acknowledge: { ...session, sequence: 1 } } });
  assert.equal(ack.status, 200, JSON.stringify(ack.body));
  const retry = await send(left, '/api/command', { body: { command: note('alpha'), expectedRevision: 0, requestId, requestAck: 0 } });
  assert.equal(retry.body.code, 'REQUEST_ACKNOWLEDGED');
  assert.equal((await command(right, note('beta'), 0, { requestId, requestAck: 0 })).receipt.requestId, requestId);
  assert.equal(right.store.getInfo().revision, 1);
});

test('state responses, identity indexes, calculation snapshots, roll and sandbox caches stay private', async t => {
  const { a, b } = await fixture(t);
  const seen = new Set();
  for (const context of [a, b, a, b]) {
    const id = context.pickerId;
    const state = await send(context, '/api/state');
    assert.equal(state.body.state.tasks[0].label, id);
    const identity = await send(context, `/api/ids/${taskId}`);
    assert.equal(identity.status, 200, JSON.stringify(identity.body)); assert.equal(identity.body.label, id);
    const ranking = await send(context, '/api/pool-ranking?memberId=one');
    assert.equal(ranking.status, 200, JSON.stringify(ranking.body));
    const tasks = await send(context, '/api/tasks?memberId=one&view=play-v1');
    assert.equal(tasks.body.tasks[0].label, id);
    const sandbox = await send(context, '/api/sandbox/evaluate', { body: { memberId: 'one', baseRevision: 0, changes: {} } });
    assert.equal(sandbox.status, 200, JSON.stringify(sandbox.body)); assert.equal(sandbox.body.marker, id);
    assert.equal(sandbox.body.cache.poolHit, seen.has(id)); seen.add(id);
    assert.equal(sandbox.body.rollPool.eligible[0].id, id === 'a' ? '12342' : '12341');
  }
  await command(a, note('changed'));
  assert.equal((await send(b, '/api/state')).body.state.revision, 0);
  assert.equal((await send(b, `/api/ids/${taskId}`)).body.label, 'b');
  assert.equal((await send(b, '/api/tasks?memberId=one&view=play-v1')).body.tasks[0].label, 'b');
});

test('saved task bytes, ranking interests and progress previews remain local when one context closes', async t => {
  const { a, b, runtime } = await fixture(t);
  await send(a, '/api/tasks?memberId=one&view=play-v1');
  await send(b, '/api/tasks?memberId=one&view=play-v1');
  await nextTurn(); await nextTurn();
  const cookieA = await viewer(a), cookieB = await viewer(b);
  assert.equal((await send(a, '/api/tasks?memberId=one&view=play-v1', { cookie: cookieA })).body.tasks[0].label, 'a');
  assert.equal((await send(b, '/api/tasks?memberId=one&view=play-v1', { cookie: cookieB })).body.tasks[0].label, 'b');
  const interest = await send(a, '/api/pool-ranking-intent', { body: { watchId: 'same', memberId: 'one', revision: 0, visible: true } });
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  const diagA = (await send(a, '/api/diagnostics')).body, diagB = (await send(b, '/api/diagnostics')).body;
  assert.notDeepEqual(diagA.poolRanking, diagB.poolRanking);
  const previewA = await send(a, '/api/original-sync/preview', { body: {} });
  const previewB = await send(b, '/api/original-sync/preview', { body: {} });
  assert.equal(previewA.status, 404); assert.equal(previewB.status, 404);
  assert.deepEqual(previewA.body, { message: 'Not found.' });
  assert.deepEqual(previewB.body, { message: 'Not found.' });
  const wrongOriginal = await send(b, '/api/command', { body: { expectedRevision: 0,
    command: { type: 'sync-original', previewId: 'synthetic-preview', members: {} } } });
  assert.equal(wrongOriginal.status, 404);
  // A fresh plugin observation below creates a real review token without a web call.
  const key = await send(a, '/api/game-plugin/keys', { body: { memberId: 'one', label: 'Synthetic' } });
  const reported = await send(a, '/api/plugin/v1/report', { key: key.body.key, body: {
    v: 1, seq: 1, sentAt: new Date(clock()).toISOString(), world: { id: 1, beta: false },
    position: { x: 48, z: 53, floor: 0 }, skills: { ATTACK: { level: 20, xp: 4470.5 } },
  } });
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  const review = await send(a, '/api/runemetrics/preview', { body: { memberId: 'one' } });
  assert.ok(review.body.previewId, JSON.stringify(review.body));
  const wrong = await send(b, '/api/runemetrics/apply', { body: { previewId: review.body.previewId, expectedRevision: 0 } });
  assert.equal(wrong.status, 410);
  await a.close();
  assert.equal(runtime.taskWorker.closeCalls, 0);
  assert.equal((await send(b, '/api/tasks?memberId=one&view=play-v1', { cookie: cookieB })).body.tasks[0].label, 'b');
  await command(b, note('still working'));
});

test('SSE subscribers and revocations only receive events from their own context', async t => {
  const { a, b } = await fixture(t);
  const left = await send(a, '/api/events', { stream: true }), right = await send(b, '/api/events', { stream: true });
  left.request.on('error', () => {}); right.request.on('error', () => {});
  const before = right.text();
  await command(a, note('alpha'));
  assert.match(left.text(), /"revision":1/); assert.equal(right.text(), before);
  await a.close(); assert.equal(left.response.writableEnded, true); assert.equal(right.response.writableEnded, false);
  await command(b, note('beta'));
  assert.match(right.text(), /"revision":1/);
  await b.close(); assert.equal(right.response.writableEnded, true);
});

test('plugin keys, report sequencing and progress evidence stay separate', async t => {
  const { a, b, root } = await fixture(t);
  const keys = [];
  for (const context of [a, b]) keys.push((await send(context, '/api/game-plugin/keys', { body: { memberId: 'one', label: 'Synthetic' } })).body.key);
  assert.equal((await send(b, '/api/plugin/v1/status', { key: keys[0] })).status, 401);
  for (const [index, context] of [a, b].entries()) {
    const response = await send(context, '/api/plugin/v1/report', { key: keys[index], body: {
      v: 1, seq: 7, sentAt: new Date(clock()).toISOString(), world: { id: 1, beta: false }, position: { x: 48 + index, z: 53, floor: 0 },
      skills: { ATTACK: { level: 20 + index, xp: index ? 5018 : 4470.5 } },
    } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  const reviewA = (await send(a, '/api/game-plugin/review?memberId=one')).body;
  const reviewB = (await send(b, '/api/game-plugin/review?memberId=one')).body;
  assert.notDeepEqual(reviewA, reviewB);
  const snapshotB = JSON.stringify(reviewB);
  await a.close();
  assert.equal(JSON.stringify((await send(b, '/api/game-plugin/review?memberId=one')).body), snapshotB);
  assert.equal((await send(b, '/api/plugin/v1/status', { key: keys[1] })).status, 200);
  // Sidecars are independently scoped even when both member keys are identical.
  assert.notEqual(await readFile(path.join(root, 'a', 'plugin-keys.json'), 'utf8'), await readFile(path.join(root, 'b', 'plugin-keys.json'), 'utf8'));
});

test('backup status sidecars use independent namespaces while legacy keeps its existing sibling layout', async t => {
  const { a, b, root, open } = await fixture(t);
  const legacy = await open('legacy');
  const record = { lastRunAt: '2026-10-21T12:00:00.000Z', lastSuccessAt: '2026-10-21T12:00:00.000Z', result: 'success', byteSize: 123 };
  await writeFile(path.join(root, 'a', 'backup-status.json'), JSON.stringify(record));
  const left = await send(a, '/api/backup-status'), right = await send(b, '/api/backup-status');
  assert.equal(left.body.byteSize, 123); assert.equal(right.body.byteSize, null);
  await writeFile(path.join(root, 'backup-status.json'), JSON.stringify({ ...record, byteSize: 456 }));
  assert.equal((await send(legacy, '/api/backup-status')).body.byteSize, 456);
  assert.equal((await send(a, '/api/backup-status')).body.byteSize, 123);
});

test('close drains an accepted write durably, refuses later work and leaves the other context writing', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { a, b, root, open } = await fixture(t, { beforeCommit: async ({ state }) => {
    if (state.members[0].notes?.['12341'] === 'held') { entered.resolve(); await release.promise; }
  } });
  t.after(() => release.resolve());
  const accepted = command(a, note('held'));
  await entered.promise;
  const queued = send(a, '/api/command', { body: { command: note('queued'), expectedRevision: 1 } });
  await nextTurn();
  const directStore = a.store;
  const closing = a.close(); let finished = false; closing.then(() => { finished = true; });
  await assert.rejects(directStore.command(note('late direct'), 1), /The store is closed/);
  await nextTurn(); assert.equal(finished, false);
  assert.equal((await readdir(path.join(root, 'a'))).includes('store.lock'), true);
  await command(b, note('concurrent'));
  release.resolve(); await accepted;
  const queuedResult = await queued;
  assert.equal(queuedResult.status, 503, 'queued work is explicitly refused before shutdown, never silently lost');
  await closing;
  assert.equal((await readdir(path.join(root, 'a'))).includes('store.lock'), false);
  const refused = await send(a, '/api/command', { key: 'closed', body: { command: note('late'), expectedRevision: 1 } });
  assert.equal(refused.status, 503);
  const reopened = await open('a'); assert.equal(reopened.store.getState().members[0].notes['12341'], 'held');
  await command(b, note('after close'));
});

test('close waits for its in-flight calculator result without closing the shared runtime or B jobs', async t => {
  const { a, b, runtime } = await fixture(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  runtime.taskWorker.beforeEvaluate = async state => {
    if (state.tasks[0].label === 'a') { entered.resolve(); await release.promise; }
  };
  const job = send(a, '/api/tasks?memberId=one&view=play-v1');
  await entered.promise;
  const closing = a.close(); let finished = false; closing.then(() => { finished = true; });
  await nextTurn(); assert.equal(finished, false);
  assert.equal((await send(b, '/api/tasks?memberId=one&view=play-v1')).body.tasks[0].label, 'b');
  release.resolve(); assert.equal((await job).status, 200); await closing;
  assert.equal(runtime.taskWorker.closeCalls, 0);
  assert.equal((await send(b, '/api/tasks?memberId=one&view=play-v1')).body.tasks[0].label, 'b');
});

test('plugin upload fragments, durable achievement evidence and item snapshots are per context', async t => {
  const initialState = createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['12341'] }]);
  initialState.tasks = [{ id: 'diary:one', category: 'Diary', label: '~|Synthetic Achievements#Easy|~ First Task' }];
  const { a, b, root } = await fixture(t, { initialState });
  const keys = [];
  for (const context of [a, b]) keys.push((await send(context, '/api/game-plugin/keys', { body: { memberId: 'one', label: 'Synthetic' } })).body.key);
  const report = (seq, achievements) => ({ v: 1, seq, sentAt: new Date(clock()).toISOString(),
    world: { id: 1, beta: false }, position: { x: 48, z: 53, floor: 0 }, achievements });
  const snapshot = '0123456789abcdef';
  const first = await send(a, '/api/plugin/v1/report', { key: keys[0], body: report(1, { snapshot, part: 1, parts: 2, complete: [[1, 'First Task', 0, 0]] }) });
  assert.equal(first.status, 200); assert.equal(first.body.achievements.received, 1);
  assert.equal((await send(b, '/api/plugin/v1/status', { key: keys[1] })).body.achievements, null);
  const second = await send(b, '/api/plugin/v1/report', { key: keys[1], body: report(1, { snapshot, part: 1, parts: 1, complete: [[2, 'First Task', 0, 0]] }) });
  assert.equal(second.status, 200); assert.equal(second.body.achievements.received, 1);
  const finished = await send(a, '/api/plugin/v1/report', { key: keys[0], body: report(2, { snapshot, part: 2, parts: 2, complete: [] }) });
  assert.equal(finished.status, 200);
  assert.equal(a.store.getInfo().revision, 1); assert.equal(b.store.getInfo().revision, 1);
  const item = await send(a, '/api/plugin/v1/report', { key: keys[0], body: {
    ...report(3), items: { snapshot, worn: [], backpack: [[0, 1205, 1, 'Bronze dagger']], journal: { id: snapshot, events: [] } },
  } });
  assert.equal(item.status, 200, JSON.stringify(item.body));
  assert.equal((await send(b, '/api/plugin/v1/status', { key: keys[1] })).body.items, null);
  await a.close(); await b.close();
  const left = JSON.parse(await readFile(path.join(root, 'a', 'plugin-achievements.json'), 'utf8'));
  const right = JSON.parse(await readFile(path.join(root, 'b', 'plugin-achievements.json'), 'utf8'));
  assert.deepEqual(left.players.one.handled, [1]); assert.deepEqual(right.players.one.handled, [2]);
  const items = JSON.parse(await readFile(path.join(root, 'a', 'plugin-items.json'), 'utf8'));
  assert.equal(items.players.one.items['1205'].name, 'Bronze dagger');
  assert.equal((await readdir(path.join(root, 'b'))).includes('plugin-items.json'), false);
});

test('revoking an invitation closes only that context stream and refuses its further reads', async t => {
  const { a, b } = await fixture(t);
  const created = await send(a, '/api/invites', { body: { label: 'Observer', viewer: true } });
  const joined = await send(a, new URL(created.body.link, 'http://127.0.0.1:8788').pathname);
  const cookie = String(joined.headers.get('set-cookie')).split(';')[0];
  const left = await send(a, '/api/events', { cookie, stream: true });
  const right = await send(b, '/api/events', { stream: true });
  const result = await send(a, `/api/invites/${created.body.invite.id}/revoke`, { body: {} });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(left.response.writableEnded, true); assert.equal(right.response.writableEnded, false);
  assert.equal((await send(a, '/api/state', { cookie })).status, 401);
  await command(b, note('independent')); assert.match(right.text(), /"revision":1/);
});

test('the extracted HTTP dispatcher retains explicit permission decisions for all API routes', async () => {
  const source = await readFile(new URL('../app/picker-context.mjs', import.meta.url), 'utf8');
  const { apiPermission } = await import('../app/picker-context-http.mjs');
  const reads = source.slice(source.indexOf("if (request.method === 'GET' || request.method === 'HEAD')"), source.indexOf("} else if (request.method === 'POST')"));
  const writes = source.slice(source.indexOf("} else if (request.method === 'POST')"), source.indexOf("throw httpError(404, 'API route not found.');"));
  for (const [method, section] of [['GET', reads], ['POST', writes]]) {
    const routes = [...section.matchAll(/route === '(\/api\/[^']+)'/g)].map(match => match[1]);
    assert.ok(routes.length > 25, `${method} dispatcher was found`);
    for (const route of routes) assert.ok(apiPermission(method, route), `${method} ${route} has a permission`);
  }
});

test('close drains borrowed warm queues without cancelling jobs or stopping the other picker', async t => {
  const { a, b, runtime } = await fixture(t);
  let active = 1;
  runtime.taskWorker.getDiagnostics = () => ({ predictionLane: { queue: { active } } });
  t.after(() => { active = 0; });
  const closing = a.close(); let finished = false; closing.then(() => { finished = true; });
  await nextTurn(); assert.equal(finished, false);
  await command(b, note('while warming'));
  active = 0; await closing;
  assert.equal(runtime.taskWorker.closeCalls, 0);
  await command(b, note('after warming'));
});


test('direct store writes accepted before close remain durable while new direct admission is refused', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { a, b, open } = await fixture(t, { beforeCommit: async ({ state }) => {
    if (state.members[0].notes?.['12341'] === 'first direct') { entered.resolve(); await release.promise; }
  } });
  t.after(() => release.resolve());
  const store = a.store;
  const first = store.command(note('first direct'), 0);
  await entered.promise;
  const queued = store.command(note('second direct'), 1);
  const closing = a.close();
  await assert.rejects(store.command(note('late direct'), 2), /The store is closed/);
  await command(b, note('independent write'));
  release.resolve(); await first; await queued; await closing;
  const reopened = await open('a');
  assert.equal(reopened.store.getInfo().revision, 2);
  assert.equal(reopened.store.getState().members[0].notes['12341'], 'second direct');
});

test('usage shares one global admission budget while both contexts retain independent sidecars', async t => {
  const admission = createUsageRateLimit({ now: clock, global: 2, perIdentity: 10 });
  const { a, b, root } = await fixture(t, { now: clock, runtimeOptions: { usageAdmission: admission } });
  const body = { counts: [{ id: usageEvents[0].id, actor: 'one', device: 'desktop', day: '2026-10-21', count: 1 }] };
  assert.equal((await send(a, '/api/usage', { body })).status, 200);
  assert.equal((await send(b, '/api/usage', { body })).status, 200);
  for (const context of [a, b]) {
    const limited = await send(context, '/api/usage', { body });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.message, 'Please try usage counts again later.');
    assert.equal(limited.headers.get('retry-after'), 60);
  }
  for (const id of ['a', 'b']) {
    const disk = JSON.parse(await readFile(path.join(root, id, 'usage.json'), 'utf8'));
    assert.equal(disk.counts.length, 1); assert.equal(disk.counts[0].count, 1);
  }
  await a.close();
  assert.equal((await send(b, '/api/usage', { body })).status, 429, 'closing A cannot renew the shared budget');
});


test('G15 provider caches and previews isolate identical member/name bindings and close independently', async t => {
  let calls = 0;
  const { a, b } = await fixture(t, { runeMetrics: { fetchImpl: async url => {
    calls++;
    return Response.json(String(url).includes('/quests') ? { quests: [] }
      : { name: 'Player x', skillvalues: [{ id: 0, level: 20, xp: 44700 }] });
  } } });
  for (const context of [a, b]) await command(context, { type: 'set-runescape-name', memberId: 'one', name: 'Player x' });
  const left = await send(a, '/api/runemetrics/preview', { body: { memberId: 'one' } });
  const right = await send(b, '/api/runemetrics/preview', { body: { memberId: 'one' } });
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  assert.ok(left.body.previewId); assert.ok(right.body.previewId);
  assert.equal(left.body.cached, false); assert.equal(right.body.cached, false);
  assert.equal(calls, 4, 'both contexts independently fetch the paired web snapshot');
  const wrong = await send(b, '/api/runemetrics/apply', { body: { previewId: left.body.previewId, expectedRevision: b.store.getInfo().revision } });
  assert.equal(wrong.status, 410);
  await a.close();
  const cached = await send(b, '/api/runemetrics/preview', { body: { memberId: 'one' } });
  assert.equal(cached.status, 200); assert.equal(cached.body.cached, true);
  assert.equal(calls, 4, 'closing one context preserves the other provider cache');
  const applied = await send(b, '/api/runemetrics/apply', { body: { previewId: right.body.previewId, expectedRevision: b.store.getInfo().revision } });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.state.members[0].skillProgress.Attack.source, 'runemetrics');
});

test('owned readiness can defer the play body while retaining variant preparation and current authenticated state', async t => {
  const timing={},eagerTiming={};
  const {a,open,runtime}=await fixture(t,{prepareStateResponse:false,startupTimingMs:timing,
    runtimeOptions:{taskWorkerOptions:{workerFactory(){},serializedStateInput:true}}});
  let variants=0;runtime.taskWorker.prepareRules=async()=>{variants++;};
  await a.prepare();assert.equal(variants,1);assert.equal(Object.hasOwn(timing,'stateResponseMs'),false);
  await command(a,note('after readiness'));
  const lazy=await send(a,'/api/state?view=play');assert.equal(lazy.status,200);assert.equal(lazy.body.state.revision,1);
  assert.equal(lazy.body.state.members[0].notes['12341'],'after readiness');
  await a.close();const eager=await open('a',{prepareStateResponse:true,startupTimingMs:eagerTiming});await eager.prepare();
  assert.ok(Number.isFinite(eagerTiming.stateResponseMs));assert.equal(variants,2);
  const ready=await send(eager,'/api/state?view=play');assert.deepEqual(ready.body.state,lazy.body.state);
});

// These calls enter the real authenticated picker route, with controllable
// sockets. The snapshot substitute contains only synthetic oversized JSON.
async function gzipFixture(t) {
  const previous = process.env.RS3_FULL_STATE_GZIP_PARTS;
  process.env.RS3_FULL_STATE_GZIP_PARTS = '1';
  try { return await fixture(t); }
  finally { if (previous === undefined) delete process.env.RS3_FULL_STATE_GZIP_PARTS; else process.env.RS3_FULL_STATE_GZIP_PARTS = previous; }
}
function oversizedSnapshots(context, { beforeSnapshot, payload = 'Z'.repeat(49 * 1024 * 1024) } = {}) {
  const original = context.store.getStateSnapshot;
  let calls = 0;
  context.store.getStateSnapshot = async options => {
    calls++;
    await beforeSnapshot?.(calls);
    const saved = await original(options);
    return { revision: saved.revision, pools: saved.pools,
      stateJSONParts: [...saved.stateJSONParts.slice(0, -1), ',"payload":"', payload, '"}'],
      get stateJSON() { throw new Error('oversized state joined'); } };
  };
  return () => calls;
}
function gzipCall(context, { method = 'GET', headers: extraHeaders = {}, onWrite, onHeaders } = {}) {
  const request = Readable.from([]);
  Object.assign(request, { method, url: '/api/state', complete: true, socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8788', authorization: `Bearer ${context.store.getAccessToken()}`, 'accept-encoding': 'gzip, identity;q=0', ...extraHeaders } });
  const chunks = [], headers = new Map();
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); if (onWrite) onWrite(done); else done(); } });
  response.setHeader = (key, value) => headers.set(key.toLowerCase(), value);
  response.getHeader = key => headers.get(key.toLowerCase());
  response.writeHead = (status, values = {}) => {
    response.statusCode = status; response.headersSent = true;
    for (const [key, value] of Object.entries(values)) response.setHeader(key, value);
    onHeaders?.(response); return response;
  };
  const done = context.handle(request, response);
  const body = async () => {
    await done;
    const { gunzipSync } = await import('node:zlib');
    const bytes = Buffer.concat(chunks);
    return JSON.parse((headers.get('content-encoding') === 'gzip' ? gunzipSync(bytes) : bytes).toString());
  };
  return { done, body, response, headers, chunks };
}
function observeCompression(t) {
  const started = Promise.withResolvers(), from = Buffer.from;
  t.mock.method(Buffer, 'from', function(value, ...args) {
    if (typeof value === 'string' && value.length === 32768 && value[0] === 'Z') started.resolve();
    return from.call(this, value, ...args);
  });
  return started.promise;
}

test('oversized route coalesces callers and keeps one captured revision through concurrent commits', { timeout: 10000 }, async t => {
  const { a } = await gzipFixture(t), captures = oversizedSnapshots(a), started = observeCompression(t);
  const first = gzipCall(a);
  await started;
  const second = gzipCall(a);
  await command(a, note('commit during compression'));
  const busy = gzipCall(a); await busy.done;
  assert.equal(busy.response.statusCode, 503); assert.equal(busy.headers.get('retry-after'), 1);
  const [left, right] = await Promise.all([first.body(), second.body()]);
  assert.equal(captures(), 1); assert.equal(left.state.revision, 0); assert.equal(left.store.revision, 0);
  assert.deepEqual(left.pools, right.pools); assert.equal(first.headers.get('etag'), second.headers.get('etag'));
  assert.equal(left.state.members[0].notes?.['12341'], undefined);
  const next = await gzipCall(a).body();
  assert.equal(next.state.revision, 1); assert.equal(next.store.revision, 1);
  assert.equal(next.state.members[0].notes['12341'], 'commit during compression');
  assert.equal(captures(), 2);
  const cached = gzipCall(a, { method: 'HEAD' }); await cached.done;
  assert.equal(cached.response.statusCode, 200); assert.equal(cached.chunks.length, 0); assert.equal(captures(), 2);
});

test('oversized route retries pool-preparation revision races and failed builds', { timeout: 10000 }, async t => {
  const { a } = await gzipFixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  let injected = true;
  const captures = oversizedSnapshots(a, { async beforeSnapshot(count) {
    if (count === 1) { entered.resolve(); await release.promise; }
    if (count === 3 && injected) { injected = false; throw new Error('injected snapshot failure'); }
  } });
  const first = gzipCall(a); await entered.promise;
  await command(a, note('pool preparation commit')); release.resolve();
  const result = await first.body();
  assert.equal(result.state.revision, 1); assert.equal(result.store.revision, 1); assert.equal(captures(), 2);
  await command(a, note('another revision'));
  const failed = gzipCall(a); await failed.done; assert.equal(failed.response.statusCode, 500);
  const retry = await gzipCall(a).body(); assert.equal(retry.store.revision, 2); assert.equal(captures(), 4);
});

test('one and all oversized-route waiter disconnects settle without poisoning retries', { timeout: 10000 }, async t => {
  const { a } = await gzipFixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  oversizedSnapshots(a, { async beforeSnapshot(count) { if (count === 1) { entered.resolve(); await release.promise; } } });
  const first = gzipCall(a), second = gzipCall(a); await entered.promise;
  first.response.destroy(); await first.done; release.resolve();
  assert.equal((await second.body()).state.revision, 0);
  await command(a, note('next'));
  const started = observeCompression(t), third = gzipCall(a), fourth = gzipCall(a);
  await started; third.response.destroy(); fourth.response.destroy();
  await Promise.all([third.done, fourth.done]);
  await nextTurn(); await nextTurn();
  const retry = await gzipCall(a).body(); assert.equal(retry.state.revision, 1);
});

test('separate pickers share bounded gzip admission without sharing bytes or validators', { timeout: 10000 }, async t => {
  const { a, b } = await gzipFixture(t);
  oversizedSnapshots(a); oversizedSnapshots(b);
  const started = observeCompression(t), first = gzipCall(a); await started;
  const busy = gzipCall(b); await busy.done; assert.equal(busy.response.statusCode, 503);
  const left = await first.body(), second = gzipCall(b), right = await second.body();
  assert.equal(left.state.tasks[0].label, 'a'); assert.equal(right.state.tasks[0].label, 'b');
  assert.notEqual(first.headers.get('etag'), second.headers.get('etag'));
  for (const context of [a, b]) {
    const cached = gzipCall(context, { method: 'HEAD' }); await cached.done;
    assert.equal(cached.response.statusCode, 200);
  }
});

test('oversized-route close after collection and during send releases finish waits', { timeout: 10000 }, async t => {
  const { a } = await gzipFixture(t); oversizedSnapshots(a);
  const afterCollection = gzipCall(a, { onHeaders(response) { response.destroy(); } });
  await afterCollection.done;
  const writing = Promise.withResolvers();
  const duringSend = gzipCall(a, { onWrite() { writing.resolve(); } });
  await writing.promise; duringSend.response.destroy(); await duringSend.done;
  assert.equal(duringSend.response.writableFinished, false, 'close settled without finish');
  const retry = gzipCall(a, { method: 'HEAD' }); await retry.done; assert.equal(retry.response.statusCode, 200);
});

test('picker shutdown cancels an oversized gzip build and drains its route', { timeout: 10000 }, async t => {
  const { a } = await gzipFixture(t); oversizedSnapshots(a);
  const started = observeCompression(t), pending = gzipCall(a); await started;
  await a.close(); await pending.done;
  assert.equal(pending.response.destroyed, true);
});

test('slow oversized sends retain a separate bounded budget across revision cache eviction', { timeout: 15000 }, async t => {
  const { a } = await gzipFixture(t);
  const { randomBytes } = await import('node:crypto');
  const payload = randomBytes(26 * 1024 * 1024).toString('base64') + 'Z'.repeat(16 * 1024 * 1024);
  const captures = oversizedSnapshots(a, { payload }), writing = Promise.withResolvers();
  const first = gzipCall(a, { onWrite() { writing.resolve(); } }); await writing.promise;
  assert.ok(first.headers.get('content-length') > 24 * 1024 * 1024);
  await command(a, note('next revision while first socket is slow'));
  const second = gzipCall(a); await second.done;
  assert.equal(second.response.statusCode, 503); assert.equal(second.headers.get('retry-after'), 1);
  assert.equal(captures(), 2);
  first.response.destroy(); await first.done;
  const retry = gzipCall(a, { method: 'HEAD' }); await retry.done;
  assert.equal(retry.response.statusCode, 200); assert.equal(captures(), 2, 'retry uses compressed-only cached bytes after the slow sender releases');
});

test('picker close destroys stalled full-state sends before draining requests', { timeout: 10000 }, async t => {
  const { a, b } = await gzipFixture(t); oversizedSnapshots(a);
  const writing = Promise.withResolvers();
  const first = gzipCall(a, { onWrite() { writing.resolve(); } }); await writing.promise;
  const closing = a.close();
  try { assert.equal(first.response.destroyed, true, 'read response cannot hold picker shutdown open'); }
  finally { first.response.destroy(); await closing; await first.done; }
  const other = gzipCall(b, { method: 'HEAD' }); await other.done;
  assert.equal(other.response.statusCode, 200);
});
