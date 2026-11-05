import path from 'node:path';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { constants as osConstants } from 'node:os';
import { datasetIdentity, telemetryAttempt, warnTelemetry } from '../test-telemetry.mjs';
export { datasetIdentity } from '../test-telemetry.mjs';

const duration = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
const errorNames = new Set(['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError', 'AggregateError', 'AssertionError', 'AbortError', 'DOMException', 'SystemError']);
// These are finite public vocabularies, not spelling rules: custom error fields
// can contain credentials or hostnames even when they look like Node errors.
const errorCodes = new Set([...Object.keys(osConstants.errno), 'ERR_ASSERTION', 'ERR_BUFFER_TOO_LARGE',
  'ERR_INVALID_ARG_TYPE', 'ERR_MODULE_NOT_FOUND', 'ERR_TEST_CANCELLED', 'ERR_TEST_FAILURE',
  'ERR_WORKER_INIT_FAILED', 'ERR_WORKER_OUT_OF_MEMORY', 'ERR_ZSTD_GENERIC']);
const failureTypes = new Set(['testCodeFailure', 'subtestsFailed', 'cancelledByParent', 'testTimeoutFailure',
  'hookFailed', 'parentAlreadyFinished', 'testAborted', 'uncaughtException', 'unhandledRejection',
  'callbackAndPromisePresent', 'multipleCallbackInvocations', 'asyncActivity']);
const redacted = '[redacted]';
const publicErrorValue = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : redacted;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Public vocabulary only. Never inspect, stringify or enumerate free-form
// payloads, including message, stack, actual/expected and primitive causes.
export function errorRedactor() {
  const visit = (error, depth, seen) => {
    if (error == null) return null;
    if (depth >= 8 || seen.has(error)) return { message: '[cause truncated]' };
    if (typeof error !== 'object') return { message: redacted };
    seen.add(error);
    const record = { message: redacted };
    for (const [key, allowed] of [
      ['name', errorNames],
      ['code', errorCodes],
      ['failureType', failureTypes],
    ]) {
      const value = error[key];
      if (value !== undefined) record[key] = publicErrorValue(value, allowed);
    }
    const cause = error.cause;
    if (cause !== undefined) record.cause = visit(cause, depth + 1, seen);
    return record;
  };
  return error => telemetryAttempt(() => visit(error, 0, new Set())) ?? (error == null ? null : { message: redacted });
}

const emptyAttempt = () => ({ outcome: 'not-admitted', admittedAt: null, completedAt: null, queueWaitMs: null,
  processWallMs: null, fileWallMs: null, bodyMs: null, datasetId: null, datasetDigest: null, datasets: [],
  solo: null, concurrency: null, errors: [] });

/** One logical receipt per selected file. The append-only journal is durable
 * after each synchronous write, including SIGKILL (no exit handler required).
 * A torn final line is ignored; all earlier records remain independently valid.
 */
export function readFileLedger(source) {
  const lines = source.split('\n');
  if (lines.at(-1) !== '') lines.pop();
  const records = lines.filter(Boolean).map(line => JSON.parse(line));
  const header = records.shift();
  if (header?.schema !== 'rs3-file-ledger-v1') throw Error('Invalid file ledger');
  const receipts = new Map(header.files.map(file => [file, { file, firstAttempt: emptyAttempt(), retry: null }]));
  let summary = null;
  for (const record of records) {
    if (record.type === 'summary') { summary = record; continue; }
    const receipt = receipts.get(record.file);
    if (!receipt || ![1, 2].includes(record.attempt)) throw Error('Unexpected file ledger record');
    const key = record.attempt === 1 ? 'firstAttempt' : 'retry';
    receipt[key] ??= emptyAttempt();
    Object.assign(receipt[key], record.value);
  }
  return { ...header, receipts: [...receipts.values()], summary };
}

