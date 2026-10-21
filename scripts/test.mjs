import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { spec } from 'node:test/reporters';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/test.mjs [quick|full] [--list]\nFull starts at 2 files and adapts up to 6; quick caps at 2. RS3_TEST_CONCURRENCY (1-6) sets the cap. Every admission reserves 1 GiB per active worker above a 4 GiB free-memory floor.');
} else {
  const { discoverTests, adaptiveOptionsFor } = await import('./test-selection.mjs');
  const suite = process.argv[2] ?? 'full';
  const options = process.argv.slice(3);
  if (options.some(option => option !== '--list')) throw new Error('Only --list is supported');
  const files = await discoverTests(undefined, suite);
  console.log(`${suite}: ${files.length} test files`);
  if (options.includes('--list')) {
    console.log(files.map(name => `tests/${name}`).join('\n'));
  } else {
    const { testRunEnvironment } = await import('./test-run-environment.mjs');
    const { runAdaptive } = await import('./adaptive-test-runner.mjs');
    const environment = await testRunEnvironment();
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
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const held = new Map();
    const flush = async key => { const queue = held.get(key) ?? []; held.delete(key); for (const event of queue) await write(event); };
    try {
      const result = await runAdaptive({ files: files.map(name => `tests/${name}`),
        ...adaptiveOptionsFor(suite), cwd, env: environment.env, signal: controller.signal,
        onEvent: async event => {
          // A case's file can be a shared helper; entryFile names the test file that ran it.
          const file = event.data?.entryFile ?? event.data?.file;
          if (!file) return write(event);
          const key = path.resolve(cwd, file).toLowerCase();
          if (!held.has(key)) held.set(key, []);
          held.get(key).push(event);
        },
        onFile: result => flush(path.resolve(cwd, result.file).toLowerCase()) });
      process.exitCode = result.exitCode;
    } finally {
      for (const key of [...held.keys()]) await flush(key).catch(() => {});
      events.end();
      await reporting;
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, abort);
      await environment.cleanup();
    }
    if (reportingError) throw reportingError;
  }
}
