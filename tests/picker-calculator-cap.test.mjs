import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createPickerContext } from '../app/picker-context.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createRateLimits, createStreamLimits, requestContext } from '../app/security/request.mjs';
import { createRepresentation, createResponseCache } from '../app/http-response.mjs';
import { createUsageRateLimit } from '../app/usage-route.mjs';

const ids = Array.from({ length: 8 }, (_, i) => 'p_' + (i + 1).toString(16).repeat(32));
const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const state = (marker = 'alpha', revision = 0) => ({ ...createGroupState([{ id: 'one', name: 'Player 1', unlocked: ['12341'] }]), revision,
  tasks: [{ id: 'rs3:task:cap', category: 'Custom', label: marker }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
function factory({ delayedTermination = false, failOnCreate } = {}) {
  const workers = [], jobs = [], waiters = [];
  let live = 0, peak = 0, attempts = 0;
  const create = () => {
    if (++attempts === failOnCreate) throw new Error('Synthetic calculator creation failure.');
    const worker = new EventEmitter(); worker.messages = []; live++; peak = Math.max(peak, live);
    worker.postMessage = message => {
      worker.messages.push(message);
      if (['cancel', 'supersede'].includes(message.type)) return;
      const item = { worker, message };
      if (waiters.length) waiters.shift()(item); else jobs.push(item);
    };
    worker.exit = () => { if (worker.exited) return; worker.exited = true; live--; worker.emit('exit', 1); worker.resolveExit?.(); };
    worker.terminate = () => {
      worker.terminated = true;
      if (!delayedTermination) worker.exit();
      return worker.exited ? Promise.resolve() : new Promise(resolve => { worker.resolveExit = resolve; });
    };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'predict', 'sandbox', 'death-estimates'], compileMs: 0 }));
    return worker;
  };
  return { create, workers, jobs, get live() { return live; }, get peak() { return peak; },
    next: () => jobs.length ? Promise.resolve(jobs.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
const finish = ({ worker, message }, marker = message.pickerId) => worker.emit('message', { id: message.id, pickerId: message.pickerId,
  result: { marker, delta: { tasksAdded: [] } }, evaluationMs: 0 });
const evaluate = (scope, key, type = 'evaluate', lane = 'foreground', value = state()) =>
  scope.evaluate(value, 'one', type, type === 'predict' ? '12342' : undefined, key, 'input', undefined, [], lane === 'duo' ? 'play-v1' : 'full', undefined, lane);
async function fixture(t, options = {}, factoryOptions) {
  const f = factory(factoryOptions), scheduler = await createTaskScheduler({ maxCalculators: 2, maxQueue: 64,
    maxPredictionQueue: 32, maxDeathQueue: 32, maxDuoQueue: 32,
    fairness: { maxOutstandingJobsPerPicker: 8 }, backoffMs: 1, workerFactory: f.create, ...options });
  t.after(async () => { for (const worker of f.workers) worker.exit(); await scheduler.close(); });
  return { f, scheduler, scopes: ids.map(id => scheduler.forPicker(id)) };
}
async function contexts(t, scheduler) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-cap-')), opened = [];
  const runtime = { dataset: selectedDataset, indexedWorld: buildWorld(definitions), ruleRegistry: createRuleRegistry(), taskWorker: scheduler,
    taskWorkerOptions: { workerFactory() {} }, parsedDefinitions: definitions, parsedTaskMap: {}, identityHistory: {}, sandboxCatalogue: [],
    xpChoiceCatalogue: { choices: [], byId: new Map() }, membersStartBanks: {}, webRoot: path.resolve('app/web'),
    requestContextFor: requestContext, limits: createRateLimits(), admitStream: createStreamLimits(), usageAdmission: createUsageRateLimit(),
    definitionCache: createRepresentation('{}'), taskCache: createRepresentation('{}'), staticCache: createResponseCache(), releaseReferences() {}, appVersion: 'synthetic' };
  t.after(async () => { await Promise.all(opened.map(context => context.close())); await rm(root, { recursive: true, force: true }); });
  for (const id of ids) opened.push(await createPickerContext({ pickerId: id, dataDir: path.join(root, id), runtime,
    initialState: state(id), predictionPrewarm: false }));
  return opened;
}

test('eight open contexts keep all four busy lanes under one calculator cap', { timeout: 15000 }, async t => {
  for (const cap of [1, 2, 3]) {
    const { f, scheduler, scopes } = await fixture(t, { maxCalculators: cap });
    await contexts(t, scheduler);
    const pending = [];
    for (let round = 0; round < 3; round++) {
      for (const scope of scopes) for (const [type, lane] of [['evaluate', 'foreground'], ['predict', 'foreground'], ['death-estimates', 'foreground'], ['evaluate', 'duo']]) {
        pending.push(evaluate(scope, `${round}-${type}-${lane}`, type, lane));
      }
      for (let i = 0; i < 32; i++) {
        const work = await f.next(); assert.ok(f.live <= cap); finish(work);
        assert.ok(scheduler.getDiagnostics().calculators.resident <= cap);
      }
      await Promise.all(pending);
    }
    assert.equal(f.peak, cap);
  }
});

test('interactive A goes ahead of B queued background work across lanes', { timeout: 5000 }, async t => {
  const { f, scopes: [a, b, c] } = await fixture(t, { maxCalculators: 1 });
  const blocker = evaluate(c, 'blocker', 'death-estimates'), busy = await f.next();
  b.prewarm(state(), 'input', [{ memberId: 'one', chunkIds: ['12342', '12343', '12344'] }]);
  const requested = evaluate(a, 'requested');
  finish(busy); await blocker;
  const next = await f.next(); assert.equal(next.message.pickerId, ids[0]); finish(next); await requested;
  const background = await f.next(); assert.equal(background.message.pickerId, ids[1]);
  b.cancelPrewarm(); finish(background);
});

test('interactive A goes ahead of B warming within the same lane', async t => {
  const { f, scopes: [a, b, c] } = await fixture(t, { maxCalculators: 1 });
  const blocker = evaluate(c, 'blocker'), busy = await f.next();
  b.prewarmTasks(state(), 'input', ['one']);
  const requested = evaluate(a, 'requested'); finish(busy); await blocker;
  const next = await f.next(); assert.equal(next.message.pickerId, ids[0]); finish(next); await requested;
  b.cancelPrewarm(); if (f.jobs.length) finish(await f.next());
});

test('per-picker interactive admission displaces its queued warming in another lane', async t => {
  const { f, scopes: [a, b] } = await fixture(t, { maxCalculators: 1, fairness: { maxOutstandingJobsPerPicker: 1 } });
  const blocker = evaluate(b, 'blocker'), busy = await f.next();
  assert.equal(a.prewarm(state(), 'input', [{ memberId: 'one', chunkIds: ['12342'] }]).queued, 1);
  const requested = evaluate(a, 'requested'); finish(busy); await blocker;
  const next = await f.next(); assert.equal(next.message.type, 'evaluate'); finish(next); await requested;
});

test('context close cancels only its queued and active jobs and a new handle can use its share', async t => {
  const { f, scheduler, scopes: [a, b] } = await fixture(t, { maxCalculators: 1 });
  const opened = await contexts(t, scheduler);
  const active = evaluate(a, 'active'), rejected = assert.rejects(active, { status: 503 });
  const old = await f.next(), queued = evaluate(a, 'queued'), queuedRejected = assert.rejects(queued, { status: 503 });
  const surviving = evaluate(b, 'same'); await opened[0].close(); await rejected; await queuedRejected;
  finish(old, 'late'); const next = await f.next(); assert.equal(next.message.pickerId, ids[1]); finish(next, 'beta');
  assert.equal((await surviving).result.marker, 'beta');
  await assert.rejects(evaluate(a, 'closed'), { status: 503 });
  const reopened = scheduler.forPicker(ids[0]), request = evaluate(reopened, 'new'); finish(await f.next(), 'alpha');
  assert.equal((await request).result.marker, 'alpha'); assert.equal(f.peak, 1);
});

test('crash recovery waits for actual exit and rejects stale or wrong-picker results', async t => {
  const { f, scheduler, scopes: [a, b] } = await fixture(t, { maxCalculators: 1 }, { delayedTermination: true });
  const active = evaluate(a, 'same'), rejected = assert.rejects(active, { status: 503 });
  const old = await f.next(), surviving = evaluate(b, 'same', 'predict');
  old.worker.emit('error', new Error('synthetic crash')); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.workers.length, 1); assert.equal(f.live, 1);
  old.worker.exit(); const next = await f.next(); assert.notEqual(next.worker, old.worker); assert.equal(f.peak, 1);
  finish(old, 'stale'); next.worker.emit('message', { id: next.message.id, pickerId: ids[0], result: { marker: 'wrong' } });
  finish(next, 'beta'); assert.equal((await surviving).result.marker, 'beta');
  const retried = evaluate(a, 'retry'), current = await f.next(); finish(current, 'alpha'); assert.equal((await retried).result.marker, 'alpha');
  assert.equal(scheduler.getDiagnostics().calculators.peak, 1);
});

