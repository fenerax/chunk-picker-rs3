import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { caseCounts, caseCountFailure, countFailureMessage } from './stability-counts.mjs';

const key = row => `${row.os}:${row.file}:${row.repetition}`;
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
};
export function summarizeStability(plan, receipts) {
  const expected = new Map(plan.matrix.include.flatMap(task => task.attempts.map(row => [key({ ...row, os: task.os }), task.id])));
  const observed = new Map();
  for (const receipt of receipts) {
    if (receipt.schema !== 'rs3-stability-shard-v2' || receipt.sha !== plan.sha || receipt.runId !== plan.runId || receipt.runAttempt !== plan.runAttempt)
      throw Error('Stale or invalid stability receipt');
    for (const row of receipt.rows) {
      const id = key(row);
      if (expected.get(id) !== receipt.id || observed.has(id) || !Number.isFinite(row.durationMs) || row.durationMs < 0 || typeof row.passed !== 'boolean')
        throw Error('Unexpected or duplicate stability repetition');
      const counts = caseCounts(row.counts);
      const reason = caseCountFailure(counts) ?? (row.passed ? null : 'native-failure');
      observed.set(id, { ...row, counts, reason, passed: row.passed && reason === null });
    }
  }
  const files = plan.targets.map(target => {
    const rows = Array.from({ length: target.repetitions }, (_, i) => observed.get(key({ ...target, repetition: i + 1 }))).filter(Boolean);
    const durations = rows.map(row => row.durationMs);
    return { file: target.file, os: target.os, planned: target.repetitions, passed: rows.filter(row => row.passed).length,
      missing: target.repetitions - rows.length, medianMs: median(durations), p90Ms: percentile(durations, 0.9),
      executed: rows.reduce((sum, row) => sum + (row.counts?.executed ?? 0), 0),
      skipped: rows.reduce((sum, row) => sum + (row.counts?.skipped ?? 0), 0),
      todo: rows.reduce((sum, row) => sum + (row.counts?.todo ?? 0), 0),
      failures: rows.filter(row => !row.passed).map(row => ({ repetition: row.repetition, reason: row.reason, errors: row.errors })),
      repetitions: rows.map(({ repetition, passed, durationMs, counts }) => ({ repetition, passed, durationMs, counts })) };
  });
  return { schema: 'rs3-stability-receipt-v2', sha: plan.sha, runId: plan.runId, runAttempt: plan.runAttempt,
    passed: files.every(file => file.passed === file.planned), reduced: plan.reduced, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  const plan = JSON.parse(await readFile(path.join(directory, 'stability-plan.json'), 'utf8'));
  const receipts = await Promise.all((await readdir(directory)).filter(name => /^stability-(linux|windows)-\d+\.json$/.test(name))
    .map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))));
  const summary = summarizeStability(plan, receipts);
  await writeFile('stability-receipt.json', JSON.stringify(summary, null, 2) + '\n');
  const lines = ['### Stability first attempts', '',
    summary.reduced ? '**Reduced count: dispatch a full 50 for each file/OS before landing.**' : 'All requested repetitions; no retries.', '',
    '| File | OS | Passes/N | Executed | Skipped | Todo | Missing | Median ms | p90 ms |', '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...summary.files.map(file => `| ${file.file} | ${file.os} | ${file.passed}/${file.planned} | ${file.executed} | ${file.skipped} | ${file.todo} | ${file.missing} | ${file.medianMs ?? '—'} | ${file.p90Ms ?? '—'} |`),
    ...summary.files.flatMap(file => file.failures.map(failure => `\nFAILED ${file.file} (${file.os}) repetition ${failure.repetition}: ${countFailureMessage[failure.reason]}; original error in the shard job log; redacted error metadata in JSON.`))];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  process.exitCode = summary.passed ? 0 : 1;
}
