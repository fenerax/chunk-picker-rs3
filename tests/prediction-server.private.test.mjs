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

test('automatic death pauses bulk warming across coalesced aborts while explicit previews still dispatch, then resumes', async t => {
  const f = await automaticDeathFixture(t, true), route = '/api/death-estimates?memberId=one&chunkId=12597';
  const death = f.get(route);
  await until(async () => ({ messages: f.messages('death-estimates') }), value => value.messages.length === 1);
  const deathWorker = f.workers.find(worker => worker.messages.some(message => message.type === 'death-estimates'));
  const followerController = new AbortController(), follower = f.get(route, followerController.signal);
  const followerRejected = assert.rejects(follower, { name: 'AbortError' });
  await until(f.diagnostics, value => value.deathLane.counts.coalesced === 1);
  followerController.abort(); await followerRejected;
  const preview = f.get('/api/predict?memberId=one&chunkId=13108');
  await until(async () => ({ messages: f.messages('predict') }), value => value.messages.length === 1);
  const predictionWorker = f.workers.find(worker => worker.messages.some(message => message.type === 'predict'));
  predictionWorker.finish('predict'); assert.equal((await preview).status, 200);
  // Preview completion installs another timer while death is pending. Planning
  // shares the advisory worker and cannot occupy the selected task lane.
  const planning = f.get('/api/chunk-planning?memberId=one&chunkId=12341');
  await until(async () => ({ messages: f.messages('chunk-planning') }), value => value.messages.length === 1);
  predictionWorker.finish('chunk-planning'); assert.equal((await planning).status, 200);
  await f.clock.advance(1150);
  assert.equal(f.messages('predict').length, 1, 'One remaining death waiter keeps unsolicited warming paused');
  assert.equal((await f.diagnostics()).predictionLane.prewarm.queued, 0);
  deathWorker.finish('death-estimates'); assert.equal((await death).status, 200);
  await f.clock.advance(1000);
  await until(async () => ({ messages: f.messages('predict') }), value => value.messages.length === 2);
  assert.equal(f.messages('predict')[1].chunkId, '12342', 'Selected warming resumes after death settles');
  predictionWorker.finish('predict');
});

test('abandoning the last automatic death waiter releases the warming pause', async t => {
  const f = await automaticDeathFixture(t, true), controller = new AbortController();
  const death = f.get('/api/death-estimates?memberId=one&chunkId=12597', controller.signal);
  const rejected = assert.rejects(death, { name: 'AbortError' });
  await until(async () => ({ messages: f.messages('death-estimates') }), value => value.messages.length === 1);
  controller.abort(); await rejected;
  await until(async () => ({ messages: f.messages('cancel') }), value => value.messages.length >= 1);
  f.workers.find(worker => worker.messages.some(message => message.type === 'death-estimates')).finish('death-estimates');
  await f.clock.advance(1000);
  await until(async () => ({ messages: f.messages('predict') }), value => value.messages.length === 1);
  f.workers.find(worker => worker.messages.some(message => message.type === 'predict')).finish('predict');
});

test('automatic OFF preserves bulk warming while an independent death request is active', async t => {
  const f = await automaticDeathFixture(t, false);
  const death = f.get('/api/death-estimates?memberId=one&chunkId=12597');
  await until(async () => ({ messages: f.messages('death-estimates') }), value => value.messages.length === 1);
  await f.clock.advance(1000);
  await until(async () => ({ messages: f.messages('predict') }), value => value.messages.length === 1);
  assert.equal(f.messages('predict')[0].chunkId, '12342');
  f.workers.find(worker => worker.messages.some(message => message.type === 'predict')).finish('predict');
  f.workers.find(worker => worker.messages.some(message => message.type === 'death-estimates')).finish('death-estimates');
  assert.equal((await death).status, 200);
});

