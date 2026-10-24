import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FAILURE_OPERATIONS, FAILURE_ERROR_NAMES, FAILURE_ERROR_CODES,
  closedFailure, createFailureTracker,
} from './failure-diagnostics.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const operations = ['reference-navigation', 'reference-main-fulfill', 'reference-page-error',
  'measured-navigation', 'measured-page-error', 'unknown-operation'];
const secret = 'PRIVATE_SENTINEL_7f6551bfa8d94f6a';

test('diagnostic has exactly four closed fields and hashes the original secret-bearing stack', () => {
  const error = { name: secret, code: secret, message: secret,
    stack: `Error: ${secret}\n at https://example.invalid/join/${secret}\nBearer ${secret}`,
    cause: { token: secret }, [secret]: secret };
  const result = closedFailure('reference-navigation', error, operations);
  assert.deepEqual(Object.keys(result), ['failureOperation', 'errorName', 'errorCode', 'errorStackSha256']);
  assert.equal(result.errorName, 'unknown-error');
  assert.equal(result.errorCode, 'unknown');
  assert.equal(result.errorStackSha256, sha(error.stack));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(Object.isFrozen(result), true);
});

test('uppercase exception codes are not admitted by shape or by message', () => {
  const result = closedFailure('reference-navigation', {
    name: 'TimeoutError', code: 'PRIVATE_ARBITRARY_CODE', message: 'ENOENT', stack: 'original-stack',
  }, operations);
  assert.equal(result.errorName, 'timeout-error');
  assert.equal(result.errorCode, 'unknown');
  assert.equal(result.errorStackSha256, sha('original-stack'));
  assert.equal(JSON.stringify(result).includes('PRIVATE_ARBITRARY_CODE'), false);
  assert.equal(closedFailure('reference-navigation', { name: 'Error', code: 'ENOENT' }, operations).errorCode, 'ENOENT');
});

test('unknown operations never pass through and caller operation arrays are copied', () => {
  const policy = ['reference-navigation'];
  const tracker = createFailureTracker(policy);
  policy.push(secret);
  const error = new Error(secret);
  assert.throws(() => tracker.at(secret, () => { throw error; }), value => value === error);
  assert.equal(tracker.diagnostic(error).failureOperation, 'unknown-operation');
  assert.equal(JSON.stringify(tracker.diagnostic(error)).includes(secret), false);
});

test('safe property access tolerates getters, primitive throws and missing stacks', () => {
  const error = Object.create(null);
  for (const property of ['name', 'code', 'stack', 'message'])
    Object.defineProperty(error, property, { get() { throw new Error(secret); } });
  assert.deepEqual(closedFailure('reference-navigation', error, operations), {
    failureOperation: 'reference-navigation', errorName: 'unknown-error', errorCode: 'unknown', errorStackSha256: null,
  });
  const tracker = createFailureTracker(operations);
  assert.throws(() => tracker.at('reference-navigation', () => { throw secret; }), value => value === secret);
  assert.equal(JSON.stringify(tracker.diagnostic(secret)).includes(secret), false);
  assert.equal(tracker.diagnostic(secret).failureOperation, 'unknown-operation');
});

test('sync returns and throws preserve identity and bind the original stack', () => {
  const tracker = createFailureTracker(operations), original = new TypeError(secret);
  const rawStack = original.stack;
  assert.equal(tracker.at('reference-navigation', () => 42), 42);
  assert.throws(() => tracker.at('reference-navigation', () => { throw original; }), error => error === original);
  assert.deepEqual(tracker.diagnostic(original), {
    failureOperation: 'reference-navigation', errorName: 'type-error', errorCode: 'unknown', errorStackSha256: sha(rawStack),
  });
  assert.equal(tracker.diagnostic(new Error(secret)).failureOperation, 'unknown-operation');
});

