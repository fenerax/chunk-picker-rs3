import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTaskScheduler, nativeWorkerInput, predictionCacheKey } from '../app/tasks/scheduler.mjs';
import { STATE_SNAPSHOT_LIMIT } from '../app/tasks/state-transfer.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Condition did not become true.'); await delay(5); }
}
function factory() {
  const workers = [];
  function create() {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    worker.finish = (result = { metrics: { availableCount: 1 } }, id = worker.messages.at(-1).id) => worker.emit('message', { id, result, evaluationMs: 2, timingMs: { engineMs: 1, totalMs: 2 } });
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 }));
    return worker;
  }
  return { create, workers };
}
function sharedBytes(text) {
  const bytes = Buffer.from(text), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes);
  return shared;
}
function finishJSON(worker, full, play = '{"format":"play-v1"}', cancelled = false) {
  const message = { id: worker.messages.at(-1).id, resultJSON: sharedBytes(full), playJSON: sharedBytes(play), cancelled,
    evaluationMs: 2, timingMs: { engineMs: 1, totalMs: 2 } };
  worker.emit('message', message);
  return message.resultJSON.byteLength + message.playJSON.byteLength
    + Buffer.byteLength(JSON.stringify({ evaluationMs: message.evaluationMs, timingMs: message.timingMs, cancelled }));
}
function finishPlay(worker, play = '{"format":"play-v1"}', duo) {
  const message = { id: worker.messages.at(-1).id, playJSON: sharedBytes(play), ...(duo === undefined ? {} : { duoJSON: sharedBytes(duo) }), cancelled: false,
    evaluationMs: 2, timingMs: { engineMs: 1, totalMs: 2 } };
  worker.emit('message', message);
  return message.playJSON.byteLength + (message.duoJSON?.byteLength ?? 0) + Buffer.byteLength(JSON.stringify({ evaluationMs: message.evaluationMs, timingMs: message.timingMs, cancelled: false }));
}
async function fixture(t, options = {}) {
  const f = factory();
  const scheduler = await createTaskScheduler({ workerFactory: f.create, firstCalculationDeadlineMs: options.deadlineMs ?? 30000, backoffMs: 10, maxBackoffMs: 20, ...options });
  t.after(() => scheduler.close());
  const evaluate = (key, revision = 0, memberId = 'actor1', signal, input = key) => scheduler.evaluate({ revision }, memberId, 'evaluate', undefined, key, input, signal);
  return { ...f, scheduler, evaluate };
}

test('claim display revisions preserve task caches and do not wake or control prediction workers', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const first = evaluate('same-input'); await until(() => workers[0].messages.length === 1);
  workers[0].finish(); await first;
  const messages = workers[0].messages.length;
  scheduler.supersedeDisplay(1, 'same-input');
  assert.equal(workers[0].messages.length, messages);
  assert.equal(scheduler.getHealth().prediction.status, 'idle');
  assert.equal(scheduler.getHealth().death.status, 'idle');
  assert.equal((await evaluate('same-input', 1)).hit, true);
  assert.equal(workers[0].messages.length, messages);
});

test('rule preparation uses tiny foreground inputs, exact rule/revision caching and isolated timings', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { shareSnapshots: true });
  const catalogue = scheduler.catalogue, rules = { 'tasks.example': true };
  const first = scheduler.prepareRules(rules, 0), follower = scheduler.prepareRules({ ...rules }, 0);
  assert.equal(workers[0].messages.length, 1);
  const message = workers[0].messages.at(-1);
  assert.deepEqual(message.state, { revision: 0, rules });
  assert.equal(message.type, 'prepare-rules');
  for (const key of ['memberId', 'snapshotKey', 'stateTransport', 'stateJSON', 'resultTransport']) assert.equal(message[key], undefined, key);
  workers[0].emit('message', { id: message.id, result: { prepared: true }, evaluationMs: 3, timingMs: { preparationMs: 2, totalMs: 3 } });
  assert.deepEqual((await first).result, { prepared: true }); assert.equal((await follower).hit, true);
  assert.equal((await scheduler.prepareRules({ ...rules }, 0)).hit, true);
  assert.equal(scheduler.getDiagnostics().timingMs.stages.preparationMs.totalMs, 2);
  assert.equal(scheduler.catalogue, catalogue);
  assert.equal(scheduler.getHealth().prediction.status, 'idle'); assert.equal(scheduler.getHealth().death.status, 'idle');
  for (const [nextRules, revision] of [[{ 'tasks.example': false }, 0], [rules, 1]]) {
    const pending = scheduler.prepareRules(nextRules, revision);
    assert.deepEqual(workers[0].messages.at(-1).state, { revision, rules: nextRules });
    workers[0].finish({ prepared: true }); await pending;
  }
  const current = evaluate('current-save', 1); workers[0].finish(); await current;
  await assert.rejects(scheduler.prepareRules(rules, -1), TypeError);
});

test('preparation cache belongs to the current worker and preparation retains the request watchdog', async t => {
  const { workers, scheduler } = await fixture(t, { deadlineMs: 50 });
  const first = scheduler.prepareRules({}, 0); workers[0].finish({ prepared: true }); await first;
  workers[0].emit('error', new Error('restart'));
  await until(() => workers.length === 2 && scheduler.getHealth().ready);
  const next = scheduler.prepareRules({}, 0);
  assert.equal(workers[1].messages.at(-1).type, 'prepare-rules');
  assert.equal(workers[1].messages.at(-1).state.revision, 0);
  await assert.rejects(next, error => error.status === 504);
  assert.equal(scheduler.getDiagnostics().counts.expired, 1);
  assert.equal(scheduler.getHealth().status, 'restarting');
});

