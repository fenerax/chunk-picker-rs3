// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { calculatorEvidence, trialFailure } from '../scripts/perf/owned-acceptance/lifecycle.mjs';
import { summary } from '../scripts/perf/owned-acceptance.mjs';
import { calculationInput } from '../scripts/perf/owned-acceptance/trial.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';

// Entirely synthetic: no server, real calculation, wall-clock deadline or
// elapsed-time assertion. advance() executes the injected application clock.
async function fixture(t, options = {}) {
  const clock = createManualClock(), workers = [], jobs = [], jobWaiters = [];
  const context = { stage: 'simultaneous-batch', barrier: 815, lastCompletedBarrier: 815 };
  let scheduler;
  const evidence = calculatorEvidence({ context: () => context, diagnostics: () => scheduler?.getDiagnostics() });
  scheduler = await createTaskScheduler({ maxCalculators: 1, maxRestarts: 0, idleMs: 100000,
    idleClock: clock, deadlineClock: clock, deadlineMs: 30, firstCalculationDeadlineMs: 120,
    onCalculatorLifecycle: evidence.onLifecycle,
    workerFactory() {
      const worker = new EventEmitter(), closed = Promise.withResolvers();
      worker.pid = 7000 + workers.length; worker.messages = []; worker.rssBytes = 0;
      worker.postMessage = message => {
        worker.messages.push(message);
        if (!message.id || ['cancel', 'supersede'].includes(message.type)) return;
        if (jobWaiters.length) jobWaiters.shift()(worker); else jobs.push(worker);
      };
      worker.exit = code => { if (!worker.exited) { worker.exited = true; worker.emit('exit', code); closed.resolve(code); } };
      worker.terminate = () => { worker.stopping = true; return closed.promise; };
      worker.finish = () => {
        const message = worker.messages.findLast(message => message.id && message.type === 'evaluate');
        worker.emit('message', { id: message.id, pickerId: message.pickerId, result: { tasks: [] } });
      };
      workers.push(worker); evidence.onWorker(worker);
      queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'predict'] }));
      return worker;
    }, ...options });
  t.after(async () => {
    evidence.seal();
    for (const worker of workers) worker.exit(0);
    await scheduler.close();
  });
  const evaluate = key => scheduler.evaluate({ revision: 0 }, 'synthetic-member', 'evaluate', undefined, key, 'synthetic-input');
  return { scheduler, workers, clock, evidence, context, evaluate,
    nextJob: () => jobs.length ? Promise.resolve(jobs.shift()) : new Promise(resolve => jobWaiters.push(resolve)) };
}

test('both harness formats defer encoding and fence a changed store before dispatch', () => {
  for (const mode of ['format1', 'format2']) {
    let revision = 7, reads = 0, encodes = 0;
    const stateJSON = new SharedArrayBuffer(2), owned = { document: { synthetic: true }, installation: {} };
    const store = { getInfo: () => ({ revision }), getCalculationSnapshot() {
      reads++;
      return { revision, members: [{ id: 'synthetic-member' }], taskInputKey: `input-${revision}`,
        get owned() { if (mode === 'format2') { encodes++; return owned; } },
        get stateJSON() { encodes++; return stateJSON; } };
    } };
    const captured = calculationInput(store);
    assert.equal(reads, 1); assert.equal(encodes, 0, 'admission reads metadata only');
    assert.equal(typeof captured.stateInput.load, 'function');
    assert.deepEqual(Object.keys(captured.stateInput), ['inputKey', 'taskInputKey', 'load']);
    const loaded = captured.stateInput.load(captured.revision);
    assert.equal(reads, 2); assert.equal(encodes, 1, 'payload is encoded only at dispatch');
    assert.equal(loaded.stateInput[mode === 'format1' ? 'stateJSON' : 'owned'], mode === 'format1' ? stateJSON : owned);
    revision++;
    assert.throws(() => captured.stateInput.load(captured.revision), { status: 409 });
    assert.equal(reads, 2); assert.equal(encodes, 1, 'stale providers never encode another save');
  }
});

