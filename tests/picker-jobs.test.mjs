import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createTaskScheduler, pickerJobId } from '../app/tasks/scheduler.mjs';
import { createPickerContext } from '../app/picker-context.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createRateLimits, createStreamLimits, requestContext } from '../app/security/request.mjs';
import { createRepresentation, createResponseCache } from '../app/http-response.mjs';
import { createUsageRateLimit } from '../app/usage-route.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const state = (marker = 'alpha', revision = 0) => ({ ...createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['12341'] }]), revision,
  tasks: [{ id: 'rs3:task:picker-jobs', category: 'Custom', label: marker }] });
const bytes = text => { const buffer = Buffer.from(text), shared = new SharedArrayBuffer(buffer.length); Buffer.from(shared).set(buffer); return shared; };
const result = marker => ({ tasks: [], marker, metrics: { availableCount: 0 }, presentation: { tasks: [] } });
function factory() {
  const workers = [], work = [], waiters = [];
  const create = () => {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => {
      worker.messages.push(message);
      if (['cancel', 'supersede'].includes(message.type)) return;
      const item = { worker, message };
      if (waiters.length) waiters.shift()(item); else work.push(item);
    };
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate', 'predict'], compileMs: 0 }));
    return worker;
  };
  return { create, workers, next: () => work.length ? Promise.resolve(work.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
const finish = ({ worker, message }, value = result('ok'), extra = {}) => worker.emit('message', { id: message.id, result: value, evaluationMs: 0, timingMs: {}, ...extra });
async function fixture(t, options = {}) {
  const f = factory(), scheduler = await createTaskScheduler({ workerFactory: f.create, ...options });
  t.after(() => scheduler.close());
  return { ...f, scheduler, a: scheduler.forPicker(A), b: scheduler.forPicker(B) };
}
const evaluate = (scheduler, value, key = 'collision', type = 'evaluate', chunk = undefined, view = 'full', lane = 'foreground') =>
  scheduler.evaluate(value, 'one', type, chunk, key, 'same-input', undefined, [], view, undefined, lane);
const reuse = (marker, sourceRevision = 0) => ({ memberId: 'one', taskInputKey: 'f'.repeat(64), sourceRevision, priority: 2,
  playJSON: bytes(JSON.stringify(result(marker))), duoJSON: bytes('{}'), duoSidebarJSON: bytes('{}') });

async function send(context, route) {
  const request = Readable.from([]);
  Object.assign(request, { method: 'GET', url: route, socket: { remoteAddress: '127.0.0.1' }, complete: true,
    headers: { host: '127.0.0.1:8788', authorization: `Bearer ${context.store.getAccessToken()}`, 'accept-encoding': 'identity' } });
  const chunks = [], response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const headers = new Map(); response.setHeader = (key, value) => headers.set(key.toLowerCase(), value);
  response.getHeader = key => headers.get(key.toLowerCase());
  response.writeHead = (status, values = {}) => { response.statusCode = status; response.headersSent = true; for (const [key, value] of Object.entries(values)) response.setHeader(key, value); return response; };
  await context.handle(request, response);
  return { status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') };
}
async function contexts(t) {
  const f = await fixture(t), directory = await mkdtemp(path.join(tmpdir(), 'picker-jobs-'));
  const world = buildWorld(definitions), opened = [];
  const runtime = { dataset: selectedDataset, indexedWorld: world, ruleRegistry: createRuleRegistry(), taskWorker: f.scheduler,
    taskWorkerOptions: { workerFactory() {} }, parsedDefinitions: definitions, parsedTaskMap: {}, identityHistory: {}, sandboxCatalogue: [],
    xpChoiceCatalogue: { choices: [], byId: new Map() }, membersStartBanks: {}, webRoot: path.resolve('app/web'),
    requestContextFor: requestContext, limits: createRateLimits(), admitStream: createStreamLimits(), usageAdmission: createUsageRateLimit(),
    definitionCache: createRepresentation('{}'), taskCache: createRepresentation('{}'), staticCache: createResponseCache(), releaseReferences() {}, appVersion: 'synthetic' };
  t.after(async () => { await Promise.all(opened.map(context => context.close())); await rm(directory, { recursive: true, force: true }); });
  for (const [index, id] of [A, B].entries()) opened.push(await createPickerContext({ pickerId: id, dataDir: path.join(directory, String(index)),
    runtime, initialState: state(index ? 'beta' : 'alpha'), predictionPrewarm: false }));
  return { ...f, left: opened[0], right: opened[1] };
}

test('picker protocol IDs are validated and the server legacy ID has one mapping', async t => {
  assert.equal(pickerJobId('legacy'), 'legacy-shared'); assert.equal(pickerJobId(), 'legacy-shared'); assert.equal(pickerJobId(A), A);
  for (const invalid of ['', 'other', 'p_1234', '../legacy']) assert.throws(() => pickerJobId(invalid), TypeError);
  const f = await fixture(t), job = evaluate(f.scheduler.forPicker('legacy'), state());
  const work = await f.next(); assert.equal(work.message.pickerId, 'legacy-shared'); finish(work); await job;
});

test('a save in context A cannot supersede context B calculation with colliding member IDs and revisions', async t => {
  const f = await contexts(t), b = send(f.right, '/api/tasks?memberId=one');
  const work = await f.next(); assert.equal(work.message.pickerId, B);
  const changed = state('alpha changed'); await f.left.store.replace(changed, 0);
  finish(work, result('beta'));
  const response = await b; assert.equal(response.status, 200); assert.equal(response.body.marker, 'beta');
  assert.equal(f.right.store.getInfo().revision, 0); assert.equal(f.left.store.getInfo().revision, 1);
});

test('colliding task keys do not coalesce or reuse per-picker results', async t => {
  const f = await fixture(t), a = evaluate(f.a, state('alpha')), b = evaluate(f.b, state('beta'));
  const first = await f.next(); finish(first, result('alpha')); assert.equal((await a).result.marker, 'alpha');
  const second = await f.next(); assert.equal(second.message.pickerId, B); finish(second, result('beta'));
  assert.equal((await b).result.marker, 'beta');
  assert.equal((await evaluate(f.a, state('alpha'))).result.marker, 'alpha');
  assert.equal((await evaluate(f.b, state('beta'))).result.marker, 'beta');
});

test('sent serialized snapshots and display rebinds are partitioned by picker', async t => {
  const f = await fixture(t), value = state(), snapshot = { inputKey: 'same-input', stateJSON: bytes(JSON.stringify(value)) };
  const run = scope => scope.evaluate(value, 'one', 'evaluate', undefined, 'collision', 'same-input', undefined, [], 'full', snapshot);
  const a = run(f.a), first = await f.next(); assert.ok(first.message.stateJSON); finish(first); await a;
  const b = run(f.b), second = await f.next(); assert.ok(second.message.stateJSON); finish(second); await b;
  f.a.supersedeDisplay(8, 'same-input');
  const bNext = f.b.evaluate({ ...value, revision: 0 }, 'one', 'evaluate', undefined, 'another-key', 'same-input', undefined, [], 'full', snapshot);
  const next = await f.next(); assert.equal(next.message.stateJSON, undefined); assert.equal(next.message.stateRevision, 0); finish(next); await bNext;
});

test('prediction summaries, cached deltas and unlock-reuse never cross contexts', async t => {
  const f = await contexts(t), eventsA = [], eventsB = [];
  f.a.subscribePredictions(value => eventsA.push(value)); f.b.subscribePredictions(value => eventsB.push(value));
  const a = evaluate(f.a, state(), 'same', 'predict', '12342'), first = await f.next();
  const deltaA = { delta: { tasksAdded: [], marker: 'alpha' } }; finish(first, deltaA, { unlockReuse: reuse('alpha') }); await a;
  assert.equal(eventsA.length, 1); assert.equal(eventsB.length, 0);
  assert.equal(f.b.peekPrediction(state(), 'one', '12342', 'same-input'), undefined);
  f.a.setRevision(1, 'changed'); f.b.setRevision(1, 'changed');
  assert.equal(f.a.preparedEvaluation('f'.repeat(64), 'one', 1).result.marker, 'alpha');
  assert.equal(f.b.preparedEvaluation('f'.repeat(64), 'one', 1), undefined);
  const b = evaluate(f.b, state('beta', 1), 'same', 'predict', '12342'), second = await f.next();
  finish(second, { delta: { tasksAdded: [], marker: 'beta' } }, { unlockReuse: reuse('beta', 1) }); await b;
  assert.equal(eventsB.length, 1); assert.equal(eventsA.length, 1);
  f.a.setRevision(2, 'changed-again'); f.b.setRevision(2, 'changed-again');
  assert.equal(f.a.preparedEvaluation('f'.repeat(64), 'one', 2), undefined);
  assert.equal(f.b.preparedEvaluation('f'.repeat(64), 'one', 2).result.marker, 'beta');
});

test('a save in A does not detach or promote B active prediction as A saved reuse', async t => {
  const f = await fixture(t), b = evaluate(f.b, state('beta'), 'same', 'predict', '12342'), first = await f.next();
  f.a.setRevision(1, 'changed');
  finish(first, { delta: { tasksAdded: [] } }, { unlockReuse: reuse('beta') }); await b;
  assert.equal(f.a.preparedEvaluation('f'.repeat(64), 'one', 1), undefined);
  f.b.setRevision(1, 'changed'); assert.equal(f.b.preparedEvaluation('f'.repeat(64), 'one', 1).result.marker, 'beta');
});

test('prewarm aborts and ranking cancellations affect only their picker within the shared queue limits', async t => {
  const f = await fixture(t), abortA = new AbortController(), abortB = new AbortController();
  const groups = [{ memberId: 'one', chunkIds: ['12342'], purpose: 'ranking' }];
  assert.equal(f.a.prewarm(state(), 'same-input', groups, { signal: abortA.signal }).queued, 1);
  const first = await f.next();
  assert.equal(f.b.prewarm(state('beta'), 'same-input', groups, { signal: abortB.signal }).queued, 1);
  f.a.cancelRankingPrewarm(new Set()); abortA.abort();
  assert.equal(f.scheduler.getDiagnostics().predictionLane.ranking.pending, 1);
  finish(first, { cancelled: true });
  const second = await f.next(); assert.equal(second.message.pickerId, B); finish(second, { delta: { tasksAdded: [] } });
  assert.ok(f.b.peekPrediction(state('beta'), 'one', '12342', 'same-input'));
  assert.equal(f.scheduler.getDiagnostics().predictionLane.prewarm.limit, 256);
});

test('closing context A promptly abandons its active and queued jobs while B completes and late A bytes are discarded', async t => {
  const f = await contexts(t), a = send(f.left, '/api/tasks?memberId=one'), first = await f.next();
  const queued = evaluate(f.a, state(), 'queued'), queuedRejected = assert.rejects(queued, { status: 503 });
  const b = send(f.right, '/api/tasks?memberId=one');
  await Promise.race([f.left.close(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Picker close waited for calculator work.')), 2000); timer.unref(); })]);
  await queuedRejected; assert.equal((await a).status, 503);
  assert.equal(first.worker.terminated, false, 'closing one context does not close the shared worker');
  finish(first, result('late alpha'), { unlockReuse: reuse('late alpha') });
  const second = await f.next(); assert.equal(second.message.pickerId, B); finish(second, result('beta'));
  assert.equal((await b).body.marker, 'beta'); assert.equal(f.scheduler.getHealth().ready, true);
  await assert.rejects(evaluate(f.a, state()), { status: 503 });
  assert.equal((await send(f.right, '/api/tasks?memberId=one')).body.marker, 'beta');
});

test('closing A during B active work discards A queued warming without waiting for B', async t => {
  const f = await contexts(t), b = send(f.right, '/api/tasks?memberId=one'), work = await f.next();
  f.a.prewarmTasks(state(), 'same-input', ['one']);
  await f.left.close(); assert.equal(work.worker.terminated, false);
  assert.equal(f.scheduler.getDiagnostics().prewarm.pending, 0);
  finish(work, result('beta')); assert.equal((await b).body.marker, 'beta');
});


test('a picker can borrow the runtime again after close while its abandoned facade stays fenced', async t => {
  const f = await fixture(t), first = evaluate(f.a, state()), work = await f.next();
  finish(work, result('old')); await first; f.a.cancelPicker();
  const reopened = f.scheduler.forPicker(A), next = evaluate(reopened, state('new'));
  const current = await f.next(); finish(current, result('new'));
  assert.equal((await next).result.marker, 'new');
  await assert.rejects(evaluate(f.a, state()), { status: 503 });
  assert.equal(f.a.canPrewarmTasks(), false);
  assert.equal(f.a.prewarmTasks(state(), 'same-input', ['one']).queued, 0);
});


test('picker cancellation and supersession preserve snapshot LRU occupancy for other pickers', async t => {
  for (const boundary of ['close', 'save']) {
    const f = await fixture(t), value = state();
    const run = async (scope, input, key) => {
      const stateInput = { inputKey: input, stateJSON: bytes(JSON.stringify(value)) };
      const job = scope.evaluate(value, 'one', 'evaluate', undefined, key, input, undefined, [], 'full', stateInput, 'side');
      const work = await f.next(); finish(work); await job; return work.message;
    };
    await run(f.b, 'b0', 'first-b'); await run(f.a, 'a0', 'first-a');
    if (boundary === 'close') f.a.cancelPicker(); else f.a.setRevision(1, 'changed');
    await run(f.b, 'b1', 'next-b');
    const revisit = await run(f.b, 'b0', 'revisit-b');
    assert.ok(revisit.stateJSON, `${boundary}: B's evicted snapshot must be resent`);
  }
});


test('retiring A obsolete or warm work wakes already queued B without retiring or superseding B', async t => {
  for (const boundary of ['save', 'warm']) {
    const f = await fixture(t);
    let a, rejected;
    if (boundary === 'save') {
      a = evaluate(f.a, state(), 'draft', 'sandbox', {});
      rejected = assert.rejects(a, { status: 409 });
    } else f.a.prewarm(state(), 'same-input', [{ memberId: 'one', chunkIds: ['12342'] }]);
    const old = await f.next();
    const b = evaluate(f.b, state('beta'), 'draft', 'sandbox', {});
    if (boundary === 'save') f.a.setRevision(1, 'changed'); else assert.equal(f.a.retireWarmPrediction(), true);
    await rejected;
    const next = await f.next();
    assert.equal(old.worker.terminated, true); assert.notEqual(next.worker, old.worker); assert.equal(next.message.pickerId, B);
    finish(old, result('late alpha')); finish(next, result('beta'));
    assert.equal((await b).result.marker, 'beta');
  }
});
