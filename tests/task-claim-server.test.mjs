import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';

const task = { id: 'rs3:task:claim-server', label: 'Mine 50 copper ore', category: 'Mining', status: 'available' };
const bytes = value => { const json = Buffer.from(JSON.stringify(value)), shared = new SharedArrayBuffer(json.length); Buffer.from(shared).set(json); return shared; };
async function until(check, message) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(check(), message);
}
async function fixture(t, { prewarm = false, personal = false, evaluationGate, predictionGate } = {}) {
  const clock = createManualClock();
  const base = path.resolve('.local/task-claim-server-tests'); await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'server-')), messages = [];
  const workerFactory = () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      messages.push(message);
      if (message.type === 'prepare-rules') return queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
      if (message.type === 'predict') {
        const publish = () => worker.emit('message', { id: message.id, result: { metrics: { availableCount: 1 } } });
        if (predictionGate) predictionGate.then(publish); else queueMicrotask(publish);
        return;
      }
      if (message.type !== 'evaluate') return;
      const state = message.state ?? JSON.parse(Buffer.from(message.stateJSON).toString());
      const result = { tasks: [task], presentation: { tasks: state.rules['access.shared'] === false ? [] : [{ id: task.id }], completedTasks: [] },
        collectionPlanning: { completionGroups: {} }, metrics: { availableCount: 1 }, access: { areas: [] } };
      const publish = () => worker.emit('message', { id: message.id, playJSON: bytes(result),
        ...(message.duoProjection ? { duoJSON: bytes(result) } : {}), ...(message.duoSidebarProjection ? { duoSidebarJSON: bytes(result) } : {}), evaluationMs: 1 });
      if (evaluationGate) evaluationGate.then(publish); else queueMicrotask(publish);
    };
    worker.terminate = async () => worker.emit('exit', 0);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [task], compileMs: 1 })); return worker;
  };
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initialState.tasks = [{ id: task.id, label: task.label, category: task.category }];
  if (personal) {
    initialState.rules['tasks.completion'] = 'personal';
    initialState.members[0].taskStatus = { [task.id]: { challengeCompleted: true } };
  }
  if (prewarm) { initialState.members[0].unlocked = ['12341']; initialState.members[0].selected = ['12342']; }
  let app = await createServer({ dataDir, schedulingClock: clock, shutdownDeadlineMs: 500, definitions: { chunks: prewarm ? { '12341': {}, '12342': {} } : {}, walkableChunks: prewarm ? ['12341', '12342'] : [], walkableChunksF2P: prewarm ? ['12341', '12342'] : [], challenges: { Mining: { [task.label]: { PickerId: task.id } } } }, taskMap: {}, initialState, port: 0, host: '127.0.0.1', predictionPrewarm: prewarm,
    gameDataDir: path.join(dataDir, 'game'), mapAssetsDir: path.join(dataDir, 'assets'), taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory, serializedStateInput: true } });
  t.after(async () => {
    try { await app?.close(); }
    finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); }
  });
  await app.listen(); const url = new URL(app.inviteUrl), auth = { Authorization: `Bearer ${url.pathname.slice('/join/'.length)}` };
  const request = (route, body, signal, credentials = auth) => fetch(url.origin + route, { signal, redirect: 'manual', method: body ? 'POST' : 'GET',
    headers: { ...credentials, ...(body ? { Origin: url.origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const command = async command => { const response = await request('/api/command?view=play-v1', { expectedRevision: app.store.getInfo().revision, command }); assert.equal(response.status, 200); return response.json(); };
  const lists = async ({ reverse = false } = {}) => {
    const revision = app.store.getInfo().revision;
    const routes = [`/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`, `/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=${revision}`];
    for (const route of reverse ? routes.reverse() : routes) {
      const response = await request(route); assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    }
  };
  const invite = async (memberId, viewer = false) => {
    const created = await request('/api/invites', { label: viewer ? 'Watcher' : 'Reed', ...(viewer ? { viewer: true } : { memberId }) });
    assert.equal(created.status, 201);
    const joined = await request(new URL((await created.json()).link).pathname, undefined, undefined, {});
    assert.equal(joined.status, 303);
    const cookie = joined.headers.get('set-cookie').split(';')[0];
    return (route, body) => request(route, body, undefined, { Cookie: cookie });
  };
  return { app, messages, request, command, lists, invite, clock };
}

test('claims publish live saved data, retain friendly History, and do no worker work', async t => {
  const { app, messages, request, command, lists } = await fixture(t);
  await lists(); const count = messages.length;
  const controller = new AbortController(); t.after(() => controller.abort());
  const events = await request('/api/events', undefined, controller.signal), reader = events.body.getReader();
  await reader.read();
  const saved = await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  assert.equal(saved.state.taskClaims[task.id].memberId, 'actor1');
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /"taskResultsUnchanged":true/);
  assert.equal(messages.length, count);
  assert.equal(app.store.getHistory().history.at(-1).command.taskLabel, task.label);
  assert.equal((await request('/task-claims.mjs')).status, 200);
  assert.equal((await request('/api/command', { expectedRevision: 1, command: { type: 'prune-task-claims', taskIds: [task.id] } })).status, 400);
  controller.abort();
  await command({ type: 'set-task-status', memberId: 'reed', taskId: task.id, challengeCompleted: true });
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
  await command({ type: 'undo' }); assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
});

test('natural lists remove inactive claims in a separate revision without changing unrelated Undo', async t => {
  const { app, command, lists } = await fixture(t);
  await lists();
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false });
  await command({ type: 'set-preference', memberId: 'reed', preferenceId: 'ids', value: true });
  await lists();
  await until(() => app.store.getInfo().revision === 4, 'background cleanup committed');
  assert.equal(app.store.getInfo().revision, 4);
  assert.equal(app.store.getHistory().history.length, 3);
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
  await command({ type: 'undo' }); assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
  await command({ type: 'undo' }); assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
});

test('[regression] assigned invites claim, release and take over only as their signed-in player', async t => {
  const { app, request, command, invite } = await fixture(t);
  const reed = await invite('reed');
  const post = command => reed('/api/command', { expectedRevision: app.store.getInfo().revision, command });
  assert.equal((await post({ type: 'claim-task', memberId: 'actor1', taskId: task.id })).status, 403);
  assert.equal(app.store.getInfo().revision, 0);
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  for (const type of ['claim-task', 'clear-task-claim']) assert.equal((await post({ type, memberId: 'actor1', taskId: task.id, ...(type === 'claim-task' ? { takeover: true } : {}) })).status, 403);
  assert.equal((await post({ type: 'claim-task', memberId: 'reed', taskId: task.id })).status, 400);
  assert.equal((await post({ type: 'claim-task', memberId: 'reed', taskId: task.id, takeover: true })).status, 200);
  const event = app.store.getHistory().history.at(-1);
  assert.equal(event.command.memberId, 'reed'); assert.equal(event.actor.memberId, 'reed'); assert.equal(event.actor.label, 'Reed');
  assert.equal((await post({ type: 'clear-task-claim', memberId: 'reed', taskId: task.id })).status, 200);
  assert.equal((await request('/api/command', { expectedRevision: app.store.getInfo().revision, command: { type: 'claim-task', taskId: task.id } })).status, 400);
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id].memberId, 'reed');
});

