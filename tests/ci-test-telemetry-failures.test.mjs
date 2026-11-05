import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createFileLedger, errorRedactor, readFileLedger } from '../scripts/ci/file-ledger.mjs';
import { GiB, runAdaptive } from '../scripts/adaptive-test-runner.mjs';
import { retryFailedFilesOnce } from '../scripts/private-companion/retry-failed-files.mjs';

const warning = 'Test telemetry unavailable; test execution continues.';
const secretShapedValues = ['ERR_SYNTHETIC_SECRET_42', 'EDGEHOST17', 'E_SYNTHETIC_TOKEN_84',
  'ERR_ASSERTION_PRIVATE', 'ENOENT_PRIVATE', 'TypeErrorPRIVATE42', 'ErrorPRIVATE42', 'testCodeFailurePRIVATE42'];
async function scratch(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'telemetry-contract-'));
  t.after(() => rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return cwd;
}

test('receipt bytes contain only public error vocabulary at every cause depth and metadata field', async t => {
  const cwd = await scratch(t), file = 'tests/synthetic.test.mjs', destination = path.join(cwd, 'ledger.jsonl');
  const privateValues = ['synthetic-environment-value', 'synthetic-generated-credential',
    '{"privateSave":{"syntheticAccount":"synthetic-save-value"}}', 'synthetichost',
    String.raw`\\syntheticserver\syntheticshare\syntheticfile`, String.raw`Q:\synthetic\absolute`, '/synthetic/absolute',
    ...secretShapedValues];
  const errors = privateValues.map(value => {
    let error;
    try { throw Object.assign(new Error(value), { name: value, code: value, failureType: value,
      actual: value, expected: value, cause: { message: value, name: value, code: value, failureType: value, cause: value } }); }
    catch (caught) { error = caught; }
    return error;
  });
  const ledger = createFileLedger({ cwd, destination, files: [file], env: { SYNTHETIC_SETTING: privateValues[0] } });
  ledger.onAdmit({ file, admittedAt: privateValues[0], solo: privateValues[1], concurrency: privateValues[2], datasetId: privateValues[3] });
  ledger.onFile({ file, passed: false, errors, completedAt: privateValues[4],
    datasets: [{ id: privateValues[5], digest: privateValues[6] }], processWallMs: privateValues[0] });
  ledger.finish();
  const bytes = await readFile(destination, 'utf8');
  for (const value of privateValues) {
    assert.ok(!bytes.includes(value));
    assert.ok(!bytes.includes(JSON.stringify(value).slice(1, -1)));
  }
  const receipt = readFileLedger(bytes).receipts[0].firstAttempt;
  assert.equal(receipt.errors.length, privateValues.length);
  for (const error of receipt.errors) {
    assert.equal(error.message, '[redacted]'); assert.equal(error.name, '[redacted]');
    assert.equal(error.code, '[redacted]'); assert.equal(error.failureType, '[redacted]');
    assert.equal(error.cause.cause.message, '[redacted]');
  }
  assert.equal(receipt.completedAt, null); assert.deepEqual(receipt.datasets, []);
  const redact = errorRedactor();
  assert.deepEqual(redact({ name: 'TypeError', code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure',
    message: 'synthetic-private-text', cause: { name: 'Error', code: 'EIO', message: 5, failureType: false } }),
  { name: 'TypeError', code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', message: '[redacted]',
    cause: { name: 'Error', code: 'EIO', message: '[redacted]', failureType: '[redacted]' } });
  assert.equal(redact({ code: 'ENOENT' }).code, 'ENOENT');
  assert.equal(redact({ name: 'AssertionError', code: 'ERR_ASSERTION' }).code, 'ERR_ASSERTION');
  for (const value of [123456789, true, false, null, { toString: () => 'ENOENT' }]) {
    assert.deepEqual(redact({ message: value, name: value, code: value, failureType: value, cause: value }),
      { message: '[redacted]', name: '[redacted]', code: '[redacted]', failureType: '[redacted]',
        cause: value === null ? null : { message: '[redacted]' } });
  }
});

