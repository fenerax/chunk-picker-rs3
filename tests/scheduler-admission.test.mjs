// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { deferredTaskInput } from '../app/tasks/deferred-input.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';

const id = n => 'p_' + n.toString(16).padStart(32, '0');
const state = (revision = 0, marker = 'original') => ({ revision, members: [{ id: 'one' }], marker });
const shared = value => { const bytes = Buffer.from(JSON.stringify(value)), result = new SharedArrayBuffer(bytes.length); Buffer.from(result).set(bytes); return result; };
async function fixture(t, options = {}) {
  const clock = createManualClock(), work = [], waiting = [], workers = [];
  const scheduler = await createTaskScheduler({ idleClock: clock, deadlineClock: clock, idleMs: 1000000,
    deadlineMs: 30, firstCalculationDeadlineMs: 30, waitDeadlineMs: 10000, maxRestarts: 0,
    workerFactory() {
      const worker = new EventEmitter();
      worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
      worker.postMessage = message => {
        if (!message.id || ['cancel', 'supersede'].includes(message.type)) return;
        const job = { worker, message };
        if (waiting.length) waiting.shift()(job); else work.push(job);
      };
      workers.push(worker);
      queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'predict'] }));
      return worker;
    }, ...options });
  t.after(() => scheduler.close());
  const request = (picker, key, { value = state(), input = key, signal, member = 'one', type = 'evaluate', chunkId, view = 'full', stateInput, lane = 'foreground' } = {}) =>
    scheduler.forPicker(id(picker)).evaluate(value, member, type, chunkId, key, input, signal, [], view, stateInput, lane);
  const next = () => work.length ? Promise.resolve(work.shift()) : new Promise(resolve => waiting.push(resolve));
  function finish({ worker, message }, result) {
    const captured = message.state ?? (message.stateJSON ? JSON.parse(Buffer.from(message.stateJSON).toString()) : undefined);
    worker.emit('message', { id: message.id, result: result ?? { revision: captured?.revision, marker: captured?.marker }, evaluationMs: 0 });
  }
  return { clock, scheduler, request, next, finish, workers };
}

// One generous deadlock guard for this file; all application time is injected.
test('initial scheduler cancellation retains the same retryable unavailability metadata', async () => {
  const controller = new AbortController(), created = Promise.withResolvers();
  const pending = createTaskScheduler({ signal: controller.signal, workerFactory() {
    const worker = new EventEmitter(); worker.postMessage = () => {};
    worker.terminate = async () => { worker.emit('exit', 0); };
    created.resolve(); return worker;
  } });
  const rejected = assert.rejects(pending, { name: 'AbortError', status: 503, retryAfter: 1 });
  await created.promise; controller.abort(); await rejected;
});

