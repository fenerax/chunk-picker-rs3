import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { runAdaptive } from '../adaptive-test-runner.mjs';
import { testRunEnvironment } from '../test-run-environment.mjs';
import { laneEnvironment } from '../private-companion/release-evidence.mjs';
import { errorRedactor } from './file-ledger.mjs';
import { redact } from '../test-timing-reporter.mjs';

// Keep original assertion/error details in the job log, but never publish machine
// paths or credentials. Receipts use the stricter existing finite-vocabulary redactor.
export function diagnostic(error, cwd = process.cwd()) {
  return redact(inspect(error, { depth: 5, colors: false }))
    .replaceAll(cwd, '.').replaceAll(cwd.replaceAll('\\', '/'), '.')
    .replace(/[A-Za-z]:[\\/][^\s'"<>)]*/g, '[external-path]')
    .replace(/(?<![\w.])\/[A-Za-z0-9_.-]+(?:\/[^\s'"<>)]*)?/g, '[external-path]');
}

export async function executeShard(task, { run, save, log = console.log }) {
  const rows = [], redactError = errorRedactor();
  for (const attempt of task.attempts) {
    log(`${attempt.file} ${task.os}: repetition ${attempt.repetition}/${attempt.total} (first attempt)`);
    const started = performance.now();
    let result, failure;
    try { result = await run(attempt.file); } catch (error) { failure = error; log(diagnostic(error)); }
    const file = result?.files?.[0];
    const passed = !failure && result?.passed === true && result.files.length === 1 && file.passed === true;
    rows.push({ ...attempt, os: task.os, passed, durationMs: Math.round(performance.now() - started),
      errors: (failure ? [failure] : file?.errors ?? []).map(redactError) });
    // Persist every outcome immediately. Never overwrite a failed first attempt.
    await save(rows);
    if (!passed) { log(`FAILED ${attempt.file} repetition ${attempt.repetition}/${attempt.total}; stopping without retry`); return { passed: false, rows }; }
  }
  return { passed: true, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const task = JSON.parse(process.env.STABILITY_TASK);
  const cwd = process.cwd(), work = path.resolve(process.argv[2] ?? path.join('.local/stability', task.id));
  await mkdir(work, { recursive: true });
  let environment;
  if (task.os === 'windows') {
    const release = path.join(work, 'r');
    for (const dir of ['.local/lane-temp', '.local/lane-home/AppData/Local', '.local/lane-home/AppData/Roaming', '.local/compile-cache'])
      await mkdir(path.join(release, dir), { recursive: true });
    environment = { env: await laneEnvironment(release, process.execPath, {
      RS3_TEST_CONCURRENCY: '1', RS3_TEST_RETRY_ONCE_IN_ISOLATION: '0',
      RS3_GAME_DATA_DIR: path.join(cwd, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(cwd, '.local/map-assets'),
      RS3_PUBLIC_BROWSER_SCREEN_HARNESS: path.join(cwd, 'tests/browser-screen-harness.mjs'),
    }), cleanup: async () => {} };
  } else environment = await testRunEnvironment();
  for (const key of ['RS3_COVERAGE_REPORT', 'RS3_COVERAGE_LANE', 'RS3_TEST_FILE_LEDGER', 'RS3_TEST_DATASET_RECEIPT']) delete environment.env[key];
  environment.env.RS3_TEST_RETRY_ONCE_IN_ISOLATION = '0';
  const receipt = { schema: 'rs3-stability-shard-v1', id: task.id, sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, rows: [] };
  const destination = `stability-${task.id}.json`;
  const save = async rows => { receipt.rows = rows; await writeFile(destination, JSON.stringify(receipt, null, 2) + '\n'); };
  await save([]);
  try {
    const result = await executeShard(task, { save, run: async file => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, abort);
      let idleSince = Date.now();
      try {
        return await runAdaptive({ files: [file], cwd, env: environment.env,
          minConcurrency: 1, maxConcurrency: 1, signal: controller.signal,
          onSchedule: ({ active }) => {
            if (active) idleSince = Date.now();
            else if (Date.now() - idleSince > 120000) { console.error('Memory admission starved for 120s'); controller.abort(); }
          },
          onEvent: event => {
            if (event.type === 'test:fail') console.error(diagnostic(event.data.details?.error));
            if (event.type === 'test:diagnostic' && /deadline/.test(event.data.message)) console.error(event.data.message);
          } });
      } finally { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, abort); }
    } });
    process.exitCode = result.passed ? 0 : 1;
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Stability ${task.id}\n\n${result.rows.filter(row => row.passed).length}/${task.attempts.length} first attempts passed. See aggregate summary and job log for failures.\n`);
  } finally { await environment.cleanup(); }
}
