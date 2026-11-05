import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createSessionResidency, residencyDefaults } from '../app/tasks/session-residency.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createCalculatorPool } from '../app/tasks/calculator-pool.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';

const GiB = 1024 ** 3;
const config = { activeMs: 100, idleMs: 50, memoryBytes: 300, estimatedBytes: 100, maxResident: 3 };
const ids = ['p_' + 'a'.repeat(32), 'p_' + 'b'.repeat(32), 'p_' + 'c'.repeat(32)];
const state = { revision: 0, members: [{ id: 'one' }], rules: {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, extra = {}) {
  const idleClock = createManualClock(), workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.bytes = 100;
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
    worker.finish = () => {
      const job = worker.messages.findLast(message => message.id);
      worker.emit('message', { id: job.id, pickerId: job.pickerId, result: { delta: { tasksAdded: [] }, tasks: [] } });
    };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory, idleClock, idleMs: 20, residency: config,
    calculatorMemoryUsage: worker => worker.bytes, fairness: { maxOutstandingJobsPerPicker: 4 }, ...extra });
  t.after(() => scheduler.close());
  const scopes = ids.map(id => scheduler.forPicker(id));
  // Model the authenticated writable HTTP boundary, separately from calculation.
  const evaluate = (scope = scopes[0], key = 'tasks', type = 'evaluate') => {
    scope.noteActivity();
    return scope.evaluate(state, 'one', type, type === 'predict' ? '100' : undefined, key, 'input');
  };
  return { scheduler, scopes, evaluate, workers, idleClock };
}

test('session idle defaults to three hours while environment overrides keep their precedence', () => {
  const options = { total: 11 * GiB, free: 8.5 * GiB, constrained: 11 * GiB };
  assert.equal(residencyDefaults({ ...options, env: {} }).idleMs, 3 * 60 * 60000);
  assert.equal(residencyDefaults({ ...options, env: { RS3_WORKER_IDLE_MS: '100' } }).idleMs, 100);
  assert.equal(residencyDefaults({ ...options, env: { RS3_WORKER_IDLE_MS: '100', RS3_SESSION_IDLE_MS: '200' } }).idleMs, 200);
});

test('defaults reserve VPS headroom and fall back to one calculator on small hosts', () => {
  const vps = residencyDefaults({ total: 11 * GiB, free: 8.5 * GiB, constrained: 11 * GiB, env: {} });
  assert.equal(vps.maxResident, 3); assert.ok(vps.memoryBytes <= 6.5 * GiB);
  const small = residencyDefaults({ total: 2 * GiB, free: GiB, constrained: 2 * GiB, env: {} });
  assert.equal(small.maxResident, 1); assert.equal(small.memoryBytes, 0.5 * GiB);
  assert.equal(createSessionResidency(small).enabled, false);
  const override = residencyDefaults({ total: 2 * GiB, free: GiB, constrained: 2 * GiB,
    env: { RS3_CALCULATOR_MEMORY_BYTES: String(20 * GiB) } });
  assert.equal(override.memoryBytes, small.memoryBytes);
  const exhausted = residencyDefaults({ total: GiB, free: 1, constrained: GiB, env: {} });
  assert.equal(exhausted.memoryBytes, 0); assert.equal(createSessionResidency(exhausted).enabled, false);
  const container = residencyDefaults({ total: 64 * GiB, free: 60 * GiB, constrained: 2 * GiB, env: {} });
  assert.equal(container.maxResident, 1);
  assert.equal(residencyDefaults({ env: { RS3_WORKER_IDLE_MS: '100' } }).idleMs, 100);
  for (const options of [{ memoryBytes: -1 }, { activeMs: 0 }, { maxResident: NaN }]) assert.throws(() => createSessionResidency({ ...config, ...options }));
});

test('recent requests retain the physical worker and cache, then expire without background renewal', async t => {
  const { scheduler, evaluate, workers, idleClock } = await fixture(t);
  const initial = evaluate(); workers[0].finish(); await initial;
  await idleClock.advance(149); assert.equal(workers[0].terminated, undefined);
  assert.equal((await evaluate()).hit, true);
  await idleClock.advance(149); assert.equal(workers[0].terminated, undefined);
  await idleClock.advance(1); assert.equal(workers[0].terminated, true);
  assert.equal(scheduler.getDiagnostics().calculators.resident, 0);
  assert.equal(scheduler.getHealth().status, 'sleeping');
});