test('a worker crash recovers with backoff; exhaustion reports restart-required and rejects later work', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { maxRestarts: 1, backoffMs: 40 });
  const first = evaluate('one'); const rejected = assert.rejects(first, /recovering/);
  workers[0].emit('error', new Error('private task data must never be diagnostic'));
  assert.equal(scheduler.getHealth().ready, false); assert.equal(scheduler.getHealth().status, 'restarting');
  await rejected; await until(() => scheduler.getHealth().ready);
  assert.equal(workers[0].terminated, true); assert.equal(workers.length, 2);
  const recovered = evaluate('two'); workers[1].finish(); await recovered;
  workers[1].emit('exit', 2);
  assert.equal(scheduler.getHealth().restartRequired, true);
  await assert.rejects(evaluate('three'), /server restart/);
  assert.equal(scheduler.getHealth().failures, 2);
  assert.ok(!JSON.stringify(scheduler.getDiagnostics()).includes('private task data'));
});

test('startup failures and startup hangs exhaust a bounded restart budget', async () => {
  let attempts = 0;
  await assert.rejects(createTaskScheduler({ workerFactory: () => { attempts++; throw new Error('bad boot'); }, backoffMs: 5, maxRestarts: 2 }), /server restart/);
  assert.equal(attempts, 3);
  let terminations = 0;
  await assert.rejects(createTaskScheduler({ workerFactory: () => { const worker = new EventEmitter(); worker.terminate = async () => { terminations++; }; return worker; }, startupDeadlineMs: 10, backoffMs: 5, maxRestarts: 1 }), /server restart/);
  assert.equal(terminations, 2);
});

test('coalescing preserves gameplay fingerprints across display revisions and cache remains bounded', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { cacheLimit: 2 });
  const one = evaluate('same', 0, 'actor1', undefined, 'gameplay');
  const follower = evaluate('same', 1, 'actor1', undefined, 'gameplay');
  assert.equal(workers[0].messages.length, 1);
  workers[0].finish(); assert.equal((await one).hit, false); assert.equal((await follower).hit, true);
  assert.equal((await evaluate('same', 2, 'actor1', undefined, 'gameplay')).hit, true);
  for (const key of ['next', 'last']) { const operation = evaluate(key, 2); workers[0].finish(); await operation; }
  const diagnostics = scheduler.getDiagnostics();
  assert.equal(diagnostics.cache.entries, 2); assert.ok(diagnostics.cache.bytes > 0);
  assert.equal(diagnostics.counts.coalesced, 1); assert.equal(diagnostics.counts.cacheHits, 1);
  assert.equal(diagnostics.timingMs.stages.engineMs.count, 3);
});

test('shared results stay lazy through coalescing, cache insertion, hits and diagnostics', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const first = evaluate('shared'), follower = evaluate('shared');
  assert.equal(workers[0].messages.at(-1).resultTransport, 'json-shared-v1');
  const bytes = finishJSON(workers[0], 'invalid JSON: must not parse during admission');
  const [one, two] = await Promise.all([first, follower]);
  assert.equal(one.hit, false); assert.equal(two.hit, true);
  assert.ok(Buffer.isBuffer(one.resultJSON)); assert.ok(Buffer.isBuffer(one.playJSON));
  assert.equal(typeof Object.getOwnPropertyDescriptor(one, 'result').get, 'function');
  assert.equal(one.resultJSON, two.resultJSON);
  const cached = await evaluate('shared');
  assert.equal(cached.hit, true); assert.equal(cached.resultJSON, one.resultJSON);
  assert.equal(typeof Object.getOwnPropertyDescriptor(cached, 'result').get, 'function');
  assert.equal(workers[0].messages.length, 1);
  assert.equal(scheduler.getDiagnostics().cache.bytes, bytes);
  assert.throws(() => cached.result, SyntaxError, 'Only a full-result consumer parses JSON');
});

test('full-result parsing is shared and memoized across transported waiters and hits', async t => {
  const { workers, evaluate } = await fixture(t);
  const first = evaluate('shared'), follower = evaluate('shared');
  finishJSON(workers[0], '{"tasks":[{"id":"known"}]}');
  const [one, two] = await Promise.all([first, follower]);
  assert.deepEqual(one.result, { tasks: [{ id: 'known' }] });
  assert.equal(one.result, two.result);
  assert.equal((await evaluate('shared')).result, one.result);
});

test('play-only results remain lazy and same caller keys cannot mix compact and full caches', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const compact = () => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'same', 'same', undefined, [], 'play-v1');
  const first = compact(), follower = compact(), full = evaluate('same');
  assert.equal(workers[0].messages.length, 1);
  assert.equal(workers[0].messages[0].resultView, 'play-v1');
  const bytes = finishPlay(workers[0], 'invalid compact JSON: admission must stay lazy');
  const [one, two] = await Promise.all([first, follower]);
  assert.equal(one.hit, false); assert.equal(two.hit, true);
  assert.equal(one.resultJSON, undefined);
  assert.ok(Buffer.isBuffer(one.playJSON));
  assert.equal(scheduler.getDiagnostics().cache.bytes, bytes);
  assert.equal(workers[0].messages.length, 2);
  assert.equal(workers[0].messages[1].resultView, 'full');
  finishJSON(workers[0], '{"full":true}');
  assert.deepEqual((await full).result, { full: true });
  const cached = await compact();
  assert.equal(cached.hit, true); assert.equal(cached.playJSON, one.playJSON);
  assert.throws(() => cached.result, SyntaxError);
  assert.deepEqual((await evaluate('same')).result, { full: true });
  await assert.rejects(scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'same', 'same', undefined, [], 'unknown'), TypeError);
});