test('pooled snapshot hints follow one physical LRU across lanes and pickers', async t => {
  const { f, scopes: [a, b, c] } = await fixture(t, { maxCalculators: 1 });
  const value = state(), data = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(data.length); Buffer.from(stateJSON).set(data);
  const run = (scope, key, lane) => scope.evaluate(value, 'one', 'evaluate', undefined, key, 'input', undefined, [], 'full', { inputKey: 'input', stateJSON }, lane);
  for (const [scope, lane, key, fresh] of [[a, 'foreground', '1', true], [b, 'side', '2', true], [a, 'foreground', '3', false],
    [c, 'side', '4', true], [b, 'side', '5', true], [a, 'foreground', '6', true]]) {
    const promise = run(scope, key, lane), work = await f.next(); assert.equal(!!work.message.stateJSON, fresh); finish(work); await promise;
  }
  assert.equal(f.workers.length, 1);
});

test('snapshot references never follow a picker to a different physical calculator', async t => {
  const { f, scopes: [a] } = await fixture(t);
  const value = state(), data = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(data.length); Buffer.from(stateJSON).set(data);
  const run = (key, lane) => a.evaluate(value, 'one', 'evaluate', undefined, key, 'input', undefined, [], 'full', { inputKey: 'input', stateJSON }, lane);
  let foreground, advisory;
  for (const [key, lane, fresh] of [['1', 'foreground', true], ['2', 'side', true], ['3', 'foreground', false], ['4', 'side', false]]) {
    const promise = run(key, lane), work = await f.next(); assert.equal(!!work.message.stateJSON, fresh);
    if (lane === 'foreground') { foreground ??= work.worker; assert.equal(work.worker, foreground); }
    else { advisory ??= work.worker; assert.equal(work.worker, advisory); }
    finish(work); await promise;
  }
  assert.notEqual(foreground, advisory); assert.equal(f.peak, 2);
});

