import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';

const fixtureRules = createRuleRegistry();
const geometricMode = fixtureRules.get('roll.neighborMode').options.find(value => value === 'frontier' || value === 'geometric');
import { createManualClock } from './helpers/manual-clock.mjs';

const definitions = {
  chunks: { '12341': {}, '12342': {}, '12597': {}, '13108': {} },
  walkableChunks: ['12341', '12342', '12597', '13108'], walkableChunksF2P: ['12341', '12342', '12597', '13108'],
  challenges: { Quest: { Present: { Chunks: ['12341'] }, Future: { Chunks: ['12342'] } } },
};
async function until(operation, predicate) {
  const deadline = Date.now() + 15000;
  let value;
  do {
    value = await operation();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail(`Background predictions did not settle: ${JSON.stringify(value.predictionLane)}`);
}

test('server warms selected and pending predictions without calculating the unopened pool', async t => {
  const clock = createManualClock();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-prediction-server-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); } });
  const initialState = createGroupState([{ id: 'synthetic', name: 'Synthetic' }]);
  initialState.rules['roll.neighborMode'] = geometricMode;
  initialState.members[0].unlocked = ['12341'];
  initialState.members[0].selected = ['13108'];
  initialState.members[0].pendingRoll = ['12597'];
  app = await createServer({ dataset: fixtureDataset, dataDir, port: 0, schedulingClock: clock, shutdownDeadlineMs: 500, definitions, taskMap: {}, initialState });
  await app.listen();
  const invitation = new URL(app.inviteUrl), origin = invitation.origin;
  const headers = { Authorization: `Bearer ${invitation.pathname.slice('/join/'.length)}` };
  async function get(route) {
    const response = await fetch(origin + route, { headers });
    assert.equal(response.status, 200); return response.json();
  }
  const settled = value => value.predictionLane.prewarm.completed >= 2 && !value.predictionLane.prewarm.pending && !value.predictionLane.prewarm.active;
  // Cross the unchanged browser admission threshold with virtual scheduling time.
  assert.equal((await get('/api/diagnostics')).predictionLane.worker.status, 'idle');
  await clock.advance(9999);
  assert.equal((await get('/api/diagnostics')).predictionLane.worker.status, 'idle', 'Startup warming waits the full ten seconds');
  await clock.advance(1);
  await until(() => get('/api/diagnostics'), settled);
  for (const chunkId of ['13108', '12597']) {
    const value = await get(`/api/predict?memberId=synthetic&chunkId=${chunkId}`);
    assert.equal(value.cache.hit, true, `Warm ${chunkId}`);
    assert.equal(value.stateRevision, 0);
    assert.ok(value.cache.timingMs.engineMs >= 0);
  }
  const response = await fetch(origin + '/api/command', { method: 'POST',
    headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, command: { type: 'cancel-roll', memberId: 'synthetic' } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.revision, 1);
  // The preceding revision's cache is discarded before the save is acknowledged.
  assert.equal((await get('/api/diagnostics')).predictionLane.cache.entries, 0);
  assert.equal((await get('/api/tasks?memberId=synthetic&view=play-v1')).stateRevision, 1);
  await clock.advance(1000);
  await until(() => get('/api/diagnostics'), value => value.predictionLane.prewarm.completed >= 4 && !value.predictionLane.prewarm.pending && !value.predictionLane.prewarm.active);
  const next = await get('/api/predict?memberId=synthetic&chunkId=12342');
  assert.equal(next.cache.hit, false); assert.equal(next.stateRevision, 1);
});