test('serialized input sends one shared snapshot across views and bounded keys are resent after eviction', async t => {
  const { workers, scheduler } = await fixture(t);
  const metadata = { revision: 0, members: [{ id: 'actor1' }] };
  const stateJSON = sharedBytes(JSON.stringify({ schemaVersion: 1, ...metadata, rules: {}, tasks: [], history: [] }));
  const operation = (key, input = 'gameplay', view = 'full') => scheduler.evaluate(metadata, 'actor1', 'evaluate', undefined, key, input, undefined, [], view, { stateJSON, inputKey: input });
  const first = operation('same');
  assert.equal(workers[0].messages.at(-1).state, undefined);
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
  assert.equal(workers[0].messages.at(-1).stateTransport, 'json-shared-v1');
  assert.equal(workers[0].messages.at(-1).stateJSONBytes, stateJSON.byteLength);
  assert.deepEqual(workers[0].messages.at(-1).stateMemberIds, ['actor1']);
  finishJSON(workers[0], '{}'); await first;
  const compact = operation('same', 'gameplay', 'play-v1');
  assert.equal(workers[0].messages.at(-1).stateJSON, undefined);
  assert.equal(workers[0].messages.at(-1).snapshotKey, JSON.stringify([0, 'gameplay']));
  finishPlay(workers[0]); await compact;
  for (const input of ['two', 'three', 'four', 'five']) {
    const pending = operation(input, input);
    assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
    finishJSON(workers[0], '{}'); await pending;
  }
  const resend = operation('uncached-original');
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
  finishJSON(workers[0], '{}'); await resend;
  const before = workers[0].messages.length;
  await assert.rejects(scheduler.evaluate(metadata, 'actor1', 'evaluate', undefined, 'invalid', 'gameplay', undefined, [], 'full', { stateJSON, inputKey: 'different' }), TypeError);
  assert.equal(workers[0].messages.length, before);
});

test('serialized queued coalescing keys the captured revision rather than a newer display revision', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const active = evaluate('blocking', 0, 'reed');
  const captured = { revision: 0, members: [{ id: 'actor1' }] };
  const stateJSON = sharedBytes(JSON.stringify({ schemaVersion: 1, ...captured, tasks: [], history: [] }));
  const first = scheduler.evaluate(captured, 'actor1', 'evaluate', undefined, 'queued', 'gameplay', undefined, [], 'full', { stateJSON, inputKey: 'gameplay' });
  const newer = { ...captured, revision: 1 };
  const follower = scheduler.evaluate(newer, 'actor1', 'evaluate', undefined, 'queued', 'gameplay', undefined, [], 'full', {
    stateJSON: sharedBytes(JSON.stringify({ schemaVersion: 1, ...newer, tasks: [], history: [] })), inputKey: 'gameplay' });
  workers[0].finish(); await active;
  const message = workers[0].messages.at(-1);
  assert.equal(message.stateRevision, 0);
  assert.equal(message.snapshotKey, JSON.stringify([0, 'gameplay']));
  assert.equal(message.stateJSON, stateJSON);
  finishJSON(workers[0], '{}');
  assert.equal((await first).hit, false); assert.equal((await follower).hit, true);
});

test('serialized input retries resend rejected snapshots and worker recovery clears sent keys', async t => {
  const { workers, scheduler } = await fixture(t);
  const metadata = { revision: 0, members: [{ id: 'actor1' }] };
  const stateJSON = sharedBytes('{}');
  const operation = key => scheduler.evaluate(metadata, 'actor1', 'evaluate', undefined, key, 'gameplay', undefined, [], 'full', { stateJSON, inputKey: 'gameplay' });
  const first = operation('first');
  const rejected = assert.rejects(first, RangeError);
  workers[0].emit('message', { id: workers[0].messages.at(-1).id, error: { name: 'RangeError', message: 'Worker state snapshot is missing; resend its full state.' } });
  await rejected;
  const retry = operation('retry');
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
  finishJSON(workers[0], '{}'); await retry;
  workers[0].emit('error', new Error('restart'));
  await until(() => workers.length === 2 && scheduler.getHealth().ready);
  const recovered = operation('recovered');
  assert.equal(workers[1].messages.at(-1).stateJSON, stateJSON);
  finishJSON(workers[1], '{}'); await recovered;
});

test('mixed object and serialized snapshots share keys without skipping the first serialized body', async t => {
  const { workers, scheduler } = await fixture(t, { shareSnapshots: true });
  const state = { schemaVersion: 1, revision: 0, members: [{ id: 'actor1', taskRules: {} }], tasks: [], history: [], rules: {}, taskRules: {} };
  const objectInput = 'object-input';
  const metadata = { revision: 0, members: [{ id: 'actor1' }] }, stateJSON = sharedBytes(JSON.stringify(state));
  const object = key => scheduler.evaluate(state, 'actor1', 'evaluate', undefined, key, objectInput);
  const serialized = key => scheduler.evaluate(metadata, 'actor1', 'evaluate', undefined, key, serializedInput, undefined, [], 'play-v1', { stateJSON, inputKey: serializedInput });
  const first = object('object-first');
  const snapshotKey = workers[0].messages.at(-1).snapshotKey, serializedInput = JSON.parse(snapshotKey)[1];
  assert.equal(workers[0].messages.at(-1).state, state);
  finishJSON(workers[0], '{}'); await first;
  const second = serialized('serialized-first');
  assert.equal(workers[0].messages.at(-1).snapshotKey, snapshotKey);
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
  finishPlay(workers[0]); await second;
  const third = object('object-reference');
  assert.equal(workers[0].messages.at(-1).state, undefined);
  assert.equal(workers[0].messages.at(-1).stateTransport, undefined);
  finishJSON(workers[0], '{}'); await third;
  const fourth = serialized('serialized-reference');
  assert.equal(workers[0].messages.at(-1).stateJSON, undefined);
  finishPlay(workers[0]); await fourth;
});

