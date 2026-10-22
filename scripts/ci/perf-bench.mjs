#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm, realpath, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRequest, measurementPlan, SAVE_SHA256, estimatedSeconds } from './perf-bench-config.mjs';
import { compareSamples, extractMetrics, reportMarkdown } from './perf-bench-report.mjs';
import { requireHeavyLock, rejectPathLinks } from '../perf/inputs.mjs';
import { safeDiagnostic, safeStderrTail } from '../perf/diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function harnessHash() {
  const hash = createHash('sha256');
  for (const folder of ['scripts/perf', 'scripts/ci']) for (const filename of (await readdir(path.join(ROOT, folder))).sort()) {
    if (!filename.endsWith('.mjs') || folder === 'scripts/ci' && !filename.startsWith('perf-bench')) continue;
    hash.update(`${folder}/${filename}\0`); hash.update(await readFile(path.join(ROOT, folder, filename)));
  }
  return hash.digest('hex');
}
export async function verifySave(filename, expected = SAVE_SHA256) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid expected save checksum.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  if (hash.digest('hex') !== expected) throw Error('Save SHA256 mismatch; import refused.');
  return expected;
}

export function parseArguments(args) {
  const values = {};
  const allowed = ['a-dir', 'b-dir', 'save', 'save-sha256', 'packs-dir', 'pack-selection', 'request', 'output-dir', 'scenarios', 'runs', 'options', 'chrome', 'dataset', 'validate-request'];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--help') return { help: true };
    const key = args[index]?.slice(2);
    if (!args[index]?.startsWith('--') || !allowed.includes(key) || values[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('Invalid benchmark arguments.');
    values[key] = args[index + 1];
  }
  return values;
}

function execute(script, args, { env, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    // App output is intentionally not inherited: an app error may contain save data.
    const child = spawn(process.execPath, [script, ...args], { env, cwd, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let tail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-32768); });
    child.once('error', () => reject(Error('Benchmark child could not start.')));
    child.once('close', (code, signal) => {
      if (code === 0) return resolve();
      const error = Error(`Benchmark child failed (${signal ?? code}).`);
      error.stderrTail = safeStderrTail(tail); reject(error);
    });
  });
}