test('async rejections and thenables bind to their original await seam', async () => {
  const tracker = createFailureTracker(operations), original = new Error(secret);
  await assert.rejects(tracker.at('reference-navigation', async () => { throw original; }), error => error === original);
  assert.equal(tracker.diagnostic(original).failureOperation, 'reference-navigation');
  const thenableError = new Error(secret);
  await assert.rejects(tracker.at('measured-navigation', () => ({ then(resolve, reject) { reject(thenableError); } })),
    error => error === thenableError);
  assert.equal(tracker.diagnostic(thenableError).failureOperation, 'measured-navigation');
});

test('nested await wrappers preserve the first precise operation', async () => {
  const tracker = createFailureTracker(operations), original = new Error(secret);
  await assert.rejects(tracker.at('reference-navigation', () =>
    tracker.at('reference-main-fulfill', async () => { throw original; })), error => error === original);
  assert.equal(tracker.diagnostic(original).failureOperation, 'reference-main-fulfill');
});

test('concurrent callback diagnostics do not replace the outer failure seam', async () => {
  const tracker = createFailureTracker(operations), outer = new Error(secret), callback = new Error(`${secret}-callback`);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = tracker.at('reference-navigation', async () => { await gate; throw outer; });
  tracker.recordCallback('reference-page-error', callback);
  tracker.recordCallback('measured-page-error', new Error(`${secret}-later`));
  release();
  await assert.rejects(pending, error => error === outer);
  assert.equal(tracker.diagnostic(outer).failureOperation, 'reference-navigation');
  assert.equal(tracker.callbackFailure.failureOperation, 'reference-page-error');
  assert.equal(tracker.callbackFailure.errorStackSha256, sha(callback.stack));
  assert.equal(tracker.getSnapshot().callbackFailuresObserved, 2);
  assert.equal(JSON.stringify(tracker.getSnapshot()).includes(secret), false);
  assert.equal(tracker.diagnostic(callback).failureOperation, 'unknown-operation');
});

test('callback wrapper preserves sync/async throws and latches only first callback', async () => {
  const tracker = createFailureTracker(operations), first = new Error(secret), later = new Error(`${secret}-later`);
  assert.throws(() => tracker.callback('reference-main-fulfill', () => { throw first; }), error => error === first);
  await assert.rejects(tracker.callback('measured-page-error', async () => { throw later; }), error => error === later);
  assert.equal(tracker.callbackFailure.failureOperation, 'reference-main-fulfill');
  assert.equal(tracker.diagnostic(first).failureOperation, 'unknown-operation');
  assert.equal(tracker.getSnapshot().callbackFailuresObserved, 2);
});

test('callback latch preserves a more precise nested await seam', async () => {
  const tracker = createFailureTracker([...operations, 'reference-main-route-install']);
  const original = new Error(secret);
  await assert.rejects(tracker.callback('reference-main-route-install', () =>
    tracker.at('reference-main-fulfill', () => Promise.reject(original))), error => error === original);
  assert.equal(tracker.callbackFailure.failureOperation, 'reference-main-fulfill');
  assert.equal(tracker.callbackFailure, tracker.diagnostic(original));
  assert.equal(tracker.callbackFailure.errorStackSha256, sha(original.stack));
});

test('exported policy enums are immutable finite lists and explicit operations are validated', () => {
  for (const values of [FAILURE_OPERATIONS, FAILURE_ERROR_NAMES, FAILURE_ERROR_CODES]) {
    assert.equal(Object.isFrozen(values), true);
    assert.equal(values.length, new Set(values).size);
  }
  for (const operation of ['reference-main-fulfill', 'measured-main-fulfill', 'reference-page-error',
    'measured-page-error', 'capability-survey', 'unknown-operation']) assert.equal(FAILURE_OPERATIONS.includes(operation), true);
  assert.throws(() => createFailureTracker([]), TypeError);
  assert.throws(() => createFailureTracker(['https://example.invalid/join/private']), TypeError);
  assert.throws(() => createFailureTracker(new Set(operations)), TypeError);
});
