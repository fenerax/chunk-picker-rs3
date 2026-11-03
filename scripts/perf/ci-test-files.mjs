// Compare isolated test-file lifetimes across existing checkouts. Run only
// synthetic test fixtures; this harness never opens an application save.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sampleMemoryTree } from './profile-stack/memory.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('Node 24.20 or newer is required.');
const [root, destination, pattern = 'server|scheduler|calculator|browser|picker|worker|residency|advisory|prediction|startup|scheduling', repetitions = '1', deadline] = process.argv.slice(2);
if (!root || !destination) throw new Error('Usage: node scripts/perf/ci-test-files.mjs <checkout> <output.jsonl> [file-name regex] [repetitions] [deadline ms]');
const count = Number(repetitions);
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Repetitions must be a positive integer.');
const cwd = path.resolve(root), output = path.resolve(destination);
const load = name => import(pathToFileURL(path.join(cwd, 'scripts', `${name}.mjs`)).href);
const { discoverTests, adaptiveOptionsFor } = await load('test-selection');
const { runAdaptive, DEFAULT_FILE_DEADLINE_MS } = await load('adaptive-test-runner');
const { testRunEnvironment } = await load('test-run-environment');
const fileDeadlineMs = deadline === undefined ? DEFAULT_FILE_DEADLINE_MS : Number(deadline);
if (!Number.isSafeInteger(fileDeadlineMs) || fileDeadlineMs < 1) throw new Error('Deadline must be a positive integer.');
const filter = new RegExp(pattern);
const files = (await discoverTests(undefined, 'full')).filter(name => filter.test(name)).map(name => `tests/${name}`);
if (!files.length) throw new Error('No matching test files.');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
await writeFile(output, '');
const record = value => appendFile(output, JSON.stringify(value) + '\n');
const controller = new AbortController();
const abort = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, abort);
try {
  for (let run = 1; run <= count && !controller.signal.aborted; run++) {
    const environment = await testRunEnvironment();
    let sampledPeakRssBytes = 0, memorySamples = 0, completeMemorySamples = 0;
    let pendingSample = Promise.resolve();
    const sample = () => { pendingSample = pendingSample.then(async () => {
      const value = await sampleMemoryTree(process.pid);
      sampledPeakRssBytes = Math.max(sampledPeakRssBytes, value.rssBytes);
      memorySamples++; if (value.complete) completeMemorySamples++;
    }); };
    sample();
    const sampler = setInterval(sample, 250); sampler.unref();
    try {
      const result = await runAdaptive({ files, cwd, env: environment.env, signal: controller.signal,
        ...adaptiveOptionsFor('full'), fileDeadlineMs,
        onFile: async result => {
          await record({ kind: 'file', run, ...result });
          console.log(`${run} ${result.timedOut ? 'TIMEOUT' : result.passed ? 'PASS' : 'FAIL'} ${result.file} ${(result.processWallMs / 1000).toFixed(3)}s`);
        } });
      clearInterval(sampler); await pendingSample;
      await record({ kind: 'run', run, commit, node: process.version, wallMs: result.wallMs,
        maxActive: result.maxActive, passed: result.passed, summary: result.summary, fileDeadlineMs,
        sampledPeakRssBytes, memorySamples, completeMemorySamples });
      console.log(JSON.stringify({ run, wallMs: result.wallMs, counts: result.summary.counts }));
      if (!result.passed) process.exitCode = 1;
    } finally { clearInterval(sampler); await pendingSample; await environment.cleanup(); }
  }
} finally {
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, abort);
}
