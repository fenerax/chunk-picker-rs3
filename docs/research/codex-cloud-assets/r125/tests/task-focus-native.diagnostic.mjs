// Pure closed diagnostics. No app import, process work, raw messages or paths.
export const DIAGNOSTIC_OPERATIONS = Object.freeze(['test-start', 'test-end', 'setup', 'environment', 'playwright-import',
  'scratch-create', 'fixture-fork', 'fixture-ready', 'browser-launch', 'browser-context', 'browser-routes',
  'navigation', 'helper-gate', 'member-select', 'group-select', 'initial-render', 'show-more', 'key-observer',
  'pending', 'tab', 'cached-render', 'body-delivery', 'fresh-witness', 'focus-check', 'space', 'save', 'readback',
  'history', 'cancellation-intent', 'cleanup', 'browser-close', 'fixture-drain', 'scratch-remove',
  'fixture-environment', 'fixture-app-import', 'fixture-state-import', 'fixture-dataset-import',
  'fixture-dataset-identity', 'fixture-state-build', 'fixture-server-create', 'fixture-server-listen', 'fixture-ready-send', 'unknown']);
export const DIAGNOSTIC_NAMES = Object.freeze(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError',
  'AggregateError', 'AssertionError', 'TimeoutError', 'unknown']);
export const DIAGNOSTIC_CODES = Object.freeze(['ERR_ASSERTION', 'ERR_TEST_FAILURE', 'ERR_MODULE_NOT_FOUND',
  'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_IPC_CHANNEL_CLOSED',
  'ERR_IPC_DISCONNECTED', 'ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ENOSPC', 'ENOMEM', 'EIO', 'unknown']);
export const DIAGNOSTIC_MODULES = Object.freeze(['tests/task-focus-native-v4.test.mjs', 'tests/task-focus-native-v4.fixture.mjs',
  'tests/task-focus-native.lifecycle.mjs', 'tests/task-focus-native.observers.mjs', 'tests/task-focus-native.diagnostic.mjs',
  'app/server.mjs', 'app/datasets.mjs', 'app/dataset-runtime.mjs', 'app/dataset-pipeline.mjs', 'app/core/state.mjs',
  'app/tasks/scheduler.mjs', 'app/tasks/process-worker.mjs', 'app/storage/store.mjs', 'unknown']);
const bounded = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
export function projectRecord(record) {
  if (!record || !['failure', 'fixture-failure', 'case-start', 'case-end'].includes(record.kind)) return null;
  const out = { kind: record.kind,
    operation: DIAGNOSTIC_OPERATIONS.includes(record.operation) ? record.operation : 'unknown' };
  if (bounded(record.operationCount)) out.operationCount = record.operationCount;
  if (record.kind === 'failure' || record.kind === 'fixture-failure') {
    out.errorName = DIAGNOSTIC_NAMES.includes(record.errorName) ? record.errorName : 'unknown';
    out.errorCode = DIAGNOSTIC_CODES.includes(record.errorCode) ? record.errorCode : 'unknown';
    out.module = DIAGNOSTIC_MODULES.includes(record.module) ? record.module : 'unknown';
    out.line = out.module !== 'unknown' && bounded(record.line) ? record.line : 0;
    out.column = out.module !== 'unknown' && bounded(record.column) ? record.column : 0;
  }
  return out;
}
function publicFrame(stack) {
  if (typeof stack !== 'string' || stack.length > 65536) return {};
  // Read actual stack-frame lines only; error.message may contain forged paths.
  for (const line of stack.split('\n').slice(1)) {
    const match = /^\s+at (?:[^\n]*?\()?file:\/\/\/scratch\/r125-[A-Za-z0-9_-]+\/source\/([A-Za-z0-9_./-]+\.mjs):(\d+):(\d+)\)?$/.exec(line)
      ?? /^\s+at (?:[^\n]*?\()?\/scratch\/r125-[A-Za-z0-9_-]+\/source\/([A-Za-z0-9_./-]+\.mjs):(\d+):(\d+)\)?$/.exec(line);
    if (match && DIAGNOSTIC_MODULES.includes(match[1]) && match[1] !== 'tests/task-focus-native.diagnostic.mjs')
      return { module: match[1], line: Number(match[2]), column: Number(match[3]) };
  }
  return {};
}
export function operationTracker(emit, kind = 'failure') {
  let operation = 'test-start', operationCount = 0, failed = false, ended = false;
  const output = value => { try { const record = projectRecord(value); if (record) emit(record); } catch {} };
  if (kind !== 'fixture-failure') output({ kind: 'case-start', operation, operationCount });
  return {
    mark(value) { operation = DIAGNOSTIC_OPERATIONS.includes(value) ? value : 'unknown'; operationCount = Math.min(1000000, operationCount + 1); },
    fail(error) {
      if (failed) return; failed = true;
      output({ kind: kind === 'fixture-failure' ? kind : 'failure', operation, operationCount,
        errorName: error?.name, errorCode: error?.code, ...publicFrame(error?.stack) });
    },
    end() { if (ended) return; ended = true; if (kind !== 'fixture-failure') output({ kind: 'case-end', operation: 'test-end', operationCount }); },
  };
}
