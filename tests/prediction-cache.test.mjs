import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler, predictionCacheKey } from '../app/tasks/scheduler.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Condition did not become true.'); await delay(2); }
}
function factory({ ready = true } = {}) {
  const workers = [];
  const create = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; };
    worker.requests = () => worker.messages.filter(message => message.id && message.type !== 'cancel');
    worker.finish = (result = { delta: { tasks: [] } }, id = worker.requests().at(-1).id) => worker.emit('message', { id, result, evaluationMs: 2, timingMs: { predictionMs: 1, totalMs: 2 } });
    workers.push(worker);
    if (ready) queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 }));
    return worker;
  };
  return { create, workers };
}
const state = (revision = 0, rules = {}) => ({ revision, rules, taskRules: {}, members: [{ id: 'actor1', taskRules: {} }, { id: 'reed', taskRules: {} }] });
async function fixture(t, options = {}, predictionOptions) {
  const foreground = factory(), prediction = factory(predictionOptions);
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, backoffMs: 5, maxBackoffMs: 10, ...options });
  t.after(() => scheduler.close());
  const predict = (chunk = '12342', snapshot = state(), memberId = 'actor1', input = 'gameplay', signal) => scheduler.evaluate(snapshot, memberId, 'predict', chunk, 'caller-key-is-not-trusted', input, signal);
  const warm = (chunks = ['12342', '12343'], snapshot = state(), input = 'gameplay', signal) => scheduler.prewarm(snapshot, input, [{ memberId: 'actor1', chunkIds: chunks }], { signal });
  return { scheduler, foreground, prediction, predict, warm };
}

test('prediction identity separates revision, member, chunk, gameplay input and effective rules', () => {
  const original = state(); const key = predictionCacheKey(original, 'actor1', '12342', 'input');
  assert.equal(key, predictionCacheKey(original, 'actor1', 12342, 'input'));
  for (const candidate of [predictionCacheKey(state(1), 'actor1', '12342', 'input'), predictionCacheKey(original, 'reed', '12342', 'input'),
    predictionCacheKey(original, 'actor1', '12343', 'input'), predictionCacheKey(original, 'actor1', '12342', 'changed'),
    predictionCacheKey(state(0, { f2p: true }), 'actor1', '12342', 'input'),
    predictionCacheKey({ ...original, taskRules: { skills: false } }, 'actor1', '12342', 'input'),
    predictionCacheKey({ ...original, members: [{ id: 'actor1', taskRules: { quests: false } }] }, 'actor1', '12342', 'input'),
    predictionCacheKey({ ...original, members: [{ id: 'actor1', sourceMapId: 'bbb' }], legacy: { maps: { bbb: { rules: { f2p: true } } } } }, 'actor1', '12342', 'input')]) assert.notEqual(candidate, key);
});

test('empty prewarm groups keep the prediction lane idle without starting a worker', async t => {
  const { scheduler, prediction, warm } = await fixture(t);
  const before = scheduler.getDiagnostics().predictionLane;
  assert.equal(warm([]).queued, 0);
  assert.equal(scheduler.prewarm(state(), 'gameplay', []).queued, 0);
  await delay(5);
  assert.equal(prediction.workers.length, 0);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane, before);
  assert.equal(scheduler.getHealth().prediction.status, 'idle');
});