test('display-only revisions reference the sent task input while changed inputs and area checks resend state', async t => {
  const { workers, scheduler } = await fixture(t);
  const operation = async (revision, input, type = 'evaluate', suffix = '') => {
    const metadata = { revision, members: [{ id: 'actor1' }] }, before = workers.map(worker => worker.messages.length);
    const stateJSON = sharedBytes(JSON.stringify({ schemaVersion: 1, ...metadata, notes: revision, tasks: [], history: [] }));
    const pending = scheduler.evaluate(metadata, 'actor1', type, type === 'evaluate' ? undefined : { chunkIds: ['12342'] },
      `${type}-${revision}${suffix}`, input, undefined, [], 'full', { stateJSON, inputKey: input });
    // Drafts and area checks use the advisory lane's own worker.
    const sent = () => workers.map((worker, index) => [worker, worker.messages.slice(before[index] ?? 0).find(message => message.type === type)]).find(([, message]) => message);
    await until(sent);
    const [worker, message] = sent();
    return { stateJSON, message, done: () => { if (type === 'evaluate') finishJSON(worker, '{}'); else worker.finish(undefined, message.id); return pending; } };
  };
  const first = await operation(0, 'gameplay');
  assert.equal(first.message.stateJSON, first.stateJSON); await first.done();
  scheduler.supersedeDisplay(1, 'gameplay');
  const display = await operation(1, 'gameplay');
  assert.equal(display.message.state, undefined); assert.equal(display.message.stateJSON, undefined);
  assert.equal(display.message.stateRevision, 1); assert.equal(display.message.snapshotKey, JSON.stringify([1, 'gameplay']));
  await display.done();
  const changed = await operation(2, 'changed');
  assert.equal(changed.message.stateJSON, changed.stateJSON); await changed.done();
  const draft = await operation(2, 'changed', 'sandbox');
  assert.equal(draft.message.stateJSON, draft.stateJSON); await draft.done();
  scheduler.supersedeDisplay(3, 'changed');
  const draftDisplay = await operation(3, 'changed', 'sandbox');
  assert.equal(draftDisplay.message.stateJSON, undefined); assert.equal(draftDisplay.message.snapshotKey, JSON.stringify([3, 'changed']));
  await draftDisplay.done();
  // Area checks read member preferences, so they reference only bytes parsed
  // from their own captured revision.
  const area = await operation(3, 'changed', 'area-check');
  assert.equal(area.message.stateJSON, area.stateJSON); await area.done();
  const areaRepeat = await operation(3, 'changed', 'area-check', '-repeat');
  assert.equal(areaRepeat.message.stateJSON, undefined); await areaRepeat.done();
});
test('worker errors clear snapshot knowledge before queued capacity changes and revisits', async t => {
  const { workers, scheduler } = await fixture(t);
  const metadata = { revision: 0, members: [{ id: 'actor1' }] };
  const stateJSON = sharedBytes('{}'), workerSnapshots = new Map();
  const operation = (key, input) => scheduler.evaluate(metadata, 'actor1', 'evaluate', undefined, key, input,
    undefined, [], 'full', { stateJSON, inputKey: input });
  const complete = () => {
    const message = workers[0].messages.at(-1);
    if (message.stateJSON) workerSnapshots.set(message.snapshotKey, message.stateJSON);
    assert.ok(workerSnapshots.has(message.snapshotKey), 'Referenced state must remain in the worker cache');
    const body = workerSnapshots.get(message.snapshotKey);
    workerSnapshots.delete(message.snapshotKey); workerSnapshots.set(message.snapshotKey, body);
    while (workerSnapshots.size > STATE_SNAPSHOT_LIMIT) workerSnapshots.delete(workerSnapshots.keys().next().value);
    finishJSON(workers[0], '{}');
  };
  // Fill the shared LRU exactly; B stays referenced and A is the oldest entry.
  for (const input of ['A', 'B', 'C', 'D'].slice(0, STATE_SNAPSHOT_LIMIT)) {
    const pending = operation(`initial-${input}`, input); complete(); await pending;
  }
  const failed = operation('rejected-B', 'B'), rejected = assert.rejects(failed, TypeError);
  assert.equal(workers[0].messages.at(-1).stateJSON, undefined);
  const next = operation('queued-E', 'E'), revisit = operation('queued-A', 'A');
  // Validation can reject B before touching the worker's existing LRU.
  workers[0].emit('message', { id: workers[0].messages.at(-1).id,
    error: { name: 'TypeError', message: 'Worker state metadata is invalid.' } });
  await rejected;
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON);
  complete(); await next;
  assert.ok(!workerSnapshots.has(JSON.stringify([0, 'A'])), 'Adding E evicts the worker\'s oldest snapshot');
  assert.equal(workers[0].messages.at(-1).stateJSON, stateJSON, 'An error invalidates all scheduler snapshot knowledge');
  complete(); await revisit;
  assert.equal(scheduler.getDiagnostics().counts.errors, 1);
});

test('shared cache quotas count full and play bytes together and skip oversized or cancelled results', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { cacheByteLimit: 256 });
  const full = JSON.stringify({ padding: 'f'.repeat(140) }), play = JSON.stringify({ padding: 'p'.repeat(140) });
  assert.ok(Buffer.byteLength(full) < 256 && Buffer.byteLength(play) < 256);
  const first = evaluate('oversized'); finishJSON(workers[0], full, play); await first;
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  const retry = evaluate('oversized'); finishJSON(workers[0], '{}'); await retry;
  assert.equal(scheduler.getDiagnostics().cache.entries, 1);
  const cancelled = evaluate('cancelled'); finishJSON(workers[0], '{}', '{}', true); await cancelled;
  assert.equal(scheduler.getDiagnostics().cache.entries, 1);
});

test('shared results are discarded after supersession and recovered workers still use the transport', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const stale = evaluate('stale'); const rejected = assert.rejects(stale, /superseded/);
  scheduler.supersede(1, 'new'); await rejected;
  finishJSON(workers[0], 'invalid discarded JSON');
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  workers[0].emit('error', new Error('recover'));
  await until(() => workers.length === 2 && scheduler.getHealth().ready);
  const recovered = evaluate('recovered', 1);
  assert.equal(workers[1].messages.at(-1).resultTransport, 'json-shared-v1');
  finishJSON(workers[1], '{"tasks":[]}');
  assert.deepEqual((await recovered).result, { tasks: [] });
});

test('one active plus a capped queue rejects overflow and discards superseded work', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { maxQueue: 2 });
  const active = evaluate('active', 0, 'reed');
  const old = evaluate('old', 0); const oldRejected = assert.rejects(old, /superseded/);
  const other = evaluate('other', 0, 'reed');
  await assert.rejects(evaluate('overflow', 0, 'reed'), { status: 429 });
  const newer = evaluate('newer', 1);
  await oldRejected;
  assert.equal(scheduler.getDiagnostics().queue.depth, 2);
  workers[0].finish(); await active; assert.equal(workers[0].messages.at(-1).memberId, 'reed');
  workers[0].finish(); await other; workers[0].finish(); await newer;
  assert.equal(scheduler.getDiagnostics().counts.superseded, 1);
});