test('viewer claim writes are denied and internal cleanup is rejected for administrators', async t => {
  const { app, request, invite } = await fixture(t), viewer = await invite(undefined, true);
  for (const type of ['claim-task', 'clear-task-claim']) assert.equal((await viewer('/api/command', { expectedRevision: 0, command: { type, memberId: 'reed', taskId: task.id } })).status, 403);
  assert.equal(app.store.getInfo().revision, 0);
  assert.equal((await request('/api/command', { expectedRevision: 0, command: { type: 'prune-task-claims', taskIds: [task.id] } })).status, 400);
});

test('[regression] assigned invites cannot undo another player’s claim or release', async t => {
  const { app, command, invite } = await fixture(t), reed = await invite('reed'), actor1 = await invite('actor1');
  const post = (session, command) => session('/api/command', { expectedRevision: app.store.getInfo().revision, command });
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  for (const undo of [{ type: 'undo' }, { type: 'undo', undoRevision: 1 }]) assert.equal((await post(reed, undo)).status, 403);
  assert.equal(app.store.getInfo().revision, 1);
  await command({ type: 'clear-task-claim', memberId: 'actor1', taskId: task.id });
  assert.equal((await post(reed, { type: 'undo' })).status, 403);
  assert.equal(app.store.getInfo().revision, 2);
  assert.equal((await post(actor1, { type: 'undo' })).status, 200);
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id].memberId, 'actor1');
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id, takeover: true });
  assert.equal((await post(actor1, { type: 'undo' })).status, 403);
  assert.equal((await post(reed, { type: 'undo' })).status, 200);
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id].memberId, 'actor1');
  await command({ type: 'clear-task-claim', memberId: 'actor1', taskId: task.id });
  await command({ type: 'undo' });
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id].memberId, 'actor1', 'master can undo either player’s claim');
});

