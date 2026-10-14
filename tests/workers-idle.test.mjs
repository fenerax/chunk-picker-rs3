import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';

function clock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return { now: () => time,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      time = end;
    },
  };
}
function factory() {
  const workers = [];
  return { workers, create() {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = value => worker.messages.push(value);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    worker.finish = result => worker.emit('message', { id: worker.messages.findLast(message => message.id)?.id, result: result ?? { tasks: [] }, evaluationMs: 1 });
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [{ id: 'test' }], compileMs: 1 }));
    return worker;
  } };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
async function fixture(t) {
  const f = factory(), idleClock = clock();
  const scheduler = await createTaskScheduler({ workerFactory: f.create, idleMs: 100, idleClock });
  t.after(() => scheduler.close());
  const evaluate = key => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, key, key);
  return { ...f, idleClock, scheduler, evaluate };
}

test('idle workers release caches and wake once for coalesced requests without using restart budget', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  const initial = evaluate('same'); workers[0].finish(); await initial;
  idleClock.tick(99); assert.equal(scheduler.getHealth().ready, true);
  assert.equal((await evaluate('same')).hit, true);
  idleClock.tick(99); assert.equal(workers[0].terminated, false);
  idleClock.tick(1); await flush();
  assert.equal(workers[0].terminated, true); assert.equal(scheduler.getHealth().status, 'sleeping');
  assert.equal(scheduler.getHealth().resident, false); assert.equal(scheduler.getDiagnostics().cache.bytes, 0);
  const first = evaluate('same'), second = evaluate('same'); await flush();
  assert.equal(workers.length, 2); assert.equal(workers[1].messages.length, 1);
  workers[0].emit('exit', 1); assert.equal(scheduler.getHealth().failures, 0);
  workers[1].finish(); await Promise.all([first, second]);
  assert.equal(scheduler.getHealth().restarts, 0); assert.equal(scheduler.getHealth().idleStops, 1);
  assert.deepEqual(scheduler.catalogue, [{ id: 'test' }]);
});

test('active and queued requests survive idle expiry and receive a fresh idle period after completion', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  const first = evaluate('first'), second = evaluate('second');
  idleClock.tick(500); await flush(); assert.equal(workers[0].terminated, false);
  workers[0].finish(); await first; workers[0].finish(); await second;
  idleClock.tick(99); assert.equal(scheduler.getHealth().ready, true);
  idleClock.tick(1); await flush(); assert.equal(scheduler.getHealth().status, 'sleeping');
});

test('a compact peer promotion refreshes the foreground idle period', async t => {
  const { workers, idleClock, scheduler } = await fixture(t);
  idleClock.tick(99);
  const request = scheduler.evaluate({ revision: 0 }, 'reed', 'evaluate', undefined, 'peer', 'input', undefined, [], 'play-v1', undefined, 'duo');
  await flush();
  const bytes = Buffer.from('{"tasks":[]}'), playJSON = new SharedArrayBuffer(bytes.length); Buffer.from(playJSON).set(bytes);
  workers[1].emit('message', { id: workers[1].messages.at(-1).id, playJSON, evaluationMs: 1 }); await request;
  idleClock.tick(1); assert.equal(scheduler.getHealth().status, 'ready');
  idleClock.tick(99); await flush(); assert.equal(scheduler.getHealth().status, 'sleeping');
});

test('close racing an idle wake never creates another worker', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  idleClock.tick(100);
  const pending = evaluate('wake'); const rejected = assert.rejects(pending, /closing/);
  await scheduler.close(); await rejected; await flush();
  assert.equal(workers.length, 1); assert.equal(scheduler.getHealth().status, 'closed');
});

