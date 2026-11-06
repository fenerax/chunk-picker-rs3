import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { spec } from 'node:test/reporters';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--help')) {
  console.log('Usage: node scripts/test.mjs [quick|full|differential|engine-differential] [--list] [--shard=N/M]\nFull starts at 2 files and adapts up to 6; quick caps at 2; differential suites default to 1. RS3_TEST_CONCURRENCY (1-6) sets the cap. Every admission reserves 1 GiB per active worker above a 4 GiB free-memory floor.');
} else if (isMain) {
  const { discoverTests, adaptiveOptionsFor, testRunPolicy } = await import('./test-selection.mjs');
  const suite = process.argv[2] ?? 'full';
  const options = process.argv.slice(3);
  if (process.env.RS3_COVERAGE_REPORT && (!['full', 'differential'].includes(suite) || options.includes('--list'))) throw new Error('Coverage reports require a full or differential test run');
  if (options.some(option => !['--list', '--affected-first'].includes(option) && !/^--shard=\d+\/\d+$/.test(option))) throw new Error('Only --list, --affected-first and --shard=N/M are supported');
  let files = await discoverTests(undefined, suite);
  const shards = options.filter(option => option.startsWith('--shard='));
  if (shards.length > 1 || shards.length && suite !== 'full') throw new Error('Sharding requires one full-suite shard');
  if (shards.length) {
    const [index, count] = shards[0].slice(8).split('/').map(Number);
    const { shardTests } = await import('./ci/test-shards.mjs');
    const plan = await shardTests(files, count);
    if (index < 1 || index > count) throw new Error('Invalid shard index');
    files = plan[index - 1].files;
    console.log(`Shard ${index}/${count}: estimated ${(plan[index - 1].estimatedMs / 60000).toFixed(1)} minutes (${(plan[index - 1].wallMs / 60000).toFixed(1)} serial)`);
  }
  let prefix = [];
  if (options.includes('--affected-first')) {
    if (!shards.length) throw Error('--affected-first requires a full-suite shard');
    const { affectedSelection } = await import('./test-affected.mjs');
    const { orderShardPrefix } = await import('./ci/test-shards.mjs');
    const selection = await affectedSelection({ base: process.env.AFFECTED_BASE || 'origin/main' });
    prefix = orderShardPrefix(files, selection.files, testRunPolicy);
    console.log(`Affected prefix: ${prefix.length}/${files.length} files; ${selection.uncertain.length} uncertain nodes`);
  }
  console.log(`${suite}: ${files.length} test files`);
  if (options.includes('--list')) {
    console.log([...prefix, ...files.filter(file => !prefix.includes(file))].map(name => `tests/${name}`).join('\n'));
  } else {
    await runSelectedTests(files, { suite, prefix, failFast: options.includes('--affected-first'), options: adaptiveOptionsFor(suite) });
  }
}

// Shared execution keeps affected checks on the same dataset, telemetry and
// native reporting path as the merge gate. Selection never imports test code.
export async function runTestPhases(files, prefix, run) {
  if (new Set(prefix).size !== prefix.length || prefix.some(file => !files.includes(file))) throw Error('Invalid affected prefix');
  const groups = prefix.length ? [prefix, files.filter(file => !prefix.includes(file))] : [files];
  for (const [index, group] of groups.entries()) {
    if (!group.length) continue;
    const result = await run(group, prefix.length > 0 && index === 0);
    if (!result.passed) return result;
  }
  return { passed: true, exitCode: 0 };
}
export async function runSelectedTests(files, { suite = 'full', options = {}, failFast = false, prefix = [] } = {}) {
  if (new Set(prefix).size !== prefix.length || prefix.some(file => !files.includes(file))) throw Error('Invalid affected prefix');
  if (!files.length) return;
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const ledgerDestination = process.env.RS3_TEST_FILE_LEDGER;
  const ledger = ledgerDestination ? (await import('./ci/file-ledger.mjs')).createFileLedger({
    destination: ledgerDestination, cwd, files: files.map(name => `tests/${name}`),
    lane: process.env.RS3_COVERAGE_LANE ?? 'test' }) : undefined;
  const coverage = process.env.RS3_COVERAGE_REPORT ? (await import('./ci/coverage-reporter.mjs')).createCoverageReporter({
    lane: process.env.RS3_COVERAGE_LANE ?? (suite === 'differential' ? 'differential' : 'test'), cwd, files: files.map(name => `tests/${name}`) }) : undefined;
  const { testRunEnvironment } = await import('./test-run-environment.mjs');
  const { runAdaptive } = await import('./adaptive-test-runner.mjs');
  const environment = await testRunEnvironment();
  // Only this controller owns the report. Tests that spawn the CLI must not
  // inherit the destination or overwrite the full run with a nested run.
  delete environment.env.RS3_COVERAGE_REPORT;
  delete environment.env.RS3_COVERAGE_LANE;
  delete environment.env.RS3_TEST_FILE_LEDGER;
  delete environment.env.RS3_TEST_DATASET_RECEIPT;
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, abort);
  const events = new PassThrough({ objectMode: true });
  let reportingError;
  // spec is a reporter factory: passed uncalled, pipeline treats it as a transform
  // whose result never reads `events`, and the run stalls after 16 events.
  const reporting = pipeline(events, spec(), async source => {
    for await (const chunk of source) if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
  }).catch(error => { reportingError = error; controller.abort(); });
  const write = async event => { if (reportingError) throw reportingError; if (!events.write(event)) await once(events, 'drain'); };
  // spec matches each pass/fail to the latest start on one stack, so overlapping
  // files must not interleave. Hold each file's events until its controller exits.
  const held = new Map();
  const flush = async key => { const queue = held.get(key) ?? []; held.delete(key); for (const event of queue) await write(event); };
  try {
    const result = await runTestPhases(files, prefix, (group, affected) => runAdaptive({ files: group.map(name => `tests/${name}`),
      ...options, ...(affected ? { soloFirst: false } : {}), cwd, env: environment.env, signal: controller.signal,
      datasetRoot: ledger ? path.join(path.dirname(ledgerDestination), '.test-datasets') : undefined,
      onAdmit: info => ledger?.onAdmit(info), onFileError: result => ledger?.onFile(result),
      onEvent: async event => {
        coverage?.onEvent(event);
        // A case's file can be a shared helper; entryFile names the test file that ran it.
        const file = event.data?.entryFile ?? event.data?.file;
        if (!file) return write(event);
        const key = path.resolve(cwd, file).toLowerCase();
        if (!held.has(key)) held.set(key, []);
        held.get(key).push(event);
      },
      onFile: result => {
        ledger?.onFile(result); coverage?.onFile(result);
        if (failFast && !result.passed) controller.abort();
        return flush(path.resolve(cwd, result.file).toLowerCase());
      } }));
    if (coverage) await coverage.write(process.env.RS3_COVERAGE_REPORT, { passed: result.passed && !controller.signal.aborted });
    process.exitCode = result.exitCode || (controller.signal.aborted ? 1 : 0);
  } finally {
    ledger?.report();
    for (const key of [...held.keys()]) await flush(key).catch(() => {});
    events.end();
    await reporting;
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, abort);
    await environment.cleanup();
  }
  if (reportingError) throw reportingError;
}