test('fifty deferred control requests fit unchanged queue limits and release every parked input', async t => {
  const { scheduler, nextJob, evaluate } = await fixture(t);
  const blocking = evaluate('blocker'), blocker = await nextJob();
  let encodes = 0;
  // If encoded eagerly, each synthetic buffer's 2 MiB would exceed the default
  // 64 MiB queued-input ceiling across fifty requests. Allocate only at dispatch.
  const pending = Array.from({ length: 50 }, (_, index) => {
    const store = { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({
      revision: 0, members: [{ id: 'synthetic-member' }], taskInputKey: `input-${index}`,
      get stateJSON() { encodes++; return new SharedArrayBuffer(2 * 1024 ** 2); },
    }) };
    const { revision, members, inputKey, stateInput } = calculationInput(store);
    return scheduler.forPicker(`p_${(index + 1).toString(16).padStart(32, '0')}`).evaluate({ revision, members }, 'synthetic-member',
      'evaluate', undefined, `request-${index}`, inputKey, undefined, [], 'full', stateInput);
  });
  assert.equal(encodes, 0);
  assert.equal(scheduler.getDiagnostics().queue.depth, 50);
  assert.equal(scheduler.getDiagnostics().queue.inputByteLimit, 64 * 1024 ** 2);
  assert(scheduler.getDiagnostics().queue.inputBytes > 0);
  // Finish the blocker, then one admitted job at a time with no real timers.
  blocker.finish(); await blocking;
  for (const request of pending) { (await nextJob()).finish(); await request; }
  assert.equal(encodes, 50);
  assert.equal(scheduler.getDiagnostics().queue.depth, 0);
  assert.equal(scheduler.getDiagnostics().queue.inputBytes, 0);
  assert.equal(scheduler.getDiagnostics().counts.rejected, 0);
});

test('active deadline retains its initiator, pre-recovery state and late exit in JSON and summary', async t => {
  const { scheduler, workers, clock, evidence, context, evaluate } = await fixture(t);
  const active = assert.rejects(evaluate('active'), { status: 504 });
  await clock.advance(100);
  const queued = assert.rejects(evaluate('queued'), { status: 503 });
  await clock.advance(20);
  await Promise.all([active, queued]);
  const event = evidence.records[0].events[0];
  assert.equal(event.initiator, 'deadline'); assert.equal(event.reason, 'calculation-deadline');
  assert.equal(event.scheduler.worker.status, 'ready', 'state is captured before recovery');
  assert.equal(event.scheduler.queue.depth, 1);
  assert.equal(event.scheduler.activeJob.kind, 'evaluate');
  assert.equal(event.scheduler.activeJob.deadlineMs, 120, 'record the effective first-calculation allowance');
  for (const field of ['ageMs', 'queuedMs', 'deadlineAgeMs']) assert.equal(typeof event.scheduler.activeJob[field], 'number');
  assert.equal(event.error.code, 504); assert.match(event.error.stack, /deadline exceeded/);
  assert.equal(event.stage, 'simultaneous-batch'); assert.equal(event.barrier, 815);
  assert.equal(event.lastCompletedBarrier, 815);
  assert.equal(scheduler.getHealth().restartRequired, true);
  assert.equal(evidence.hasExited, false, 'retirement intent precedes physical exit');

  // Trial teardown waits for this owned process. Sealing suppresses ordinary
  // shutdown events without discarding an incident's later exit/error receipt.
  const error = new Error('Calculator retired during measurement; refusing incomplete residency evidence.');
  Object.defineProperty(error, 'trialEvidence', { value: { ...context, calculatorLifecycle: evidence.records,
    scheduler: scheduler.getDiagnostics(), errors: [{ kind: 'calculator', code: 504 }], records: [] } });
  evidence.seal(); context.stage = 'cleanup'; context.barrier = 816;
  workers[0].exit(9);
  const failure = JSON.parse(JSON.stringify(trialFailure('format1', error)));
  assert.equal(evidence.hasExited, true);
  assert.equal(failure.calculatorLifecycle[0].exit.code, 9);
  assert.equal(failure.calculatorLifecycle[0].exit.barrier, 816);
  assert.equal(failure.calculatorLifecycle[0].events.length, 1);
  assert.equal(failure.errors[0].code, 504);
  const text = summary({ smoke: false, results: [], failures: [failure] });
  assert.match(text, /INCOMPLETE ACCEPTANCE; no acceptance claim/);
  assert.match(text, /deadline \(calculation-deadline\).*stage simultaneous-batch, barrier 815, last complete 815/);
  assert.match(text, /queue 1, active evaluate age \d+ ms, deadline 120 ms; exit 9/);
  assert.match(text, /Task calculation deadline exceeded/);
});

