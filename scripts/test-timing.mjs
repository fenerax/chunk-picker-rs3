import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverTests, fullConcurrency } from './test-selection.mjs';
import { testRunEnvironment } from './test-run-environment.mjs';

const [label, concurrencyArg = String(fullConcurrency), ...targetFiles] = process.argv.slice(2);
const concurrency = Number(concurrencyArg);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
  throw new Error('Usage: node scripts/test-timing.mjs <label> [1-4] [tests/<file>.test.mjs ...]');
}
const lockPath = process.env.RS3_HEAVY_LOCK_PATH;
if (!lockPath) throw new Error('Timing runs require .local/with-heavy.ps1');
const owner = JSON.parse((await readFile(path.join(lockPath, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
if (owner.token !== process.env.RS3_HEAVY_LOCK_TOKEN || String(owner.pid) !== process.env.RS3_HEAVY_LOCK_PID) {
  throw new Error('Shared heavy-work lock is not owned by this command');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.local/test-speed');
await mkdir(directory, { recursive: true });
const reportPath = path.join(directory, `${label}.json`);
const discovered = await discoverTests(undefined, 'full');
if (targetFiles.some(name => !name.startsWith('tests/') || !discovered.includes(name.slice(6)))) {
  throw new Error('Targeted timing files must be discovered tests/<file>.test.mjs paths');
}
if (new Set(targetFiles).size !== targetFiles.length) throw new Error('Duplicate targeted timing files');
const files = targetFiles.length ? targetFiles.map(name => name.slice(6)).sort() : discovered;
// An interrupted rerun must never reuse a previous label's passing report.
await rm(reportPath, { force: true });
const run = await testRunEnvironment();
function sourceState() {
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    return { commit: git(['rev-parse', 'HEAD']), trackedChanges: Boolean(git(['status', '--porcelain', '--untracked-files=no'])) };
  } catch { return { error: 'Source metadata unavailable' }; }
}
try {
  const sourceAtStart = sourceState();
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const child = spawn(process.execPath, ['--test', ...(targetFiles.length ? ['--test-timeout=120000'] : []), `--test-concurrency=${concurrency}`,
    '--test-reporter=./scripts/test-timing-reporter.mjs', ...files.map(name => `tests/${name}`)], {
    cwd: root, stdio: 'inherit', env: { ...run.env, RS3_TEST_TIMING_REPORT: reportPath }, windowsHide: true,
  });
  const memory = spawn('powershell.exe', ['-NoProfile', '-File', 'scripts/test-memory.ps1', '-RunnerPid', String(child.pid)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let memoryOutput = '', memoryError = '';
  memory.stdout.setEncoding('utf8').on('data', value => { memoryOutput += value; });
  memory.stderr.setEncoding('utf8').on('data', value => { memoryError += value; });
  const memoryDone = new Promise((resolve, reject) => { memory.once('error', reject); memory.once('close', resolve); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const wallMs = performance.now() - start;
  await memoryDone;
  if (memoryError) throw new Error(`Memory sampler failed: ${memoryError}`);
  const sampled = JSON.parse(memoryOutput);
  if (!(sampled.peakWorkingSetBytes > 0) || !sampled.samples) throw new Error('Memory sampler did not capture the run');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (report.files.length !== files.length) throw new Error(`Expected ${files.length} file timings, got ${report.files.length}`);
  Object.assign(report, { label, startedAt, wallMs, concurrency, node: process.version,
    sourceCommit: sourceAtStart.commit, sourceAtStart, sourceAtEnd: sourceState(),
    scope: targetFiles.length ? 'targeted' : 'full', order: 'node-cli-alphabetical',
    nodeOptions: [], timeoutMs: targetFiles.length ? 120000 : null,
    machine: { hostname: hostname(), cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    compileCache: run.env.NODE_COMPILE_CACHE ? 'enabled (source-validated native bytecode)' : 'disabled',
    memory: sampled,
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved ${reportPath}: ${(wallMs / 1000).toFixed(2)}s, peak ${(report.memory.peakWorkingSetBytes / 1024 ** 2).toFixed(0)} MiB`);
  process.exitCode = code ?? 1;
} catch (error) {
  await rm(reportPath, { force: true });
  throw error;
} finally { await run.cleanup(); }
