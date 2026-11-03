import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSessionResidency, residencyDefaults } from '../app/tasks/session-residency.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
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
  const evaluate = (scope = scopes[0], key = 'tasks', type = 'evaluate') => scope.evaluate(state, 'one', type, type === 'predict' ? '100' : undefined, key, 'input');
  return { scheduler, scopes, evaluate, workers, idleClock };
}

test('defaults reserve VPS headroom and fall back to one calculator on small hosts', () => {
  const vps = residencyDefaults({ total: 11 * GiB, free: 8.5 * GiB, constrained: 11 * GiB, env: {} });
  assert.equal(vps.maxResident, 3); assert.ok(vps.memoryBytes <= 6.5 * GiB);
  const small = residencyDefaults({ total: 2 * GiB, free: GiB, constrained: 2 * GiB, env: {} });
  assert.equal(small.maxResident, 1);
  const container = residencyDefaults({ total: 64 * GiB, free: 60 * GiB, constrained: 2 * GiB, env: {} });
  assert.equal(container.maxResident, 1);
  assert.equal(residencyDefaults({ env: { RS3_WORKER_IDLE_MS: '100' } }).idleMs, 100);
  for (const options of [{ memoryBytes: 99 }, { activeMs: 0 }, { maxResident: NaN }]) assert.throws(() => createSessionResidency({ ...config, ...options }));
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

test('many pickers share a fake memory ceiling; growing idle workers evict least recently active first', async t => {
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
  assert.equal(workers[0].terminated, true); assert.equal(workers[1].terminated, undefined);
  assert.equal(scheduler.getDiagnostics().calculators.reservedBytes, 180);
  assert.equal(scheduler.getDiagnostics().calculators.evictions, 1);
  assert.ok(scheduler.getDiagnostics().calculators.peak <= 3);
});

test('one-reservation budgets bound all pickers and interactive work interrupts an active background Preview', async t => {
  const { scheduler, scopes: [a, b], evaluate, workers } = await fixture(t, { residency: { ...config, memoryBytes: 100 } });
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

test('memory pressure waits for a retiring worker instead of repeatedly evicting useful residents', async t => {
  const { scheduler, scopes: [a, b], evaluate, workers } = await fixture(t);
  const tasks = evaluate(a); workers[0].finish(); await tasks;
  const prediction = evaluate(b, 'preview', 'predict'); await tick(); workers[1].finish(); await prediction;
  workers.forEach(worker => { worker.bytes = 180; });
  let exit;
  workers[0].terminate = () => new Promise(resolve => { exit = resolve; });
  scheduler.noteActivity(ids[1]); await tick();
  assert.equal(scheduler.getDiagnostics().calculators.retiring, 1);
  scheduler.noteActivity(ids[1]); await tick();
  assert.equal(workers[1].terminated, undefined);
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
