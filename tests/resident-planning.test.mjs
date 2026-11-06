// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once, EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createCalculatorPool } from '../app/tasks/calculator-pool.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { buildChunkPlanningIndex, buildChunkPlanningIndexIncremental } from '../app/tasks/chunk-planning-index.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const definitions = {
  challenges: { Extra: { Alpha: { Chunks: ['12850'] }, Beta: { Objects: ['Anvil'] }, Cave: { Chunks: ['12851-1'] } } },
  drops: {}, equipment: {}, codeItems: {},
  chunks: { '12850': { Object: { Anvil: true } }, '12851': { Sections: { '1': { Object: { Anvil: true } } } } },
  clues: { easy: { '12851-1': true } }, walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
};
const world = buildWorld(definitions);
const workerData = genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface },
  skillGuideCatalogue: { skills: [], tasks: [] } });
const state = () => createGroupState(['one', 'two'].map(id => ({ id, name: 'Explorer', unlocked: ['12850'] })));
const probeURL = new URL('./fixtures/resident-planning-probe.mjs', import.meta.url);

async function fixture(t, { pool, processWorker = false, pause = false, cacheBytes } = {}) {
  const workers = [], messages = [], sent = [];
  const create = data => {
    const worker = processWorker ? new ProcessWorker(data, { probeImport: probeURL.href })
      : new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
        workerData: data, execArgv: ['--import', probeURL.href],
        env: { ...process.env, ...(cacheBytes === undefined ? {} : { RS3_CALCULATOR_CACHE_BYTES: String(cacheBytes) }) },
      });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { sent.push({ worker, message }); post(message); };
    worker.on('message', message => messages.push({ worker, message }));
    workers.push(worker); return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory: create, predictionWorkerFactory: create,
    workerData: { ...workerData, pauseResidentPlanning: pause }, ...(pool ? { maxCalculators: pool } : {}),
    fairness: { maxOutstandingJobsPerPicker: 4 }, deadlineMs: 30000 });
  t.after(() => scheduler.close());
  const scope = scheduler.forPicker(A);
  let sequence = 0;
  const evaluate = ({ scope: target = scope, value = state(), member = 'one', input = 'baseline', type = 'evaluate',
    chunk = '12851', lane = 'foreground', signal, serialized = false } = {}) => {
    let captured, inputState = value;
    if (serialized) {
      const bytes = Buffer.from(JSON.stringify(value)), stateJSON = new SharedArrayBuffer(bytes.length);
      Buffer.from(stateJSON).set(bytes);
      captured = { inputKey: input, stateJSON };
      inputState = { revision: value.revision, members: value.members.map(({ id }) => ({ id })) };
    }
    return target.evaluate(inputState, member, type, type === 'chunk-planning' ? chunk : undefined,
      'request-' + ++sequence, input, signal, [], 'play-v1', captured, lane);
  };
  return { scheduler, scope, workers, messages, sent, evaluate,
    planning: options => evaluate({ ...options, type: 'chunk-planning', lane: 'side' }) };
}
const finalMessages = f => f.messages.filter(({ message }) => message.id !== undefined && message.type !== 'progress');
function balanced(probe) {
  assert.ok(probe);
  const snapshots = probe.snapshots.map(({ owner, charge }) => ({ owner, cost: charge })).sort((a, b) => a.cost - b.cost);
  assert.deepEqual(probe.ledger.filter(row => row.owner !== 'eligibility').sort((a, b) => a.cost - b.cost), snapshots);
  for (const row of probe.snapshots) assert.ok(row.charge >= row.measured, 'charge covers the complete native graph');
  const own = probe.ledger.filter(row => row.owner === 'picker:' + A).reduce((sum, row) => sum + row.cost, 0);
  assert.ok(own <= 192 * 1024 * 1024);
  assert.ok(probe.ledger.reduce((sum, row) => sum + row.cost, 0) <= 384 * 1024 * 1024);
}

