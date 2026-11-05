import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createFileLedger, readFileLedger, errorRedactor } from '../scripts/ci/file-ledger.mjs';
import { createCoverageReporter } from '../scripts/ci/coverage-reporter.mjs';
import { childErrorRecord, restoreChildError, transportChildError } from '../scripts/test-child-errors.mjs';
import { GiB, runAdaptive } from '../scripts/adaptive-test-runner.mjs';
import { retryFailedFilesOnce } from '../scripts/private-companion/retry-failed-files.mjs';

const summary = passed => ({ success: passed, counts: { tests: 0, suites: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0 } });
async function fixture(t, files = ['tests/a.test.mjs']) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'file-ledger-'));
  const destination = path.join(cwd, 'ledger.jsonl');
  const ledger = createFileLedger({ destination, cwd, files, env: { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' } });
  t.after(async () => { ledger.finish(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, destination, ledger, read: async () => readFileLedger(await readFile(destination, 'utf8')) };
}
const schedule = (f, files, options = {}) => runAdaptive({ cwd: f.cwd, files, env: {}, memory: () => 8 * GiB,
  minConcurrency: 1, maxConcurrency: 1, policy: () => ({}), pollMs: 1,
  onAdmit: info => f.ledger.onAdmit(info), onFile: result => f.ledger.onFile(result), onFileError: result => f.ledger.onFile(result), ...options });

test('reporter retains native timings without changing native coverage counts or verdict', () => {
  const reporter = createCoverageReporter({ cwd: '/repo', files: ['tests/a.test.mjs'] });
  reporter.onFile({ file: 'tests/a.test.mjs', passed: true, summary: summary(true), processWallMs: 22, fileWallMs: 20, bodyMs: 5 });
  const value = reporter.report();
  assert.equal(value.passed, true);
  assert.deepEqual(value.fileResults[0], { file: 'tests/a.test.mjs', passed: true, counts: summary(true).counts,
    processWallMs: 22, fileWallMs: 20, bodyMs: 5, recordCount: 0 });
});

test('every selected file has exactly one receipt, including unadmitted files on cancellation', async t => {
  const files = ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'];
  const f = await fixture(t, files), controller = new AbortController();
  const result = await schedule(f, files, { signal: controller.signal,
    policy: () => ({ solo: true, env: { RS3_DATASET: 'open-f2p' } }),
    runFile: async ({ file }) => { controller.abort(); return { file, passed: true, processWallMs: 4, fileWallMs: 3, bodyMs: 2, summary: summary(true) }; } });
  assert.equal(result.passed, false);
  f.ledger.finish();
  const value = await f.read();
  assert.equal(value.sha, 'a'.repeat(40)); assert.equal(value.runId, '123'); assert.equal(value.runAttempt, 2);
  assert.equal(value.receipts.length, files.length);
  assert.equal(new Set(value.receipts.map(row => row.file)).size, files.length);
  const first = value.receipts[0].firstAttempt;
  assert.ok(first.admittedAt); assert.ok(first.completedAt); assert.ok(first.queueWaitMs >= 0);
  assert.equal(first.solo, true); assert.equal(first.concurrency, 1); assert.equal(first.datasetId, 'open-f2p');
  assert.deepEqual(value.receipts.slice(1).map(row => row.firstAttempt.outcome), ['not-admitted', 'not-admitted']);
  assert.doesNotThrow(() => f.ledger.onFile(result.files[0]));
});

for (const retryPasses of [true, false]) test(`isolated retry preserves the first failure when retry ${retryPasses ? 'passes as FLAKY' : 'fails'}`, async t => {
  const files = ['tests/a.test.mjs'], f = await fixture(t, files);
  const original = Object.assign(new Error('original child failure', { cause: Object.assign(new Error('root failure'), { code: 'ENOENT' }) }), { code: 'EIO' });
  const run = (attempt, passed) => schedule(f, files, {
    onAdmit: info => f.ledger.onAdmit(info, attempt), onFile: result => f.ledger.onFile(result, attempt),
    runFile: async ({ file }) => ({ file, passed, processWallMs: 6, fileWallMs: 5, bodyMs: 1, summary: summary(passed), errors: passed ? [] : [original] }),
  });
  const initial = await run(1, false);
  const result = await retryFailedFilesOnce({ result: initial, enabled: true, runIsolated: () => run(2, retryPasses) });
  assert.equal(result.passed, retryPasses); assert.equal(result.files[0].flaky, retryPasses);
  const { receipts: [receipt] } = await f.read();
  assert.equal(receipt.firstAttempt.outcome, 'fail'); assert.equal(receipt.retry.outcome, retryPasses ? 'pass' : 'fail');
  assert.equal(receipt.retry.concurrency, 1);
  assert.equal(receipt.firstAttempt.errors[0].message, '[redacted]');
  assert.equal(receipt.firstAttempt.errors[0].code, 'EIO');
  assert.equal(receipt.firstAttempt.errors[0].cause.code, 'ENOENT');
});

test('controller exceptions still record a failed receipt and keep the original rejection', async t => {
  const f = await fixture(t);
  const error = Object.assign(new Error('controller failed'), { code: 'EACCES' });
  await assert.rejects(schedule(f, ['tests/a.test.mjs'], { runFile: () => { throw error; } }), value => value === error);
  assert.equal((await f.read()).receipts[0].firstAttempt.errors[0].code, 'EACCES');
});

test('SIGKILL leaves completed, interrupted and unadmitted receipts without finalization', async t => {
  const f = await fixture(t, ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs']);
  f.ledger.finish();
  const module = new URL('../scripts/ci/file-ledger.mjs', import.meta.url).href;
  const script = path.join(f.cwd, 'kill-fixture.mjs');
  await writeFile(script, `import { createFileLedger } from ${JSON.stringify(module)};
const ledger = createFileLedger({destination: ${JSON.stringify(f.destination)}, cwd: process.cwd(), files: ['tests/a.test.mjs','tests/b.test.mjs','tests/c.test.mjs']});
const info = file => ({file, admittedAt: new Date().toISOString(), queueWaitMs: 1, solo: true, concurrency: 1});
ledger.onAdmit(info('tests/a.test.mjs'));
ledger.onFile({file:'tests/a.test.mjs', passed:true, completedAt:new Date().toISOString(), processWallMs:2, fileWallMs:1, bodyMs:0});
ledger.onAdmit(info('tests/b.test.mjs'));
process.stdout.write('ready'); setInterval(() => {}, 1000);
`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script], { cwd: f.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const closed = once(child, 'close');
  await once(child.stdout, 'data');
  child.kill('SIGKILL'); await closed;
  const source = await readFile(f.destination, 'utf8');
  for (const value of [source, source + '{"type":"torn']) {
    const ledger = readFileLedger(value);
    assert.equal(ledger.summary, null);
    assert.deepEqual(ledger.receipts.map(row => row.firstAttempt.outcome), ['pass', 'interrupted', 'not-admitted']);
  }
});

test('real native child errors retain message/code/cause over IPC and observe only dataset identity', async t => {
  const f = await fixture(t), file = 'a.test.mjs';
  const datasetRuntime = new URL('../app/dataset-runtime.mjs', import.meta.url).href;
  await writeFile(path.join(f.cwd, file), `import test from 'node:test'; import ${JSON.stringify(datasetRuntime)};
test('synthetic failure', () => { throw Object.assign(new Error('original child message', {cause:Object.assign(new Error('root child message'), {code:'E_ROOT'})}), {code:'E_CHILD'}); });`);
  const observed = [];
  const result = await runAdaptive({ cwd: f.cwd, files: [file], env: { ...process.env, RS3_DATASET: 'open-starter' },
    memory: () => 8 * GiB, policy: () => ({}), minConcurrency: 1, maxConcurrency: 1, datasetRoot: path.join(f.cwd, 'datasets'),
    onEvent: event => { if (event.type === 'test:fail') observed.push(event.data.details.error); } });
  assert.equal(result.passed, false);
  const serialized = JSON.stringify(result.files[0].errors);
  for (const text of ['original child message', 'root child message', 'E_CHILD', 'E_ROOT']) assert.ok(serialized.includes(text), serialized);
  assert.ok(observed.every(error => !String(error).includes('[object Object]')));
  assert.ok(result.files[0].datasets.some(value => value.id === 'open-starter' && /^[a-f0-9]{64}$/.test(value.digest)));
  const record = childErrorRecord(Object.assign(new Error('outer', { cause: new Error('inner') }), { code: 'E_CHILD' }));
  assert.equal(restoreChildError(record).cause.message, 'inner'); assert.equal(restoreChildError(record).code, 'E_CHILD');
  assert.equal(restoreChildError(childErrorRecord(new Error('null cause', { cause: null }))).cause, null);
  const assertion = Object.assign(new Error('diff'), { actual: () => {}, expected: Symbol('expected') });
  assert.doesNotThrow(() => structuredClone(transportChildError(assertion)));
});

test('the CLI writes its own complete ledger and supported native coverage in a one-file synthetic checkout', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.cwd, 'scripts/ci'), { recursive: true });
  await mkdir(path.join(f.cwd, 'tests'));
  for (const name of ['test.mjs', 'adaptive-test-runner.mjs', 'test-child-errors.mjs', 'test-run-environment.mjs', 'ci/file-ledger.mjs', 'ci/coverage-reporter.mjs', 'test-telemetry.mjs']) {
    await cp(new URL('../scripts/' + name, import.meta.url), path.join(f.cwd, 'scripts', name));
  }
  await writeFile(path.join(f.cwd, 'scripts/test-selection.mjs'), `export const discoverTests = async () => ['a.test.mjs']; export const adaptiveOptionsFor = () => ({ minConcurrency: 1, maxConcurrency: 1, memory: () => 8 * 1024 ** 3 });`);
  await writeFile(path.join(f.cwd, 'tests/a.test.mjs'), `import test from 'node:test'; test('synthetic pass', () => {});`);
  const destination = path.join(f.cwd, 'cli-ledger.jsonl');
  const env = { ...process.env, RS3_TEST_FILE_LEDGER: destination };
  delete env.NODE_TEST_CONTEXT;
  delete env.RS3_COVERAGE_REPORT;
  // Probe Node itself, as in ci-coverage-reporter.test.mjs. Older Node 24
  // releases can run the CLI/ledger but cannot identify native coverage cases.
  await writeFile(path.join(f.cwd, 'probe.mjs'), `import { run } from 'node:test';
import { writeFile } from 'node:fs/promises';
let nativeCase, nativeSuccess = false;
for await (const event of run({files: ['tests/a.test.mjs'], isolation: 'process', concurrency: 1})) {
  if (event.type === 'test:complete' && event.data.name === 'synthetic pass') nativeCase = event.data;
  if (event.type === 'test:summary' && !event.data.file) nativeSuccess = event.data.success;
}
if (!nativeSuccess || !nativeCase) throw new Error('Native coverage identity probe failed');
await writeFile('capability.json', JSON.stringify({entryFile: typeof nativeCase.entryFile === 'string', node: process.version}));
`);
  const probe = spawnSync(process.execPath, ['probe.mjs'], { cwd: f.cwd, env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr);
  const capability = JSON.parse(await readFile(path.join(f.cwd, 'capability.json'), 'utf8'));
  assert.equal(capability.node, process.version);
  assert.equal(typeof capability.entryFile, 'boolean');
  if (capability.entryFile) env.RS3_COVERAGE_REPORT = path.join(f.cwd, 'coverage.json');
  const child = spawn(process.execPath, ['scripts/test.mjs', 'full'], { cwd: f.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  assert.equal((await once(child, 'close'))[0], 0, output);
  const value = readFileLedger(await readFile(destination, 'utf8'));
  assert.equal(value.receipts.length, 1); assert.equal(value.receipts[0].firstAttempt.outcome, 'pass');
  assert.equal(value.summary.completedAttempts, 1);
  if (capability.entryFile) assert.equal(JSON.parse(await readFile(path.join(f.cwd, 'coverage.json'), 'utf8')).passed, true);
  else t.diagnostic(`Node ${capability.node} node:test lacks native entryFile identities; ledger verified, coverage assertions skipped`);
});

test('error receipts exclude payloads, credentials, paths and endpoints', () => {
  const redact = errorRedactor({ USERNAME: 'synthetic-user', API_KEY: 'synthetic-credential', PRIVATE_KEY: 'synthetic-key-value' });
  const value = redact(Object.assign(new Error('SYNTHETIC-USER synthetic-credential synthetic-key-value at C:\\private\\file on https://service.example/path 192.0.2.1 localhost [2001:db8::1] ::1 machine.invalid user@example.invalid token=private-value'),
    { code: 'E_CHILD', actual: { private: 'payload' }, stack: 'private stack', cause: { message: 'cause survives', code: 'E_ROOT' } }));
  assert.equal(value.code, '[redacted]'); assert.equal(value.cause.code, '[redacted]'); assert.equal(value.cause.message, '[redacted]');
  for (const forbidden of ['SYNTHETIC-USER', 'synthetic-credential', 'synthetic-key-value', 'private-value', 'C:\\', 'service.example', '192.0.2.1', 'localhost', '2001:db8', '::1', 'machine.invalid', 'user@', 'payload', 'stack']) assert.ok(!JSON.stringify(value).includes(forbidden), forbidden);
  const assertion = redact({ name: 'AssertionError', code: 'ERR_ASSERTION', message: 'expected child shutdown\n\nprivate assertion payload' });
  assert.equal(assertion.message, '[redacted]');
});

test('750-file journal bookkeeping stays below the two-second per-job budget', async t => {
  const files = Array.from({ length: 750 }, (_, index) => `tests/file-${index}.test.mjs`);
  const started = performance.now(), f = await fixture(t, files);
  for (const file of files) {
    f.ledger.onAdmit({ file, admittedAt: new Date().toISOString(), queueWaitMs: 1, solo: false, concurrency: 1 });
    f.ledger.onFile({ file, passed: true, completedAt: new Date().toISOString(), processWallMs: 5, fileWallMs: 4, bodyMs: 3 });
  }
  const cost = f.ledger.finish();
  const wallMs = performance.now() - started;
  t.diagnostic(`750-file ledger: ${wallMs.toFixed(1)} ms wall; ${cost.overheadMs} ms measured bookkeeping`);
  assert.ok(wallMs < 2000, `${wallMs} ms`);
  assert.equal((await f.read()).receipts.length, files.length);
});