test('prediction summary observers see complete current results and peeks do not use the lane', async t => {
  const { scheduler, prediction, warm } = await fixture(t, { predictionCacheLimit: 1 });
  const summaries = [], unsubscribe = scheduler.subscribePredictions(value => summaries.push(value));
  assert.equal(scheduler.peekPrediction(state(), 'actor1', '12342', 'gameplay'), undefined);
  scheduler.notePredictionUse(); assert.equal(prediction.workers.length, 0);
  warm(['12342']); await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0], result = { delta: { tasksAdded: [{ id: 'one' }] } };
  worker.emit('message', { id: worker.requests()[0].id, type: 'prediction-prepared' });
  assert.equal(summaries.length, 0);
  scheduler.supersedeDisplay(1, 'gameplay'); worker.finish(result);
  assert.equal(summaries.length, 1); assert.equal(summaries[0].state.revision, 1);
  assert.equal(summaries[0].input, 'gameplay'); assert.equal(summaries[0].memberId, 'actor1');
  assert.equal(summaries[0].chunkId, '12342'); assert.equal(summaries[0].result, result);
  const before = scheduler.getDiagnostics().predictionLane;
  assert.equal(scheduler.peekPrediction(state(1), 'actor1', '12342', 'gameplay'), result);
  assert.equal(scheduler.peekPrediction(state(1), 'reed', '12342', 'gameplay'), undefined);
  assert.equal(scheduler.peekPrediction(state(1), 'actor1', '12342', 'changed'), undefined);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane, before);
  unsubscribe(); warm(['12343'], state(1)); await until(() => worker.requests().length === 2);
  worker.finish({ delta: { tasksAdded: [] } }); assert.equal(summaries.length, 1);
  assert.equal(scheduler.peekPrediction(state(1), 'actor1', '12342', 'gameplay'), undefined);
});

test('obsolete and cancelled predictions do not publish ranking summaries', async t => {
  const { scheduler, prediction, warm } = await fixture(t);
  const summaries = []; scheduler.subscribePredictions(value => summaries.push(value));
  warm(['12342']); await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; scheduler.supersede(1, 'changed');
  worker.finish({ delta: { tasksAdded: [] } }); assert.equal(summaries.length, 0);
  warm(['12343'], state(1), 'changed'); await until(() => worker.requests().length === 2);
  worker.finish({ cancelled: true, delta: { tasksAdded: [] } }); assert.equal(summaries.length, 0);
});

test('ranking peeks and completions allow idle sleep; new visible interest permits a wake', async t => {
  let time = 0, sequence = 0;
  const timers = new Map(), idleClock = { now: () => time,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      time = end;
    } };
  const { scheduler, prediction } = await fixture(t, { idleMs: 100, idleClock });
  const groups = [{ memberId: 'actor1', chunkIds: ['12342'], purpose: 'ranking' }], summaries = [];
  scheduler.subscribePredictions(value => summaries.push(value.result.delta.tasksAdded.length));
  scheduler.prewarm(state(), 'gameplay', groups);
  await until(() => prediction.workers[0]?.requests().length === 1);
  idleClock.tick(90); prediction.workers[0].finish({ delta: { tasksAdded: [{ id: 'one' }] } });
  idleClock.tick(9); assert.ok(scheduler.peekPrediction(state(), 'actor1', '12342', 'gameplay'));
  idleClock.tick(1); await delay(2);
  assert.equal(scheduler.getHealth().prediction.status, 'sleeping');
  assert.equal(scheduler.peekPrediction(state(), 'actor1', '12342', 'gameplay'), undefined);
  assert.deepEqual(summaries, [1]);
  assert.equal(scheduler.prewarm(state(), 'gameplay', groups).queued, 0);
  scheduler.notePredictionUse(); assert.equal(scheduler.prewarm(state(), 'gameplay', groups).queued, 1);
  await until(() => prediction.workers[1]?.requests().length === 1);
  idleClock.tick(100); await delay(2);
  assert.equal(scheduler.getHealth().prediction.status, 'sleeping');
  assert.equal(prediction.workers[1].terminated, true);
  assert.deepEqual(summaries, [1]);
});

