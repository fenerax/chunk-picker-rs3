import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function factory({ ready = true, deferredTermination = false } = {}) {
  const workers = [];
  return { workers, create() {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => worker.messages.push(message);
    worker.requests = () => worker.messages.filter(message => message.id && message.type !== 'cancel');
    worker.ready = () => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 });
    worker.finish = fields => worker.emit('message', { id: worker.requests().at(-1)?.id, result: { tasks: [] }, evaluationMs: 1, ...fields });
    worker.terminate = async () => {
      worker.terminated = true;
      if (deferredTermination) await new Promise(resolve => { worker.releaseTermination = resolve; });
      worker.emit('exit', 1);
    };
    workers.push(worker); if (ready) queueMicrotask(worker.ready); return worker;
  } };
}
function shared(value) {
  const bytes = Buffer.from(JSON.stringify(value)), buffer = new SharedArrayBuffer(bytes.length);
  Buffer.from(buffer).set(bytes); return buffer;
}
function states() {
  const before = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  before.members[0].unlocked = ['12341']; before.members[1].unlocked = ['12343'];
  const after = structuredClone(before); after.revision = 1; after.members[0].unlocked.push('12342');
  return { before, after };
}
const projection = (state, memberId) => ({ taskInputKey: taskReuseInputKey(state), memberId, sourceRevision: 0,
  playJSON: shared({ tasks: [{ id: memberId }] }), duoJSON: shared({ tasks: [{ id: memberId }] }),
  duoSidebarJSON: shared({ tasks: [{ id: memberId }] }), priority: 1 });

test('saved revision retires cold advisory workers and rejects all obsolete queued followers without restarting', async t => {
  const foreground = factory(), prediction = factory({ ready: false }), death = factory({ ready: false });
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, deathWorkerFactory: death.create });
  t.after(() => scheduler.close());
  const { before } = states();
  const first = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'old');
  const follower = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'old');
  const other = scheduler.evaluate(before, 'reed', 'predict', '12344', 'other', 'old');
  const estimate = scheduler.evaluate(before, 'actor1', 'death-estimates', undefined, 'death', 'old', undefined, ['12342']);
  const rejected = [first, follower, other, estimate].map(promise => assert.rejects(promise, { status: 409 }));
  scheduler.setRevision(1, 'saved'); await Promise.all(rejected); await flush();
  assert.equal(prediction.workers[0].terminated, true); assert.equal(death.workers[0].terminated, true);
  assert.equal(foreground.workers[0].terminated, false);
  assert.equal(scheduler.getDiagnostics().predictionLane.queue.depth, 0);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  assert.equal(scheduler.getDiagnostics().deathLane.queue.depth, 0);
  prediction.workers[0].ready(); death.workers[0].ready(); await flush();
  assert.equal(prediction.workers[0].requests().length, 0, 'late readiness cannot dispatch rejected old candidates');
  assert.equal(death.workers[0].requests().length, 0);
  assert.equal(prediction.workers.length, 1); assert.equal(death.workers.length, 1, 'save does not automatically allocate replacements');
  assert.equal(scheduler.getHealth().prediction.resident, false); assert.equal(scheduler.getHealth().death.resident, false);
});

test('advisory replacement waits for old termination and ignores late old results', async t => {
  const foreground = factory(), prediction = factory({ deferredTermination: true });
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
  t.after(async () => { for (const worker of prediction.workers) worker.releaseTermination?.(); await scheduler.close(20); });
  const { before, after } = states();
  const side = scheduler.evaluate(before, 'actor1', 'chunk-planning', '12342', 'old-side', 'old');
  const rejected = assert.rejects(side, { status: 409 }); await flush();
  const old = prediction.workers[0];
  scheduler.setRevision(1, 'saved'); await rejected; await flush();
  assert.equal(old.terminated, true);
  const current = scheduler.evaluate(after, 'actor1', 'chunk-planning', '12342', 'current-side', 'saved');
  await flush(); assert.equal(prediction.workers.length, 1, 'replacement cannot overlap the old worker');
  old.finish({ unlockReuse: projection(after, 'actor1') }); old.ready(); await flush();
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0); assert.equal(scheduler.getDiagnostics().predictionLane.cache.entries, 0);
  old.releaseTermination(); await flush();
  assert.equal(prediction.workers.length, 2); assert.equal(prediction.workers[1].requests().length, 1);
  prediction.workers[1].finish(); await current;
  assert.equal(scheduler.getHealth().prediction.failures, 0); assert.equal(scheduler.getHealth().prediction.restarts, 0);
});