test('Windows failure logging and ledger bytes reject secret-shaped error fields', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const cwd = await scratch(t), work = path.join(cwd, 'work');
  await mkdir(path.join(cwd, '.github/windows-slice'), { recursive: true });
  await mkdir(path.join(cwd, 'scripts/ci'), { recursive: true });
  await mkdir(path.join(cwd, 'scripts/private-companion'), { recursive: true });
  await cp(new URL('../.github/windows-slice/run.mjs', import.meta.url), path.join(cwd, '.github/windows-slice/run.mjs'));
  for (const name of ['ci/file-ledger.mjs', 'ci/coverage-reporter.mjs', 'test-telemetry.mjs', 'private-companion/retry-failed-files.mjs']) {
    await cp(new URL('../scripts/' + name, import.meta.url), path.join(cwd, 'scripts', name));
  }
  // Only the scheduler/environment are synthetic: execute the real Windows
  // callbacks, sanitizer, coverage collector and retry policy without its suite.
  await writeFile(path.join(cwd, 'scripts/test-selection.mjs'), `import { readdir } from 'node:fs/promises';
export const discoverTests = () => readdir(new URL('../tests/', import.meta.url));`);
  const source = await readFile(new URL('../.github/windows-slice/run.mjs', import.meta.url), 'utf8');
  const names = source.match(/export const windowsFiles = \[([\s\S]*?)\];/)[1].match(/'[^']+\.mjs'/g).map(name => name.slice(1, -1));
  await mkdir(path.join(cwd, 'tests'));
  for (const name of names) await writeFile(path.join(cwd, 'tests', name), '// Synthetic inventory only.\n');
  await writeFile(path.join(cwd, 'scripts/private-companion/release-evidence.mjs'), 'export const laneEnvironment = async () => ({});');
  await writeFile(path.join(cwd, 'scripts/adaptive-test-runner.mjs'), `let attempt = 0;
export async function runAdaptive({files, onAdmit, onEvent, onFile}) {
  const initial = ++attempt === 1, results = [];
  for (const [index, file] of files.entries()) {
    const passed = !(initial && index === 0);
    const errors = passed ? [] : ${JSON.stringify(secretShapedValues)}.map(value => ({
      message: value, name: value, code: value, failureType: value,
      cause: {message: value, name: value, code: value, failureType: value,
        cause: {name: value, code: value, failureType: value, message: value}}
    }));
    if (!passed) errors.push({name:'AssertionError', code:'ERR_ASSERTION',
      cause:{name:'Error', code:'ENOENT', cause:{name:'TypeError', code:'EIO'}}});
    await onAdmit({file, admittedAt:new Date().toISOString(), concurrency:1, solo:true});
    for (const error of errors) {
      await onEvent({type:'test:fail', data:{file, details:{type:'test', error:{cause:error}}}});
      await onEvent({type:'test:fail', data:{file, details:{type:'test', error:{...error, cause:undefined}}}});
    }
    await onEvent({type:'test:complete', data:{entryFile:file, file, testId:1, name:'synthetic case',
      nesting:0, details:{type:'test', passed}}});
    const result = {file, passed, errors, completedAt:new Date().toISOString(), processWallMs:1,
      summary:{counts:{tests:1,suites:0,passed:Number(passed),failed:Number(!passed),cancelled:0,skipped:0,todo:0,topLevel:1}}};
    await onFile(result); results.push(result);
  }
  const passed = results.every(result => result.passed);
  return {files:results, passed, exitCode:passed ? 0 : 1};
}`);
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'GITHUB_STEP_SUMMARY']) delete env[name];
  const child = spawn(process.execPath, ['.github/windows-slice/run.mjs', cwd, work],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  assert.equal((await once(child, 'close'))[0], 0, output);
  const bytes = await readFile(path.join(work, 'windows-ledger.jsonl'), 'utf8');
  const lines = output.split('\n').filter(line => line.trim().startsWith('{'));
  assert.equal(lines.length, (secretShapedValues.length + 1) * 2, output);
  for (const value of secretShapedValues) {
    assert.ok(!bytes.includes(value), value);
    assert.ok(!output.includes(value), value);
  }
  for (const code of ['ENOENT', 'EIO', 'ERR_ASSERTION']) {
    assert.ok(bytes.includes(code), code);
    assert.ok(lines.some(line => line.includes(code)), code);
  }
  const receipt = readFileLedger(bytes).receipts.find(row => row.firstAttempt.outcome === 'fail');
  assert.equal(receipt.retry.outcome, 'pass');
  for (const line of lines.slice(0, secretShapedValues.length * 2)) {
    for (let error = JSON.parse(line.trim()); error; error = error.cause) {
      assert.equal(error.message, '[redacted]'); assert.equal(error.name, '[redacted]');
      assert.equal(error.code, '[redacted]'); assert.equal(error.failureType, '[redacted]');
    }
  }
});