test('writable SSE leases retain an established calculator for arbitrarily long gaps; closing starts idle delay', async t => {
  const { scopes: [a], evaluate, workers, idleClock } = await fixture(t);
  const initial = evaluate(); workers[0].finish(); await initial;
  const closeA = a.openSession(), closeB = a.openSession();
  await idleClock.advance(1000); closeA(); closeA();
  await idleClock.advance(1000); assert.equal(workers[0].terminated, undefined);
  closeB(); await idleClock.advance(49); assert.equal(workers[0].terminated, undefined);
  await idleClock.advance(1); assert.equal(workers[0].terminated, true);
});

test('many pickers share a fake memory ceiling; advisory graphs are evicted before foreground', async t => {
  const { scheduler, scopes, evaluate, workers, idleClock } = await fixture(t);
  const active = scopes.map((scope, index) => evaluate(scope, `first-${index}`));
  assert.equal(workers.length, 1);
  for (let i = 0; i < 3; i++) { workers[0].finish(); await tick(); }
  await Promise.all(active);
  const predictions = scopes.map((scope, index) => evaluate(scope, `predict-${index}`, 'predict'));
  await tick(); assert.equal(workers.length, 2);
  for (let i = 0; i < 3; i++) { workers[1].finish(); await tick(); }
  await Promise.all(predictions);
  await idleClock.advance(1); scopes[0].noteActivity();
  // Foreground's last owner is picker C; advisory's last owner is C too.
  // Assign the advisory graph to the recently active picker A.
  const recent = evaluate(scopes[0], 'new-preview', 'predict'); workers[1].finish(); await recent;
  workers[0].bytes = 180; workers[1].bytes = 180;
  scheduler.noteActivity(ids[0]); await tick();
  assert.equal(workers[1].terminated, true); assert.equal(workers[0].terminated, undefined);
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
  assert.equal(scheduler.getDiagnostics().calculators.evictions, 1);
  assert.ok(scheduler.getDiagnostics().calculators.peak <= 3);
});

test('one-reservation budgets bound all pickers and interactive work interrupts an active background Preview', async t => {
  const { scheduler, scopes: [a, b], evaluate, workers } = await fixture(t, { residency: { ...config, memoryBytes: 100 } });
  a.noteActivity();
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['100', '101'] }]).queued, 2);
  await tick(); assert.equal(workers[0].messages.findLast(message => message.id).type, 'predict');
  const interactive = evaluate(b, 'interactive');
  await tick(); await tick();
  assert.equal(workers[0].terminated, true, 'background producer yields without replying');
  assert.equal(workers.length, 2);
  assert.equal(workers[1].messages.findLast(message => message.id).pickerId, ids[1]);
  workers[1].finish(); await interactive;
  assert.equal(scheduler.getDiagnostics().calculators.peak, 1);
  a.cancelPrewarm();
});

for (const type of ['predict', 'death-estimates', 'duo']) test(`requested ${type} reclaims idle foreground RSS while retaining foreground headroom`, async t => {
  const { scheduler, scopes: [a, b], evaluate, workers } = await fixture(t);
  const close = a.openSession(); t.after(close);
  const initial = evaluate(a); workers[0].finish(); await initial;
  workers[0].bytes = 250;
  let releaseExit;
  workers[0].terminate = () => new Promise(resolve => { releaseExit = () => { workers[0].terminated = true; resolve(); }; });
  t.after(() => releaseExit?.());
  // Unsolicited work cannot displace foreground, even with writable interest.
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['101'] }]).queued, 1);
  await tick();
  assert.equal(workers.length, 1); assert.equal(releaseExit, undefined);
  a.cancelPrewarm();
  const requested = type === 'duo'
    ? a.evaluate(state, 'one', 'evaluate', undefined, 'group', 'input', undefined, [], 'play-v1', undefined, 'duo')
    : evaluate(a, 'requested', type);
  await tick();
  assert.equal(typeof releaseExit, 'function', 'the idle foreground calculator must be reclaimed');
  assert.equal(workers.length, 1, 'retiring memory is still charged');
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 250);
  releaseExit(); await tick(); await tick();
  assert.equal(workers.length, 2);
  assert.equal(workers[1].messages.findLast(message => message.id).type, type === 'duo' ? 'evaluate' : type);
  // The advisory job stays active while the next foreground request wakes.
  const next = evaluate(b, 'next-foreground');
  await tick(); await tick();
  assert.equal(workers.length, 3);
  assert.equal(workers[2].messages.findLast(message => message.id).type, 'evaluate');
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 200);
  assert.ok(scheduler.getDiagnostics().calculators.peak <= 3);
  workers[2].finish(); await next;
  workers[1].finish(); await requested;
});