test('disconnect cancels only that waiter, and abandoned queued snapshots are released', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const controller = new AbortController();
  const first = evaluate('active', 0, 'actor1', controller.signal); const rejected = assert.rejects(first, { name: 'AbortError' });
  const follower = evaluate('active'); controller.abort(); await rejected;
  assert.equal(scheduler.getDiagnostics().queue.active, 1); workers[0].finish(); await follower;
  const active = evaluate('next');
  const queuedController = new AbortController();
  const queued = evaluate('queued', 0, 'reed', queuedController.signal); const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
  queuedController.abort(); await queuedRejected;
  assert.equal(scheduler.getDiagnostics().queue.depth, 0); workers[0].finish(); await active;
});

test('active deadline restarts the worker', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { deadlineMs: 35, backoffMs: 5 });
  await assert.rejects(evaluate('hung'), { status: 504 });
  await until(() => workers.length === 2 && scheduler.getHealth().ready);
  const recovered = evaluate('recovered'); workers[1].finish(); await recovered;
  assert.equal(scheduler.getDiagnostics().counts.expired, 1);
  assert.equal(scheduler.getHealth().lastFailure.kind, 'calculation-deadline');
});

test('queued deadline during backoff releases its snapshot without another restart', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { deadlineMs: 20, backoffMs: 100, maxBackoffMs: 100 });
  workers[0].emit('error', new Error('crash'));
  await assert.rejects(evaluate('queued'), { status: 504 });
  assert.equal(scheduler.getDiagnostics().queue.depth, 0); assert.equal(scheduler.getHealth().failures, 1);
});

test('a discarded active result neither enters cache nor triggers its old deadline', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { deadlineMs: 20 });
  const operation = evaluate('old'); const rejected = assert.rejects(operation, /superseded/);
  scheduler.supersede(1, 'new'); await rejected; workers[0].finish();
  await delay(40);
  assert.equal(scheduler.getDiagnostics().cache.entries, 0); assert.equal(scheduler.getHealth().restarts, 0);
});

test('abandoned active work retains its watchdog and discards late results', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { deadlineMs: 30, backoffMs: 5 });
  const controller = new AbortController();
  const hung = evaluate('hung', 0, 'actor1', controller.signal); const rejected = assert.rejects(hung, { name: 'AbortError' });
  controller.abort(); await rejected;
  await until(() => workers.length === 2 && scheduler.getHealth().ready);
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  const operation = evaluate('okay'); workers[1].finish(); await operation;
});

test('shutdown rejects pending calculations and bounds a worker that refuses to terminate', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  workers[0].terminate = () => new Promise(() => {});
  const active = evaluate('active'); const rejected = assert.rejects(active, /closing/);
  const queued = evaluate('queued', 0, 'reed'); const queuedRejected = assert.rejects(queued, /closing/);
  const started = performance.now(); await scheduler.close(20);
  await Promise.all([rejected, queuedRejected]);
  assert.ok(performance.now() - started < 1000); assert.equal(scheduler.getHealth().status, 'closed');
  workers[0].terminate = async () => {};
});

test('a cold death lane cannot block foreground work; chunk lists coalesce independently', async t => {
  const { workers, scheduler, evaluate } = await fixture(t);
  const death = ids => scheduler.evaluate({ revision: 0 }, 'actor1', 'death-estimates', undefined, 'death', 'input', undefined, ids);
  const first = death(['12342']);
  const follower = death(['12342']);
  const other = death(['12343']);
  await until(() => workers[1]?.messages.length === 1);
  assert.deepEqual(workers[1].messages[0].chunkIds, ['12342']);
  assert.equal(scheduler.getDiagnostics().deathLane.queue.depth, 1);
  const tasks = evaluate('normal');
  assert.equal(workers[0].messages.length, 1);
  workers[0].finish(); await tasks;
  assert.equal(scheduler.getDiagnostics().deathLane.queue.active, 1);
  workers[1].finish({ estimates: [], cancelled: false });
  assert.equal((await first).hit, false); assert.equal((await follower).hit, true);
  assert.deepEqual(workers[1].messages.at(-1).chunkIds, ['12343']);
  workers[1].finish({ estimates: [], cancelled: false }); await other;
  assert.equal(scheduler.getDiagnostics().deathLane.counts.coalesced, 1);
});

test('death admissions are bounded while starting and supersession prevents stale dispatch', async t => {
  const f = factory();
  const booting = new EventEmitter(); booting.messages = [];
  booting.postMessage = message => booting.messages.push(message);
  booting.terminate = async () => {};
  const scheduler = await createTaskScheduler({ workerFactory: f.create, deathWorkerFactory: () => booting, maxDeathQueue: 1 });
  t.after(() => scheduler.close());
  const death = (revision, key) => scheduler.evaluate({ revision }, 'actor1', 'death-estimates', undefined, key, key, undefined, ['12342']);
  const old = death(0, 'old'); const rejected = assert.rejects(old, { status: 409 });
  await assert.rejects(death(0, 'overflow'), { status: 429 });
  scheduler.supersede(1, 'new'); await rejected;
  await assert.rejects(death(0, 'late-old'), { status: 409 });
  const current = death(1, 'new');
  booting.emit('message', { type: 'ready', catalogue: [] });
  assert.equal(booting.messages.length, 1);
  assert.equal(booting.messages[0].state.revision, 1);
  booting.emit('message', { id: booting.messages[0].id, result: { estimates: [], cancelled: false } }); await current;
});

test('death cancellation preserves followers and cancelled partial results never enter cache', async t => {
  const { workers, scheduler } = await fixture(t);
  const firstController = new AbortController(), followerController = new AbortController();
  const death = signal => scheduler.evaluate({ revision: 0 }, 'actor1', 'death-estimates', undefined, 'death', 'input', signal, ['12342']);
  const first = death(firstController.signal), follower = death(followerController.signal);
  const firstRejected = assert.rejects(first, { name: 'AbortError' }), followerRejected = assert.rejects(follower, { name: 'AbortError' });
  await until(() => workers[1]?.messages.length === 1);
  firstController.abort(); await firstRejected;
  assert.equal(workers[1].messages.length, 1);
  followerController.abort(); await followerRejected;
  assert.deepEqual(workers[1].messages.at(-1), { id: 1, type: 'cancel' });
  workers[1].finish({ estimates: [], cancelled: true });
  assert.equal(scheduler.getDiagnostics().deathLane.cache.entries, 0);
  const partial = death(); workers[1].finish({ estimates: [], cancelled: true }); await partial;
  assert.equal(scheduler.getDiagnostics().deathLane.cache.entries, 0);
});