test('worker crash preserves its original error stack and exit code before scheduler recovery', async t => {
  const { workers, evidence, evaluate } = await fixture(t);
  const pending = assert.rejects(evaluate('crash'), { status: 503 });
  const error = Object.assign(new Error('Synthetic calculator crash.'), { code: 'SYNTHETIC_CRASH' });
  workers[0].emit('error', error); workers[0].exit(7);
  await pending;
  const record = evidence.records[0];
  assert.equal(record.events[0].initiator, 'crash');
  assert.equal(record.events[0].scheduler.activeJob.kind, 'evaluate');
  assert.equal(record.events[0].error.stack, error.stack);
  assert.equal(record.errors[0].error.code, 'SYNTHETIC_CRASH');
  assert.equal(record.errors[0].error.stack, error.stack);
  assert.equal(record.exit.code, 7);
});

test('worker memory errors are identified separately from crashes', async t => {
  const { workers, evidence, evaluate } = await fixture(t);
  const pending = assert.rejects(evaluate('memory'), { status: 503 });
  workers[0].emit('error', Object.assign(new Error('Synthetic memory ceiling.'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }));
  workers[0].exit(1); await pending;
  assert.equal(evidence.records[0].events[0].initiator, 'memory-ceiling');
  assert.equal(evidence.records[0].events[0].error.code, 'ERR_WORKER_OUT_OF_MEMORY');
  assert.equal(evidence.records[0].exit.code, 1);
});

test('a pool RSS emergency records the memory initiator before cancelling active work', async t => {
  const { scheduler, workers, evidence, evaluate } = await fixture(t, {
    residency: { memoryBytes: 100, estimatedBytes: 100, maxResident: 1, activeMs: 1000, idleMs: 1000 },
  });
  const pending = assert.rejects(evaluate('rss'), { status: 503 });
  workers[0].rssBytes = 101;
  scheduler.noteActivity('legacy-shared'); await pending;
  const event = evidence.records[0].events[0];
  assert.equal(event.initiator, 'memory-ceiling'); assert.equal(event.reason, 'pool-memory-budget');
  assert.equal(event.scheduler.activeJob.kind, 'evaluate');
  workers[0].exit(3); assert.equal(evidence.records[0].exit.code, 3);
});

test('a raw worker exit keeps its code even without a preceding error event', async t => {
  const { workers, evidence, evaluate } = await fixture(t);
  const pending = assert.rejects(evaluate('exit'), { status: 503 });
  workers[0].exit(6); await pending;
  const record = evidence.records[0];
  assert.equal(record.events[0].initiator, 'crash'); assert.equal(record.events[0].reason, 'worker-exit');
  assert.equal(record.exit.code, 6); assert.deepEqual(record.errors, []);
});