test('an opened session retains the startup calculator before the first task request, without allocating more workers', async t => {
  const { scheduler, scopes: [a], workers, idleClock } = await fixture(t);
  const close = a.openSession();
  await idleClock.advance(2000);
  assert.equal(workers.length, 1); assert.equal(workers[0].terminated, undefined);
  assert.equal(scheduler.getDiagnostics().calculators.resident, 1);
  close(); await idleClock.advance(50);
  assert.equal(workers[0].terminated, true);
});

test('picker cancellation drops only its own residency interest and closed handles cannot renew it', async t => {
  const { scopes: [a, b], evaluate, workers, idleClock } = await fixture(t);
  const initial = evaluate(a); workers[0].finish(); await initial;
  a.openSession(); const closeB = b.openSession();
  a.cancelPicker(); a.noteActivity();
  await idleClock.advance(2000); assert.equal(workers[0].terminated, undefined);
  closeB(); await idleClock.advance(50); assert.equal(workers[0].terminated, true);
});

test('client readiness follows only its own foreground wake and keeps the browser recovery contract', async t => {
  const { scheduler, scopes: [a, b], evaluate, workers, idleClock } = await fixture(t);
  await idleClock.advance(150);
  assert.equal(scheduler.getHealth().status, 'sleeping');
  const changes = [];
  const unsubscribe = scheduler.subscribe(() => changes.push(a.getClientHealth()));
  t.after(unsubscribe);
  const request = evaluate(a);
  assert.deepEqual(a.getClientHealth(), { status: 'waking', ready: false, restartRequired: false });
  assert.deepEqual(b.getClientHealth(), { status: 'ready', ready: true, restartRequired: false });
  await tick(); await tick();
  assert.deepEqual(a.getClientHealth(), { status: 'ready', ready: true, restartRequired: false });
  assert.ok(changes.some(health => !health.ready));
  assert.ok(changes.some(health => health.ready), 'the browser receives its own ready transition after compilation');
  workers[1].finish(); await request;
});

test('memory pressure waits for a retiring worker instead of repeatedly evicting useful residents', async t => {
  const { scheduler, scopes: [a, b], evaluate, workers } = await fixture(t);
  const tasks = evaluate(a); workers[0].finish(); await tasks;
  const prediction = evaluate(b, 'preview', 'predict'); await tick(); workers[1].finish(); await prediction;
  workers.forEach(worker => { worker.bytes = 180; });
  let exit;
  workers[1].terminate = () => new Promise(resolve => { exit = resolve; });
  scheduler.noteActivity(ids[1]); await tick();
  assert.equal(scheduler.getDiagnostics().calculators.retiring, 1);
  scheduler.noteActivity(ids[1]); await tick();
  assert.equal(workers[0].terminated, undefined);
  assert.equal(scheduler.getDiagnostics().calculators.evictions, 1);
  exit(); await tick();
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
});

test('background completion just before session expiry cannot extend physical residency', async t => {
  const { scheduler, scopes: [a], evaluate, workers, idleClock } = await fixture(t);
  const tasks = evaluate(a); workers[0].finish(); await tasks;
  await idleClock.advance(149);
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['100'] }]).queued, 1);
  await tick(); workers[1].finish();
  await idleClock.advance(1);
  assert.equal(scheduler.getDiagnostics().calculators.resident, 0);
  assert.equal(workers.every(worker => worker.terminated), true);
});

test('small budgets disable optional work and retain only the original idle lifetime', async t => {
  const { scheduler, scopes: [a], evaluate, workers, idleClock } = await fixture(t,
    { residency: { ...config, memoryBytes: 150, estimatedBytes: 200 } });
  workers[0].bytes = 100;
  const close = a.openSession();
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['100'] }]).queued, 0);
  assert.equal(a.prewarmTasks(state, 'input', ['one']).queued, 0);
  const request = evaluate(); workers[0].finish(); await request;
  await idleClock.advance(20);
  assert.equal(workers[0].terminated, true, 'an open session cannot enable keep-warm on a small host');
  assert.equal(scheduler.getDiagnostics().calculators.limit, 1);
  close();
});

