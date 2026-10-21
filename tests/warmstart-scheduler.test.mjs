import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';

const state = (revision = 0) => ({ revision, members: [{ id: 'actor1' }, { id: 'reed' }], rules: {} });
const key = (input, memberId) => JSON.stringify([input, memberId, 'evaluate', undefined, undefined]);
function shared(value) {
  const bytes = Buffer.from(JSON.stringify(value)), buffer = new SharedArrayBuffer(bytes.length);
  Buffer.from(buffer).set(bytes); return buffer;
}
async function fixture(t, options = {}) {
  const workers = [], idleClock = createManualClock();
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; };
    worker.finish = (result = { tasks: [] }, message = worker.messages.findLast(value => value.id)) => {
      worker.emit('message', { id: message.id, evaluationMs: 1, ...(message.type === 'evaluate'
        ? { playJSON: shared(result), ...(message.resultView === 'full' ? { resultJSON: shared(result) } : {}) }
        : { result }) });
    };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory, idleClock, idleMs: 100, ...options });
  t.after(() => scheduler.close());
  const evaluate = (memberId = 'actor1', input = 'saved', revision = 0, resultView = 'full') =>
    scheduler.evaluate(state(revision), memberId, 'evaluate', undefined, key(input, memberId), input, undefined, [], resultView);
  return { scheduler, workers, idleClock, evaluate };
}

test('bounded task warming deduplicates and real demand promotes/coalesces the same cache key', async t => {
  const { scheduler, workers, evaluate } = await fixture(t, { maxPrewarmQueue: 1 });
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['actor1', 'actor1', 'reed']), { queued: 1 });
  assert.equal(scheduler.getDiagnostics().prewarm.pending, 1);
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['actor1']), { queued: 0 });
  const first = evaluate(), second = evaluate();
  assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  scheduler.cancelPrewarm();
  workers[0].finish({ tasks: [{ id: 'prepared' }] });
  assert.deepEqual((await first).result, { tasks: [{ id: 'prepared' }] });
  assert.equal((await second).hit, true);
  assert.equal((await evaluate()).hit, true);
  assert.equal(scheduler.getDiagnostics().prewarm.cancelled, 1);
});

test('a state/task load preserves matching foreground preparation for demand to follow', async t => {
  const { scheduler, workers, evaluate } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed']);
  scheduler.cancelPrewarm({ keepTasks: true });
  assert.equal(scheduler.getDiagnostics().prewarm.pending, 2);
  const demand = evaluate();
  assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  workers[0].finish({ tasks: [{ id: 'followed' }] });
  assert.equal((await demand).result.tasks[0].id, 'followed');
});

test('background compilation respects the startup allowance before health reports a stall', async t => {
  const predictionWorkerFactory = () => {
    const worker = new EventEmitter(); worker.postMessage = () => {}; worker.terminate = async () => {};
    return worker;
  };
  const { scheduler, idleClock } = await fixture(t, { idleMs: 1000000, startupDeadlineMs: 300000, predictionWorkerFactory });
  scheduler.prewarmTasks(state(), 'saved', ['actor1'], { prediction: true, resultView: 'play-v1' });
  await idleClock.advance(120001);
  assert.equal(scheduler.getHealth().prediction.status, 'starting');
  assert.equal(scheduler.getHealth().stuck, false);
  await idleClock.advance(180000);
  assert.equal(scheduler.getHealth().stuck, true);
});

test('foreground requests dispatch before pending background task preparation', async t => {
  const { scheduler, workers, evaluate } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed']);
  await yieldToEventLoop();
  assert.equal(workers[0].messages.findLast(message => message.id).memberId, 'actor1');
  const requested = evaluate('reed', 'other');
  workers[0].finish();
  assert.equal(workers[0].messages.findLast(message => message.id).input, 'other');
  workers[0].finish(); await requested;
  await yieldToEventLoop();
  assert.equal(workers[0].messages.findLast(message => message.id).input, 'saved');
  workers[0].finish();
  assert.equal(scheduler.getDiagnostics().prewarm.completed, 2);
});

test('background completion does not extend idle life or allocate a predictor after expiry', async t => {
  const { scheduler, workers, idleClock } = await fixture(t);
  await idleClock.advance(70);
  scheduler.prewarmTasks(state(), 'saved', ['actor1']);
  await yieldToEventLoop(); workers[0].finish();
  await idleClock.advance(30);
  assert.equal(scheduler.getHealth().status, 'sleeping');
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['reed']), { queued: 0 });
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['reed'], { prediction: true, resultView: 'play-v1' }), { queued: 0 });
  await yieldToEventLoop(); assert.equal(workers.length, 1);
});

test('idle expiry cancels an active task warmup and ignores its late result', async t => {
  const { scheduler, workers, idleClock } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed']);
  await yieldToEventLoop();
  await idleClock.advance(100);
  workers[0].finish();
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  assert.equal(scheduler.getDiagnostics().prewarm.pending, 0);
  assert.equal(scheduler.getDiagnostics().prewarm.active, 0);
});