test('death failures and deadlines leave the foreground worker available', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, { maxRestarts: 0, deathDeadlineMs: 25, firstCalculationDeadlineMs: 25 });
  const dead = scheduler.evaluate({ revision: 0 }, 'actor1', 'death-estimates', undefined, 'death', 'input', undefined, ['12342']);
  await assert.rejects(dead, { status: 504 });
  assert.equal(scheduler.getHealth().death.restartRequired, true);
  assert.equal(scheduler.getHealth().ready, true);
  assert.equal(workers[0].terminated, false);
  const normal = evaluate('normal'); workers[0].finish(); await normal;
});

test('death startup exhaustion reports separately while foreground work keeps running', async t => {
  const { workers, scheduler, evaluate } = await fixture(t, {
    maxRestarts: 0, deathWorkerFactory: () => { throw new Error('Boot failure'); },
  });
  await assert.rejects(scheduler.evaluate({ revision: 0 }, 'actor1', 'death-estimates', undefined, 'death', 'input', undefined, ['12342']), { status: 503 });
  assert.equal(scheduler.getHealth().death.restartRequired, true);
  assert.equal(scheduler.getHealth().ready, true);
  const normal = evaluate('normal'); workers[0].finish(); await normal;
});

test('closing during death startup rejects admissions and terminates both lanes', async t => {
  const f = factory(), booting = new EventEmitter(); let terminated = false;
  booting.postMessage = () => {}; booting.terminate = async () => { terminated = true; };
  const scheduler = await createTaskScheduler({ workerFactory: f.create, deathWorkerFactory: () => booting });
  t.after(() => scheduler.close());
  const death = scheduler.evaluate({ revision: 0 }, 'actor1', 'death-estimates', undefined, 'death', 'input', undefined, ['12342']);
  const rejected = assert.rejects(death, /closing/);
  await scheduler.close(); await rejected;
  assert.equal(terminated, true); assert.equal(f.workers[0].terminated, true);
  booting.emit('message', { type: 'ready', catalogue: [] });
  assert.equal(scheduler.getHealth().death.status, 'closed');
});

test('duo worker starts only for explicit peers and overlaps foreground without occupying advisory workers', async t => {
  const peers = factory(), { workers, scheduler, evaluate } = await fixture(t, { duoWorkerFactory: peers.create });
  assert.equal(peers.workers.length, 0);
  const foreground = evaluate('own', 5, 'actor1', undefined, 'gameplay');
  assert.equal(peers.workers.length, 0);
  const state = { revision: 5 }, peer = () => scheduler.evaluate(state, 'reed', 'evaluate', undefined, 'peer', 'gameplay', undefined, [], 'play-v1', undefined, 'duo');
  const first = peer(), coalesced = peer();
  await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
  assert.equal(workers[0].messages.at(-1).memberId, 'actor1'); assert.equal(workers[0].messages.at(-1).duoProjection, undefined);
  assert.equal(peers.workers[0].messages.at(-1).memberId, 'reed'); assert.equal(peers.workers[0].messages.at(-1).duoProjection, true);
  assert.equal(peers.workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  assert.equal(scheduler.getHealth().prediction.status, 'idle'); assert.equal(scheduler.getHealth().death.status, 'idle');
  assert.equal(scheduler.getDiagnostics().duoLane.queue.active, 1);
  assert.equal(peers.workers[0].messages.at(-1).resultView, 'play-v1');
  finishPlay(peers.workers[0]); await Promise.all([first, coalesced]);
  assert.equal((await peer()).hit, true);
  assert.equal(scheduler.getDiagnostics().queue.active, 1, 'Foreground remains independently active.');
  workers[0].finish(); await foreground;
  await scheduler.close(); assert.equal(peers.workers[0].terminated, true);
});

test('duo lane validates routing and globally supersedes old peers when another member saves', async t => {
  const peers = factory(), { scheduler } = await fixture(t, { duoWorkerFactory: peers.create });
  await assert.rejects(scheduler.evaluate({ revision: 5 }, 'reed', 'predict', '100', 'x', 'gameplay', undefined, [], 'play-v1', undefined, 'duo'), /Invalid task evaluation lane/);
  assert.equal(peers.workers.length, 0);
  const pending = scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, 'old', 'before', undefined, [], 'play-v1', undefined, 'duo');
  const rejected = assert.rejects(pending, error => error.status === 409);
  await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
  scheduler.supersede(6, 'after', 'actor1'); await rejected;
  await assert.rejects(scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, 'old', 'before', undefined, [], 'play-v1', undefined, 'duo'), error => error.status === 409);
});


test('peer completion promotes lazy compact bytes for map switches while full details still evaluate', async t => {
  const peers = factory(), { workers, scheduler } = await fixture(t, { duoWorkerFactory: peers.create });
  const request = (view = 'play-v1', lane = 'foreground', key = 'peer') => scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, key, 'gameplay', undefined, [], view, undefined, lane);
  const peer = request('play-v1', 'duo');
  await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
  assert.equal(peers.workers[0].messages.at(-1).resultView, 'play-v1');
  const bytes = finishPlay(peers.workers[0], 'unparsed play JSON', 'unparsed thin JSON');
  const initial = await peer; assert.equal(initial.hit, false);
  const compact = await request(), peerAgain = await request('play-v1', 'duo');
  assert.equal(compact.hit, true); assert.equal(peerAgain.hit, true);
  assert.equal(compact.resultJSON, undefined); assert.equal(compact.playJSON, initial.playJSON);
  assert.equal(compact.duoJSON, initial.duoJSON); assert.equal(peerAgain.duoJSON, initial.duoJSON);
  assert.equal(scheduler.getDiagnostics().duoLane.cache.bytes, bytes);
  assert.equal(scheduler.getDiagnostics().cache.bytes, bytes);
  assert.equal(workers[0].messages.length, 0, 'Completed peer switches require no foreground evaluation.');
  assert.equal(peers.workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  assert.equal(scheduler.getDiagnostics().counts.cacheHits, 2); assert.equal(scheduler.getDiagnostics().counts.promoted, 1);
  assert.throws(() => compact.result, SyntaxError, 'Promotion never parsed the compact payload.');
  const detail = request('full');
  assert.equal(workers[0].messages.at(-1).resultView, 'full'); finishJSON(workers[0], '{"tasks":[]}'); await detail;
  const different = request('play-v1', 'foreground', 'different-gameplay');
  assert.equal(workers[0].messages.at(-1).resultView, 'play-v1'); finishPlay(workers[0]); await different;
});