test('ranking cancellation preserves reviewed warm choices and an explicit Preview follower', async t => {
  const { scheduler, prediction, predict } = await fixture(t);
  scheduler.prewarm(state(), 'gameplay', [
    { memberId: 'actor1', chunkIds: ['12342'] },
    { memberId: 'actor1', chunkIds: ['12342', '12343', '12344'], purpose: 'ranking' },
  ]);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; scheduler.cancelRankingPrewarm();
  assert.equal(Atomics.load(new Int32Array(worker.requests()[0].cancellation), 0), 0);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  worker.finish(); await delay(5); assert.equal(worker.requests().length, 1);
  scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: ['12343'], purpose: 'ranking' }]);
  await until(() => worker.requests().length === 2);
  const preview = predict('12343'); scheduler.cancelRankingPrewarm();
  assert.equal(Atomics.load(new Int32Array(worker.requests()[1].cancellation), 0), 0);
  worker.finish({ delta: { tasksAdded: [] } }); await preview;
});

test('closing one ranking member preserves another member queue and reports ranking activity', async t => {
  const { scheduler, prediction } = await fixture(t);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 0, active: 0 });
  scheduler.prewarm(state(), 'gameplay', [
    { memberId: 'actor1', chunkIds: ['12342', '12343'], purpose: 'ranking' },
    { memberId: 'reed', chunkIds: ['12344'], purpose: 'ranking' },
  ]);
  await until(() => prediction.workers[0]?.requests().length === 1);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 2, active: 1 });
  const worker = prediction.workers[0]; scheduler.cancelRankingPrewarm(new Set(['reed']));
  assert.equal(Atomics.load(new Int32Array(worker.requests()[0].cancellation), 0), 1);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 1, active: 0 });
  worker.finish(); await until(() => worker.requests().length === 2);
  assert.equal(worker.requests()[1].memberId, 'reed');
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 0, active: 1 });
  worker.finish({ delta: { tasksAdded: [] } });
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 0, active: 0 });
});

test('ranking prepared admission cannot evict a protected pair even for a selected pool chunk', async t => {
  const { scheduler, prediction } = await fixture(t, { predictionCacheLimit: 2 });
  const complete = (worker, chunk, signature, priority) => {
    const shared = () => { const bytes = Buffer.from('{}'), buffer = new SharedArrayBuffer(bytes.length); Buffer.from(buffer).set(bytes); return buffer; };
    const reuse = memberId => ({ taskInputKey: signature, memberId, sourceRevision: 0, priority,
      playJSON: shared(), duoJSON: shared(), duoSidebarJSON: shared() });
    worker.emit('message', { id: worker.requests().findLast(value => value.chunkId === chunk).id,
      result: { delta: { tasksAdded: [] } }, unlockReuse: reuse('actor1'), partnerUnlockReuse: reuse('reed'), evaluationMs: 1 });
  };
  scheduler.prewarm(state(), 'gameplay', [
    { memberId: 'actor1', chunkIds: ['12342'] },
    { memberId: 'actor1', chunkIds: ['12342', '12343'], purpose: 'ranking' },
  ]);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; complete(worker, '12342', 'a'.repeat(64), 1);
  await until(() => worker.requests().length === 2);
  complete(worker, '12343', 'b'.repeat(64), 2);
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  scheduler.supersede(1, 'saved');
  assert.ok(scheduler.preparedEvaluation('a'.repeat(64), 'actor1', 1));
  assert.equal(scheduler.preparedEvaluation('b'.repeat(64), 'actor1', 1), undefined);
});

