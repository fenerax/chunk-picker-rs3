import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { waitForCondition, settlePredictionLane, predictionLaneIdle, predictionLaneWork } from './helpers/prediction-lane.mjs';

const guard = AbortSignal.timeout(60_000);
const until = predicate => waitForCondition(predicate, Boolean, guard);

test('no-work baselines wait for the cancelled last ranking producer, not its published row', async t => {
  let now = 0;
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {};
    worker.requests = () => worker.messages.filter(message => message.id && message.type !== 'cancel');
    worker.finish = result => worker.emit('message', { id: worker.requests().at(-1).id, result, evaluationMs: 1 });
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory,
    predictionWorkerFactory: () => { const worker = workerFactory(); workers.push(worker); return worker; },
    idleClock: { now: () => now, setTimeout, clearTimeout } });
  t.after(() => scheduler.close());
  const snapshot = { revision: 0, rules: {}, taskRules: {}, members: [{ id: 'actor1', taskRules: {} }] };
  const state = () => snapshot;
  const predict = chunk => scheduler.evaluate(snapshot, 'actor1', 'predict', chunk, 'ignored', 'gameplay');
  const chunks = Array.from({ length: 11 }, (_, index) => String(12342 + index));
  const summaries = [];
  scheduler.subscribePredictions(value => summaries.push(value));
  scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: chunks, purpose: 'ranking' }]);
  await until(() => workers[0]?.requests().length === 1);
  const worker = workers[0], result = { delta: { tasksAdded: [] } };
  // Ten producers finish; the eleventh publishes its row but withholds its
  // final reply. This recreates the hosted failure without a scheduling race.
  for (let index = 0; index < 10; index++) {
    worker.finish(result);
    await until(() => worker.requests().length === index + 2);
  }
  assert.equal(worker.requests().length, 11);
  worker.emit('message', { id: worker.requests().at(-1).id, type: 'prediction-prepared', result });
  assert.equal(summaries.length, 11);
  scheduler.cancelRankingPrewarm();
  const inFlight = scheduler.getDiagnostics().predictionLane;
  assert.equal(inFlight.queue.active, 1);
  assert.equal(inFlight.counts.completed, 10);
  assert.equal(inFlight.prewarm.queued, 11);
  assert.equal(inFlight.prewarm.completed, 10);
  assert.equal(inFlight.prewarm.cancelled, 1);
  assert.deepEqual(inFlight.ranking, { pending: 0, active: 0 });
  assert.equal(worker.messages.at(-1).type, 'cancel');
  assert.equal(predictionLaneIdle(inFlight), false);

  now++;
  const later = scheduler.getDiagnostics().predictionLane;
  assert.throws(() => assert.deepEqual(later, inFlight), { code: 'ERR_ASSERTION' },
    'The old whole-lane assertion fails with no new work or worker reply');
  assert.deepEqual(predictionLaneWork(later), predictionLaneWork(inFlight));

  let settled = false;
  const baseline = settlePredictionLane(() => scheduler.getDiagnostics(), guard)
    .then(value => { settled = true; return value.predictionLane; });
  await yieldTurn();
  assert.equal(settled, false, 'An outstanding producer cannot supply a no-work baseline');
  worker.finish(result);
  const before = await baseline;
  assert.equal(predictionLaneIdle(before), true);
  assert.equal(before.counts.completed, 11);
  assert.equal(worker.requests().length, 11, 'Closing did not leak another ranking job');
  assert.notDeepEqual(predictionLaneWork(before), predictionLaneWork(inFlight),
    'Removing clock fields alone would still race the completed counter');
  scheduler.peekPrediction(state(), 'actor1', chunks[0], 'gameplay');
  assert.deepEqual(predictionLaneWork(scheduler.getDiagnostics().predictionLane), predictionLaneWork(before));
  const admitted = predict('99999');
  assert.notDeepEqual(predictionLaneWork(scheduler.getDiagnostics().predictionLane), predictionLaneWork(before),
    'The rebuilt assertion still detects newly admitted worker work');
  worker.finish(result); await admitted;
});