test('[regression] conflicts report claim-only gaps and never report gameplay gaps as safe to retry', async t => {
  const { app, request, command, lists } = await fixture(t);
  const stale = expectedRevision => request('/api/command', { expectedRevision, command: { type: 'set-preference', memberId: 'reed', preferenceId: 'ids', value: true } });
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  await command({ type: 'clear-task-claim', memberId: 'actor1', taskId: task.id });
  let response = await stale(0); assert.equal(response.status, 409); assert.equal((await response.json()).claimOnlyChanges, true);
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false });
  const beforeCleanup = app.store.getInfo().revision;
  await lists(); await until(() => app.store.getInfo().revision === beforeCleanup + 1, 'cleanup saved its own revision');
  response = await stale(beforeCleanup); assert.equal(response.status, 409); assert.equal((await response.json()).claimOnlyChanges, true);
  for (const revision of [0, beforeCleanup - 1]) {
    response = await stale(revision); assert.equal(response.status, 409); assert.equal((await response.json()).claimOnlyChanges, undefined);
  }
  await command({ type: 'set-preference', memberId: 'reed', preferenceId: 'ids', value: false });
  response = await stale(beforeCleanup + 1); assert.equal(response.status, 409); assert.equal((await response.json()).claimOnlyChanges, undefined);
});

test('[regression] a claim preserves prediction warm-up already scheduled by task loading', async t => {
  const { messages, command, lists, clock } = await fixture(t, { prewarm: true });
  await lists();
  assert.equal(messages.some(message => message.type === 'predict'), false);
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  await clock.advance(999);
  assert.equal(messages.some(message => message.type === 'predict'), false, 'Claim preserves the one-second task quiet window');
  await clock.advance(1);
  await until(() => messages.some(message => message.type === 'predict'), 'pending prediction warm-up survived the claim save');
});

test('[regression] a claim during list loading settles the equivalent revision before prediction warm-up', async t => {
  let release;
  const evaluationGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { app, messages, request, command, clock } = await fixture(t, { prewarm: true, evaluationGate });
  const pending = request('/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=0');
  await until(() => messages.some(message => message.type === 'evaluate'), 'foreground list started');
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  assert.equal(app.store.getInfo().revision, 1);
  release();
  assert.equal((await pending).status, 200);
  const peer = await request('/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=1');
  assert.equal(peer.status, 200);
  await clock.advance(1000);
  await until(() => messages.some(message => message.type === 'predict'), 'equivalent current lists released prediction warming');
});

test('[regression] panel preparation keeps one prediction across claim and preference saves', async t => {
  let release;
  const predictionGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { messages, request, command, lists } = await fixture(t, { prewarm: true, predictionGate });
  await lists();
  const pending = request('/api/prediction-intent', { revision: 0, memberId: 'actor1', chunkId: '12342' });
  await until(() => messages.some(message => message.type === 'predict'), 'intent prediction started');
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  await command({ type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: true });
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { memberId: 'actor1', chunkId: '12342', stateRevision: 2, prepared: true });
  assert.equal(messages.filter(message => message.type === 'predict').length, 1);
});