test('a newer save discards active and queued obsolete warm tasks without caching them', async t => {
  const { scheduler, workers } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed']);
  await yieldToEventLoop();
  scheduler.setRevision(1, 'changed'); workers[0].finish();
  await yieldToEventLoop();
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  assert.equal(scheduler.getDiagnostics().prewarm.pending, 0);
  assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['actor1']), { queued: 0 });
});

test('prediction task preparation uses the existing lane and precedes an explicit Preview', async t => {
  const { scheduler, workers } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed'], { prediction: true, resultView: 'play-v1' });
  await yieldToEventLoop(); await yieldToEventLoop();
  assert.equal(workers.length, 2);
  const baseline = workers[1].messages.findLast(message => message.id);
  assert.equal(baseline.type, 'evaluate'); assert.equal(baseline.resultView, 'play-v1');
  workers[1].finish();
  const preview = scheduler.evaluate(state(), 'actor1', 'predict', '100', 'preview', 'saved');
  scheduler.cancelPrewarm({ keepActive: true });
  const prediction = workers[1].messages.findLast(message => message.id);
  assert.equal(prediction.type, 'predict'); assert.equal(prediction.input, baseline.input);
  workers[1].finish({ delta: { tasksAdded: [] } }); await preview;
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.completed, 1);
  assert.equal(workers.length, 2);
});

test('prediction task warming cannot revive an existing sleeping lane', async t => {
  const { scheduler, workers, idleClock, evaluate } = await fixture(t);
  scheduler.prewarmTasks(state(), 'saved', ['actor1'], { prediction: true, resultView: 'play-v1' });
  await yieldToEventLoop(); await yieldToEventLoop(); workers[1].finish();
  await idleClock.advance(100);
  const foreground = evaluate(); await yieldToEventLoop(); workers[2].finish(); await foreground;
  assert.deepEqual(scheduler.prewarmTasks(state(), 'saved', ['reed'], { prediction: true, resultView: 'play-v1' }), { queued: 0 });
  await yieldToEventLoop(); assert.equal(workers.length, 3);
  assert.equal(scheduler.getHealth().prediction.status, 'sleeping');
});

test('background task results obey the ordinary cache entry and byte limits', async t => {
  const { scheduler, workers } = await fixture(t, { cacheLimit: 1, cacheByteLimit: 100 });
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed']);
  await yieldToEventLoop(); workers[0].finish({ tasks: [{ label: 'x'.repeat(200) }] });
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  await yieldToEventLoop(); workers[0].finish({ tasks: [] });
  assert.equal(scheduler.getDiagnostics().cache.entries, 1);
  assert.ok(scheduler.getDiagnostics().cache.bytes <= 100);
});

test('warm tasks support serialized state and close clears pending background work', async t => {
  const { scheduler, workers } = await fixture(t);
  const stateInput = { inputKey: 'saved', stateJSON: shared(state()) };
  scheduler.prewarmTasks(state(), 'saved', ['actor1', 'reed'], { stateInput });
  await yieldToEventLoop();
  const message = workers[0].messages.findLast(value => value.id);
  assert.equal(message.stateTransport, 'json-shared-v1'); assert.equal(message.state, undefined);
  assert.equal(message.stateJSON, stateInput.stateJSON);
  await scheduler.close(); workers[0].finish();
  assert.equal(scheduler.getHealth().status, 'closed');
  assert.equal(scheduler.getDiagnostics().prewarm.pending, 0);
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
});

test('aborting initial compilation terminates its worker and rejects only after termination', async () => {
  const controller = new AbortController();
  let attempts = 0, terminations = 0, finishTermination;
  const terminated = new Promise(resolve => { finishTermination = resolve; });
  const creating = createTaskScheduler({ signal: controller.signal, startupDeadlineMs: 300000, workerFactory() {
    attempts++;
    const worker = new EventEmitter(); worker.postMessage = () => {};
    worker.terminate = async () => { terminations++; await terminated; }; return worker;
  } });
  let rejected = false;
  const observed = assert.rejects(creating, error => { rejected = true; return error.name === 'AbortError'; });
  controller.abort();
  await yieldToEventLoop();
  assert.equal(attempts, 1); assert.equal(terminations, 1); assert.equal(rejected, false);
  finishTermination(); await observed;
  assert.equal(attempts, 1);
});

test('a cancelled initial signal allocates no worker and abort after readiness leaves it usable', async t => {
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(createTaskScheduler({ signal: cancelled.signal, workerFactory() { throw new Error('Must not allocate'); } }), { name: 'AbortError' });
  const controller = new AbortController();
  const { scheduler, workers, evaluate } = await fixture(t, { signal: controller.signal });
  controller.abort();
  assert.equal(scheduler.getHealth().ready, true); assert.equal(workers[0].terminated, false);
  const requested = evaluate(); workers[0].finish(); await requested;
  const preview = scheduler.evaluate(state(), 'actor1', 'predict', '100', 'preview', 'saved');
  await yieldToEventLoop();
  assert.equal(workers.length, 2); workers[1].finish({ delta: { tasksAdded: [] } }); await preview;
});