export async function runBenchmark(values, dependencies = {}) {
  const runChild = dependencies.execute ?? execute;
  const requestFile = values.request ? JSON.parse(await readFile(values.request, 'utf8')) : {};
  const request = normalizeRequest({ ...requestFile,
    ...(values.scenarios ? { scenarios: values.scenarios.split(',') } : {}),
    ...(values.runs ? { runs: Number(values.runs) } : {}),
    ...(values.options ? { options: JSON.parse(values.options) } : {}) });
  if (!values['a-dir'] || !values['b-dir'] || !values.save || !values['packs-dir']) throw Error('A dir, B dir, save and packs dir are required.');
  const expectedSave = values['save-sha256'] ?? SAVE_SHA256;
  await verifySave(values.save, expectedSave); // Before reading any application modules.
  if (!dependencies.execute && process.env.GITHUB_ACTIONS !== 'true') await requireHeavyLock();
  const checkout = { A: await rejectPathLinks(values['a-dir']), B: await rejectPathLinks(values['b-dir']) };
  const revisions = {};
  for (const arm of ['A', 'B']) {
    revisions[arm] = dependencies.revision ? await dependencies.revision(checkout[arm])
      : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout[arm], encoding: 'utf8', windowsHide: true }).trim();
    if (!/^[a-f0-9]{40}$/.test(revisions[arm])) throw Error('Invalid checkout revision.');
  }
  if (request.base && (request.base !== revisions.A || request.candidate !== revisions.B)) throw Error('Checkouts differ from request commits.');
  const packs = await rejectPathLinks(values['packs-dir']);
  const selection = await rejectPathLinks(values['pack-selection'] ?? path.join(packs, 'selection.json'));
  const dataset = values.dataset ?? 'duo-legacy';
  if (!['duo-legacy', 'open-f2p'].includes(dataset)) throw Error('Invalid dataset.');
  const output = path.resolve(values['output-dir'] ?? path.join(ROOT, '.local/perf/gh-report'));
  await mkdir(output, { recursive: true });
  const scratchRoot = path.join(ROOT, '.local/perf-ci');
  await mkdir(scratchRoot, { recursive: true });
  await rejectPathLinks(scratchRoot);
  const scratch = await mkdtemp(path.join(scratchRoot, 'scratch-'));
  const rawRoot = path.join(ROOT, '.local/perf');
  await mkdir(rawRoot, { recursive: true });
  const label = path.basename(scratch);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('RS3_'))),
    RS3_DATASET: dataset, RS3_PACKS_DIR: packs, RS3_PACK_SELECTION: selection,
    RS3_SCRATCH_CDP_PORT: '8961' };
  // A clean pack environment: operator profiles or locally installed sidecars must
  // never silently influence a public-pack run.
  for (const key of ['NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[key];
  const samples = [], rawFiles = [];
  const report = { schemaVersion: 1, complete: false, base: revisions.A, candidate: revisions.B,
    capturedAt: new Date().toISOString(), saveSha256: expectedSave, harnessSha256: await harnessHash(), request, estimatedSeconds: estimatedSeconds(request),
    method: 'Alternating A,B app trials, same harness; each view starts a fresh scratch server/browser. Lower is better; strict non-overlapping min–max at n>=3.',
    samples, summary: [] };
  const started = performance.now();
  let failed, stage = { operation: 'import', arm: 'A' };
  try {
    for (const arm of ['A', 'B']) {
      stage = { operation: 'import', arm };
      await verifySave(values.save, expectedSave);
      console.log(`Importing arm ${arm}.`);
      await runChild(path.join(ROOT, 'scripts/ci/perf-bench-import.mjs'),
        [checkout[arm], path.resolve(values.save), path.join(scratch, arm)], { env });
    }
    for (const trial of measurementPlan(request)) {
      stage = { operation: 'measure', arm: trial.arm, run: trial.run, groupView: trial.groupView };
      console.log(`Measuring ${trial.arm} ${trial.run}/${request.runs}, group ${trial.groupView}.`);
      const raw = path.join(rawRoot, `${label}-${trial.arm}-${trial.run}-${trial.groupView}.json`);
      rawFiles.push(raw, raw.replace(/\.json$/, '.md'), raw.replace(/\.json$/, '-partial.json'));
      const args = ['--app-dir', checkout[trial.arm], '--server-revision', revisions[trial.arm],
        '--source', path.join(scratch, trial.arm), '--packs-dir', packs, '--pack-selection', selection,
        '--runs', '1', '--output', raw, '--label', `${label}-${trial.arm}-${trial.run}-${trial.groupView}`,
        '--scenarios', trial.scenarios.join(','), '--group-view', trial.groupView, '--port', '8960',
        '--settlement', request.options.settlement, '--timeout', String(request.options.timeoutMs),
        '--unlock-member', request.options.unlockMember, '--unlock-pick', request.options.unlockPick,
        '--unlock-preview', request.options.unlockPreview, '--unlock-dwell-ms', String(request.options.unlockDwellMs),
        '--screenshots', request.options.screenshots ? 'responsive' : 'off'];
      if (values.chrome) args.push('--chrome', path.resolve(values.chrome));
      await runChild(path.join(ROOT, 'scripts/perf/page-load.mjs'), args, { env });
      const rawReport = JSON.parse(await readFile(raw, 'utf8'));
      if (request.options.screenshots) {
        const destination = path.join(output, 'screenshots'); await mkdir(destination, { recursive: true });
        let index = 0;
        for (const suite of rawReport.suites ?? []) for (const screenshot of suite.screenshots ?? []) {
          const filename = await rejectPathLinks(path.resolve(ROOT, screenshot.path));
          const relative = path.relative(rawRoot, filename);
          if (relative.startsWith('..') || path.isAbsolute(relative) || !filename.endsWith('.png')) throw Error('Unsafe screenshot path refused.');
          await copyFile(filename, path.join(destination, `${trial.arm}-${trial.run}-${trial.groupView}-${++index}.png`));
        }
      }
      const sourceHash = rawReport.applicationSource?.sha256;
      const fixtureHash = rawReport.fixture?.sha256;
      const prior = samples.find(sample => sample.arm === trial.arm);
      if (!/^[a-f0-9]{64}$/.test(sourceHash ?? '') || !/^[a-f0-9]{64}$/.test(fixtureHash ?? '')
        || prior && (sourceHash !== prior.applicationSha256 || fixtureHash !== prior.fixtureSha256)) throw Error('App or imported fixture changed between repetitions.');
      samples.push({ run: trial.run, arm: trial.arm, groupView: trial.groupView,
        applicationSha256: sourceHash, fixtureSha256: fixtureHash, datasetDigest: rawReport.suites?.[0]?.server?.dataset?.digest ?? null,
        environment: { node: rawReport.environment?.node, chrome: rawReport.environment?.chrome, platform: rawReport.environment?.platform,
          chromeExtraArgs: (rawReport.environment?.chromeExtraArgs ?? []).filter(flag => ['--no-sandbox', '--disable-dev-shm-usage'].includes(flag)) },
        metrics: extractMetrics(rawReport) });
    }
    if (await harnessHash() !== report.harnessSha256) throw Error('Harness changed during paired measurement.');
    report.complete = true;
  } catch (error) {
    report.failure = 'A benchmark child or integrity check failed. Completed scalar samples are retained; no app logs are published.';
    report.failureContext = stage;
    report.diagnostic = safeDiagnostic(error, { stage: stage.operation });
    report.diagnostic.stderrTail = safeStderrTail((error.stderrTail ?? []).join('\n'));
    console.error(`Benchmark failure: ${JSON.stringify({ ...stage, ...report.diagnostic })}`);
    failed = Error(report.failure);
  } finally {
    report.wallSeconds = (performance.now() - started) / 1000;
    report.summary = compareSamples(samples, request.runs);
    await writeFile(path.join(output, 'perf-report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(path.join(output, 'perf-report.md'), reportMarkdown(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, reportMarkdown(report, { short: true }));
    // Only delete this invocation's generated directory, after all children exit.
    const resolved = await realpath(scratch), base = await realpath(scratchRoot);
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('scratch-')) throw Error('Unsafe scratch cleanup refused.');
    await rm(resolved, { recursive: true, force: true, maxRetries: 5 });
    for (const filename of rawFiles) await rm(filename, { force: true });
  }
  if (failed) throw failed;
  return report;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  if (values.help) { console.log('node scripts/ci/perf-bench.mjs --a-dir A --b-dir B --save FILE --packs-dir DIR [--request FILE] [--scenarios LIST] [--runs N] [--output-dir DIR]'); return; }
  if (values['validate-request']) {
    const request = normalizeRequest(JSON.parse(await readFile(values['validate-request'], 'utf8')), { requireRevisions: true });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `base=${request.base}\ncandidate=${request.candidate}\nscreenshots=${request.options.screenshots}\n`);
    console.log(`Request valid; estimated runner time ${Math.ceil(estimatedSeconds(request) / 60)} minutes.`); return;
  }
  await runBenchmark(values);
  console.log('Performance reports written.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Performance run failed; inspect the scalar report if present.'); process.exitCode = 1;
});