export function createFileLedger(options = {}) {
  let descriptor, disabled = false, finalSummary, overheadMs = 0, state;
  const measure = action => { const start = performance.now(); try { return action(); } finally { overheadMs += performance.now() - start; } };
  const close = () => {
    if (descriptor === undefined) return;
    const fd = descriptor; descriptor = undefined;
    telemetryAttempt(() => closeSync(fd));
  };
  const attempt = action => {
    if (disabled) return;
    try { return measure(action); }
    catch { disabled = true; warnTelemetry(); close(); }
  };
  // No raw strings or Error objects reach this sink. Every record is built
  // below from fixed enums, validated public metadata and numeric/boolean data.
  const append = record => {
    const bytes = JSON.stringify(record) + '\n';
    if (writeSync(descriptor, bytes) !== Buffer.byteLength(bytes)) throw Error('Incomplete telemetry write');
  };
  attempt(() => {
    const { destination, cwd = process.cwd(), files, lane = 'test', env = process.env } = options;
    if (!['test', 'windows', 'differential', 'engine-differential'].includes(lane)) throw Error('Invalid ledger lane');
    const paths = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path.posix;
    const relative = file => {
      const name = paths.relative(cwd, paths.resolve(cwd, file)).replaceAll('\\', '/');
      if (!/^tests\/[a-zA-Z0-9_.-]+\.mjs$/.test(name)) throw Error('Invalid ledger file');
      return name;
    };
    const expected = Array.from(files, relative).sort();
    if (!expected.length || new Set(expected).size !== expected.length) throw Error('Invalid ledger inventory');
    state = { expected, relative, inventory: new Set(expected), admitted: new Set(), completed: new Set() };
    mkdirSync(path.dirname(destination), { recursive: true });
    descriptor = openSync(destination, 'w');
    const publicString = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
    append({ schema: 'rs3-file-ledger-v1', lane,
      sha: publicString(env.GITHUB_SHA, /^[a-f0-9]{40}$/),
      runId: publicString(env.GITHUB_RUN_ID, /^\d+$/),
      runAttempt: duration(Number(publicString(env.GITHUB_RUN_ATTEMPT, /^\d+$/))) || null,
      selectedAt: new Date().toISOString(), files: expected });
  });
  const key = (file, attempt) => {
    file = state.relative(file);
    if (!state.inventory.has(file) || ![1, 2].includes(attempt)) throw Error('Unexpected ledger attempt');
    return [file, `${file}:${attempt}`];
  };
  const redact = errorRedactor();
  const ledger = {
    onAdmit(info, number = 1) {
      return attempt(() => {
        const [file, id] = key(info.file, number);
        if (state.admitted.has(id) || finalSummary) throw Error('Duplicate ledger admission');
        append({ type: 'admitted', file, attempt: number, value: { outcome: 'interrupted', admittedAt: timestamp(info.admittedAt),
          queueWaitMs: duration(info.queueWaitMs), solo: typeof info.solo === 'boolean' ? info.solo : null,
          concurrency: Number.isSafeInteger(info.concurrency) && info.concurrency > 0 ? info.concurrency : null,
          ...datasetIdentity({ datasetId: info.datasetId }) } });
        state.admitted.add(id);
      });
    },
    onFile(result, number = 1) {
      return attempt(() => {
        const [file, id] = key(result.file, number);
        if (!state.admitted.has(id) || state.completed.has(id) || finalSummary) throw Error('Invalid ledger completion');
        const datasets = Array.from(result.datasets ?? [], datasetIdentity).filter(item => item.datasetId && item.datasetDigest);
        const value = { outcome: result.timedOut === true ? 'timeout' : result.cancelled === true ? 'cancelled' : result.passed === true ? 'pass' : 'fail',
          completedAt: timestamp(result.completedAt), processWallMs: duration(result.processWallMs), fileWallMs: duration(result.fileWallMs), bodyMs: duration(result.bodyMs),
          datasets, ...(datasets.length === 1 ? datasets[0] : {}), errors: Array.from(result.errors ?? [], redact) };
        overheadMs += duration(result.telemetryMs) ?? 0;
        append({ type: 'completed', file, attempt: number, value });
        state.completed.add(id);
      });
    },
    finish() {
      if (finalSummary) return finalSummary;
      const value = attempt(() => {
        const summary = { type: 'summary', selectedFiles: state.expected.length, completedAttempts: state.completed.size, overheadMs: duration(overheadMs) };
        append(summary);
        return summary;
      });
      close();
      return finalSummary = value;
    },
    report() {
      return telemetryAttempt(() => {
        const summary = ledger.finish();
        if (summary) writeSync(1, 'File telemetry: ' + JSON.stringify(summary) + '\n');
      });
    },
  };
  return ledger;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  telemetryAttempt(() => writeSync(1, JSON.stringify(readFileLedger(readFileSync(process.argv[2], 'utf8')), null, 2) + '\n'));
}