test('bounded server warming prioritizes pending rolls across players before large selected lists and bulk pools', async t => {
  const clock = createManualClock();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-prediction-server-'));
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {};
    worker.finish = () => worker.emit('message', { id: worker.messages.findLast(message => message.id).id,
      result: { delta: {}, metrics: {} }, evaluationMs: 1 });
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  };
  let app;
  t.after(async () => { try { await app?.close(); } finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); } });
  const initialState = createGroupState([{ id: 'first', name: 'First', unlocked: ['12341'], selected: ['13108', '12342'] },
    { id: 'second', name: 'Second', unlocked: ['12342'], pendingRoll: ['12597'] }]);
  initialState.rules['roll.neighborMode'] = geometricMode;
  app = await createServer({ dataset: fixtureDataset, dataDir, port: 0, schedulingClock: clock, shutdownDeadlineMs: 500, definitions, taskMap: {}, initialState,
    taskWorkerOptions: { workerFactory, maxPrewarmQueue: 2 } });
  await app.listen();
  const request = worker => worker?.messages.filter(message => message.type === 'predict');
  await clock.advance(9999);
  assert.equal(request(workers[1]), undefined, 'Startup admission has not expired');
  await clock.advance(1);
  await until(async () => ({ predictionLane: { worker: true }, messages: request(workers[1]) }), value => value.messages?.length === 1);
  assert.equal(request(workers[1])[0].memberId, 'second');
  assert.equal(request(workers[1])[0].chunkId, '12597');
  workers[1].finish();
  await until(async () => ({ predictionLane: { worker: true }, messages: request(workers[1]) }), value => value.messages.length === 2);
  assert.equal(request(workers[1])[1].memberId, 'first');
  assert.equal(request(workers[1])[1].chunkId, '13108');
  workers[1].finish();
});
test('state loading and active foreground work defer warming; stale completions cannot release a newer revision gate', async t => {
  const clock = createManualClock();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-prediction-priority-')), workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {};
    worker.finish = () => worker.emit('message', { id: worker.messages.findLast(message => message.type === 'evaluate' || message.type === 'predict').id,
      result: { tasks: [], metrics: {}, delta: {} }, evaluationMs: 1 });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'], selected: ['12342'] }]);
  let app = await createServer({ dataset: fixtureDataset, dataDir, port: 0, schedulingClock: clock, shutdownDeadlineMs: 500, definitions, taskMap: {}, initialState, taskWorkerOptions: { workerFactory, maxPrewarmQueue: 1 } });
  t.after(async () => { try { await app?.close(); } finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); } });
  await app.listen(); const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const get = route => fetch(origin + route, { headers });
  assert.equal((await get('/api/state?view=play-v1')).status, 200);
  await clock.advance(1100); assert.equal(workers.length, 1, 'State transfer must not start a prediction worker');
  const pending = get('/api/tasks?memberId=one&view=play-v1');
  await until(async () => ({ messages: workers[0].messages.filter(message => message.type === 'evaluate') }), value => value.messages.length === 1);
  await clock.advance(1100); assert.equal(workers.length, 1, 'Active foreground calculation blocks warming');
  const saved = await fetch(origin + '/api/command', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Revision one' } }) });
  assert.equal(saved.status, 200); await saved.json();
  assert.equal((await pending).status, 409); workers[0].finish();
  await clock.advance(1100); assert.equal(workers.length, 1, 'Old completion must preserve the newer save gate');
  const first = get('/api/tasks?memberId=one&view=play-v1'), second = get('/api/tasks?memberId=one&view=play-v1');
  await until(async () => ({ messages: workers[0].messages.filter(message => message.type === 'evaluate') }), value => value.messages.length === 2);
  workers[0].finish(); assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  await clock.advance(1000);
  await until(async () => ({ predictionLane: {}, messages: workers[1]?.messages.filter(message => message.type === 'predict') }), value => value.messages?.length === 1);
  assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 2, 'Concurrent foreground requests coalesce');
  workers[1].finish();
});

