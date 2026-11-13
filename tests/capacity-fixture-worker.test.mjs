// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { MessageChannel, Worker } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildGroups } from '../scripts/perf/capacity/fixture-pool.mjs';
import { FixtureThread } from '../scripts/perf/capacity/fixture-thread.mjs';
import { serveFixtureWorker } from '../scripts/perf/capacity/fixture-worker-runtime.mjs';
import { acquireProcessGuard } from '../app/storage/process-guard.mjs';

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

test('pool stops a booting worker cooperatively when a sibling fails initialization', async () => {
  const threads = [], created = Promise.withResolvers();
  let settled = false;
  const building = buildGroups(jobs, { workers: 2, workerData: {},
    workerFactory: () => {
      const worker = new ControlledWorker(); threads.push(worker);
      if (threads.length === 2) {
        created.resolve();
        queueMicrotask(() => worker.emit('message', { type: 'failure', message: 'Synthetic initialization failure' }));
      }
      return worker;
    },
  });
  const outcome = assert.rejects(building, /Synthetic initialization failure/).finally(() => { settled = true; });
  // Wait for the failed worker's cancellation to reach the booting sibling.
  // The sibling cannot exit until this test releases its initialization gate.
  await created.promise;
  const method = await threads[0].closing.promise;
  // Flush the pool's continuations while the explicit boot gate stays closed.
  await setImmediate();
  const returnedBeforeExit = settled;
  threads[0].boot();
  threads[1].boot();
  await outcome;
  assert.equal(method, 'stop', 'never interrupt async module initialization with terminate()');
  assert.equal(returnedBeforeExit, false);
  assert.ok(threads.every(worker => worker.exited));
});

test('a ready worker cannot start while a sibling initializes; all builds still overlap', async () => {
  const threads = [], created = Promise.withResolvers(), overlapping = Promise.withResolvers();
  let working = 0;
  const building = buildGroups(jobs, { workers: 2, workerData: {},
    workerFactory: () => {
      const worker = new ControlledWorker(), send = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        send(message);
        if (message.type === 'ack') queueMicrotask(() => worker.emit('message', { type: 'result', value: worker.job.item.index }));
      };
      threads.push(worker); if (threads.length === 2) created.resolve();
      return worker;
    },
    onProgress: async value => {
      if (value.phase !== 'work') return;
      if (++working === 2) overlapping.resolve();
      await overlapping.promise;
    } });
  await created.promise;
  threads[0].boot();
  // Drain ready/dispatch continuations while the sibling's explicit boot gate
  // stays closed. This is an event-loop barrier, with no elapsed-time check.
  await setImmediate();
  const startedDuringInitialization = threads.some(worker => worker.job);
  threads[1].boot();
  assert.deepEqual(await building, [0, 1]);
  assert.equal(startedDuringInitialization, false);
  assert.equal(working, 2);
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

test('a close failure reported during STOP keeps its cause through worker exit', async () => {
  const worker = new EventEmitter(), failures = [];
  worker.postMessage = () => {};
  const thread = new FixtureThread(worker, { onFailure: error => failures.push(error.message), onProgress: async () => {} });
  worker.emit('message', { type: 'ready' }); await thread.ready;
  const closing = assert.rejects(thread.stop(), /Synthetic context close failure/);
  worker.emit('message', { type: 'failure', message: 'Synthetic context close failure' });
  worker.emit('exit', 1);
  await closing;
  assert.equal(failures[0], 'Synthetic context close failure');
});

for (const cancel of [false, true]) test(`a rejecting fixture close exits with its guard held${cancel ? ' during STOP' : ''} and fails the pool`, async t => {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await mkdtemp(new URL('fixture-close-failure-', base));
  t.after(() => rm(root, { recursive: true, force: true }));
  const work = jobs.map(job => ({ ...job, dataDir: path.join(root, String(job.item.index)) }));
  for (const job of work) await mkdir(job.dataDir);
  const workers = [], overlap = Promise.withResolvers();
  let opened = 0;
  const building = buildGroups(work, { workers: 2, workerData: {},
    workerFactory: () => {
      const record = { messages: [] }, failClose = workers.length === 0;
      const worker = new Worker(new URL('./helpers/fixture-failing-close-worker.mjs', import.meta.url), {
        workerData: { failClose }, execArgv: [],
      });
      worker.on('message', message => record.messages.push(message));
      worker.on('exit', code => { record.exit = code; });
      workers.push(record);
      return worker;
    },
    onProgress: async (value, slot) => {
      if (value.phase !== 'synthetic-open') return;
      if (++opened === 2) overlap.resolve();
      await overlap.promise;
      if (cancel && slot === 0) throw new Error('Synthetic observer failure');
    } });
  await assert.rejects(building, cancel ? /Synthetic observer failure/ : /Synthetic context close failure/);
  assert.equal(opened, 2, 'both real guards were acquired before failure');
  assert.equal(workers[0].exit, 1, 'failed close exits despite its referenced native guard');
  assert.equal(workers[1].exit, 0, 'the sibling still drains and exits normally');
  const messages = workers[0].messages;
  assert.ok(messages.some(message => message.type === 'closing'));
  assert.ok(messages.some(message => message.type === 'failure' && message.message === 'Synthetic context close failure'));
  assert.ok(!messages.some(message => message.type === 'result'), 'a failed close never completes a group');
  for (const job of work) await (await acquireProcessGuard(job.dataDir))();
});
