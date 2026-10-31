// Summarize matching first-round + two-warm-round byte-budget trials. Reports
// contain numeric observations and hashes only, never request or saved values.
import { readFile } from 'node:fs/promises';
const reports = await Promise.all(process.argv.slice(2).map(async file => JSON.parse(await readFile(file, 'utf8'))));
if (!reports.length) throw new Error('Supply START and budget profile reports.');
const quantile = values => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * .95) - 1)];
const range = values => { const sorted = values.sort((a,b) => a-b); return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
for (const report of reports) {
  if (report.datasetHash !== reports[0].datasetHash || report.sourceHash !== reports[0].sourceHash
    || report.states.some((state, i) => reports[0].states[i] && state.hash !== reports[0].states[i].hash)) throw new Error('Input hash mismatch.');
  if (report.pending) throw new Error('Incomplete trial.');
  if (report.cacheBytes !== undefined && report.cacheBytes !== null) for (const row of report.trials.flatMap(t => t.rows)) {
    const budget = row.cacheBudget;
    if (!budget || budget.byteLimit !== Number(report.cacheBytes) || budget.bytes > budget.byteLimit || budget.entries > 512)
      throw new Error('Budget telemetry mismatch.');
  }
}
const summaries = reports.map(report => ({
  datasetHash: report.datasetHash, sourceHash: report.sourceHash, appSourceHash: report.appSourceHash,
  harnessHash: report.harnessHash, stateHashes: report.states.map(state => state.hash),
  byteLimit: report.cacheBytes === undefined || report.cacheBytes === null ? null : Number(report.cacheBytes),
  warmRounds: 2,
  counts: Object.fromEntries(report.counts.map(count => {
    const trials = report.trials.filter(t => t.count === count);
    if (trials.length !== report.runs) throw new Error('Incomplete trial count.');
    const rows = trials.map(t => t.rows.filter(row => row.round <= 2));
    if (rows.some(r => !r.some(row => row.round === 2))) throw new Error('Incomplete warm rounds.');
    const caches = {};
    for (const trial of rows) for (const row of trial) for (const [name, stats] of Object.entries(row.counters ?? {})) {
      const key = (row.round ? 'warm:' : 'cold:') + name;
      const value = caches[key] ??= { hits: 0, misses: 0 };
      value.hits += stats.hits; value.misses += stats.misses;
    }
    for (const [key, stats] of Object.entries(caches)) {
      stats.hitRate = stats.hits + stats.misses ? stats.hits / (stats.hits + stats.misses) : null;
      const warm = key.startsWith('warm:'), name = key.slice(key.indexOf(':') + 1);
      const perTrial = rows.map(trial => trial.filter(row => (row.round > 0) === warm).reduce((sum,row) => {
        sum.hits += row.counters?.[name]?.hits ?? 0; sum.misses += row.counters?.[name]?.misses ?? 0; return sum;
      }, { hits: 0, misses: 0 }));
      const rates = perTrial.filter(s => s.hits + s.misses).map(s => s.hits / (s.hits + s.misses));
      stats.hitRateRange = rates.length ? range(rates) : null;
      stats.hitsRange = range(perTrial.map(s => s.hits)); stats.missesRange = range(perTrial.map(s => s.misses));
    }
    const kinds = [...new Set(rows.flat().map(row => row.kind))];
    return [count, {
      trials: trials.length,
      requests: rows.flat().length,
      warmP95Ms: range(rows.map(r => quantile(r.filter(row => row.round).map(row => row.wallMs)))),
      warmRoundMs: range(rows.map(r => r.filter(row => row.round).reduce((n,row) => n + row.wallMs, 0) / 2)),
      peakRSSBytes: range(rows.map(r => Math.max(...r.map(row => row.VmHWM)))),
      chargedBytes: rows.flat().some(row => row.cacheBudget) ? range(rows.map(r => Math.max(...r.map(row => row.cacheBudget?.bytes ?? 0)))) : null,
      latency: Object.fromEntries(kinds.map(kind => [kind, Object.fromEntries(['cold','warm'].map(phase => [phase + 'P95Ms', range(rows.map(r => quantile(r.filter(row => row.kind === kind && (phase === 'warm' ? row.round > 0 : row.round === 0)).map(row => row.wallMs))))]))])),
      caches,
    }];
  })),
}));
console.log(JSON.stringify(summaries, (_key, value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value, 2));