async function automaticDeathFixture(t, automatic, { selected = ['12342'], maxPrewarmQueue = 1 } = {}) {
  const base = path.resolve('.local/prediction-priority-tests'); await mkdir(base, { recursive: true });
  const clock = createManualClock();
  const dataDir = await mkdtemp(path.join(base, 'automatic-death-')), workers = [];
  assert.ok(path.resolve(dataDir).startsWith(base + path.sep));
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {};
    worker.finish = type => worker.emit('message', { id: worker.messages.findLast(message => message.type === type).id,
      result: { tasks: [], items: [], access: {}, metrics: {}, delta: {}, estimates: [] }, evaluationMs: 1 });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'], selected }]);
  if (fixtureRules.get('travel.automatic')) initialState.rules['travel.automatic'] = automatic;
  let app = await createServer({ dataset: fixtureDataset, dataDir, port: 0, schedulingClock: clock, shutdownDeadlineMs: 500, definitions, taskMap: {}, initialState,
    taskWorkerOptions: { workerFactory, maxPrewarmQueue } });
  t.after(async () => { try { await app?.close(); } finally { app = undefined; await rm(dataDir, { recursive: true, force: true }); } });
  await app.listen(); const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const get = (route, signal) => fetch(origin + route, { headers, signal });
  const messages = type => workers.flatMap(worker => worker.messages.filter(message => message.type === type));
  const diagnostics = async () => (await get('/api/diagnostics')).json();
  const foreground = get('/api/tasks?memberId=one&view=play-v1');
  await until(async () => ({ messages: messages('evaluate') }), value => value.messages.length === 1);
  workers[0].finish('evaluate'); assert.equal((await foreground).status, 200);
  return { workers, get, messages, diagnostics, clock };
}




test('explicit Preview clears queued warming, follows its active producer and preserves a quiet window', async t => {
  const f = await automaticDeathFixture(t, false, { selected: ['12342', '13108'], maxPrewarmQueue: 2 });
  await f.clock.advance(1000);
  await until(f.diagnostics, value => value.predictionLane.prewarm.active === 1 && value.predictionLane.prewarm.pending === 1);
  assert.equal(f.messages('predict').length, 1);
  const active = f.messages('predict')[0];
  assert.equal(active.chunkId, '12342');
  const predictionWorker = f.workers.find(worker => worker.messages.some(message => message.id === active.id && message.type === 'predict'));
  const activeCancelled = () => predictionWorker.messages.some(message => message.type === 'cancel' && message.id === active.id);

  const preview = f.get('/api/predict?memberId=one&chunkId=12342');
  const coalesced = await until(f.diagnostics, value => value.predictionLane.counts.coalesced === 1);
  assert.equal(coalesced.predictionLane.prewarm.pending, 0, 'Preview removes the next bulk candidate before joining active work');
  assert.equal(activeCancelled(), false, 'Joining Preview must preserve its active producer');

  // Cross the ordinary one-second prewarm interval while Preview is unresolved.
  await f.clock.advance(1150);
  assert.equal((await f.diagnostics()).predictionLane.prewarm.pending, 0, 'An active Preview must not refill unsolicited work');
  assert.equal(f.messages('predict').length, 1, 'Preview coalesces rather than dispatching another calculation');
  assert.equal(activeCancelled(), false);

  predictionWorker.finish('predict');
  const response = await preview;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cache.hit, true, 'The explicit response follows the already running warm candidate');
  await f.clock.advance(300);
  assert.equal(f.messages('predict').length, 1, 'Finishing Preview must leave the foreground quiet window for immediate Unlock');
  assert.equal((await f.diagnostics()).predictionLane.prewarm.pending, 0);
  await f.clock.advance(699);
  assert.equal(f.messages('predict').length, 1, 'Preview quiet window still holds at 999 milliseconds');
  await f.clock.advance(1);
  await until(async () => ({ messages: f.messages('predict') }), value => value.messages.length === 2);
  assert.equal(f.messages('predict')[1].chunkId, '13108', 'Warming resumes at the one-second quiet deadline');
  predictionWorker.finish('predict');
});
