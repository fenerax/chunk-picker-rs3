// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import { buildGroups } from '../scripts/perf/capacity/fixture-pool.mjs';
import { FixtureThread } from '../scripts/perf/capacity/fixture-thread.mjs';
import { serveFixtureWorker } from '../scripts/perf/capacity/fixture-worker-runtime.mjs';

class ControlledWorker extends EventEmitter {
  booted = false;
  exited = false;
  messages = [];
  closing = Promise.withResolvers();
  boot() {
    this.booted = true;
    this.emit('message', { type: 'ready' });
    if (this.stopping) this.finish();
    else if (this.job) this.progress();
  }
  progress() { queueMicrotask(() => this.emit('message', { type: 'progress', id: 1, value: { phase: 'work' } })); }
  finish() {
    this.emit('message', { type: 'stopped' });
    this.exited = true;
    this.emit('exit', 0);
  }
  postMessage(message) {
    this.messages.push(message);
    assert.equal(this.exited, false, 'no parent messages after worker exit');
    if (message.type === 'build') { this.job = message.job; if (this.booted) this.progress(); }
    if (message.type === 'stop') {
      this.stopping = true; this.closing.resolve('stop');
      if (this.booted) this.finish();
    }
  }
  terminate() {
    this.closing.resolve('terminate'); this.exited = true; this.emit('exit', 1);
    return Promise.resolve(1);
  }
}
const jobs = [0, 1].map(index => ({ item: { index } }));

test('pool stops a booting worker cooperatively and waits for its natural exit', async () => {
  const threads = [], created = Promise.withResolvers();
  let settled = false;
  const building = buildGroups(jobs, { workers: 2, workerData: {},
    workerFactory: () => {
      const worker = new ControlledWorker(); threads.push(worker);
      if (threads.length === 2) { created.resolve(); queueMicrotask(() => worker.boot()); }
      return worker;
    },
    onProgress: value => { if (value.phase === 'work') throw new Error('Synthetic observer failure'); } });
  const outcome = assert.rejects(building, /Synthetic observer failure/).finally(() => { settled = true; });
  // Wait for the running worker's failure to reach the still-booting sibling.
  // The sibling cannot exit until this test releases its initialization gate.
  await created.promise;
  const method = await threads[0].closing.promise;
  // Flush the pool's continuations while the explicit boot gate stays closed.
  await setImmediate();
  const returnedBeforeExit = settled;
  threads[0].boot();
  await outcome;
  assert.equal(method, 'stop', 'never interrupt async module initialization with terminate()');
  assert.equal(returnedBeforeExit, false);
  assert.ok(threads.every(worker => worker.exited));
});

test('a progress observer resolved after worker exit cannot send a late ACK', async () => {
  const worker = new ControlledWorker(), entered = Promise.withResolvers(), observer = Promise.withResolvers();
  const thread = new FixtureThread(worker, { onFailure: assert.fail,
    onProgress: () => { entered.resolve(); return observer.promise; } });
  worker.boot(); await thread.ready;
  const outcome = assert.rejects(thread.build(jobs[0]), /stopping/);
  await entered.promise;
  await thread.stop(); await outcome;
  observer.resolve();
  // Drain the observer's continuation after the explicit exit event, with no
  // elapsed-time requirement. ControlledWorker rejects any post-exit send.
  await setImmediate();
  assert.deepEqual(worker.messages.map(message => message.type), ['build', 'stop']);
});

test('worker STOP rejects blocked progress and closes its port only after build cleanup', async t => {
  const { port1, port2 } = new MessageChannel();
  t.after(() => { port1.close(); port2.close(); });
  const cleaning = Promise.withResolvers(), release = Promise.withResolvers(), stopped = Promise.withResolvers();
  const progress = Promise.withResolvers(), messages = [];
  let cleaned = false;
  port1.on('message', message => {
    messages.push(message.type);
    if (message.type === 'progress') progress.resolve();
    if (message.type === 'stopped') stopped.resolve();
  });
  const closed = once(port1, 'close');
  serveFixtureWorker(port2, async (job, report) => {
    try { await report({ phase: 'synthetic-store-open' }); }
    finally { cleaning.resolve(); await release.promise; cleaned = true; }
  });
  port1.postMessage({ type: 'build', job: jobs[0] });
  await progress.promise;
  port1.postMessage({ type: 'stop' });
  await cleaning.promise;
  assert.deepEqual(messages, ['ready', 'progress'], 'shutdown must still be waiting for the store cleanup gate');
  release.resolve();
  await stopped.promise; await closed;
  assert.equal(cleaned, true);
  assert.deepEqual(messages, ['ready', 'progress', 'stopped']);
});
