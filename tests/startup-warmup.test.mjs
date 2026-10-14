import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupWarmup } from '../app/tasks/startup-warmup.mjs';

function manualClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get pending() { return timers.size; },
    tick(ms = 10) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = end;
    },
  };
}

function fixture(t, overrides = {}) {
  const clock = manualClock(), calls = [];
  const metadata = { revision: 1, members: [{ id: 'actor1' }, { id: 'reed' }] };
  const control = {
    busy: false, snapshotCalls: 0,
    health: { ready: true, status: 'ready', restartRequired: false },
    diagnostic: { queue: { depth: 0, active: 0 }, prewarm: { pending: 0, active: 0 },
      predictionLane: { queue: { depth: 0, active: 0 }, prewarm: { pending: 0, active: 0 } } },
    captured: { metadata, input: 'input-a', stateInput: { stateJSON: '{"revision":1}', inputKey: 'serialized-a' } },
    admit: () => ({ queued: 0 }), ...overrides,
  };
  const worker = {
    getHealth: () => control.health,
    getDiagnostics: () => control.diagnostic,
    prewarmTasks(state, input, memberIds, options) {
      const call = { state, input, memberIds, options }; calls.push(call);
      return control.admit(call);
    },
    evaluate() { assert.fail('Startup preparation must not admit foreground evaluation.'); },
    restartUnhealthy() { assert.fail('Startup preparation must not wake or restart workers.'); },
  };
  const warmup = createStartupWarmup({ worker, clock, delayMs: 10, busy: () => control.busy,
    snapshot: () => { control.snapshotCalls++; return control.captured; } });
  t.after(() => warmup.close());
  return { clock, calls, control, warmup, metadata };
}

test('startup preparation finishes full tasks before admitting play predictions', t => {
  const f = fixture(t);
  const cached = new Set();
  f.control.admit = ({ options }) => ({ queued: cached.has(options.prediction) ? 0 : 2 });
  f.clock.tick();
  assert.deepEqual(f.warmup.diagnostics(), { status: 'running', phase: 'tasks', queued: 2 });
  assert.deepEqual(f.calls[0].memberIds, ['actor1', 'reed']);
  assert.equal(f.calls[0].options.resultView, 'full');
  assert.equal(f.calls[0].options.prediction, false);
  f.control.diagnostic.prewarm.pending = 2;
  f.clock.tick(30);
  assert.equal(f.calls.length, 1);
  f.control.diagnostic.prewarm.pending = 0;
  cached.add(false);
  f.clock.tick();
  assert.equal(f.warmup.diagnostics().phase, 'preview');
  f.clock.tick();
  assert.equal(f.calls.at(-1).options.resultView, 'play-v1');
  assert.equal(f.calls.at(-1).options.prediction, true);
  f.control.diagnostic.predictionLane.queue.active = 1;
  f.clock.tick(30);
  assert.equal(f.calls.length, 3);
  f.control.diagnostic.predictionLane.queue.active = 0;
  cached.add(true);
  f.clock.tick();
  assert.deepEqual(f.warmup.diagnostics(), { status: 'ready', phase: 'complete', queued: 4 });
  assert.equal(f.clock.pending, 0);
});

test('a sleeping predictor and an expired warm window cannot be reported as prepared', t => {
  const sleeping = fixture(t);
  sleeping.clock.tick(); // foreground cache is ready
  sleeping.control.diagnostic.predictionLane.worker = { status: 'sleeping' };
  sleeping.clock.tick();
  assert.equal(sleeping.calls.length, 1);
  assert.equal(sleeping.warmup.diagnostics().status, 'sleeping');
  assert.equal(sleeping.clock.pending, 0);
});

test('startup preparation waits for foreground quiet, worker readiness and queued work', t => {
  const f = fixture(t);
  f.control.busy = true;
  f.clock.tick(30);
  assert.equal(f.control.snapshotCalls, 0);
  f.control.busy = false;
  f.control.health.ready = false;
  f.clock.tick(30);
  assert.equal(f.control.snapshotCalls, 0);
  f.control.health.ready = true;
  for (const [group, key] of [['queue', 'depth'], ['queue', 'active'], ['prewarm', 'pending'], ['prewarm', 'active']]) {
    f.control.diagnostic[group][key] = 1;
    f.clock.tick();
    assert.equal(f.calls.length, 0);
    f.control.diagnostic[group][key] = 0;
  }
  f.clock.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.prediction, false);
});