test('picker close invalidates its hints on every physical calculator without dropping another picker LRU positions', async t => {
  const { f, scheduler, scopes: [a, b] } = await fixture(t);
  const value = state(), data = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(data.length); Buffer.from(stateJSON).set(data);
  const run = async (scope, key, lane) => {
    const job = scope.evaluate(value, 'one', 'evaluate', undefined, key, 'input', undefined, [], 'full', { inputKey: 'input', stateJSON }, lane);
    const work = await f.next(); finish(work); await job; return work.message;
  };
  for (const lane of ['foreground', 'side']) { await run(a, 'a-'+lane, lane); await run(b, 'b-'+lane, lane); }
  a.cancelPicker(); const reopened = scheduler.forPicker(ids[0]);
  for (const lane of ['foreground', 'side']) {
    assert.equal((await run(b, 'again-b-'+lane, lane)).stateJSON, undefined);
    assert.ok((await run(reopened, 'new-a-'+lane, lane)).stateJSON);
  }
});

test('absent cap preserves START calculator count and independent lanes', async t => {
  const { f, scheduler, scopes: [a] } = await fixture(t, { maxCalculators: undefined, fairness: undefined });
  const requests = [evaluate(a, 'fg'), evaluate(a, 'predict', 'predict'), evaluate(a, 'death', 'death-estimates'), evaluate(a, 'duo', 'evaluate', 'duo')];
  const jobs = await Promise.all(requests.map(() => f.next()));
  assert.equal(new Set(jobs.map(job => job.worker)).size, 4); assert.equal(f.live, 4);
  for (const work of jobs) finish(work); await Promise.all(requests);
  assert.equal(scheduler.getDiagnostics().calculators, undefined);
  for (const lane of ['deathLane', 'predictionLane', 'duoLane']) assert.equal(scheduler.getDiagnostics()[lane].worker.resident, true);
});