test('automatic reviewed preparation skips a complete pair after ranking evicts its delta response', async t => {
  const { scheduler, prediction } = await fixture(t, { predictionCacheLimit: 2 });
  scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: ['12342'] }]);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0];
  const shared = () => { const bytes = Buffer.from('{}'), buffer = new SharedArrayBuffer(bytes.length); Buffer.from(buffer).set(bytes); return buffer; };
  const reuse = memberId => ({ taskInputKey: 'a'.repeat(64), memberId, sourceRevision: 0, priority: 2,
    playJSON: shared(), duoJSON: shared(), duoSidebarJSON: shared() });
  worker.emit('message', { id: worker.requests()[0].id, result: { delta: { tasksAdded: [] } },
    unlockReuse: reuse('actor1'), partnerUnlockReuse: reuse('reed'), evaluationMs: 1 });
  scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: ['12343', '12344'], purpose: 'ranking' }]);
  await until(() => worker.requests().length === 2); worker.finish({ delta: { tasksAdded: [] } });
  await until(() => worker.requests().length === 3); worker.finish({ delta: { tasksAdded: [] } });
  assert.equal(scheduler.peekPrediction(state(), 'actor1', '12342', 'gameplay'), undefined);
  assert.equal(scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: ['12342'] }]).queued, 0);
  await delay(5); assert.equal(worker.requests().length, 3);
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  // Ranking still needs the delta when no independent compact summary exists.
  assert.equal(scheduler.prewarm(state(), 'gameplay', [{ memberId: 'actor1', chunkIds: ['12342'], purpose: 'ranking' }]).queued, 1);
  scheduler.cancelRankingPrewarm();
});

test('cached reviewed choices do not consume bounded prewarm slots ahead of missing ranking work', async t => {
  const { scheduler, prediction } = await fixture(t, { maxPrewarmQueue: 2 });
  const reviewed = { memberId: 'actor1', chunkIds: ['12342', '12343'] };
  assert.equal(scheduler.prewarm(state(), 'gameplay', [reviewed]).queued, 2);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; worker.finish();
  await until(() => worker.requests().length === 2); worker.finish();
  assert.ok(scheduler.peekPrediction(state(), 'actor1', '12342', 'gameplay'));
  assert.ok(scheduler.peekPrediction(state(), 'actor1', '12343', 'gameplay'));
  assert.equal(scheduler.prewarm(state(), 'gameplay', [reviewed,
    { memberId: 'actor1', chunkIds: ['12344', '12344'], purpose: 'ranking' }]).queued, 1);
  await until(() => worker.requests().length === 3);
  assert.equal(worker.requests()[2].chunkId, '12344');
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.ranking, { pending: 0, active: 1 });
  worker.finish({ delta: { tasksAdded: [] } });
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
});

test('empty prewarm groups clear an existing warm plan while preserving its warmed cache', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  warm(['12342', '12343', '12344']);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; worker.finish();
  await until(() => worker.requests().length === 2);
  const before = scheduler.getDiagnostics().predictionLane.cache;
  assert.equal(warm([]).queued, 0);
  assert.equal(prediction.workers.length, 1);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  assert.deepEqual(scheduler.getDiagnostics().predictionLane.cache, before);
  worker.finish(); await delay(5);
  assert.equal(worker.requests().length, 2);
  assert.equal((await predict()).hit, true);
});

test('idle warming deduplicates and serves HTTP from cache while sharing one full snapshot', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  assert.equal(warm(['12342', '12342', '12343']).queued, 2);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0];
  assert.equal(warm().queued, 0); assert.equal(worker.requests().length, 1);
  assert.equal(worker.requests()[0].state.revision, 0); assert.equal(worker.requests()[0].input, 'gameplay');
  worker.finish(); await until(() => worker.requests().length === 2);
  assert.equal(worker.requests()[1].state, undefined); assert.equal(worker.requests()[1].snapshotKey, worker.requests()[0].snapshotKey);
  worker.finish();
  assert.equal((await predict()).hit, true);
  const diagnostics = scheduler.getDiagnostics().predictionLane;
  assert.equal(diagnostics.cache.entries, 2); assert.equal(diagnostics.prewarm.completed, 2);
  assert.equal(diagnostics.queue.depth, 0); assert.equal(diagnostics.counts.cacheHits, 1);
  assert.ok(!JSON.stringify(diagnostics).includes('12342'));
});