test('peer requests reuse existing foreground full buffers before creating a duo worker', async t => {
  const peers = factory(), { workers, scheduler } = await fixture(t, { duoWorkerFactory: peers.create });
  const full = scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, 'same-key', 'gameplay');
  finishJSON(workers[0], '{"tasks":[]}', '{"format":"play-v1"}'); await full;
  const peer = await scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, 'same-key', 'gameplay', undefined, [], 'play-v1', undefined, 'duo');
  assert.equal(peer.hit, true); assert.equal(peer.resultJSON, undefined); assert.equal(peers.workers.length, 0);
  assert.equal(scheduler.getDiagnostics().counts.cacheHits, 1);
});

test('compact promotion obeys existing foreground count and byte limits', async t => {
  for (const large of [false, true]) {
    const peers = factory(), { workers, scheduler, evaluate } = await fixture(t, { duoWorkerFactory: peers.create, cacheLimit: 1, cacheByteLimit: 200 });
    const old = evaluate('old', 5); finishPlay(workers[0]); await old;
    const key = 'bounded', peer = scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, key, 'gameplay', undefined, [], 'play-v1', undefined, 'duo');
    await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
    finishPlay(peers.workers[0], large ? JSON.stringify({ large: 'x'.repeat(500) }) : '{"format":"play-v1"}'); await peer;
    assert.equal(scheduler.getDiagnostics().cache.entries, 1); assert.ok(scheduler.getDiagnostics().cache.bytes <= 200);
    assert.equal(scheduler.getDiagnostics().counts.promoted, large ? 0 : 1);
    const compact = scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, key, 'gameplay', undefined, [], 'play-v1');
    if (large) finishPlay(workers[0]);
    assert.equal((await compact).hit, !large);
  }
});

test('aborted, cancelled and overtaken peer results never enter foreground cache', async t => {
  for (const transition of ['abort', 'cancelled', 'revision']) {
    const peers = factory(), { scheduler } = await fixture(t, { duoWorkerFactory: peers.create });
    const controller = new AbortController(), key = transition;
    const peer = scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, key, 'before', controller.signal, [], 'play-v1', undefined, 'duo');
    await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
    if (transition === 'abort') {
      const rejected = assert.rejects(peer, error => error.name === 'AbortError'); controller.abort(); await rejected;
    }
    if (transition === 'revision') {
      const rejected = assert.rejects(peer, error => error.status === 409); scheduler.supersede(6, 'after', 'actor1'); await rejected;
    }
    const message = peers.workers[0].messages.at(-1);
    peers.workers[0].emit('message', { id: message.id, playJSON: sharedBytes('{"format":"play-v1"}'), cancelled: transition === 'cancelled', evaluationMs: 2 });
    if (transition === 'cancelled') await peer;
    assert.equal(scheduler.getDiagnostics().cache.entries, 0); assert.equal(scheduler.getDiagnostics().counts.promoted, 0);
  }
});


test('optional peer bytes count against both duo and promoted foreground byte limits', async t => {
  const peers = factory(), { workers, scheduler } = await fixture(t, { duoWorkerFactory: peers.create, duoCacheBytes: 200, cacheByteLimit: 200 });
  const request = lane => scheduler.evaluate({ revision: 5 }, 'reed', 'evaluate', undefined, 'thin-overflow', 'gameplay', undefined, [], 'play-v1', undefined, lane);
  const peer = request('duo'); await until(() => peers.workers[0]?.messages.some(message => message.type === 'evaluate'));
  finishPlay(peers.workers[0], '{"format":"play-v1"}', 'x'.repeat(500)); await peer;
  assert.equal(scheduler.getDiagnostics().duoLane.cache.entries, 0); assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  assert.equal(scheduler.getDiagnostics().counts.promoted, 0);
  const ordinary = request('foreground'); assert.equal(workers[0].messages.at(-1).duoProjection, undefined);
  finishPlay(workers[0]); assert.equal((await ordinary).hit, false);
});

function finishSidebar(worker, sidebar = 'unparsed sidebar JSON', play = 'unparsed ordinary JSON', duo = 'unparsed peer JSON') {
  const message = { id: worker.messages.at(-1).id, playJSON: sharedBytes(play), duoSidebarJSON: sharedBytes(sidebar), duoJSON: sharedBytes(duo), cancelled: false,
    evaluationMs: 2, timingMs: { engineMs: 1, totalMs: 2 } };
  worker.emit('message', message);
  return message.playJSON.byteLength + message.duoSidebarJSON.byteLength + message.duoJSON.byteLength
    + Buffer.byteLength(JSON.stringify({ evaluationMs: message.evaluationMs, timingMs: message.timingMs, cancelled: false }));
}

