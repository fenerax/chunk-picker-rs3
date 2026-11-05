import path from 'node:path';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { childErrorRecord } from '../test-child-errors.mjs';

const duration = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
const ids = new Set(['duo-legacy', 'open-f2p', 'open-starter']);
export const datasetIdentity = value => ({ datasetId: ids.has(value?.datasetId ?? value?.id) ? value.datasetId ?? value.id : null,
  datasetDigest: /^[a-f0-9]{64}$/.test(value?.datasetDigest ?? value?.digest ?? '') ? value.datasetDigest ?? value.digest : null });

// Never copy arbitrary Error properties, assertion actual/expected, stacks or
// output. Redact known identities/credentials as well as paths and endpoints.
export function errorRedactor(env = process.env) {
  const privateValues = [...new Set([hostname(), env.COMPUTERNAME, env.USERNAME, env.USER, env.LOGNAME,
    ...Object.entries(env).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL/i.test(key)).map(([, value]) => value)]
    .filter(value => typeof value === 'string' && value.length >= 3))].sort((a, b) => b.length - a.length);
  const clean = value => {
    let text = String(value);
    for (const value of privateValues) text = text.split(value).join('[redacted]');
    return text.replace(/\b(?:Bearer\s+\S+|(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi, '[credential]')
      .replace(/(?:https?|wss?):\/\/[^\s'"<>]+/gi, '[endpoint]')
      .replace(/\b[A-Z]:[\\/][^\s'"<>]*/gi, '[path]').replace(/(?:^|(?<=[\s('"=]))\/(?:[^\s'"<>]+\/)*[^\s'"<>]*/g, '[path]')
      .replace(/\b[\w.+-]+@[\w.-]+\b/g, '[email]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[address]')
      .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|local|internal|test|example)\b(?::\d+)?/gi, '[host]')
      .replace(/\b(?:localhost|[a-f0-9]*:[a-f0-9:]+:[a-f0-9]*)\b/gi, '[address]').slice(0, 4096);
  };
  const redact = error => {
    const record = childErrorRecord(error);
    if (!record) return null;
    const visit = record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, key === 'cause' ? visit(value) : typeof value === 'number' ? value : clean(value)]));
    return visit(record);
  };
  return redact;
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

export function createFileLedger({ destination, cwd = process.cwd(), files, lane = 'test', env = process.env } = {}) {
  if (!['test', 'windows', 'differential', 'engine-differential'].includes(lane)) throw Error('Invalid ledger lane');
  const paths = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path.posix;
  const relative = file => {
    const name = paths.relative(cwd, paths.resolve(cwd, file)).replaceAll('\\', '/');
    if (!/^tests\/[a-zA-Z0-9_.-]+\.mjs$/.test(name)) throw Error('Invalid ledger file');
    return name;
  };
  const expected = files.map(relative).sort();
  if (!expected.length || new Set(expected).size !== expected.length) throw Error('Invalid ledger inventory');
  const inventory = new Set(expected), admitted = new Set(), completed = new Set();
  const redact = errorRedactor(env);
  let overheadMs = 0, descriptor, finalSummary;
  const measure = action => { const start = performance.now(); try { return action(); } finally { overheadMs += performance.now() - start; } };
  const append = record => measure(() => writeSync(descriptor, JSON.stringify(record) + '\n'));
  measure(() => {
    mkdirSync(path.dirname(destination), { recursive: true });
    descriptor = openSync(destination, 'w');
    writeSync(descriptor, JSON.stringify({ schema: 'rs3-file-ledger-v1', lane,
      sha: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
      runId: /^\d+$/.test(env.GITHUB_RUN_ID ?? '') ? env.GITHUB_RUN_ID : null,
      runAttempt: /^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ? Number(env.GITHUB_RUN_ATTEMPT) : null,
      selectedAt: new Date().toISOString(), files: expected }) + '\n');
  });
  const key = (file, attempt) => {
    file = relative(file);
    if (!inventory.has(file) || ![1, 2].includes(attempt)) throw Error('Unexpected ledger attempt');
    return [file, `${file}:${attempt}`];
  };
  return {
    onAdmit(info, attempt = 1) {
      const [file, id] = key(info.file, attempt);
      if (admitted.has(id)) throw Error('Duplicate ledger admission');
      append({ type: 'admitted', file, attempt, value: { outcome: 'interrupted', admittedAt: info.admittedAt,
        queueWaitMs: duration(info.queueWaitMs), solo: info.solo, concurrency: info.concurrency,
        ...datasetIdentity({ datasetId: info.datasetId }) } });
      admitted.add(id);
    },
    onFile(result, attempt = 1) {
      const [file, id] = key(result.file, attempt);
      if (!admitted.has(id) || completed.has(id)) throw Error('Invalid ledger completion');
      const value = measure(() => {
        const datasets = (result.datasets ?? []).map(datasetIdentity).filter(item => item.datasetId && item.datasetDigest);
        return { outcome: result.timedOut ? 'timeout' : result.cancelled ? 'cancelled' : result.passed ? 'pass' : 'fail',
          completedAt: result.completedAt, processWallMs: duration(result.processWallMs), fileWallMs: duration(result.fileWallMs), bodyMs: duration(result.bodyMs),
          datasets, ...(datasets.length === 1 ? datasets[0] : {}), errors: (result.errors ?? []).map(redact) };
      });
      overheadMs += duration(result.telemetryMs) ?? 0;
      append({ type: 'completed', file, attempt, value });
      completed.add(id);
    },
    finish() {
      if (finalSummary) return finalSummary;
      // Includes all serializing, redacting and synchronous ledger I/O above.
      const summary = { type: 'summary', selectedFiles: expected.length, completedAttempts: completed.size, overheadMs: duration(overheadMs) };
      append(summary);
      closeSync(descriptor);
      return finalSummary = summary;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(readFileLedger(readFileSync(process.argv[2], 'utf8')), null, 2));
}