test('disabled keep-warm retires on the ordinary ten-minute default, not the three-hour session grace', async t => {
  if (process.env.RS3_WORKER_IDLE_MS !== undefined) return t.skip('RS3_WORKER_IDLE_MS overrides the default');
  const { scheduler, evaluate, workers, idleClock } = await fixture(t, { idleMs: undefined,
    residency: { ...config, idleMs: 3 * 60 * 60000, memoryBytes: 150, estimatedBytes: 200 } });
  const request = evaluate(); workers[0].finish(); await request;
  await idleClock.advance(599000);
  assert.notEqual(workers[0].terminated, true, 'the ordinary lifetime is still ten minutes');
  await idleClock.advance(2000);
  assert.equal(workers[0].terminated, true, 'a disabled pool must not inherit the session grace');
  assert.equal(scheduler.getDiagnostics().calculators.resident, 0);
});

test('zero available budget creates no calculator', async () => {
  let allocations = 0;
  await assert.rejects(createTaskScheduler({ residency: { ...config, memoryBytes: 0 },
    workerFactory() { allocations++; } }), { status: 503 });
  assert.equal(allocations, 0);
});

test('admission and diagnostics use cached RSS without synchronous filesystem reads', async t => {
  const { scheduler, evaluate, workers, idleClock } = await fixture(t, { calculatorMemoryUsage: undefined });
  const worker = workers[0]; worker.pid = 123; worker.rssBytes = 180;
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = () => { reads++; throw new Error('synchronous filesystem read forbidden'); };
  syncBuiltinESMExports();
  try {
    const request = evaluate();
    assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
    for (const value of [undefined, NaN, -1, Infinity]) {
      worker.rssBytes = value;
      await idleClock.advance(100);
      assert.equal(scheduler.getDiagnostics().calculators.rssBytes, 180);
      assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
    }
    Object.defineProperty(worker, 'rssBytes', { configurable: true, get() { throw new Error('sample unavailable'); } });
    assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
    worker.finish(); await request;
    Object.defineProperty(worker, 'rssBytes', { value: 0, writable: true });
    assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 100, 'a valid low sample retains the reservation floor');
    assert.equal(reads, 0, 'admission, maintenance, completion and diagnostics must make no synchronous filesystem read');
  } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
});

for (const emergency of [false, true]) test(`replacement calculators get a full idle lifetime after ${emergency ? 'an RSS trip' : 'small-host startup'}`, async t => {
  const { scheduler, evaluate, workers, idleClock } = await fixture(t, emergency ? {}
    : { residency: { ...config, memoryBytes: 150, estimatedBytes: 200 } });
  if (emergency) {
    const request = evaluate(), rejected = assert.rejects(request, { status: 503 });
    workers[0].bytes = 400;
    await idleClock.advance(100); await rejected;
  } else await idleClock.advance(100);
  assert.equal(workers[0].terminated, true);
  const replacement = evaluate(undefined, 'replacement');
  await tick(); await tick();
  assert.equal(workers.length, 2);
  // Busy time and pool age cannot consume the replacement's idle lifetime.
  await idleClock.advance(25); workers[1].finish(); await replacement;
  await idleClock.advance(19); scheduler.noteActivity(ids[0]); await tick();
  assert.equal(workers[1].terminated, undefined);
  await idleClock.advance(1);
  assert.equal(workers[1].terminated, true);
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 0);
});

test('a crash during emergency cancellation releases every admission charge and the reservation on exit', async t => {
  const { scheduler, evaluate, workers, idleClock } = await fixture(t, { fairness: { maxOutstandingJobsPerPicker: 2 } });
  const first = evaluate(undefined, 'crashing'), rejected = assert.rejects(first, { status: 503 });
  const queued = evaluate(undefined, 'queued');
  await assert.rejects(evaluate(undefined, 'over-budget'), { status: 429 });
  const crashed = workers[0], post = crashed.postMessage;
  let releaseExit;
  const exited = new Promise(resolve => { releaseExit = () => { crashed.emit('exit', 1); resolve(); }; });
  crashed.terminate = () => exited;
  crashed.postMessage = message => {
    post(message);
    if (message.type === 'cancel') crashed.emit('error', new Error('synthetic crash during cancellation'));
  };
  crashed.bytes = 400;
  await idleClock.advance(100); await rejected;
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 400, 'crashing process stays charged until proven exit');
  assert.equal(workers.length, 1);
  releaseExit(); await tick(); await tick();
  assert.equal(workers.length, 2, 'queued admission resumes after the crash exits');
  workers[1].finish(); await queued;
  // Filling the entire picker budget again detects a leaked charge from either
  // the interrupted entry or the queued entry, even if failure settled twice.
  const fresh = [evaluate(undefined, 'fresh-1'), evaluate(undefined, 'fresh-2')];
  await assert.rejects(evaluate(undefined, 'fresh-over-budget'), { status: 429 });
  workers[1].finish(); await tick(); workers[1].finish(); await Promise.all(fresh);
  assert.equal(scheduler.getDiagnostics().retainedWork.pending, 0);
  await idleClock.advance(20);
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 0);
  assert.equal(scheduler.getDiagnostics().calculators.resident, 0);
});

