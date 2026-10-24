// Pure failure metadata. No app, provider, browser, environment or filesystem access.
import { createHash } from 'node:crypto';

const referenceOperations = [
  'reference-root-create', 'reference-child-start', 'reference-child-ready',
  'reference-witness-begin', 'reference-snapshot-before', 'reference-http-fetch',
  'reference-body-parse', 'reference-playwright-load', 'reference-browser-launch',
  'reference-browser-version', 'reference-context-create', 'reference-adapter-install',
  'reference-origin-route-install', 'reference-page-create', 'reference-main-route-install',
  'reference-main-fetch', 'reference-main-read', 'reference-main-instrument',
  'reference-main-fulfill', 'reference-navigation', 'reference-context-wait',
  'reference-open-chunk', 'reference-tasks-click', 'reference-summary-wait',
  'reference-summary-open-read', 'reference-summary-click', 'reference-all-chip-wait',
  'reference-map-read', 'reference-projection-build', 'reference-browser-close',
  'reference-snapshot-before-all', 'reference-snapshot-after-frames',
  'reference-witness-finish', 'reference-identity', 'reference-child-close',
  'reference-page-error',
];

// This is a finite default policy. A controller may instead supply its own
// predeclared finite list; operation strings are never learned from exceptions.
export const FAILURE_OPERATIONS = Object.freeze([...new Set([
  'entry-setup', 'node-version', 'harness-verify', 'fixture-read', 'source-verify',
  'source-lock-write', ...referenceOperations,
  ...referenceOperations.map(operation => operation.replace(/^reference-/, 'measured-')),
  'measured-store-copy', 'measured-main-network-install', 'measured-overlay-create',
  'measured-overlay-network-install', 'measured-overlay-navigation',
  'measured-overlay-content-wait', 'measured-overlay-content-read',
  'measured-page-front', 'measured-opening-arm', 'measured-opening-transition',
  'measured-contrast-wait', 'measured-contrast-click', 'measured-current-view-read',
  'measured-all-arm', 'measured-all-click', 'measured-all-transition',
  'measured-capture-read', 'measured-overlay-capture-read',
  'calibration-direct-fetch', 'calibration-relay-fetch', 'evidence-write',
  'final-proof-write', 'result-write', 'controller-cleanup', 'controller-deadline',
  'capability-survey', 'unknown-operation',
])]);

const errorNameMap = Object.freeze({
  Error: 'error', TypeError: 'type-error', RangeError: 'range-error',
  SyntaxError: 'syntax-error', ReferenceError: 'reference-error',
  EvalError: 'eval-error', URIError: 'uri-error', AggregateError: 'aggregate-error',
  AbortError: 'abort-error', TimeoutError: 'timeout-error',
  TargetClosedError: 'target-closed-error', ProtocolError: 'protocol-error',
});
export const FAILURE_ERROR_NAMES = Object.freeze([...Object.values(errorNameMap), 'unknown-error']);
export const FAILURE_ERROR_CODES = Object.freeze([
  'EACCES', 'EADDRINUSE', 'EADDRNOTAVAIL', 'EAGAIN', 'EAI_AGAIN',
  'EBADF', 'EBUSY', 'ECANCELED', 'ECONNABORTED', 'ECONNREFUSED',
  'ECONNRESET', 'EEXIST', 'EFAULT', 'EFBIG', 'EHOSTUNREACH', 'EINTR',
  'EINVAL', 'EIO', 'EISDIR', 'EMFILE', 'ENETDOWN', 'ENETUNREACH',
  'ENFILE', 'ENOENT', 'ENOMEM', 'ENOSPC', 'ENOSYS', 'ENOTDIR',
  'ENOTEMPTY', 'ENOTFOUND', 'ENOTSOCK', 'ENOTSUP', 'EPERM', 'EPIPE',
  'EROFS', 'ESRCH', 'ETIMEDOUT', 'EXDEV',
  'ERR_ABORTED', 'ERR_ASSERTION', 'ERR_CHILD_PROCESS_IPC_REQUIRED',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ERR_CRYPTO_HASH_FINALIZED',
  'ERR_HTTP_HEADERS_SENT', 'ERR_HTTP_INVALID_HEADER_VALUE',
  'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_INVALID_RETURN_VALUE',
  'ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED', 'ERR_IPC_ONE_PIPE',
  'ERR_MODULE_NOT_FOUND', 'ERR_NETWORK_IMPORT_DISALLOWED', 'ERR_OPERATION_FAILED',
  'ERR_OUT_OF_RANGE', 'ERR_SERVER_ALREADY_LISTEN', 'ERR_SERVER_NOT_RUNNING',
  'ERR_STREAM_DESTROYED', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_WRITE_AFTER_END',
  'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_DIR_IMPORT',
  'UND_ERR_ABORTED', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'unknown',
]);
const errorCodes = new Set(FAILURE_ERROR_CODES);
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const safeRead = (value, property) => {
  try { return objectLike(value) ? value[property] : undefined; }
  catch { return undefined; }
};

