import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { measuredTimes, percentiles } from './metrics.mjs';
import { acceptanceShape, SEED } from './profile.mjs';
import { pairReports } from './comparison.mjs';
import { summary } from '../owned-acceptance.mjs';
import { acceptanceScope } from './scope.mjs';

// Pool time samples, but require EVERY complete trial to meet the memory bar.
// A fast/small trial can never average away a failed or absent run.
export function aggregate(receipts, { scope = 'diagnostic' } = {}) {
  const policy = acceptanceScope(scope);
  const reports = pairReports(receipts);
  const expected = policy.platforms, first = reports[0], expectedCount = expected.length * policy.runs.length;
  const result = { format: 'owned-acceptance-7b-aggregate', schemaVersion: 1, commit: first?.commit ?? null,
    seed: first?.seed ?? null, scope, acceptanceClaim: false, scopePassed: false, errors: [], platforms: {},
    comparisons: reports.map(report => ({ os: report.host.os, freshRun: report.ci.freshRun,
      formatHosts: report.formatHosts ?? null, equivalent: report.equivalent, errors: report.comparisonErrors,
      failures: report.failures, decision: report.results.find(row => row.mode === 'format2')?.decision ?? null,
      summary: summary(report) })) };
  for (const os of expected) {
    const runs = reports.filter(report => report.host.os === os);
    if (runs.length !== policy.runs.length || !policy.runs.every(run => runs.filter(report => String(report.ci.freshRun) === String(run)).length === 1))
      result.errors.push(`${os}: expected ${policy.runs.length} distinct fresh runs`);
    const group = { runs: runs.length, runDecisions: [], formats: {} };
    for (const mode of ['format1', 'format2']) {
      const trials = runs.map(report => report.results.find(trial => trial.mode === mode)).filter(Boolean);
      if (trials.length !== policy.runs.length) result.errors.push(`${os}/${mode}: incomplete trials`);
      group.formats[mode] = { times: {}, writes: trials.map(trial => trial.measuredIO),
        baseWrites: trials.map(trial => trial.allPostPublicationIO.baseWrites),
        perGroupBytes: percentiles(trials.flatMap(trial => trial.decision.groups.map(row => row.attributableBytes))),
        maximumGroupHeapBytes: trials.length ? Math.max(...trials.map(trial => trial.decision.maximumGroupHeapBytes)) : null,
        slopesBytesPerGroup: trials.map(trial => trial.decision.openSlopeBytesPerGroup) };
      const records = trials.flatMap(trial => trial.records);
      for (const kind of new Set(records.map(row => row.kind))) group.formats[mode].times[kind] = measuredTimes(records.filter(row => row.kind === kind));
      if (mode === 'format2') group.runDecisions = trials.map(trial => trial.decision.status);
    }
    result.platforms[os] = group;
  }
  for (const report of reports) {
    if (report.scope !== scope || !expected.includes(report.host.os) || !policy.runs.includes(Number(report.ci.freshRun)))
      result.errors.push('unexpected scope, platform or fresh run');
    if (report.smoke || !report.equivalent || report.failures.length || report.comparisonErrors.length || report.commit !== first.commit || report.seed !== first.seed || report.seed !== SEED
      || report.runtime.node !== first.runtime.node || report.ci.run !== first.ci.run || report.ci.attempt !== first.ci.attempt)
      result.errors.push('incomparable, smoke or mismatched receipt');
    const trial = report.results.find(row => row.mode === 'format2');
    if (!(trial?.decision.gatePassed ?? trial?.decision.acceptanceClaim) || !acceptanceShape(trial?.shape)) result.errors.push(`${report.host.os}/${report.ci.freshRun}: reject gate or required shape failed`);
  }
  result.scopePassed = reports.length === expectedCount && result.errors.length === 0;
  result.acceptanceClaim = policy.finalClaim && result.scopePassed;
  result.summary = `${result.acceptanceClaim ? 'ACCEPTED in all ten hosted runs' : scope === 'diagnostic' && result.scopePassed ? 'DIAGNOSTIC PASSED; no final acceptance claim' : 'ACCEPTANCE NOT ESTABLISHED'}; scope ${scope}; ${reports.length}/${expectedCount} paired receipts.\n${result.errors.join('\n')}`;
  return result;
}

async function main() {
  const directory = path.resolve(process.argv[2]), files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(path.join(folder, entry.name));
      else if (entry.name === 'results.json') files.push(path.join(folder, entry.name));
    }
  }
  await visit(directory);
  const result = aggregate(await Promise.all(files.map(file => readFile(file, 'utf8').then(JSON.parse))),
    { scope: process.env.ACCEPTANCE_SCOPE ?? 'diagnostic' });
  await writeFile(path.join(directory, 'aggregate.json'), JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    [result.summary, ...result.comparisons.map(row => `${row.os}/${row.freshRun}: ${row.summary}`)].join('\n\n') + '\n');
  console.log(result.summary);
  if (!result.scopePassed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
