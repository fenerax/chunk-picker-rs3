import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleReviewPreview, rulePreviewText } from '../app/web/rules-review-preview.mjs';
const request = (extra = {}) => ({ stateRevision: 2, memberId: 'a', ruleId: 'InsidePOH', value: true, ...extra });
const response = (extra = {}) => ({ format: 'sandbox-v1', stateRevision: 2, memberId: 'a', delta: { tasksAdded: [{ id: 'x', category: 'Construction' }], tasksRemoved: [] }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('preview uses Sandbox, coalesces duplicate work and caches by revision, member, rule and value', async () => {
  const calls = [], preview = createRuleReviewPreview(async (...args) => { calls.push(args); return response({ stateRevision: args[1].baseRevision, memberId: args[1].memberId }); });
  const a = preview.check(request()), b = preview.check(request()); assert.equal(a, b);
  const result = await a; assert.equal(result.added, 1); assert.match(rulePreviewText(result, 'Turning this on'), /adds 1 tasks \(Construction 1\)/);
  await preview.check(request()); assert.equal(calls.length, 1);
  await preview.check(request({ value: false }));
  await preview.check(request({ memberId: 'b' }));
  await preview.check(request({ ruleId: 'Boosting' }));
  await preview.check(request({ stateRevision: 3 })); assert.equal(calls.length, 5);
  assert.equal(calls[0][0], '/api/sandbox/evaluate');
  assert.deepEqual(calls[0][1], { memberId: 'a', baseRevision: 2, changes: { unlockChunks: [], lockChunks: [], doneTasks: [], taskRules: { InsidePOH: true } } });
});

test('moving on cancels work and queues only one evaluator even if transport ignores abort', async () => {
  const first = deferred(), calls = [];
  const preview = createRuleReviewPreview(async (...args) => { calls.push(args); return calls.length === 1 ? first.promise : response(); });
  const a = preview.check(request()); const rejected = assert.rejects(a, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  const b = preview.check(request({ value: false })); await Promise.resolve();
  assert.equal(calls.length, 1); assert.equal(calls[0][2].aborted, true);
  first.resolve(response()); await rejected; await b;
  assert.equal(calls.length, 2);
  await preview.check(request()); assert.equal(calls.length, 3, 'cancelled result is not cached');
});

test('explicit cancellation and mismatched responses are never cached', async () => {
  const preview = createRuleReviewPreview(async () => response({ memberId: 'wrong' }));
  await assert.rejects(preview.check(request()), /saved rules changed/);
  const job = preview.check(request()); preview.cancel(); await assert.rejects(job, { name: 'AbortError' });
  assert.match(rulePreviewText({ added: 0, removed: 0 }, 'Turning this on'), /no current tasks/);
});