for (const options of [{}, { pool: 2 }, { pool: 1 }, { processWorker: true, pool: 2 }]) {
  test(`resident baseline uses foreground without another full evaluation ${JSON.stringify(options)}`, async t => {
    const f = await fixture(t, options);
    await f.evaluate({ serialized: true });
    const baseline = finalMessages(f).at(-1);
    assert.equal(baseline.message.probe.evaluateFull, 1);
    const planned = await f.planning({ serialized: true });
    assert.equal(planned.result.format, 'chunk-planning-v1');
    assert.equal(f.workers.length, 1, 'prediction calculator never starts');
    assert.equal(f.scheduler.getHealth().prediction.status, 'idle');
    const after = finalMessages(f).at(-1);
    assert.equal(after.worker, baseline.worker);
    assert.equal(after.message.probe.evaluateFull, 1);
    assert.equal(f.sent.at(-1).message.residentOnly, true);
    assert.ok(after.message.probe.snapshots.some(row => row.planning && row.planningCharge > 0 && row.owner === 'picker:' + A));
    assert.ok(after.message.probe.ledger.filter(row => row.owner === 'picker:' + A).reduce((sum, row) => sum + row.cost, 0)
      > baseline.message.probe.ledger.filter(row => row.owner === 'picker:' + A).reduce((sum, row) => sum + row.cost, 0));
    balanced(after.message.probe);
    // Use the same cold prediction path as before the change for the oracle.
    const oracle = await fixture(t, options);
    const expected = await oracle.planning({ serialized: true });
    assert.deepEqual(planned.result, expected.result);
    assert.equal(finalMessages(oracle).at(-1).message.probe.evaluateFull, 1);
    balanced(finalMessages(oracle).at(-1).message.probe);
    await f.planning({ chunk: '12851-1', serialized: true });
    assert.equal(finalMessages(f).at(-1).message.probe.evaluateFull, 1);
    balanced(finalMessages(f).at(-1).message.probe);
    await f.evaluate({ member: 'two', serialized: true });
    for (const chunk of ['12850', '12851', '12851-1']) {
      const secondMember = await f.planning({ member: 'two', chunk, serialized: true });
      assert.deepEqual(secondMember.result, (await oracle.planning({ member: 'two', chunk, serialized: true })).result);
      balanced(finalMessages(f).at(-1).message.probe);
    }
  });
}

test('cold, changed revision/member/input/rules/picker and evicted snapshots fall back to prediction', async t => {
  const f = await fixture(t);
  const cases = [
    {},
    { value: { ...state(), revision: 1 } },
    { member: 'two' },
    { input: 'other-input' },
    { value: { ...state(), rules: { 'chunks.members': true } } },
    { value: { ...state(), taskRules: { 'Show Best in Slot Tasks': false } } },
    { value: { ...state(), members: state().members.map(member => ({ ...member, taskRules: { 'Show Best in Slot Tasks': false } })) } },
    { scope: f.scheduler.forPicker(B) },
  ];
  // First probe is genuinely cold. Later probes all have a baseline for A/one.
  for (let i = 0; i < cases.length; i++) {
    await f.evaluate({ value: { ...state(), revision: 2 * i } });
    const foregroundCalls = finalMessages(f).filter(({ worker }) => worker === f.workers[0]).at(-1).message.probe.evaluateFull;
    const candidate = { ...cases[i], value: { ...(cases[i].value ?? state()), revision: 2 * i + (i === 1 ? 1 : 0) } };
    if (i === 0) candidate.input = 'cold-input';
    const start = f.sent.length;
    const result = await f.planning(candidate);
    assert.equal(result.result.format, 'chunk-planning-v1');
    const jobs = f.sent.slice(start).filter(({ message }) => !['cancel', 'supersede'].includes(message.type));
    assert.equal(jobs.at(-1).message.residentOnly, undefined);
    assert.notEqual(jobs.at(-1).worker, f.workers[0]);
    assert.equal(jobs.at(-1).message.type, 'chunk-planning');
    assert.equal(finalMessages(f).filter(({ worker }) => worker === f.workers[0]).at(-1).message.probe.evaluateFull, foregroundCalls);
    balanced(finalMessages(f).at(-1).message.probe);
  }
  const evicted = await fixture(t, { cacheBytes: 16 });
  await evicted.evaluate(); await evicted.planning();
  assert.equal(evicted.sent.filter(({ message }) => message.type === 'chunk-planning').at(-1).message.residentOnly, undefined);
  assert.equal(finalMessages(evicted).at(-1).message.probe.snapshots.length, 0);
  balanced(finalMessages(evicted).at(-1).message.probe);
});