test('calculator cap rejects invalid values before creating any calculator', async () => {
  const f = factory();
  for (const maxCalculators of [0, -1, 1.5, NaN, '2']) await assert.rejects(createTaskScheduler({ maxCalculators, workerFactory: f.create }), TypeError);
  assert.equal(f.workers.length, 0);
});

for (const mode of ['process', 'thread']) test(`${mode} calculators share compiled workers with isolated picker snapshots and results`, { timeout: 15000 }, async t => {
  const { ProcessWorker } = await import('../app/tasks/process-worker.mjs');
  const { Worker } = await import('node:worker_threads');
  const { genericWorkerData } = await import('./helpers/worker-dataset.mjs');
  const data = { ...definitions, challenges: { Extra: Object.fromEntries(ids.map((_, index) => [`Goal${index}`, { Chunks: ['12341'] }])) } };
  const world = buildWorld(data), workers = [];
  const scheduler = await createTaskScheduler({ maxCalculators: 2, fairness: {}, maxQueue: 32,
    workerData: genericWorkerData({ definitions: data, world: { chunks: world.chunks, surface: world.surface } }),
    workerFactory: input => {
      const worker = mode === 'process' ? new ProcessWorker(input) : new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: input });
      workers.push(worker); return worker;
    } });
  t.after(() => scheduler.close());
  assert.equal(scheduler.catalogue.filter(task => task.id.startsWith('rs3:Extra:Goal')).length, 8);
  const scopes = ids.map(id => scheduler.forPicker(id));
  const jobs = scopes.map((scope, index) => {
    const value = state(`value-${index}`);
    value.members[0].completedTasks = [`rs3:Extra:Goal${index}`];
    const bytes = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(bytes.length); Buffer.from(stateJSON).set(bytes);
    return scope.evaluate(value, 'one', 'evaluate', undefined, 'same', 'same', undefined, [], 'full', { inputKey: 'same', stateJSON });
  });
  const results = await Promise.all(jobs);
  for (const [index, result] of results.entries()) {
    assert.deepEqual(result.result.tasks.filter(task => task.personalCompleted).map(task => task.id), [`rs3:Extra:Goal${index}`]);
  }
  // Exercise native references across mixed transports on one advisory worker.
  const value = state('value-0');
  const bytes = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(bytes.length); Buffer.from(stateJSON).set(bytes);
  const side = key => scopes[0].evaluate(value, 'one', 'evaluate', undefined, key, 'same', undefined, [], 'full', { inputKey: 'same', stateJSON }, 'side');
  const [baseline] = await Promise.all([side('side-first'), evaluate(scopes[1], 'fg')]);
  await side('side-reference');
  await evaluate(scopes[0], 'prediction', 'predict', 'foreground', value);
  const referenced = await side('side-after-object');
  assert.equal(referenced.result.tasks.length, 8);
  assert.deepEqual(referenced.result.tasks, baseline.result.tasks);
  assert.equal(workers.length, 2); assert.equal(scheduler.getDiagnostics().calculators.peak, 2);
  assert.equal(scheduler.catalogue.filter(task => task.id.startsWith('rs3:Extra:Goal')).length, 8);
});

test('one calculator crash leaves an independently executing picker result intact', async t => {
  const { f, scopes: [a, b] } = await fixture(t);
  const first = evaluate(a, 'same'), rejected = assert.rejects(first, { status: 503 }), old = await f.next();
  const second = evaluate(b, 'same', 'predict'), running = await f.next();
  old.worker.emit('error', new Error('synthetic crash')); await rejected;
  finish(running, 'beta'); assert.equal((await second).result.marker, 'beta');
  const retry = evaluate(a, 'retry'), work = await f.next(); finish(work, 'alpha');
  assert.equal((await retry).result.marker, 'alpha'); assert.ok(f.peak <= 2);
});