test('native metadata and serialized state reach the warm queue without hydrating state', t => {
  const f = fixture(t);
  Object.defineProperty(f.control.captured, 'state', { get() { assert.fail('Lazy full state was read.'); } });
  f.clock.tick(20);
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.strictEqual(call.state, f.metadata);
    assert.strictEqual(call.options.stateInput, f.control.captured.stateInput);
    assert.equal(call.input, 'input-a');
  }
  assert.equal(f.warmup.diagnostics().status, 'ready');
});

test('cancelled warming is re-admitted while completed cache entries advance the phase', t => {
  const f = fixture(t);
  let cached = false;
  f.control.admit = () => ({ queued: cached ? 0 : 2 });
  f.clock.tick();
  f.control.diagnostic.prewarm.pending = 2;
  f.control.busy = true;
  f.clock.tick(30);
  assert.equal(f.calls.length, 1);
  // An interactive request cancelled the queued preparation rather than filling its cache.
  f.control.diagnostic.prewarm.pending = 0;
  f.control.busy = false;
  f.clock.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.at(-1).options.prediction, false);
  cached = true;
  f.clock.tick();
  assert.equal(f.warmup.diagnostics().phase, 'preview');
  f.clock.tick();
  assert.equal(f.warmup.diagnostics().status, 'ready');
  assert.equal(f.warmup.diagnostics().queued, 4);
});

for (const [health, status] of [
  [{ status: 'sleeping', ready: false, restartRequired: false }, 'sleeping'],
  [{ status: 'ready', ready: true, restartRequired: true }, 'unavailable'],
]) {
  test(`startup preparation stops when a worker is ${status} without waking it`, t => {
    const f = fixture(t, { health });
    f.clock.tick();
    assert.equal(f.warmup.diagnostics().status, status);
    assert.equal(f.calls.length, 0);
    assert.equal(f.control.snapshotCalls, 0);
    assert.equal(f.clock.pending, 0);
    f.control.health = { ready: true, status: 'ready', restartRequired: false };
    f.clock.tick(1000);
    assert.equal(f.calls.length, 0);
  });
}

test('closing startup preparation cancels its initial and deferred timers', t => {
  for (const deferred of [false, true]) {
    const f = fixture(t);
    if (deferred) { f.control.busy = true; f.clock.tick(); }
    assert.equal(f.clock.pending, 1);
    f.warmup.close(); f.warmup.close();
    assert.equal(f.clock.pending, 0);
    f.clock.tick(1000);
    assert.equal(f.calls.length, 0);
  }
});

test('a changed task input returns preview preparation to the full task phase', t => {
  const f = fixture(t);
  f.clock.tick();
  assert.equal(f.warmup.diagnostics().phase, 'preview');
  f.control.captured = { ...f.control.captured, input: 'input-b' };
  f.control.admit = () => ({ queued: 2 });
  f.clock.tick();
  assert.deepEqual(f.warmup.diagnostics(), { status: 'running', phase: 'tasks', queued: 2 });
  assert.equal(f.calls.at(-1).input, 'input-b');
  assert.equal(f.calls.at(-1).options.prediction, false);
  assert.equal(f.calls.at(-1).options.resultView, 'full');
});

test('repeated failed warm admissions stop after a bounded number of attempts', t => {
  const f = fixture(t, { admit: () => ({ queued: 1 }) });
  f.clock.tick(1000);
  assert.equal(f.warmup.diagnostics().status, 'unavailable');
  assert.ok(f.calls.length > 1 && f.calls.length <= 9);
  assert.equal(f.clock.pending, 0);
  const attempts = f.calls.length;
  f.clock.tick(1000);
  assert.equal(f.calls.length, attempts);
});

test('a failed snapshot or queue admission makes optional startup preparation unavailable', t => {
  for (const failSnapshot of [false, true]) {
    const f = fixture(t);
    if (failSnapshot) Object.defineProperty(f.control.captured, 'input', { get() { throw new Error('Unavailable snapshot'); } });
    else f.control.admit = () => { throw new Error('Unavailable calculator'); };
    f.clock.tick();
    assert.equal(f.warmup.diagnostics().status, 'unavailable');
    assert.equal(f.clock.pending, 0);
  }
});