function operationPolicy(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 512
    || operations.some(operation => typeof operation !== 'string'
      || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(operation) || operation.length > 96))
    throw new TypeError('INVALID_FAILURE_OPERATIONS');
  return new Set([...operations, 'unknown-operation']);
}

function diagnose(operation, error, allowedOperations) {
  const rawName = safeRead(error, 'name'), rawCode = safeRead(error, 'code');
  const rawStack = safeRead(error, 'stack');
  return Object.freeze({
    failureOperation: allowedOperations.has(operation) ? operation : 'unknown-operation',
    errorName: typeof rawName === 'string' && Object.hasOwn(errorNameMap, rawName)
      ? errorNameMap[rawName] : 'unknown-error',
    errorCode: typeof rawCode === 'string' && errorCodes.has(rawCode) ? rawCode : 'unknown',
    errorStackSha256: typeof rawStack === 'string'
      ? createHash('sha256').update(rawStack).digest('hex') : null,
  });
}

/** Flat closed metadata only. No message/cause, arbitrary properties or raw stack. */
export function closedFailure(operation, error, allowedOperations = FAILURE_OPERATIONS) {
  return diagnose(operation, error, operationPolicy(allowedOperations));
}

// Invoke inside the try so synchronous argument/locator/getter failures and
// thenable rejections get the same binding. Preserve sync return/throw behavior.
function invoke(thunk, onFailure) {
  try {
    if (typeof thunk !== 'function') throw new TypeError('FAILURE_THUNK_REQUIRED');
    const value = thunk();
    if (objectLike(value) && typeof value.then === 'function')
      return Promise.resolve(value).catch(error => { onFailure(error); throw error; });
    return value;
  } catch (error) { onFailure(error); throw error; }
}

/** The supplied operation list must be a controller-owned constant array. */
export function createFailureTracker(operations = FAILURE_OPERATIONS) {
  const allowedOperations = operationPolicy(operations), errors = new WeakMap();
  let callbackFailure = null, callbackFailuresObserved = 0;
  const remember = (operation, error) => {
    // Never overwrite an inner, more precise seam with its outer await seam.
    if (objectLike(error) && !errors.has(error)) errors.set(error, diagnose(operation, error, allowedOperations));
  };
  const recordCallback = (operation, error) => {
    callbackFailuresObserved++;
    if (!callbackFailure) callbackFailure = objectLike(error) && errors.has(error)
      ? errors.get(error) : diagnose(operation, error, allowedOperations);
    return callbackFailure;
  };
  return Object.freeze({
    at(operation, thunk) { return invoke(thunk, error => remember(operation, error)); },
    diagnostic(error) {
      return objectLike(error) && errors.has(error) ? errors.get(error)
        : diagnose('unknown-operation', error, allowedOperations);
    },
    recordCallback,
    callback(operation, thunk) { return invoke(thunk, error => recordCallback(operation, error)); },
    get callbackFailure() { return callbackFailure; },
    getSnapshot() { return Object.freeze({ callbackFailure, callbackFailuresObserved }); },
  });
}