test('bounded calculator admission', { timeout: 60000 }, async t => {
  for (const [reason, options, request] of [
    ['byte-cap', { maxQueuedInputBytes: 1024 }, f => f.request(2, 'large', { value: { ...state(), marker: 'x'.repeat(2048) } })],
    ['per-picker-outstanding', { fairness: { maxOutstandingJobsPerPicker: 1 } }, f => f.request(1, 'second', { member: 'two' })],
    ['waiters', { fairness: { maxWaitersPerJob: 1 } }, f => f.request(1, 'blocker')],
    ['job-count', { maxQueue: 1 }, async f => {
      const queued = f.request(2, 'queued'); f.extra = queued;
      return f.request(3, 'overflow');
    }],
  ]) await t.test(`${reason} refusals count their job kind without changing admission`, async t => {
    const f = await fixture(t, options), active = f.request(1, 'blocker'), job = await f.next();
    const before = f.scheduler.getDiagnostics().rejections;
    await assert.rejects(request(f), { status: 429 });
    assert.deepEqual(f.scheduler.getDiagnostics().rejections, { byReason: { [reason]: 1 }, byKind: { evaluate: 1 }, byReasonAndKind: { [`${reason}:evaluate`]: 1 } });
    assert.deepEqual(before.byReason, {}, 'previous diagnostic receipts are immutable');
    f.finish(job); await active;
    if (f.extra) { f.finish(await f.next()); await f.extra; }
  });

  for (const pooled of [false, true]) await t.test(`50 distinct groups finish with zero refusals (${pooled ? 'one physical calculator' : 'one worker'})`, async t => {
    const f = await fixture(t, pooled ? { maxCalculators: 1 } : {});
    const requests = Array.from({ length: 50 }, (_, n) => f.request(n + 1, 'same-key', { value: state(0, `group-${n}`) }));
    assert.equal(f.scheduler.getDiagnostics().queue.depth, 49);
    assert.ok(f.scheduler.getDiagnostics().queue.inputBytes < 1024 * 1024);
    for (let n = 0; n < 50; n++) {
      const job = await f.next();
      assert.equal(job.message.pickerId, id(n + 1));
      await f.clock.advance(20); f.finish(job);
    }
    const replies = await Promise.all(requests);
    assert.deepEqual(replies.map(value => value.result.marker), Array.from({ length: 50 }, (_, n) => `group-${n}`));
    assert.equal(f.scheduler.getDiagnostics().counts.rejected, 0);
    assert.equal(f.scheduler.getDiagnostics().queue.inputBytes, 0);
    assert.equal(f.workers.length, 1);
  });

  await t.test('equivalent queued reads join, replacements fence the old revision, and abort removes only its waiter', async t => {
    const f = await fixture(t, { fairness: { maxOutstandingJobsPerPicker: 2 } });
    const first = f.request(1, 'blocker'), blocker = await f.next();
    const controller = new AbortController();
    const old = f.request(2, 'old', { input: 'same', signal: controller.signal });
    const aborted = assert.rejects(old, { name: 'AbortError' });
    const joined = f.request(2, 'alias', { input: 'same' });
    const obsolete = assert.rejects(joined, { status: 409 });
    assert.equal(f.scheduler.getDiagnostics().queue.depth, 1);
    controller.abort(); await aborted;
    const current = f.request(2, 'new', { value: state(1, 'current'), input: 'changed' });
    const currentFollower = f.request(2, 'new-alias', { value: state(1, 'current'), input: 'changed' });
    await obsolete;
    await assert.rejects(f.request(2, 'late-old', { input: 'same' }), { status: 409 });
    f.finish(blocker); await first;
    const job = await f.next(); assert.equal(job.message.state.revision, 1); f.finish(job);
    assert.equal((await current).result.marker, 'current');
    assert.equal((await currentFollower).result.marker, 'current');
    assert.equal(f.scheduler.getDiagnostics().cache.entries, 2);
    const fresh = ['one', 'two'].map(member => f.request(2, `fresh-${member}`, { member, value: state(1), input: 'changed' }));
    for (let n = 0; n < 2; n++) f.finish(await f.next());
    await Promise.all(fresh);
  });

  for (const pooled of [false, true]) for (const event of ['error', 'exit']) await t.test(`joined request charges survive coalescing and release on abort and ${event} (${pooled ? 'pooled' : 'dedicated'})`, async t => {
    const f = await fixture(t, { fairness: { maxOutstandingJobsPerPicker: 2 }, ...(pooled ? { maxCalculators: 1 } : {}) });
    const first = f.request(1, 'blocker'), blocker = await f.next();
    const primary = f.request(2, 'primary', { input: 'same' });
    const primaryRejected = assert.rejects(primary, { status: 503 });
    const controller = new AbortController();
    const alias = f.request(2, 'alias', { input: 'same', signal: controller.signal });
    const aborted = assert.rejects(alias, { name: 'AbortError' });
    await assert.rejects(f.request(2, 'over-budget', { input: 'same' }), { status: 429 });
    const exact = f.request(2, 'primary', { input: 'same' });
    const exactRejected = assert.rejects(exact, { status: 503 });
    assert.equal(f.scheduler.getDiagnostics().queue.depth, 1, 'joined demand uses one queued calculation');
    controller.abort(); await aborted;
    const replacement = f.request(2, 'replacement', { input: 'same' });
    const replacementRejected = assert.rejects(replacement, { status: 503 });
    await assert.rejects(f.request(2, 'still-over-budget', { input: 'same' }), { status: 429 });
    f.finish(blocker); await first;
    const running = await f.next();
    running.worker.emit(event, event === 'error' ? new Error('synthetic crash') : 1);
    await Promise.all([primaryRejected, exactRejected, replacementRejected]);
    assert.equal(f.scheduler.getDiagnostics().retainedWork.pending, 0);
    // Another lane shares the picker quota. Filling it detects leaked charges
    // even though the foreground lane exhausted its configured restart budget.
    const fresh = [100, 101].map(chunkId => f.request(2, `fresh-${chunkId}`, { type: 'predict', chunkId }));
    await assert.rejects(f.request(2, 'fresh-over-budget', { type: 'predict', chunkId: 102 }), { status: 429 });
    for (let n = 0; n < 2; n++) f.finish(await f.next());
    await Promise.all(fresh);
  });

  await t.test('flooding groups cannot starve a quiet group', async t => {
    const f = await fixture(t), promises = [f.request(1, 'active')], first = await f.next();
    for (let group = 1; group <= 2; group++) for (let n = 0; n < 3; n++) promises.push(f.request(group, `job-${n}`, { member: `member-${n}` }));
    promises.push(f.request(3, 'quiet'));
    await assert.rejects(f.request(1, 'overflow', { member: 'extra' }), { status: 429, retryAfter: 1 });
    f.finish(first);
    const order = [];
    for (let n = 0; n < 7; n++) { const job = await f.next(); order.push(job.message.pickerId); f.finish(job); }
    await Promise.all(promises);
    assert.ok(order.indexOf(id(3)) <= 2);
  });

  for (const pooled of [false, true]) await t.test(`interactive priority yields to heavy requests after eight turns (${pooled})`, async t => {
    const f = await fixture(t, pooled ? { maxCalculators: 1 } : {}), promises = [f.request(1, 'blocker')], blocker = await f.next();
    promises.push(f.request(2, 'heavy'));
    for (let n = 3; n <= 14; n++) promises.push(f.request(n, 'play', { view: 'play-v1' }));
    f.finish(blocker);
    const order = [];
    for (let n = 0; n < 13; n++) { const job = await f.next(); order.push(job.message.pickerId); f.finish(job); }
    await Promise.all(promises);
    assert.equal(order.indexOf(id(2)), 8);
  });

  await t.test('queue expiration is distinct from execution and never retires a useful calculator', async t => {
    const f = await fixture(t, { waitDeadlineMs: 10, deadlineMs: 100, firstCalculationDeadlineMs: 100 });
    const active = f.request(1, 'active'), job = await f.next();
    const waiting = assert.rejects(f.request(2, 'queued'), { status: 504, code: 'CALCULATION_WAIT_TIMEOUT' });
    await f.clock.advance(6);
    const alias = assert.rejects(f.request(2, 'alias', { input: 'queued' }), { code: 'CALCULATION_WAIT_TIMEOUT' });
    await f.clock.advance(4); await Promise.all([waiting, alias]);
    assert.equal(f.scheduler.getDiagnostics().queue.depth, 0);
    assert.equal(f.scheduler.getHealth().failures, 0);
    assert.equal(f.workers[0].terminated, undefined);
    f.finish(job); await active;
    const execution = assert.rejects(f.request(3, 'hung'), { status: 504 });
    await f.next(); await f.clock.advance(100); await execution;
    assert.equal(f.scheduler.getHealth().lastFailure.kind, 'calculation-deadline');
  });

  await t.test('interactive demand precedes other lanes and unsolicited warming from other groups', async t => {
    const f = await fixture(t, { maxCalculators: 1 });
    const first = f.request(1, 'blocker'), blocker = await f.next();
    const peer = f.request(2, 'peer', { lane: 'duo', view: 'play-v1' });
    f.scheduler.forPicker(id(3)).prewarmTasks(state(), 'warm', ['one']);
    const play = f.request(4, 'play', { view: 'play-v1' });
    f.finish(blocker); await first;
    const next = await f.next(); assert.equal(next.message.pickerId, id(4)); f.finish(next); await play;
    const heavy = await f.next(); assert.equal(heavy.message.pickerId, id(2)); f.finish(heavy); await peer;
    const warm = await f.next(); assert.equal(warm.message.pickerId, id(3)); f.finish(warm);
  });

  await t.test('deferred captures hold no payload, verify revisions at dispatch, and release an unused pooled lease', async t => {
    const f = await fixture(t, { maxCalculators: 1 });
    let current = state(), captures = 0;
    const store = { getInfo: () => ({ revision: current.revision }), getCalculationSnapshot() {
      captures++; return { ...current, taskInputKey: 'input', stateJSON: shared(current) };
    } };
    const first = f.request(1, 'blocker'), blocker = await f.next();
    const lazy = deferredTaskInput(store, 'input');
    const obsolete = assert.rejects(f.request(2, 'lazy', { input: 'input', stateInput: lazy }), { status: 409 });
    assert.equal(captures, 0); assert.ok(f.scheduler.getDiagnostics().queue.inputBytes < 1024);
    current = state(1); // Simulate a save before its supersession notification.
    const valid = f.request(3, 'valid');
    f.finish(blocker); await first; await obsolete;
    const next = await f.next(); assert.equal(next.message.pickerId, id(3)); f.finish(next); await valid;
    assert.equal(captures, 0); assert.equal(f.workers.length, 1);
    const loaded = f.request(2, 'fresh', { value: current, input: 'input', stateInput: lazy });
    const fresh = await f.next(); assert.equal(captures, 1); f.finish(fresh); await loaded;
  });

  await t.test('eager queued snapshots are immutable, byte bounded, and released on disconnect', async t => {
    const f = await fixture(t, { maxQueuedInputBytes: 1024 });
    const first = f.request(1, 'blocker'), blocker = await f.next();
    const mutable = state(), next = f.request(2, 'next', { value: mutable });
    mutable.marker = 'changed after capture';
    await assert.rejects(f.request(3, 'large', { value: { ...state(), marker: 'x'.repeat(2048) } }), { status: 429 });
    const controller = new AbortController();
    const abandoned = assert.rejects(f.request(4, 'abandoned', { signal: controller.signal }), { name: 'AbortError' });
    controller.abort(); await abandoned;
    f.finish(blocker); await first; const job = await f.next(); f.finish(job);
    assert.equal((await next).result.marker, 'original');
    assert.equal(f.scheduler.getDiagnostics().queue.inputBytes, 0);
  });

  await t.test('a deferred provider resolves the current cached capture without recapturing or materializing state', () => {
    let revision = 0, reads = 0, serializations = 0;
    const capture = (input = 'input') => {
      let bytes;
      return { revision, members: [{ id: 'one' }], taskInputKey: input,
        get state() { throw Error('Must not materialize state.'); },
        get stateJSON() { if (!bytes) { serializations++; bytes = shared(state(revision)); } return bytes; } };
    };
    let cached = capture();
    const store = { getInfo: () => ({ revision }), getCalculationSnapshot() { throw Error('Must reuse the context capture.'); } };
    const provider = deferredTaskInput(store, 'input', () => { reads++; return cached; });
    assert.equal(reads, 0); assert.equal(serializations, 0);
    const first = provider.load(0), second = provider.load(0);
    assert.equal(first.stateInput.stateJSON, second.stateInput.stateJSON);
    assert.equal(serializations, 1);
    revision = 1; cached = capture();
    assert.throws(() => provider.load(0), { status: 409 });
    assert.equal(reads, 2, 'a stale revision cannot even resolve its capture');
    assert.equal(provider.load(1).state.revision, 1, 'display revisions resolve the current cached capture');
    assert.equal(serializations, 2);
    cached = capture('changed');
    assert.throws(() => provider.load(1), { status: 409 });
    assert.equal(serializations, 2, 'fingerprint mismatches are refused before serialization');
  });

  await t.test('deferred state cannot bypass byte limits through large draft arguments or response keys', async t => {
    const f = await fixture(t, { maxCalculators: 1, maxQueuedInputBytes: 1024 });
    const first = f.request(1, 'blocker'), blocker = await f.next();
    let captures = 0;
    const input = deferredTaskInput({ getInfo: () => ({ revision: 0 }), getCalculationSnapshot() { captures++; throw Error('Must not capture.'); } }, 'input');
    await assert.rejects(f.request(2, 'draft', { type: 'sandbox', input: 'input', stateInput: input,
      chunkId: { changes: 'x'.repeat(2048) } }), { status: 429 });
    await assert.rejects(f.request(3, 'key'.repeat(1024), { input: 'input', stateInput: input }), { status: 429 });
    assert.equal(captures, 0); assert.equal(f.scheduler.getDiagnostics().queue.inputBytes, 0);
    f.finish(blocker); await first;
  });

  await t.test('performance trace anchors remain available', async () => {
    const scheduler = await readFile(new URL('../app/tasks/scheduler.mjs', import.meta.url), 'utf8');
    for (const anchor of ['function retire(error = superseded()) {', 'if (count >= maxOutstandingJobsPerPicker) return;',
      'if (count() >= limit) return;', "if (queue.length >= maxQueue && (calculatorPool || active || status !== 'ready')) {",
      'entry = { releaseFair, key, originalKey, pickerId, input, state, stateInput, memberId, type,',
      'const entry = active; active = undefined; deadlineClock.clearTimeout(entry.timer);']) assert.ok(scheduler.includes(anchor), anchor);
  });
});