test('planning growth releases the foreground snapshot when its existing owner share is full', async t => {
  const measure = await fixture(t);
  await measure.evaluate();
  const charge = finalMessages(measure).at(-1).message.probe.snapshots[0].charge;
  const f = await fixture(t, { cacheBytes: 2 * charge });
  await f.evaluate();
  assert.equal(finalMessages(f).at(-1).message.probe.snapshots.length, 1);
  const planned = await f.planning();
  const reply = finalMessages(f).at(-1).message;
  assert.equal(planned.result.format, 'chunk-planning-v1');
  assert.equal(reply.probe.evaluateFull, 1);
  assert.equal(reply.probe.snapshots.length, 0, 'index growth uses the existing admission and eviction rule');
  balanced(reply.probe);
  assert.deepEqual(planned.result, (await measure.planning()).result);
});

for (const options of [{}, { pool: 1 }, { processWorker: true, pool: 1 }]) {
  test(`foreground arriving between locations preempts partial planning ${JSON.stringify(options)}`, async t => {
    const f = await fixture(t, { ...options, pause: true });
    await f.evaluate();
    const foreground = f.workers[0];
    const paused = new Promise(resolve => foreground.on('message', message => { if (message.planningPaused) resolve(message); }));
    const planning = f.planning();
    const progress = await paused;
    assert.equal(progress.type, 'progress');
    const next = f.evaluate({ member: 'two' });
    const cancellation = f.sent.find(({ message }) => message.type === 'cancel' && message.id === progress.id);
    assert.ok(cancellation, 'foreground arrival sends cancellation before waiting');
    const resident = f.sent.find(({ message }) => message.residentOnly).message;
    assert.equal(Atomics.load(new Int32Array(resident.cancellation), 0), 1);
    await next;
    assert.equal((await planning).result.format, 'chunk-planning-v1');
    const cancelled = finalMessages(f).find(({ message }) => message.residentPlanningMiss);
    assert.ok(cancelled);
    assert.equal(cancelled.message.probe.evaluateFull, 1);
    assert.ok(cancelled.message.probe.snapshots.every(row => !row.planning), 'partial index is discarded');
    balanced(cancelled.message.probe);
    const jobs = f.sent.filter(({ message }) => !['cancel', 'supersede'].includes(message.type));
    assert.ok(jobs.some(({ message }) => message.type === 'chunk-planning' && !message.residentOnly), 'original path handles the waiter');
    assert.equal(f.scheduler.getDiagnostics().worker.restarts, 0, 'cooperative cancellation retains foreground');
  });
}

test('an abandoned resident request does not start prediction work', async t => {
  const f = await fixture(t, { pause: true });
  await f.evaluate();
  const foreground = f.workers[0], controller = new AbortController();
  const paused = new Promise(resolve => foreground.on('message', message => { if (message.planningPaused) resolve(); }));
  const cancelled = new Promise(resolve => foreground.on('message', message => { if (message.residentPlanningMiss) resolve(message); }));
  const planning = f.planning({ signal: controller.signal });
  const rejected = assert.rejects(planning, { name: 'AbortError' });
  await paused; controller.abort(); await rejected;
  balanced((await cancelled).probe);
  assert.equal(f.workers.length, 1);
  assert.equal(f.scheduler.getHealth().prediction.status, 'idle');
});

test('cancellation is checked between locations within one task and incremental output is identical', async () => {
  const result = { tasks: [{ id: 'synthetic', record: { Chunks: ['12850', '12851', '12851-1'] } }] };
  const expected = buildChunkPlanningIndex(definitions, result);
  const actual = await buildChunkPlanningIndexIncremental(definitions, result);
  assert.deepEqual(actual.byLocation, expected.byLocation);
  assert.deepEqual(actual.clueLocations, expected.clueLocations);
  let checks = 0;
  await assert.rejects(buildChunkPlanningIndexIncremental(definitions, result, undefined, () => ++checks < 4), /viewed chunk changed/);
  assert.equal(checks, 4);
});

function fakeFactory() {
  const workers = [];
  const create = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {};
    worker.finish = () => {
      const message = worker.messages.findLast(message => !['cancel', 'supersede'].includes(message.type));
      worker.emit('message', { id: message.id, pickerId: message.pickerId, result: { format: 'chunk-planning-v1' } });
    };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'chunk-planning', 'resident-chunk-planning'] }));
    return worker;
  };
  return { create, workers };
}