test('actual RSS above the ceiling cancels requested advisory work and queues replacements until exit', async t => {
  const { scheduler, scopes: [a, b, c], evaluate, workers, idleClock } = await fixture(t,
    { residency: { ...config, activeMs: 10000, memoryBytes: 650, estimatedBytes: 200 } });
  const foreground = evaluate(a);
  const preview = evaluate(b, 'preview', 'predict');
  const previewRejected = assert.rejects(preview, { status: 503 });
  c.noteActivity();
  const death = c.evaluate(state, 'one', 'death-estimates', undefined, 'death', 'input');
  await tick(); assert.equal(workers.length, 3);
  let exit, forced;
  workers[1].terminate = options => new Promise(resolve => { forced = options.force; exit = resolve; });
  workers.forEach(worker => { worker.bytes = 300; });
  await idleClock.advance(100); await previewRejected;
  assert.equal(forced, true);
  assert.equal(workers[1].messages.at(-1).type, 'cancel');
  const before = scheduler.getDiagnostics().calculators;
  assert.equal(before.rssBytes, 900); assert.equal(before.memoryTrips, 1);
  assert.equal(before.retiring, 1); assert.equal(workers[0].terminated, undefined);
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['101'] }]).queued, 0);
  assert.equal(a.prewarmTasks(state, 'input', ['one']).queued, 0);
  const next = evaluate(b, 'new-preview', 'predict');
  await tick(); assert.equal(workers.length, 3, 'retiring RSS is still charged');
  workers[0].finish(); await foreground;
  workers[2].finish(); await death;
  // Reuse still cannot start while the retiring process owns excess memory.
  await tick(); assert.equal(workers.length, 3);
  exit(); await tick(); await tick();
  // An idle advisory slot can serve the queued request after the exit.
  workers[2].finish(); await next;
  assert.ok(scheduler.getDiagnostics().calculators.rssBytes <= 650);
});

test('an oversized requested foreground calculator is cancelled even when no work is expendable', async t => {
  const { scheduler, evaluate, workers, idleClock } = await fixture(t);
  const request = evaluate(), rejected = assert.rejects(request, { status: 503 });
  workers[0].bytes = 400;
  await idleClock.advance(100); await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(scheduler.getDiagnostics().calculators.resident, 0);
});

test('actual RSS is bounded during calculator startup too', async t => {
  const clock = createManualClock(), sessions = createSessionResidency(config, clock);
  const worker = new EventEmitter(); worker.bytes = 400;
  worker.terminate = async ({ force }) => { worker.forced = force; worker.emit('exit', 0); };
  const pool = createCalculatorPool({ limit: 3, sessions, clock, workerFactory: () => worker,
    workerData: () => ({}), memoryUsage: worker => worker.bytes });
  t.after(() => pool.close());
  const endpoint = pool.createEndpoint(true), errors = [];
  endpoint.on('error', error => errors.push(error));
  await tick(); await clock.advance(100);
  assert.equal(worker.forced, true);
  assert.match(errors[0].message, /memory budget/);
  assert.equal(pool.diagnostics().resident, 0);
});

