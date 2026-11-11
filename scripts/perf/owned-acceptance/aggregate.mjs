import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { measuredTimes, percentiles } from './metrics.mjs';
import { acceptanceShape, SEED } from './profile.mjs';

// Pool time samples, but require EVERY complete trial to meet the memory bar.
// A fast/small trial can never average away a failed or absent run.
export function aggregate(reports) {
  const expected = ['linux', 'win32'], first = reports[0];
  const result = { format: 'owned-acceptance-7b-aggregate', schemaVersion: 1, commit: first?.commit ?? null,
    seed: first?.seed ?? null, acceptanceClaim: false, errors: [], platforms: {} };
  for (const os of expected) {
    const runs = reports.filter(report => report.host.os === os);
    if (runs.length !== 5 || new Set(runs.map(report => report.ci.freshRun)).size !== 5) result.errors.push(`${os}: expected five distinct fresh runs`);
    const group = { runs: runs.length, runDecisions: [], formats: {} };
    for (const mode of ['format1', 'format2']) {
      const trials = runs.map(report => report.results.find(trial => trial.mode === mode)).filter(Boolean);
      if (trials.length !== 5) result.errors.push(`${os}/${mode}: incomplete trials`);
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
    if (report.smoke || !report.equivalent || report.commit !== first.commit || report.seed !== first.seed || report.seed !== SEED
      || report.runtime.node !== first.runtime.node) result.errors.push('incomparable, smoke or mismatched receipt');
    const trial = report.results.find(row => row.mode === 'format2');
    if (!trial?.decision.acceptanceClaim || !acceptanceShape(trial?.shape)) result.errors.push(`${report.host.os}/${report.ci.freshRun}: target not met`);
  }
  result.acceptanceClaim = reports.length === 10 && result.errors.length === 0;
  result.summary = `${result.acceptanceClaim ? 'TARGET MET in all ten hosted runs' : 'ACCEPTANCE NOT ESTABLISHED'}; ${reports.length}/10 receipts.\n${result.errors.join('\n')}`;
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
  const result = aggregate(await Promise.all(files.map(file => readFile(file, 'utf8').then(JSON.parse))));
  await writeFile(path.join(directory, 'aggregate.json'), JSON.stringify(result, null, 2));
  console.log(result.summary);
  if (!result.acceptanceClaim) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
