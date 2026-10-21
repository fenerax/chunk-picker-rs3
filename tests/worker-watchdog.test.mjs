import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';

function clock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return { now: () => time, setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } } };
}
function factory() {
  const workers = [];
  return { workers, create() {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = value => worker.messages.push(value);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    worker.progress = id => worker.emit('message', { type: 'progress', id: id ?? worker.messages.findLast(message => message.id)?.id });
    worker.finish = () => worker.emit('message', { id: worker.messages.findLast(message => message.id)?.id, result: { tasks: [] } });
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  } };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function fixture(t, options = {}) {
  const f = factory(), idleClock = clock();
  const scheduler = await createTaskScheduler({ workerFactory: f.create, idleClock, deadlineMs: 600000, startupDeadlineMs: 600000, ...options });
  t.after(() => scheduler.close());
  const evaluate = (key, lane = 'foreground') => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, key, key, undefined, [], lane === 'duo' ? 'play-v1' : 'full', undefined, lane);
  return { ...f, idleClock, scheduler, evaluate };
}

test('health finds active and queued work over two minutes without completing progress messages', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  const first = evaluate('first'), second = evaluate('second');
  idleClock.tick(120000); assert.equal(scheduler.getHealth().stuck, false);
  workers[0].progress(999); idleClock.tick(1);
  assert.equal(scheduler.getHealth().stuck, true);
  assert.equal(scheduler.getHealth().queuedMs, 120001);
  workers[0].progress(); assert.equal(scheduler.getHealth().stuck, false);
  assert.equal(scheduler.getDiagnostics().queue.active, 1);
  idleClock.tick(120001); assert.equal(scheduler.getHealth().stuck, true);
  workers[0].finish(); await first;
  assert.equal(scheduler.getHealth().stuck, false);
  workers[0].finish(); await second;
});

test('sleeping workers remain healthy and both health and recovery leave every lane unallocated', async t => {
  const { workers, idleClock, scheduler } = await fixture(t, { idleMs: 100 });
  idleClock.tick(100); await flush(); idleClock.tick(3600000);
  for (let i = 0; i < 5; i++) {
    assert.equal(scheduler.getHealth().status, 'sleeping'); assert.equal(scheduler.getHealth().stuck, false);
    assert.equal(scheduler.getHealth().resident, false);
    assert.deepEqual((await scheduler.restartUnhealthy()).restarted, []);
  }
  assert.equal(workers.length, 1);
});

test('worker-only recovery rejects old waiters and ignores retired progress before a clean retry', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  const first = evaluate('first'), second = evaluate('second');
  const rejected = [assert.rejects(first, /restarted/), assert.rejects(second, /restarted/)];
  idleClock.tick(120001);
  const [a, b] = await Promise.all([scheduler.restartUnhealthy(), scheduler.restartUnhealthy()]);
  await Promise.all(rejected); await flush();
  assert.equal(a.restarted.length + b.restarted.length, 1);
  assert.equal(workers.length, 2); assert.equal(workers[0].terminated, true);
  assert.equal(scheduler.getHealth().stuck, false);
  const retry = evaluate('first'); idleClock.tick(120001);
  workers[0].progress(); assert.equal(scheduler.getHealth().stuck, true);
  workers[1].finish(); await retry; assert.equal(scheduler.getHealth().stuck, false);
});

test('a stalled peer is visible while the foreground sleeps and only that peer is replaced', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t, { idleMs: 100 });
  const peer = evaluate('peer', 'duo'), rejected = assert.rejects(peer, /restarted/);
  await flush(); idleClock.tick(120001); await flush();
  assert.equal(scheduler.getHealth().status, 'sleeping'); assert.equal(scheduler.getHealth().duo.stuck, true);
  assert.equal(scheduler.getHealth().stuck, true);
  assert.deepEqual((await scheduler.restartUnhealthy()).restarted, ['duo']); await rejected;
  assert.equal(workers.length, 3); assert.equal(scheduler.getHealth().status, 'sleeping');
});

test('the watchdog can recover after automatic worker retries are exhausted', async t => {
  const { workers, scheduler } = await fixture(t, { maxRestarts: 0 });
  workers[0].emit('error', new Error('private error'));
  assert.equal(scheduler.getHealth().restartRequired, true);
  assert.deepEqual((await scheduler.restartUnhealthy()).restarted, ['foreground']); await flush();
  assert.equal(scheduler.getHealth().restartRequired, false); assert.equal(workers.length, 2);
});

test('replacement waits for old memory to retire and concurrent checks share that retirement', async t => {
  const { workers, idleClock, scheduler, evaluate } = await fixture(t);
  let retired;
  workers[0].terminate = () => new Promise(resolve => { retired = resolve; });
  const pending = evaluate('held'), rejected = assert.rejects(pending, /restarted/);
  idleClock.tick(120001);
  const first = scheduler.restartUnhealthy(), second = scheduler.restartUnhealthy(); await flush();
  assert.equal(workers.length, 1); assert.equal(scheduler.getHealth().recovering, true);
  retired();
  const results = await Promise.all([first, second]); await rejected;
  assert.equal(results.flatMap(value => value.restarted).length, 1); assert.equal(workers.length, 2);
});