test('a foreground cache hit also preempts resident planning', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create });
  t.after(() => scheduler.close());
  const evaluate = (type, key) => scheduler.evaluate(state(), 'one', type, '12851', key, 'input');
  const baseline = evaluate('evaluate', 'saved'); foreground.workers[0].finish(); await baseline;
  const planning = evaluate('chunk-planning', 'planning');
  const resident = foreground.workers[0].messages.at(-1);
  assert.equal(resident.residentOnly, true);
  assert.equal((await evaluate('evaluate', 'saved')).hit, true);
  assert.equal(Atomics.load(new Int32Array(resident.cancellation), 0), 1);
  foreground.workers[0].finish();
  await new Promise(resolve => setImmediate(resolve));
  prediction.workers[0].finish();
  assert.equal((await planning).result.format, 'chunk-planning-v1');
  assert.equal(foreground.workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
});

test('a resident miss preserves the first full calculation deadline', async t => {
  const foreground = fakeFactory(), prediction = fakeFactory(), timers = [];
  const deadlineClock = { setTimeout(_callback, ms) { const timer = { ms }; timers.push(timer); return timer; }, clearTimeout() {} };
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, predictionWorkerFactory: prediction.create,
    deadlineMs: 50, firstCalculationDeadlineMs: 1000, deadlineClock, idleClock: { now: () => 0, setTimeout, clearTimeout } });
  t.after(() => scheduler.close());
  const planning = scheduler.evaluate(state(), 'one', 'chunk-planning', '12851', 'planning', 'input');
  const worker = foreground.workers[0], resident = worker.messages.at(-1);
  assert.equal(timers.at(-1).ms, 50);
  worker.emit('message', { id: resident.id, residentPlanningMiss: true });
  await new Promise(resolve => setImmediate(resolve));
  prediction.workers[0].finish(); await planning;
  const tasks = scheduler.evaluate(state(), 'one', 'evaluate', undefined, 'first', 'input');
  assert.equal(timers.at(-1).ms, 1000);
  worker.finish(); await tasks;
});

test('active and queued foreground jobs skip the resident attempt unchanged', async t => {
  for (const maxCalculators of [undefined, 1, 2]) {
    const f = fakeFactory(), prediction = fakeFactory();
    const scheduler = await createTaskScheduler({ workerFactory: f.create, predictionWorkerFactory: prediction.create, maxCalculators });
    t.after(() => scheduler.close());
    const evaluate = (type, key) => scheduler.evaluate(state(), 'one', type, '12851', key, 'input');
    const active = evaluate('evaluate', 'active');
    const queued = evaluate('evaluate', 'queued');
    const planning = evaluate('chunk-planning', 'planning');
    assert.ok(f.workers.every(worker => worker.messages.every(message => !message.residentOnly)));
    f.workers[0].finish(); await active;
    f.workers[0].finish(); await queued;
    if (maxCalculators) {
      // With one physical slot, prediction follows the queued foreground work.
      await new Promise(resolve => setImmediate(resolve));
      const worker = f.workers.find(worker => worker.messages.some(message => message.type === 'chunk-planning'));
      assert.ok(worker); worker.finish();
    } else {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(prediction.workers.length, 1); prediction.workers[0].finish();
    }
    assert.equal((await planning).result.format, 'chunk-planning-v1');
  }
});

test('pooled resident attempts never allocate or wait, including a queued foreground endpoint', async t => {
  const f = fakeFactory(), pool = createCalculatorPool({ limit: 1, workerFactory: f.create, workerData: () => ({}) });
  t.after(() => pool.close());
  const foreground = pool.createEndpoint(true), other = pool.createEndpoint(true);
  await Promise.all([once(foreground, 'message'), once(other, 'message')]);
  assert.equal(foreground.tryIdle(A, () => assert.fail('no previous calculator')), false);
  const submit = (endpoint, id) => endpoint.schedule(() => ({ pickerId: A, interactive: true }), () => endpoint.postMessage({ id, pickerId: A, type: 'evaluate' }));
  submit(foreground, 1);
  submit(other, 2);
  foreground.once('message', () => assert.equal(foreground.tryIdle(A, () => assert.fail('queued foreground')), false));
  f.workers[0].finish();
  assert.equal(foreground.tryIdle(A, () => assert.fail('busy physical calculator')), false);
  f.workers[0].finish();
  assert.equal(foreground.tryIdle(A, () => foreground.postMessage({ id: 3, pickerId: A, type: 'chunk-planning' })), true);
  f.workers[0].finish();
  assert.equal(f.workers.length, 1);
});
