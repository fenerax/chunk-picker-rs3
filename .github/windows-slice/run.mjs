// Windows job of the Tests workflow: runs the Windows-bound test files on a
// hosted Windows runner. A signal only: release evidence still comes from the
// release PC until a verified import exists.
// Usage: node run.mjs <checkout> <work dir> [--check]
// --check validates the file list and the lane environment, then stops.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// The files that skip Windows/PowerShell cases or fail off Windows, from the P3
// cloud probe (reports/cloud-lane-probe.md on claude/keen-einstein-cxt4ri):
// 96 cases across 15 files skip on Linux, plus release-pipeline-v2.
export const windowsFiles = [
  'backup-status.private.test.mjs',
  'cutover-live.test.mjs',
  'operations-degraded.test.mjs',
  'operations-forced.test.mjs',
  'operations-graceful.test.mjs',
  'operations-owner.test.mjs',
  'operations.test.mjs',
  'operator-cutover.test.mjs',
  'private-live-swap.test.mjs',
  'release-admission-v2.test.mjs',
  'release-pack-upgrade-v2.test.mjs',
  'release-pipeline-v2.test.mjs',
  'release-runtime-v2.test.mjs',
  'restore-picker.private.test.mjs',
  'watchdog-core.test.mjs',
  'watchdog-script.test.mjs',
];

const GiB = 1024 ** 3;
const check = process.argv.includes('--check');
const [checkout, work] = process.argv.slice(2).filter(item => item !== '--check').map(item => path.resolve(item));
if (!checkout || !work) throw new Error('Usage: node run.mjs <checkout> <work>');
if (process.platform !== 'win32') throw new Error('The Windows slice only means something on Windows.');

// One repository now, so the tests run in the checkout itself.
const assembly = checkout, release = path.join(work, 'r');
const load = file => import(pathToFileURL(path.join(assembly, file)).href);

// A renamed or reclassified file must fail here, not silently drop out of the slice.
const { discoverTests } = await load('scripts/test-selection.mjs');
const inventory = new Set(await discoverTests(path.join(assembly, 'tests'), 'full'));
const missing = windowsFiles.filter(name => !inventory.has(name));
if (missing.length) throw new Error('Windows slice names files outside the full inventory: ' + missing.join(', '));

const { laneEnvironment } = await load('scripts/private-companion/release-evidence.mjs');
const { runAdaptive } = await load('scripts/adaptive-test-runner.mjs');
const { retryFailedFilesOnce } = await load('scripts/private-companion/retry-failed-files.mjs');
for (const dir of ['.local/lane-temp', '.local/lane-home/AppData/Local', '.local/lane-home/AppData/Roaming', '.local/compile-cache'])
  await mkdir(path.join(release, dir), { recursive: true });