test('pausing warming for foreground use keeps the active result and discards queued work', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  warm(['12342', '12343']);
  await until(() => prediction.workers[0]?.requests().length === 1);
  scheduler.cancelPrewarm({ keepActive: true });
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  const worker = prediction.workers[0];
  assert.equal(worker.messages.some(message => message.type === 'cancel'), false);
  worker.finish(); await delay(5);
  assert.equal((await predict()).hit, true);
  assert.equal(worker.requests().length, 1);
});

test('interactive predictions replace queued bulk warming and foreground stays independent', async t => {
  const { scheduler, prediction, foreground, warm, predict } = await fixture(t);
  let announcements = 0; scheduler.subscribe(() => announcements++);
  warm(['12342', '12343', '12344']);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0];
  const interactive = predict('12595');
  const tasks = scheduler.evaluate(state(), 'actor1', 'evaluate', undefined, 'tasks', 'gameplay');
  assert.equal(foreground.workers[0].requests().length, 1);
  foreground.workers[0].finish(); await tasks;
  worker.finish(); assert.equal(worker.requests()[1].chunkId, '12595');
  worker.finish(); await interactive;
  assert.equal(worker.requests().length, 2);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  assert.equal(worker.messages.some(message => message.type === 'cancel'), true);
  assert.equal(Atomics.load(new Int32Array(worker.requests()[0].cancellation), 0), 1);
  assert.equal(announcements, 0);
});

test('HTTP followers coalesce onto active warm work and survive cancellation of warming', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  const controller = new AbortController(); warm(undefined, undefined, undefined, controller.signal);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0];
  const first = predict(), follower = predict(); controller.abort();
  assert.equal(worker.messages.some(message => message.type === 'cancel'), false);
  worker.finish(); assert.equal((await first).hit, true); assert.equal((await follower).hit, true);
  await delay(10); assert.equal(worker.requests().length, 1);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
});

test('abort cancels active warm work, discards its late result and stops subsequent candidates', async t => {
  const { scheduler, prediction, warm } = await fixture(t);
  const controller = new AbortController(); warm(undefined, undefined, undefined, controller.signal);
  await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; controller.abort();
  assert.deepEqual(worker.messages.at(-1), { id: 1, type: 'cancel' });
  worker.finish(); await delay(10);
  assert.equal(worker.requests().length, 1); assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 0);
});

test('new revision cancels old prediction followers, clears cache and rejects late stale admissions', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  const initial = predict(); await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; worker.finish(); await initial;
  warm(['12343', '12344']); await until(() => worker.requests().length === 2);
  const stale = predict('12343'); const rejected = assert.rejects(stale, { status: 409 });
  scheduler.supersede(1, 'new-gameplay', 'reed'); await rejected;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 0);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  await assert.rejects(predict(), { status: 409 });
  worker.finish(); const current = predict('12342', state(1));
  assert.equal(worker.requests().at(-1).state.revision, 1); worker.finish(); await current;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 1);
});

test('prewarm and HTTP queues remain bounded while the prediction worker starts', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t, { maxPrewarmQueue: 2, maxPredictionQueue: 1 }, { ready: false });
  assert.equal(warm(['1', '2', '3', '4']).queued, 2);
  const interactive = predict('9');
  await assert.rejects(predict('8'), { status: 429 });
  await assert.rejects(predict('1'), { status: 429 });
  assert.equal(scheduler.getDiagnostics().predictionLane.queue.depth, 1);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  const worker = prediction.workers[0]; worker.emit('message', { type: 'ready', catalogue: [] });
  assert.equal(worker.requests()[0].chunkId, '9'); worker.finish(); await interactive;
  assert.equal(worker.requests().length, 1);
});