test('sidebar projection is optional, shares the ordinary key and retains all lazy byte buffers', async t => {
  const { scheduler, workers } = await fixture(t);
  const request = projected => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'sidebar', 'gameplay', undefined, [], 'play-v1', undefined, 'foreground', projected);
  const projected = request(true), ordinary = request(false);
  assert.equal(workers[0].messages.at(-1).duoSidebarProjection, true); assert.equal(workers[0].messages.at(-1).duoProjection, undefined);
  const bytes = finishSidebar(workers[0]), [one, two] = await Promise.all([projected, ordinary]);
  assert.equal(one.hit, false); assert.equal(two.hit, true); assert.equal(two.duoSidebarJSON, one.duoSidebarJSON);
  assert.equal(two.playJSON, one.playJSON); assert.equal(scheduler.getDiagnostics().cache.bytes, bytes);
  const normalHit = await request(false), sidebarHit = await request(true);
  assert.equal(normalHit.hit, true); assert.equal(sidebarHit.hit, true); assert.equal(sidebarHit.duoSidebarJSON, one.duoSidebarJSON);
  assert.equal(normalHit.playJSON, one.playJSON); assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
  assert.throws(() => normalHit.result, SyntaxError, 'Lazy result remains the ordinary compact payload');
});

test('sidebar callers coalesce with active normal requests and reuse old normal cache entries without rerunning', async t => {
  const { scheduler, workers } = await fixture(t);
  const request = projected => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'normal-first', 'gameplay', undefined, [], 'play-v1', undefined, 'foreground', projected);
  const ordinary = request(false), projected = request(true);
  assert.equal(workers[0].messages.at(-1).duoSidebarProjection, undefined);
  finishPlay(workers[0]); const [one, two] = await Promise.all([ordinary, projected]);
  assert.equal(one.duoSidebarJSON, undefined); assert.equal(two.duoSidebarJSON, undefined); assert.equal(two.playJSON, one.playJSON);
  const cached = await request(true); assert.equal(cached.hit, true); assert.equal(cached.duoSidebarJSON, undefined);
  assert.equal(workers[0].messages.filter(message => message.type === 'evaluate').length, 1);
});

test('a sidebar follower can add its projection while a same-key normal request is still queued', async t => {
  const { scheduler, workers, evaluate } = await fixture(t);
  const blocker = evaluate('blocker');
  const request = projected => scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'queued-sidebar', 'gameplay', undefined, [], 'play-v1', undefined, 'foreground', projected);
  const ordinary = request(false), projected = request(true);
  workers[0].finish(); await blocker; assert.equal(workers[0].messages.at(-1).duoSidebarProjection, true);
  finishSidebar(workers[0]); const [one, two] = await Promise.all([ordinary, projected]); assert.equal(one.duoSidebarJSON, two.duoSidebarJSON);
});

test('sidebar projection rejects incompatible modes and extra sidebar bytes obey cache quotas', async t => {
  const { scheduler, workers } = await fixture(t, { cacheByteLimit: 200 });
  for (const [type, view, lane, flag] of [['predict', 'play-v1', 'foreground', true], ['evaluate', 'full', 'foreground', true], ['evaluate', 'play-v1', 'duo', true], ['evaluate', 'play-v1', 'foreground', 'true']]) {
    await assert.rejects(scheduler.evaluate({ revision: 0 }, 'actor1', type, undefined, 'invalid', 'gameplay', undefined, [], view, undefined, lane, flag), /Invalid duo sidebar projection/);
  }
  assert.equal(workers[0].messages.length, 0); assert.equal(scheduler.getHealth().duo.status, 'idle');
  const projected = scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'large-sidebar', 'gameplay', undefined, [], 'play-v1', undefined, 'foreground', true);
  finishSidebar(workers[0], 'x'.repeat(500), '{"format":"play-v1"}', ''); await projected;
  assert.equal(scheduler.getDiagnostics().cache.entries, 0);
  const ordinary = scheduler.evaluate({ revision: 0 }, 'actor1', 'evaluate', undefined, 'large-sidebar', 'gameplay', undefined, [], 'play-v1');
  assert.equal(workers[0].messages.at(-1).duoSidebarProjection, undefined); finishPlay(workers[0]); assert.equal((await ordinary).hit, false);
});

test('chunk planning and full side hydration never occupy the saved-list lane', async t => {
  const prediction = factory();
  const { workers, scheduler } = await fixture(t, { predictionWorkerFactory: prediction.create });
  const state = { revision: 0, members: [{ id: 'actor1' }, { id: 'reed' }] };
  const planning = scheduler.evaluate(state, 'actor1', 'chunk-planning', '12342', 'planning', 'before');
  const obsolete = assert.rejects(planning, { status: 409 });
  await until(() => prediction.workers[0]?.messages.some(message => message.type === 'chunk-planning'));
  assert.equal(workers[0].messages.length, 0);
  const saved = scheduler.evaluate({ ...state, revision: 1 }, 'actor1', 'evaluate', undefined, 'saved', 'after', undefined, [], 'play-v1');
  assert.equal(workers[0].messages.at(-1).resultView, 'play-v1', 'New saved work dispatches while obsolete planning still runs');
  await obsolete;
  assert.equal(Atomics.load(new Int32Array(prediction.workers[0].messages.find(message => message.type === 'chunk-planning').cancellation), 0), 1);
  finishPlay(workers[0]); await saved;
  prediction.workers[0].finish();
  const full = scheduler.evaluate({ ...state, revision: 1 }, 'actor1', 'evaluate', undefined, 'details', 'after', undefined, [], 'full', undefined, 'side');
  assert.equal(prediction.workers[0].messages.at(-1).resultView, 'full');
  const compact = scheduler.evaluate({ ...state, revision: 2 }, 'actor1', 'evaluate', undefined, 'next', 'next', undefined, [], 'play-v1');
  const fullRejected = assert.rejects(full, { status: 409 });
  assert.equal(workers[0].messages.at(-1).input, 'next');
  finishPlay(workers[0]); await compact; await fullRejected; prediction.workers[0].finish();
});

test('native worker input always sets the ready-catalogue flag without changing the caller data', () => {
  const workerData = { datasetDigest: 'a'.repeat(64), omitReadyCatalogue: true };
  assert.deepEqual(nativeWorkerInput(workerData, true), { datasetDigest: 'a'.repeat(64), omitReadyCatalogue: false });
  assert.deepEqual(nativeWorkerInput(workerData, false), { datasetDigest: 'a'.repeat(64), omitReadyCatalogue: true });
  assert.deepEqual(nativeWorkerInput(undefined, false), { omitReadyCatalogue: true });
  assert.equal(workerData.omitReadyCatalogue, true);
});