// The full lane's overrides. The game-data and map folders stay absent: no packs here.
const env = await laneEnvironment(release, process.execPath, {
  RS3_TEST_CONCURRENCY: '2', RS3_TEST_RETRY_ONCE_IN_ISOLATION: '1',
  RS3_GAME_DATA_DIR: path.join(assembly, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(assembly, '.local/map-assets'),
  RS3_PUBLIC_BROWSER_SCREEN_HARNESS: path.join(checkout, 'tests/browser-screen-harness.mjs'),
});

if (check) { console.log(`Check passed: ${windowsFiles.length} files in the inventory; lane PATH ${env.PATH}`); process.exit(0); }
console.log(`Node ${process.version}; memory ${(freemem() / GiB).toFixed(1)} of ${(totalmem() / GiB).toFixed(1)} GiB free; ${windowsFiles.length} files`);
const output = new Map(), failures = new Map();
const keyOf = file => path.basename(file);
const onEvent = async ({ type, data }) => {
  const file = data?.entryFile ?? data?.file;
  if (!file) return;
  const key = keyOf(file);
  if (type === 'test:stdout' || type === 'test:stderr') output.set(key, (output.get(key) ?? '') + data.message);
  if (type === 'test:fail' && data.details?.type !== 'suite') {
    // Errors cross the worker IPC as structured clones; inspect keeps what survives.
    const cause = data.details?.error?.cause ?? data.details?.error;
    const text = typeof cause?.message === 'string' && cause.message ? (cause.stack ?? cause.message) : inspect(cause, { depth: 4, breakLength: 160 });
    const list = failures.get(key) ?? [];
    list.push(`${data.name}: ${String(cause?.message ?? cause).split('\n').slice(0, 6).join('\n    ')}`);
    failures.set(key, list);
  }
};
const onFile = async result => {
  const c = result.summary?.counts ?? {};
  console.log(`${result.passed ? 'pass' : 'FAIL'} ${keyOf(result.file)}  tests ${c.tests} pass ${c.passed} fail ${c.failed} skipped ${c.skipped}  ${(result.processWallMs / 1000).toFixed(1)} s`);
  if (!result.passed) {
    for (const line of failures.get(keyOf(result.file)) ?? []) console.log('    ' + line);
    const tail = (output.get(keyOf(result.file)) ?? '').trim().split('\n').slice(-30).join('\n');
    if (tail) console.log('    --- output tail ---\n' + tail);
  }
};

// runAdaptive never admits below its 4 GiB floor. Fail clearly instead of
// waiting out the job timeout if the runner is too small.
const run = (files, maxConcurrency) => {
  for (const name of files) { output.delete(keyOf(name)); failures.delete(keyOf(name)); }
  const controller = new AbortController();
  let idleSince = Date.now(), starved = false;
  const onSchedule = async ({ freeBytes, active, pending }) => {
    if (active || !pending) { idleSince = Date.now(); return; }
    if (Date.now() - idleSince > 120000) {
      starved = true;
      console.log(`No file admitted for 120 s: ${(freeBytes / GiB).toFixed(2)} GiB free, below the runner's 4 GiB floor plus 1 GiB per worker.`);
      controller.abort();
    }
  };
  return runAdaptive({ files: files.map(name => 'tests/' + keyOf(name)), cwd: assembly,
    env: { ...env, RS3_TEST_CONCURRENCY: String(maxConcurrency) }, signal: controller.signal,
    minConcurrency: 1, maxConcurrency, onEvent, onFile, onSchedule })
    .then(result => ({ ...result, starved }));
};
const started = Date.now();
let result = await run(windowsFiles, 2);
// The shared flaky policy: a failed file reruns once alone and passes as FLAKY.
result = await retryFailedFilesOnce({ result, enabled: !result.starved, runIsolated: files => run(files, 1),
  onFlaky: async file => console.log(`FLAKY ${keyOf(file.file)}: failed, then passed alone`) });

// Diagnostics only, never a verdict: a failure's cause can be lost crossing the
// runner's IPC, so rerun each still-failing file with the spec reporter in-process.
for (const file of result.starved ? [] : result.files.filter(item => !item.passed)) {
  const name = 'tests/' + keyOf(file.file);
  const rerun = spawnSync(process.execPath, ['--test', '--test-reporter=spec', name], { cwd: assembly, env, encoding: 'utf8', timeout: 300000, windowsHide: true });
  const lines = `${rerun.stdout ?? ''}${rerun.stderr ?? ''}`.split('\n');
  const first = Math.max(0, lines.findIndex(line => /failing tests:/.test(line)));
  console.log(`\n--- spec rerun of ${name} (exit ${rerun.status}, diagnostic only) ---\n` + lines.slice(first, first + 120).join('\n'));
}

const rows = result.files.map(file => ({ file: keyOf(file.file), passed: file.passed, flaky: file.flaky === true,
  counts: file.summary?.counts ?? null, processWallMs: Math.round(file.processWallMs ?? 0) })).sort((a, b) => a.file.localeCompare(b.file));
const summary = { schema: 'rs3-windows-slice-v1', node: process.version, passed: result.passed === true, starved: result.starved === true,
  wallMs: Date.now() - started, maxActive: result.maxActive, counts: result.summary?.counts ?? null,
  notRun: windowsFiles.filter(name => !rows.some(row => row.file === name)), files: rows };
await writeFile(path.join(work, 'windows-slice.json'), JSON.stringify(summary, null, 2) + '\n');

const c = summary.counts ?? {};
const lines = [`### Windows slice: ${summary.passed ? 'passed' : 'FAILED'}`, '',
  `${rows.length}/${windowsFiles.length} files, ${c.tests ?? '?'} tests, ${c.passed ?? '?'} pass, ${c.failed ?? '?'} fail, ${c.skipped ?? '?'} skipped, ${(summary.wallMs / 1000).toFixed(0)} s, Node ${process.version}`, '',
  '| File | Result | Tests | Fail | Skipped | Seconds |', '|---|---|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.file} | ${row.passed ? (row.flaky ? 'FLAKY' : 'pass') : 'FAIL'} | ${row.counts?.tests ?? ''} | ${row.counts?.failed ?? ''} | ${row.counts?.skipped ?? ''} | ${(row.processWallMs / 1000).toFixed(1)} |`)];
if (summary.notRun.length) lines.push('', 'Not run: ' + summary.notRun.join(', '));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
console.log('\n' + lines.join('\n'));
process.exitCode = summary.passed ? 0 : 1;
