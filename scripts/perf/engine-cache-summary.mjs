// Numeric summaries only; raw request/state values are never read or emitted.
import { readFile } from 'node:fs/promises';
const reports = await Promise.all(process.argv.slice(2).map(async file => JSON.parse(await readFile(file, 'utf8'))));
if (!reports.length) throw new Error('Supply cache-profile reports.');
for (const report of reports.slice(1)) {
  if (report.datasetHash !== reports[0].datasetHash || report.sourceHash !== reports[0].sourceHash
    || report.states.some((state, i) => reports[0].states[i] && state.hash !== reports[0].states[i].hash))
    throw new Error('Cache profile input hashes differ.');
}
const range = values => {
  const v = values.sort((a,b) => a-b), n = v.length;
  return { n, median: n % 2 ? v[(n-1)/2] : (v[n/2-1]+v[n/2])/2, min: v[0], max: v.at(-1) };
};
console.log(JSON.stringify(reports.map(report => ({
  sourceHash: report.sourceHash, datasetHash: report.datasetHash, runs: report.runs, rounds: report.rounds,
  counts: Object.fromEntries(report.counts.map(count => {
    const trials = report.trials.filter(t => t.count === count);
    const rates = new Map();
    for (const trial of trials) for (const row of trial.rows) for (const [name, stats] of Object.entries(row.counters ?? {})) {
      const key = (row.round > 0 ? 'warm:' : 'cold:') + name;
      const entry = rates.get(key) ?? { hits: 0, misses: 0, entryBytes: [], maxEntries: 0 };
      entry.hits += stats.hits; entry.misses += stats.misses;
      // Size sampling is cumulative within a worker, not a new sample at each reply.
      if (stats.entryBytes?.length) entry.entryBytes = stats.entryBytes;
      entry.maxEntries = Math.max(entry.maxEntries, stats.maxEntries);
      rates.set(key, entry);
    }
    const retainedSizes = new Map();
    for (const trial of trials) for (const [name, stats] of Object.entries(trial.sizeSample ?? {})) {
      const entry = retainedSizes.get(name) ?? { admission: [], live: [], backing: [] };
      entry.admission.push(...stats.entryBytes ?? []); entry.live.push(...stats.liveEntryBytes ?? []); entry.backing.push(...(stats.liveBackingBytes?.length ? stats.liveBackingBytes : stats.backingEntryBytes ?? []));
      retainedSizes.set(name, entry);
    }
    return [count, { retainedSizes: Object.fromEntries([...retainedSizes].map(([name, entry]) => [name, {
      admissionBytes: entry.admission.length ? range(entry.admission) : null, liveBytes: entry.live.length ? range(entry.live) : null, backingBytes: entry.backing.length ? range(entry.backing) : null,
    }])), warmRoundWallMs: range(trials.map(t => t.rows.filter(r => r.round > 0).reduce((n,r) => n + r.wallMs, 0) / report.rounds)), peakRSS: range(trials.map(t => Math.max(...t.rows.map(r => r.VmHWM)))),
      maxRSS: range(trials.map(t => Math.max(...t.rows.map(r => r.VmRSS)))),
      latency: report.summary[count],
      caches: Object.fromEntries([...rates].map(([name, entry]) => [name, { hits: entry.hits, misses: entry.misses,
        hitRate: entry.hits + entry.misses ? entry.hits / (entry.hits + entry.misses) : null,
        maxEntries: entry.maxEntries, entryBytes: entry.entryBytes.length ? range(entry.entryBytes) : null }])) }];
  })),
})), null, 2));