test('an RSS emergency can retire a served Preview partner while ordinary yielding preserves it', async t => {
  const { scheduler, scopes: [a], evaluate, workers, idleClock } = await fixture(t,
    { residency: { ...config, activeMs: 10000 } });
  const preview = evaluate(a, 'preview', 'predict'); await tick();
  const job = workers[1].messages.findLast(message => message.id);
  workers[1].emit('message', { id: job.id, pickerId: job.pickerId, type: 'prediction-prepared', result: { delta: { tasksAdded: [] } } });
  await preview;
  const foreground = evaluate(a); workers[0].finish(); await foreground;
  assert.equal(workers[1].terminated, undefined, 'served partner remains requested under ordinary scheduling');
  workers[1].bytes = 400;
  await idleClock.advance(100);
  assert.equal(workers[1].terminated, true, 'requested status cannot override the RSS ceiling');
  assert.equal(scheduler.getDiagnostics().calculators.rssBytes <= 300, true);
  assert.equal(scheduler.getDiagnostics().predictionLane.retainedWork.pending, 0);
});

for (const pressure of [true, false]) test(`pool ${pressure ? 'preserves foreground headroom' : 'preempts background production across groups'}`, async t => {
  const clock = createManualClock(), workers = [], sessions = createSessionResidency({ ...config,
    activeMs: 10000, memoryBytes: 650, estimatedBytes: 200 }, clock);
  const pool = createCalculatorPool({ limit: 3, clock, sessions, workerData: () => ({}),
    memoryUsage: worker => worker.bytes, workerFactory() {
      const worker = new EventEmitter(); worker.bytes = 200;
      worker.postMessage = message => { worker.last = message; };
      worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
      workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready' })); return worker;
    } });
  t.after(() => pool.close());
  sessions.note(ids[0]);
  const foreground = pool.createEndpoint(true); foreground.on('message', () => {});
  foreground.schedule(() => ({ pickerId: ids[0], interactive: true }), () => foreground.postMessage({ id: 7 }));
  await tick();
  if (pressure) workers[0].emit('message', { id: workers[0].last.id, result: {} });
  function warm() {
    const endpoint = pool.createEndpoint(false); endpoint.on('message', () => {});
    const stop = () => { void endpoint.terminate(); return true; };
    endpoint.schedule(() => ({ pickerId: ids[0], interactive: false }), () => endpoint.postMessage({ id: 1 }),
      stop, () => true, stop);
    return endpoint;
  }
  warm(); warm(); await tick();
  assert.equal(workers.length, 3);
  if (!pressure) await foreground.terminate();
  workers[1].bytes = workers[2].bytes = 240;
  if (pressure) {
    pool.sessionChanged(ids[0]); await tick();
    assert.equal(workers[0].terminated, undefined, '200-byte foreground graph survives the 650-byte pressure case');
    assert.equal(workers.filter(worker => worker.terminated).length, 1);
    return;
  }
  // Foreground has expired and 480 bytes of busy advisory graphs remain. Its
  // 200-byte reservation needs an unsolicited producer in another group to yield.
  const requested = pool.createEndpoint(true); requested.on('message', () => {});
  let ran = false;
  requested.schedule(() => ({ pickerId: ids[1], interactive: true }), () => { ran = true; requested.postMessage({ id: 2 }); });
  await tick(); await tick();
  assert.equal(ran, true);
  assert.equal(workers.filter(worker => worker.terminated).length, 2);
  assert.ok(pool.diagnostics().reservedBytes <= sessions.memoryBytes);
});

test('foreground can preempt an unsolicited advisory calculator still compiling', async t => {
  const clock = createManualClock(), sessions = createSessionResidency({ ...config, memoryBytes: 200 }, clock), workers = [];
  sessions.note(ids[0]);
  const pool = createCalculatorPool({ limit: 3, sessions, clock, workerData: () => ({}), memoryUsage: worker => worker.bytes,
    workerFactory() {
      const worker = new EventEmitter(); worker.bytes = 100; worker.postMessage = () => {};
      worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
      workers.push(worker);
      if (workers.length !== 2) queueMicrotask(() => worker.emit('message', { type: 'ready' }));
      return worker;
    } });
  t.after(() => pool.close());
  const foreground = pool.createEndpoint(true); foreground.on('message', () => {});
  foreground.schedule(() => ({ pickerId: ids[0], interactive: true }), () => foreground.postMessage({ id: 1 }));
  await tick(); await foreground.terminate();
  const advisory = pool.createEndpoint(false); advisory.on('message', () => {});
  advisory.schedule(() => ({ pickerId: ids[0], interactive: false }), () => assert.fail('unsolicited startup must yield'),
    () => false, () => false, () => false, () => { void advisory.terminate(); return true; });
  await tick(); workers[1].bytes = 150;
  const next = pool.createEndpoint(true); next.on('message', () => {});
  let ran = false;
  next.schedule(() => ({ pickerId: ids[1], interactive: true }), () => { ran = true; next.postMessage({ id: 2 }); });
  await tick(); await tick();
  assert.equal(workers[1].terminated, true); assert.equal(ran, true);
});