test('aborted bootstrap retires its calculator and does not leak a pool', async () => {
  let worker, exited = false;
  const controller = new AbortController();
  const creating = createTaskScheduler({ maxCalculators: 1, signal: controller.signal, workerFactory: () => {
    worker = new EventEmitter(); worker.postMessage = () => {};
    worker.terminate = async () => { exited = true; worker.emit('exit', 0); };
    queueMicrotask(() => controller.abort()); return worker;
  } });
  await assert.rejects(creating, { name: 'AbortError' }); assert.equal(exited, true);
});

test('a failing bootstrap retries without exceeding the physical cap', async t => {
  let count = 0, live = 0, peak = 0;
  const scheduler = await createTaskScheduler({ maxCalculators: 1, backoffMs: 1, workerFactory: () => {
    const worker = new EventEmitter(); live++; peak = Math.max(peak, live); const attempt = ++count;
    worker.postMessage = () => {};
    worker.terminate = async () => { live--; worker.emit('exit', 0); };
    queueMicrotask(() => attempt === 1 ? worker.emit('error', new Error('synthetic startup failure'))
      : worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'] }));
    return worker;
  } });
  t.after(() => scheduler.close()); assert.equal(count, 2); assert.equal(peak, 1);
});

for (const sameLane of [false, true]) test(`active unrequested warming yields to another picker interactive request (${sameLane ? 'same' : 'different'} lane)`, async t => {
  const { f, scopes: [a, b] } = await fixture(t, { maxCalculators: 1 }, { delayedTermination: true });
  if (sameLane) b.prewarmTasks(state(), 'input', ['one']);
  else b.prewarm(state(), 'input', [{ memberId: 'one', chunkIds: ['12342', '12343'] }]);
  const old = await f.next(), requested = evaluate(a, 'interactive');
  await tick(); assert.equal(old.worker.terminated, true); assert.equal(f.live, 1);
  old.worker.exit(); const work = await f.next(); assert.equal(work.message.pickerId, ids[0]);
  finish(old, 'stale'); finish(work, 'alpha'); assert.equal((await requested).result.marker, 'alpha');
  assert.equal(f.peak, 1); b.cancelPrewarm(); if (f.jobs.length) finish(await f.next());
});

test('a rejected termination cannot release an unproven physical slot', async t => {
  const { f, scheduler, scopes: [a, b] } = await fixture(t, { maxCalculators: 1 });
  const active = evaluate(a, 'first'), rejected = assert.rejects(active, { status: 503 }), old = await f.next();
  old.worker.terminate = async () => { throw new Error('synthetic termination failure'); };
  const surviving = evaluate(b, 'second', 'predict'); old.worker.emit('error', new Error('synthetic crash')); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.workers.length, 1); assert.equal(scheduler.getDiagnostics().calculators.resident, 1);
  old.worker.exit(); const work = await f.next(); finish(work, 'beta');
  assert.equal((await surviving).result.marker, 'beta'); assert.equal(f.peak, 1);
});

test('a later calculator creation failure recovers while another picker keeps its active job', async t => {
  const { f, scopes: [a, b] } = await fixture(t, {}, { failOnCreate: 2 });
  const first = evaluate(a, 'first'), running = await f.next();
  const second = evaluate(b, 'second', 'predict'), retried = await f.next();
  assert.equal(running.worker.exited, undefined); finish(retried, 'beta');
  assert.equal((await second).result.marker, 'beta'); finish(running, 'alpha');
  assert.equal((await first).result.marker, 'alpha'); assert.equal(f.peak, 2);
});

test('advisory queues preserve a ready foreground calculator for another picker interactive work', async t => {
  const { f, scopes: [a, b, c] } = await fixture(t);
  const first = evaluate(a, 'first'), foreground = await f.next(); finish(foreground); await first;
  const prediction = evaluate(b, 'prediction', 'predict'), advisory = await f.next();
  const death = evaluate(a, 'death', 'death-estimates');
  const interactive = evaluate(c, 'interactive'), ready = await f.next();
  assert.equal(ready.worker, foreground.worker); assert.equal(ready.message.pickerId, ids[2]); finish(ready); await interactive;
  assert.equal(f.jobs.length, 0); finish(advisory); await prediction;
  const next = await f.next(); assert.equal(next.worker, advisory.worker); assert.equal(next.message.type, 'death-estimates');
  finish(next); await death; assert.equal(f.peak, 2);
});