test('redaction bounds null, primitive, cyclic, deep and hostile causes without reading payloads', () => {
  const redact = errorRedactor();
  for (const cause of [null, false, 123, 'synthetic-private-cause', Symbol('synthetic-private-symbol')]) {
    assert.doesNotThrow(() => JSON.stringify(redact(new Error('synthetic-private-message', { cause }))));
  }
  assert.equal(redact(new Error('synthetic', { cause: null })).cause, null);
  const cycle = new Error('synthetic-cycle'); cycle.cause = cycle;
  assert.equal(redact(cycle).cause.message, '[cause truncated]');
  let deep = new Error('synthetic-deep');
  for (let index = 0; index < 20000; index++) deep = new Error('synthetic-deep', { cause: deep });
  assert.ok(JSON.stringify(redact(deep)).length < 1000);
  const hostile = new Proxy({}, { get() { throw Error('synthetic-getter-secret'); }, ownKeys() { throw Error('synthetic-keys-secret'); } });
  assert.deepEqual(redact(hostile), { message: '[redacted]' });
  assert.deepEqual(redact({ message: { toString() { throw Error('synthetic-coercion-secret'); } } }), { message: '[redacted]' });
});

// A tiny copied checkout exercises the real CLI, native child and OS exit code.
// Its only selected file is synthetic and memory admission is deterministic.
async function cliFixture(t) {
  const cwd = await scratch(t);
  await mkdir(path.join(cwd, 'scripts/ci'), { recursive: true });
  await mkdir(path.join(cwd, 'tests'));
  for (const name of ['test.mjs', 'adaptive-test-runner.mjs', 'test-child-errors.mjs', 'test-run-environment.mjs',
    'test-telemetry.mjs', 'ci/file-ledger.mjs']) {
    await cp(new URL('../scripts/' + name, import.meta.url), path.join(cwd, 'scripts', name));
  }
  await writeFile(path.join(cwd, 'scripts/test-selection.mjs'), `export const discoverTests = async () => ['synthetic.test.mjs'];
export const adaptiveOptionsFor = () => ({minConcurrency:1,maxConcurrency:1,memory:()=>8*1024**3});`);
  await writeFile(path.join(cwd, 'fault.mjs'), `import fs from 'node:fs'; import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const fault = process.env.SYNTHETIC_FAULT, descriptors = new Set(); let writes = 0;
const eio = () => { throw Object.assign(Error('synthetic-io-secret'), {code:'EIO'}); };
const open = fs.openSync, write = fs.writeSync, close = fs.closeSync, make = fs.mkdirSync;
fs.mkdirSync = function(...args) { if (fault === 'mkdir') eio(); return make.apply(this,args); };
fs.openSync = function(file,...args) { if (String(file).endsWith('ledger.jsonl') && fault === 'open') eio();
  const fd = open.call(this,file,...args); if (String(file).endsWith('ledger.jsonl')) descriptors.add(fd); return fd; };
fs.writeSync = function(fd,...args) { if (descriptors.has(fd) && String(++writes) === fault) eio();
  if (fd === 1 && String(args[0]).startsWith('File telemetry:') && fault === 'log') eio(); return write.call(this,fd,...args); };
fs.closeSync = function(fd) { const tracked = descriptors.delete(fd); const result = close.call(this,fd); if (tracked && fault === 'close') eio(); return result; };
const mkdir = fsp.mkdir, read = fsp.readFile, rm = fsp.rm;
fsp.mkdir = async function(file,...args) { if (String(file).endsWith('.test-datasets') && fault === 'dataset-mkdir') eio(); return mkdir.call(this,file,...args); };
fsp.readFile = async function(file,...args) { if (String(file).includes('.test-datasets') && fault === 'dataset-read') eio(); return read.call(this,file,...args); };
fsp.rm = async function(file,...args) { if (String(file).includes('.test-datasets') && fault === 'dataset-cleanup') eio(); return rm.call(this,file,...args); };
syncBuiltinESMExports();`);
  return async ({ fault = '', kind = 'pass', telemetry = true } = {}) => {
    await writeFile(path.join(cwd, 'tests/synthetic.test.mjs'), `import test from 'node:test'; import {writeFileSync} from 'node:fs';
test('synthetic verdict', {todo:${kind.startsWith('todo')}}, () => {
  console.log('synthetic-test-started');
  if (process.env.RS3_TEST_DATASET_RECEIPT) writeFileSync(process.env.RS3_TEST_DATASET_RECEIPT,
    JSON.stringify({id:'open-f2p',digest:'a'.repeat(64),ignored:'synthetic-extra-private'})+'\\n');
  const error = new Error('synthetic test error', {cause:null});
  if (${JSON.stringify(kind)} === 'todo-cycle') error.cause = error;
  if (${JSON.stringify(kind)} === 'todo-primitive') error.cause = 'synthetic primitive';
  if (${JSON.stringify(kind)} === 'todo-deep') { let cause = error; for(let i=0;i<100;i++) cause = new Error('synthetic',{cause}); throw cause; }
  if (${JSON.stringify(kind)} !== 'pass') throw error;
});`);
    const env = { ...process.env, SYNTHETIC_FAULT: fault };
    for (const name of ['NODE_TEST_CONTEXT', 'RS3_COVERAGE_REPORT', 'RS3_COVERAGE_LANE', 'RS3_TEST_FILE_LEDGER', 'RS3_TEST_DATASET_RECEIPT']) delete env[name];
    if (telemetry) env.RS3_TEST_FILE_LEDGER = path.join(cwd, 'ledger.jsonl');
    const child = spawn(process.execPath, ['--import', './fault.mjs', 'scripts/test.mjs', 'full'],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    const [code, signal] = await once(child, 'close');
    assert.equal(signal, null, output);
    assert.ok(output.includes('synthetic-test-started'), output);
    assert.ok(!output.includes('synthetic-io-secret'), output);
    assert.ok(output.split(warning).length - 1 <= 1, output);
    return { code, output, receipt: telemetry && !['mkdir', 'open', '1'].includes(fault)
      ? readFileLedger(await readFile(path.join(cwd, 'ledger.jsonl'), 'utf8')) : undefined };
  };
}

for (const kind of ['pass', 'fail']) test(`telemetry I/O faults preserve the native ${kind} verdict and CLI exit code`, { timeout: 30000 }, async t => {
  const run = await cliFixture(t), baseline = await run({ kind, telemetry: false });
  assert.equal(baseline.code, kind === 'pass' ? 0 : 1);
  for (const fault of ['mkdir', 'open', '1', '2', '3', '4', 'close', 'dataset-mkdir', 'dataset-read', 'dataset-cleanup', 'log']) {
    const result = await run({ kind, fault });
    assert.equal(result.code, baseline.code, fault + '\n' + result.output);
    assert.equal(result.output.split(warning).length - 1, 1, fault);
  }
});

for (const kind of ['todo-null', 'todo-cycle', 'todo-primitive', 'todo-deep']) test(`${kind} passes identically with and without telemetry`, { timeout: 30000 }, async t => {
  const run = await cliFixture(t), baseline = await run({ kind, telemetry: false }), result = await run({ kind });
  assert.equal(baseline.code, 0, baseline.output); assert.equal(result.code, baseline.code, result.output);
  assert.equal(result.receipt.receipts[0].firstAttempt.outcome, 'pass');
});

test('broken telemetry leaves isolated retry decisions and exit codes unchanged', async t => {
  const cwd = await scratch(t), files = ['tests/synthetic.test.mjs'];
  // An existing regular file deterministically refuses mkdir on every OS.
  const blocked = path.join(cwd, 'blocked'); await writeFile(blocked, 'synthetic');
  for (const retryPasses of [false, true]) {
    const observed = [];
    for (const telemetry of [false, true]) {
      const ledger = telemetry ? createFileLedger({ cwd, files, destination: path.join(blocked, 'ledger.jsonl') }) : undefined;
      const attempts = [];
      const run = (number, passed) => runAdaptive({ files, cwd, env: {}, memory: () => 8 * GiB,
        minConcurrency: 1, maxConcurrency: 1, policy: () => ({}),
        onAdmit: info => ledger?.onAdmit(info, number), onFile: result => ledger?.onFile(result, number),
        runFile: async ({ file }) => { attempts.push(number); return { file, passed, errors: [new Error('synthetic', { cause: null })] }; } });
      const result = await retryFailedFilesOnce({ result: await run(1, false), enabled: true, runIsolated: () => run(2, retryPasses) });
      ledger?.report();
      observed.push({ passed: result.passed, exitCode: result.exitCode, flaky: result.flaky, attempts });
    }
    assert.deepEqual(observed[1], observed[0]);
  }
});

test('sanitizer and metadata getter failures cannot replace a passing verdict', async t => {
  const cwd = await scratch(t), files = ['tests/synthetic.test.mjs'];
  for (const field of ['errors', 'datasets']) {
    const verdicts = [];
    for (const enabled of [false, true]) {
      const ledger = enabled ? createFileLedger({ cwd, files, destination: path.join(cwd, field + '.jsonl') }) : undefined;
      const result = await runAdaptive({ files, cwd, env: {}, memory: () => 8 * GiB,
        minConcurrency: 1, maxConcurrency: 1, policy: () => ({}),
        onAdmit: info => ledger?.onAdmit(info), onFile: result => ledger?.onFile(result),
        runFile: async ({ file }) => Object.defineProperty({ file, passed: true }, field,
          { get() { throw Error('synthetic-sanitizer-secret'); } }) });
      ledger?.finish();
      verdicts.push({ passed: result.passed, exitCode: result.exitCode });
    }
    assert.deepEqual(verdicts[1], verdicts[0]); assert.equal(verdicts[1].exitCode, 0);
  }
});

test('the runtime dataset receipt writer tolerates EIO on open, both writes and close', { timeout: 30000 }, async t => {
  const cwd = await scratch(t), runtime = new URL('../app/dataset-runtime.mjs', import.meta.url).href;
  for (const fault of ['open', '1', '2', 'close']) {
    const destination = path.join(cwd, fault + '.jsonl');
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const destination = ${JSON.stringify(destination)}, fault = ${JSON.stringify(fault)};
const open = fs.openSync, write = fs.writeSync, close = fs.closeSync; let receipt, count = 0;
const eio = () => { throw Object.assign(Error('synthetic-runtime-io-secret'), {code:'EIO'}); };
fs.openSync = function(file,...args) { if (file === destination && fault === 'open') eio();
  const fd = open.call(this,file,...args); if (file === destination) receipt = fd; return fd; };
fs.writeSync = function(fd,...args) { if (fd === receipt && String(++count) === fault) eio(); return write.call(this,fd,...args); };
fs.closeSync = function(fd) { const result = close.call(this,fd); if (fd === receipt && fault === 'close') eio(); return result; };
syncBuiltinESMExports();
await import(${JSON.stringify(runtime)}); console.log('synthetic-runtime-started');`;
    const env = { ...process.env, RS3_DATASET: 'open-starter', RS3_TEST_DATASET_RECEIPT: destination };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    assert.equal((await once(child, 'close'))[0], 0, output);
    assert.ok(output.includes('synthetic-runtime-started'), output);
    assert.ok(!output.includes('synthetic-runtime-io-secret'), output);
  }
});