test('[regression] panel preparation rebases a claim while waiting for the same task lists', async t => {
  let release;
  const evaluationGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { messages, request, command } = await fixture(t, { prewarm: true, evaluationGate });
  const selected = request('/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=0');
  await until(() => messages.some(message => message.type === 'evaluate'), 'selected list started');
  const pending = request('/api/prediction-intent', { revision: 0, memberId: 'actor1', chunkId: '12342' });
  await new Promise(resolve => setTimeout(resolve, 30));
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  release();
  assert.equal((await selected).status, 200);
  assert.equal((await request('/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=1')).status, 200);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stateRevision, 1);
  const predictions = messages.filter(message => message.type === 'predict');
  assert.equal(predictions.length, 1);
  assert.equal(predictions[0].state.revision, 1);
});

test('[regression] panel preparation still rejects a changed gameplay input', async t => {
  let release;
  const predictionGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { messages, request, command, lists } = await fixture(t, { prewarm: true, predictionGate });
  await lists();
  const pending = request('/api/prediction-intent', { revision: 0, memberId: 'actor1', chunkId: '12342' });
  await until(() => messages.some(message => message.type === 'predict'), 'intent prediction started');
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false });
  release();
  assert.equal((await pending).status, 409);
  assert.equal(messages.filter(message => message.type === 'predict').length, 1);
});

test('[regression] background claim cleanup preserves task loading’s prediction warm-up', async t => {
  const { app, messages, command, lists, clock } = await fixture(t, { prewarm: true });
  await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false });
  await lists();
  await until(() => app.store.getInfo().revision === 3, 'cleanup saved after both task lists');
  assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id], undefined);
  await clock.advance(1000);
  await until(() => messages.some(message => message.type === 'predict'), 'pending prediction warm-up survived cleanup');
});

test('[regression] task responses do not wait for cleanup, and a failed cleanup cannot break later reads', async t => {
  const { app, command, lists } = await fixture(t);
  await lists(); await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false });
  let rejectCleanup, calls = 0;
  const gate = new Promise((resolve, reject) => { rejectCleanup = reject; });
  t.mock.method(app.store, 'reconcileTaskClaims', async () => { calls++; return gate; });
  const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
  let timer;
  try {
    await Promise.race([lists(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Task response waited on cleanup')), 3000); })]);
    await until(() => calls === 1, 'cleanup started after the successful task response');
  } finally { clearTimeout(timer); rejectCleanup(Object.assign(new Error('Synthetic cleanup failure'), { code: 'EIO' })); }
  await until(() => errors.length === 1, 'cleanup error logged outside request');
  await lists();
  assert.equal(calls, 1, 'unchanged task reads do not retry a failed amendment');
  assert.equal(app.store.getInfo().revision, 2);
});

test('a partner state read after claiming cannot restart background predictions', async t => {
  const { messages, request, command, lists, clock } = await fixture(t, { prewarm: true });
  await lists();
  await clock.advance(1500);
  const before = messages.length;
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  assert.equal((await request('/api/state?view=play-v1')).status, 200);
  // The ordinary state-load admission gate lasts 15 seconds. A claim must
  // retain completed foreground admission rather than create a new warm batch.
  await clock.advance(16000);
  assert.equal(messages.length, before);
});

test('claiming from a retained browser list does not bypass the startup prediction delay', async t => {
  const { messages, request, command, clock } = await fixture(t, { prewarm: true });
  const before = messages.length;
  await command({ type: 'claim-task', memberId: 'actor1', taskId: task.id });
  assert.equal((await request('/api/state?view=play-v1')).status, 200);
  await clock.advance(100);
  assert.equal(messages.length, before);
});

test('cleanup uses every current personal list and is independent of response arrival order', async t => {
  for (const reverse of [false, true]) {
    const { app, command, lists } = await fixture(t, { personal: true });
    await command({ type: 'claim-task', memberId: 'reed', taskId: task.id });
    await lists({ reverse });
    assert.equal(app.store.getTaskClaimSnapshot().taskClaims[task.id].memberId, 'reed');
    assert.equal(app.store.getInfo().revision, 1);
    await app.close();
  }
});