test('shutdown force-stops warm production without waiting for graceful retirement', { timeout: 1000 }, async t => {
  let release;
  t.after(() => release?.());
  const { scheduler, scopes: [scope], workers } = await fixture(t);
  scope.noteActivity();
  scope.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['100'] }]);
  await tick();
  const worker = workers[1];
  assert.equal(worker.messages.findLast(message => message.id).type, 'predict');
  const exited = new Promise(resolve => { release = resolve; });
  let forced = false;
  worker.terminate = ({ force = false } = {}) => {
    if (force) { forced = true; worker.emit('exit', 0); release(); }
    return exited;
  };
  await scheduler.close(20);
  assert.equal(forced, true);
  await scheduler.close(20);
});

test('pool shutdown escalates retirement already waiting for a warm calculator exit', { timeout: 1000 }, async t => {
  const clock = createManualClock(), sessions = createSessionResidency(config, clock);
  let release;
  const exited = new Promise(resolve => { release = resolve; });
  t.after(release);
  const worker = new EventEmitter();
  let forced = false;
  worker.terminate = ({ force = false } = {}) => {
    if (force) { forced = true; worker.emit('exit', 0); release(); }
    return exited;
  };
  const pool = createCalculatorPool({ limit: 1, sessions, clock, idleMs: 1, workerData: () => ({}),
    workerFactory: () => { queueMicrotask(() => worker.emit('message', { type: 'ready' })); return worker; } });
  t.after(() => pool.close());
  pool.createEndpoint(true).on('error', assert.fail);
  await tick(); await clock.advance(1);
  assert.equal(pool.diagnostics().retiring, 1);
  await pool.close();
  assert.equal(forced, true);
  assert.equal(pool.diagnostics().resident, 0);
});

test('pooled shutdown keeps the requested deadline when termination never resolves', { timeout: 30000 }, async t => {
  const { scheduler, workers } = await fixture(t);
  workers[0].terminate = () => new Promise(() => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completed = false;
  const first = scheduler.close(20);
  void first.then(() => { completed = true; });
  assert.equal(scheduler.close(20), first);
  t.mock.timers.tick(19); await tick();
  assert.equal(completed, false);
  t.mock.timers.tick(1); await first;
  assert.equal(scheduler.getHealth().status, 'closed');
});

test('task preparation readiness obeys the same picker activity admission as its warm queue', async t => {
  const { scopes: [active, inactive], idleClock } = await fixture(t);
  assert.equal(active.canPrewarmTasks(), false);
  active.noteActivity();
  for (const prediction of [false, true]) {
    assert.equal(active.canPrewarmTasks(prediction), true);
    assert.equal(inactive.canPrewarmTasks(prediction), false);
  }
  await idleClock.advance(150);
  assert.equal(active.canPrewarmTasks(), false);
});

for (const requested of [false, true]) test(`expired queued warming releases the shared lane${requested ? ' behind requested work' : ''}`, async t => {
  const { scheduler, scopes: [a, b, c], evaluate, workers, idleClock } = await fixture(t, { residency: { ...config, memoryBytes: 200 } });
  a.noteActivity(); workers[0].bytes = 150;
  assert.equal(a.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['100'] }]).queued, 1);
  await tick(); assert.equal(workers.length, 1);
  const close = b.openSession(); t.after(close);
  await idleClock.advance(150);
  assert.equal(b.prewarm(state, 'input', [{ memberId: 'one', chunkIds: ['101'] }]).queued, 1);
  const request = requested ? evaluate(c, 'requested', 'predict') : undefined;
  workers[0].bytes = 100;
  await idleClock.advance(100);
  assert.equal(workers.length, 2, 'eligible work must acquire the free reservation');
  assert.equal(workers[1].messages.findLast(message => message.id).pickerId, ids[requested ? 2 : 1]);
  if (requested) {
    assert.equal(workers[1].messages.findLast(message => message.id).chunkId, '100');
    workers[1].finish(); await request; await tick();
  }
  assert.equal(workers[1].messages.findLast(message => message.id).chunkId, '101');
  workers[1].finish(); await tick();
  assert.equal(scheduler.getDiagnostics().predictionLane.retainedWork.pending, 0);
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.completed, 1);
});