test('prediction LRU enforces entry and byte limits and does not cache oversized results', async t => {
  const { scheduler, prediction, predict } = await fixture(t, { predictionCacheLimit: 2, predictionCacheBytes: 300 });
  for (const chunk of ['1', '2', '3']) {
    const operation = predict(chunk); await until(() => prediction.workers[0]?.requests().at(-1)?.chunkId === chunk);
    prediction.workers[0].finish({ data: 'x'.repeat(20) }); await operation;
  }
  let cache = scheduler.getDiagnostics().predictionLane.cache;
  assert.equal(cache.byteLimit, 150);
  assert.equal(cache.byteLimit + scheduler.getDiagnostics().unlockReuse.byteLimit, 300);
  assert.equal(cache.entries, 1); assert.ok(cache.bytes <= 150);
  const before = cache.entries, bytes = cache.bytes;
  const oversized = predict('4'); prediction.workers[0].finish({ data: 'x'.repeat(1000) }); await oversized;
  cache = scheduler.getDiagnostics().predictionLane.cache;
  assert.equal(cache.entries, before); assert.equal(cache.bytes, bytes);
  const repeat = predict('4'); assert.equal(prediction.workers[0].requests().at(-1).chunkId, '4');
  prediction.workers[0].finish(); assert.equal((await repeat).hit, false);
});

test('prediction entry limit evicts the least recently used result', async t => {
  const { scheduler, prediction, predict } = await fixture(t, { predictionCacheLimit: 2 });
  for (const chunk of ['1', '2']) {
    const operation = predict(chunk); await until(() => prediction.workers[0]?.requests().at(-1)?.chunkId === chunk);
    prediction.workers[0].finish(); await operation;
  }
  assert.equal((await predict('1')).hit, true);
  const third = predict('3'); prediction.workers[0].finish(); await third;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 2);
  assert.equal((await predict('1')).hit, true);
  const evicted = predict('2'); assert.equal(prediction.workers[0].requests().at(-1).chunkId, '2');
  prediction.workers[0].finish(); assert.equal((await evicted).hit, false);
});

test('unchanged revision with changed rules and another member never reuses a prediction result', async t => {
  const { prediction, predict } = await fixture(t);
  const original = predict(); await until(() => prediction.workers[0]?.requests().length === 1);
  const worker = prediction.workers[0]; worker.finish({ marker: 'original' }); await original;
  const changed = predict('12342', state(0, { f2p: true }));
  assert.equal(worker.requests().length, 2); assert.notEqual(worker.requests()[0].snapshotKey, worker.requests()[1].snapshotKey);
  assert.deepEqual(worker.requests()[1].state.rules, { f2p: true });
  worker.finish({ marker: 'changed' }); assert.equal((await changed).hit, false);
  const other = predict('12342', state(0, { f2p: true }), 'reed');
  assert.equal(worker.requests().length, 3); assert.equal(worker.requests()[2].state, undefined);
  worker.finish({ marker: 'other' }); assert.equal((await other).hit, false);
  assert.equal((await predict()).result.marker, 'original');
});

test('abandoned warming keeps its watchdog and restart resends the full snapshot', async t => {
  const { scheduler, prediction, warm, predict, foreground } = await fixture(t, { predictionDeadlineMs: 25 });
  warm(['1']); await until(() => prediction.workers[0]?.requests().length === 1);
  scheduler.cancelPrewarm();
  await until(() => prediction.workers.length === 2 && scheduler.getHealth().prediction.ready);
  assert.equal(prediction.workers[0].terminated, true); assert.equal(foreground.workers[0].terminated, false);
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 0);
  const operation = predict('1'); assert.equal(prediction.workers[1].requests()[0].state.revision, 0);
  prediction.workers[1].finish(); await operation;
});

test('cancelled partial predictions are never cached and closing stops idle candidates', async t => {
  const { scheduler, prediction, warm, predict } = await fixture(t);
  const operation = predict(); await until(() => prediction.workers[0]?.requests().length === 1);
  prediction.workers[0].finish({ cancelled: true }); await operation;
  assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 0);
  warm(); await scheduler.close(); await delay(5);
  assert.equal(prediction.workers[0].requests().length, 1); assert.equal(prediction.workers[0].terminated, true);
});