test('pool idle retirement keeps the last lane diagnostics without retaining its inputs', async t => {
  const { workers, clock, evidence, evaluate } = await fixture(t);
  const pending = evaluate('complete'); workers[0].finish(); await pending;
  await clock.advance(100000);
  assert.equal(workers[0].stopping, true);
  const event = evidence.records[0].events[0];
  assert.equal(event.initiator, 'idle'); assert.equal(event.reason, 'pool-idle');
  assert.equal(event.scheduler.queue.depth, 0); assert.equal(event.scheduler.activeJob, null);
  assert.equal(event.pool.resident, 1);
  assert.equal(JSON.stringify(event).includes('synthetic-input'), false);
});

test('generation retirement is distinct from deadline failure', async t => {
  const { scheduler, workers, evidence, nextJob } = await fixture(t);
  const pending = assert.rejects(scheduler.evaluate({ revision: 0 }, 'synthetic-member', 'predict', '100', 'obsolete', 'synthetic-input'), { status: 409 });
  await nextJob();
  // A skipped revision makes this producer obsolete instead of preserving the
  // immediately preceding Preview for saved-result reuse.
  assert.equal(scheduler.setRevision(2, 'new-input'), true);
  await pending; workers[0].exit(0);
  const event = evidence.records[0].events[0];
  assert.equal(event.initiator, 'generation-retirement');
  assert.equal(event.scheduler.activeJob.kind, 'predict');
  assert.equal(evidence.records[0].exit.code, 0);
});

test('explicit unhealthy restart records its initiator and replacement worker', async t => {
  const { scheduler, workers, clock, evidence, evaluate, nextJob } = await fixture(t, { stuckMs: 1 });
  const pending = assert.rejects(evaluate('stuck'), { status: 503 });
  await nextJob();
  await clock.advance(2);
  const restarted = scheduler.restartUnhealthy();
  workers[0].exit(2);
  assert.deepEqual((await restarted).restarted, ['foreground']); await pending;
  assert.equal(evidence.records[0].events[0].initiator, 'explicit-restart');
  assert.equal(evidence.records[0].events[0].scheduler.activeJob.kind, 'evaluate');
  const replacement = evaluate('replacement');
  (await nextJob()).finish(); await replacement;
  assert.equal(evidence.records[1].start.replacement, true);
});

test('an explicit restart after a crash is recorded even when no physical worker is owned', async t => {
  const { scheduler, workers, evidence, evaluate, nextJob } = await fixture(t);
  const pending = assert.rejects(evaluate('exited'), { status: 503 });
  await nextJob(); workers[0].exit(6); await pending;
  await scheduler.restartUnhealthy();
  const restart = evidence.schedulerEvents.find(event => event.initiator === 'explicit-restart');
  assert.equal(restart.reason, 'restart-unhealthy');
  assert.equal(restart.scheduler.worker.restartRequired, true);
  const replacement = evaluate('replacement');
  (await nextJob()).finish(); await replacement;
  assert.equal(evidence.records[1].start.replacement, true);
});

test('a failed worker allocation preserves its original error without inventing a worker exit', async () => {
  const evidence = calculatorEvidence({ context: () => ({ stage: 'scheduler-startup', barrier: 1, lastCompletedBarrier: 1 }),
    diagnostics: () => null });
  const cause = new Error('Synthetic worker allocation failure.');
  await assert.rejects(createTaskScheduler({ maxCalculators: 1, maxRestarts: 0,
    workerFactory() { throw cause; }, onCalculatorLifecycle: evidence.onLifecycle }), { status: 503 });
  assert.deepEqual(evidence.records, []);
  assert.equal(evidence.schedulerEvents[0].initiator, 'crash');
  assert.equal(evidence.schedulerEvents[0].error.stack, cause.stack);
});

test('a throwing diagnostic observer cannot prevent deadline rejection or physical retirement', async t => {
  const { scheduler, workers, clock, evaluate } = await fixture(t, { onCalculatorLifecycle() { throw new Error('Synthetic observer failure.'); } });
  const pending = assert.rejects(evaluate('deadline'), { status: 504 });
  await clock.advance(120); await pending;
  assert.equal(workers[0].stopping, true);
  assert.equal(scheduler.getHealth().restartRequired, true);
});