test('peer, death and prediction lanes all sleep; background warming does not extend their lifetime', async t => {
  const f = factory(), idleClock = clock();
  const scheduler = await createTaskScheduler({ workerFactory: f.create, idleMs: 100, idleClock });
  t.after(() => scheduler.close());
  const state = { revision: 0 };
  const peer = scheduler.evaluate(state, 'reed', 'evaluate', undefined, 'peer', 'input', undefined, [], 'play-v1', undefined, 'duo');
  const death = scheduler.evaluate(state, 'actor1', 'death-estimates', undefined, 'death', 'input');
  const prediction = scheduler.evaluate(state, 'actor1', 'predict', '100', 'prediction', 'input');
  await flush();
  assert.equal(f.workers.length, 4);
  for (const worker of f.workers.slice(1)) worker.finish(); await Promise.all([peer, death, prediction]);
  scheduler.prewarm(state, 'input', [{ memberId: 'actor1', chunkIds: ['101', '102'] }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.active, 1);
  idleClock.tick(100); await flush();
  // Unrequested background work is stopped without waiting for its calculation.
  assert.equal(f.workers.every(worker => worker.terminated), true);
  for (const worker of f.workers) if (!worker.terminated) worker.finish();
  await flush();
  const health = scheduler.getHealth();
  for (const lane of [health, health.duo, health.death, health.prediction]) assert.equal(lane.status, 'sleeping');
  assert.equal(scheduler.getDiagnostics().predictionLane.prewarm.pending, 0);
  assert.deepEqual(scheduler.prewarm(state, 'input', [{ memberId: 'actor1', chunkIds: ['103'] }]), { queued: 0 });
  assert.equal(f.workers.length, 4);
  scheduler.resumePrewarm();
  assert.equal(scheduler.prewarm(state, 'input', [{ memberId: 'actor1', chunkIds: ['103'] }]).queued, 1);
  await flush();
  assert.equal(f.workers.length, 5, 'Using tasks again permits fresh predictions after idle.');
  await new Promise(resolve => setImmediate(resolve));
  f.workers[4].finish();
});

test('a requester following active background warming prevents idle termination', async t => {
  const { workers, idleClock, scheduler } = await fixture(t), state = { revision: 0 };
  scheduler.prewarm(state, 'input', [{ memberId: 'actor1', chunkIds: ['100'] }]);
  await flush(); await new Promise(resolve => setImmediate(resolve));
  const requested = scheduler.evaluate(state, 'actor1', 'predict', '100', 'preview', 'input');
  idleClock.tick(200); await flush();
  assert.equal(workers[1].terminated, false);
  workers[1].finish({ delta: {} }); await requested;
  idleClock.tick(99); assert.equal(workers[1].terminated, false);
  idleClock.tick(1); await flush(); assert.equal(workers[1].terminated, true);
});

test('idle interval validates explicit and environment values', async () => {
  for (const idleMs of [0, -1, 1.5, NaN]) await assert.rejects(createTaskScheduler({ idleMs }), /idleMs/);
  const previous = process.env.RS3_WORKER_IDLE_MS;
  try {
    process.env.RS3_WORKER_IDLE_MS = 'invalid';
    await assert.rejects(createTaskScheduler(), /idleMs/);
  } finally {
    if (previous === undefined) delete process.env.RS3_WORKER_IDLE_MS; else process.env.RS3_WORKER_IDLE_MS = previous;
  }
});

test('an idle interval beyond native timer limits never stops a worker early', async t => {
  const f = factory(), idleClock = clock(), maximumDelay = 2147483647;
  const scheduler = await createTaskScheduler({ workerFactory: f.create, idleClock, idleMs: maximumDelay + 100 });
  t.after(() => scheduler.close());
  idleClock.tick(maximumDelay); await flush();
  assert.equal(scheduler.getHealth().status, 'ready');
  assert.equal(f.workers[0].terminated, false);
  idleClock.tick(99); await flush(); assert.equal(f.workers[0].terminated, false);
  idleClock.tick(1); await flush();
  assert.equal(scheduler.getHealth().status, 'sleeping'); assert.equal(f.workers[0].terminated, true);
});

test('the production default gives an unused worker ten full minutes', async t => {
  const previous = process.env.RS3_WORKER_IDLE_MS;
  try {
    delete process.env.RS3_WORKER_IDLE_MS;
    const f = factory(), idleClock = clock();
    const scheduler = await createTaskScheduler({ workerFactory: f.create, idleClock });
    t.after(() => scheduler.close());
    idleClock.tick(599999); await flush(); assert.equal(f.workers[0].terminated, false);
    idleClock.tick(1); await flush(); assert.equal(scheduler.getHealth().status, 'sleeping');
  } finally {
    if (previous === undefined) delete process.env.RS3_WORKER_IDLE_MS;
    else process.env.RS3_WORKER_IDLE_MS = previous;
  }
});

test('prediction-only residency reports retirement completion without foreground ready notifications', async t => {
  const f = factory(), idleClock = clock();
  const scheduler = await createTaskScheduler({ workerFactory: f.create, idleMs: 100, idleClock });
  t.after(() => scheduler.close());
  idleClock.tick(100); await flush();
  assert.equal(scheduler.getHealth().status, 'sleeping');
  const residency = [], foreground = [];
  const unsubscribeResidency = scheduler.subscribeResidency(health => residency.push(health));
  const unsubscribeForeground = scheduler.subscribe(health => foreground.push(health));
  t.after(unsubscribeResidency); t.after(unsubscribeForeground);
  const requested = scheduler.evaluate({ revision: 0 }, 'actor1', 'predict', '100', 'preview', 'input');
  await flush();
  assert.equal(f.workers.length, 2);
  assert.ok(residency.some(health => health.prediction.status === 'ready' && health.prediction.resident));
  assert.equal(foreground.length, 0, 'prediction ready must not trigger foreground readiness/SSE observers');
  let release;
  f.workers[1].terminate = () => new Promise(resolve => { release = resolve; });
  f.workers[1].finish(); await requested;
  idleClock.tick(100); await flush();
  assert.equal(residency.at(-1).prediction.status, 'sleeping');
  assert.equal(residency.at(-1).prediction.retiring, 1);
  const beforeCompletion = residency.length;
  release(); await flush();
  assert.ok(residency.length > beforeCompletion, 'termination completion announces the last retained worker release');
  assert.equal(residency.at(-1).prediction.retiring, 0);
  assert.equal(residency.at(-1).prediction.resident, false);
  assert.equal(foreground.length, 0);
});