test('retiring obsolete side work preserves exact compressed owner and peer cache hits', async t => {
  for (const kind of ['chunk-planning', 'full']) await t.test(kind, async sub => {
    const foreground = factory(), prediction = factory(), duo = factory();
    const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, duoWorkerFactory: duo.create });
    sub.after(() => scheduler.close());
    const { before, after } = states();
    const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'old'); await flush();
    prediction.workers[0].finish({ unlockReuse: projection(after, 'actor1'), partnerUnlockReuse: projection(after, 'reed') }); await preview;
    const bytes = scheduler.getDiagnostics().unlockReuse.bytes;
    const side = kind === 'full'
      ? scheduler.evaluate(before, 'actor1', 'evaluate', undefined, 'old-full', 'old', undefined, [], 'full', undefined, 'side')
      : scheduler.evaluate(before, 'actor1', 'chunk-planning', '12342', 'old-side', 'old');
    const rejected = assert.rejects(side, { status: 409 }); scheduler.setRevision(1, 'saved'); await rejected; await flush();
    assert.equal(prediction.workers[0].terminated, true); assert.equal(scheduler.getDiagnostics().unlockReuse.bytes, bytes);
    assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
    for (const memberId of ['actor1', 'reed']) {
      const cached = scheduler.preparedEvaluation(taskReuseInputKey(after), memberId, 1);
      assert.equal(cached.resultCache.unlockPredictionHit, true); assert.deepEqual(cached.result.tasks, [{ id: memberId }]);
    }
    assert.equal(foreground.workers.length, 1); assert.equal(foreground.workers[0].requests().length, 0);
    assert.equal(duo.workers.length, 0); assert.equal(prediction.workers.length, 1);
  });
});

test('retirement preserves ready prediction races and never terminates ordinary foreground or duo workers', async t => {
  const foreground = factory(), prediction = factory(), duo = factory(), death = factory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create,
    duoWorkerFactory: duo.create, deathWorkerFactory: death.create });
  t.after(() => scheduler.close());
  const { before, after } = states();
  const preview = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'old');
  const previewRejected = assert.rejects(preview, { status: 409 }); await flush();
  prediction.workers[0].finish({ type: 'prediction-prepared', unlockReuse: projection(after, 'actor1') });
  const ordinary = scheduler.evaluate(before, 'actor1', 'evaluate', undefined, 'old-list', 'old');
  const peer = scheduler.evaluate(before, 'reed', 'evaluate', undefined, 'old-peer', 'old', undefined, [], 'play-v1', undefined, 'duo');
  const estimate = scheduler.evaluate(before, 'actor1', 'death-estimates', undefined, 'old-death', 'old', undefined, ['12342']);
  const rejected = [ordinary, peer, estimate].map(promise => assert.rejects(promise, { status: 409 })); await flush();
  scheduler.setRevision(1, 'saved'); await Promise.all([previewRejected, ...rejected]); await flush();
  assert.equal(prediction.workers[0].terminated, false, 'a ready actual prediction may still supply the exact saved result');
  assert.equal(foreground.workers[0].terminated, false); assert.equal(duo.workers[0].terminated, false);
  assert.equal(death.workers[0].terminated, true);
  const hit = scheduler.preparedEvaluation(taskReuseInputKey(after), 'actor1', 1); assert.equal(hit.resultCache.unlockPredictionHit, true);
  prediction.workers[0].finish({ unlockReuse: projection(after, 'actor1'), partnerUnlockReuse: projection(after, 'reed') }); await flush();
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
});

test('a retired advisory lane wakes normally and later idle sleep clears its retained projections', async t => {
  let now = 0, sequence = 0;
  const timers = new Map(), idleClock = { now: () => now,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const foreground = factory(), prediction = factory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create, idleMs: 100, idleClock });
  t.after(() => scheduler.close());
  const { before, after } = states();
  const old = scheduler.evaluate(before, 'actor1', 'chunk-planning', '12342', 'old-side', 'old');
  const rejected = assert.rejects(old, { status: 409 }); await flush(); scheduler.setRevision(1, 'saved'); await rejected; await flush();
  const next = scheduler.evaluate(after, 'actor1', 'predict', '12344', 'next-preview', 'saved'); await flush();
  assert.equal(prediction.workers.length, 2);
  const future = structuredClone(after); future.members[0].unlocked.push('12344');
  prediction.workers[1].finish({ unlockReuse: { ...projection(future, 'actor1'), sourceRevision: 1 },
    partnerUnlockReuse: { ...projection(future, 'reed'), sourceRevision: 1 } }); await next;
  assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 2);
  now = 101; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush();
  assert.equal(scheduler.getHealth().prediction.status, 'sleeping'); assert.equal(scheduler.getDiagnostics().unlockReuse.entries, 0);
  assert.equal(scheduler.getHealth().prediction.restarts, 0);
});

test('a note edit retires only an unrequested warm prediction', async t => {
  const foreground = factory(), prediction = factory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
  t.after(() => scheduler.close());
  const { before } = states();
  const dispatched = async index => { for (let i = 0; i < 100 && !prediction.workers[index]?.requests().length; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  assert.equal(scheduler.prewarm(before, 'input', [{ memberId: 'actor1', chunkIds: ['12342'] }]).queued, 1); await dispatched(0);
  assert.equal(prediction.workers[0].requests().at(-1)?.type, 'predict');
  assert.equal(scheduler.retireWarmPrediction(), true); await flush();
  assert.equal(prediction.workers[0].terminated, true);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  const requested = scheduler.evaluate(before, 'actor1', 'predict', '12342', 'preview', 'input'); requested.catch(() => {});
  await dispatched(1);
  assert.equal(prediction.workers[1].requests().at(-1)?.type, 'predict');
  assert.equal(scheduler.retireWarmPrediction(), false, 'a requested preview keeps its process');
  assert.equal(prediction.workers[1].terminated, false);
});
