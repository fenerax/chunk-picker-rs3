// Summarize search-typing.mjs results, retaining the pair as the sampling unit.
// node scripts/perf/search-typing-summary.mjs .local/search-perf/paired/results.json
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
const median = values => { const a = [...values].sort((a, b) => a - b); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
const stats = values => values.every(Number.isFinite) ? { median: median(values), min: Math.min(...values), max: Math.max(...values) } : null;
const round = value => typeof value === 'number' ? Math.round(value * 10) / 10 : Array.isArray(value) ? value.map(round) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, round(child)])) : value;
const variants = ['before', 'after'];
const runs = Object.fromEntries(variants.map(variant => [variant, report.results.filter(r => r.variant === variant)]));
if (!runs.before.length || runs.before.length !== runs.after.length) throw Error('Expected complete before/after pairs.');
const queries = report.results[0].scopes[0].rows.map(row => row.query);
const output = { baseline: report.baseline, chunks: report.chunks, pairs: runs.before.length, node: report.node,
  note: 'Median of the four member/Group scopes within each run, then median and min/max across independent paired runs. Milliseconds unless labelled MiB; complete row equality is checked by the runner outside timed actions. Browser tree RSS includes that validation.',
  queries: {} };
const rowCopy = row => row.prepareMs - row.matchMs + row.rowCopyMs;
const measures = { pageReady: row => row.pageReadyMs, pagePaint: row => row.pagePaintMs, inputToPaint: row => row.wallMs, render: row => row.renderMs, matching: row => row.matchMs,
  rowCopy, domPage: row => row.listMs - row.rowCopyMs, map: row => row.mapMs, rendererCpu: row => row.cpuMs };
for (const query of queries) {
  const results = {};
  for (const [name, extract] of Object.entries(measures)) {
    results[name] = Object.fromEntries(variants.map(variant => [variant, stats(runs[variant].map(run => median(run.scopes.map(scope => extract(scope.rows.find(row => row.query === query))))))]));
  }
  const pairedSavings = runs.before.map(before => {
    const after = runs.after.find(r => r.pair === before.pair);
    if (!after) throw Error('Missing matching pair.');
    return median(before.scopes.map(scope => scope.rows.find(row => row.query === query).wallMs))
      - median(after.scopes.map(scope => scope.rows.find(row => row.query === query).wallMs));
  });
  results.pairedInputToPaintSaving = stats(pairedSavings);
  output.queries[query || '(empty)'] = results;
}
for (const variant of variants) output[variant] = {
  coldIndexMs: stats(runs[variant].map(run => run.scopes[0].opening.indexMs)),
  indexBuilds: runs[variant].map(run => run.scopes.reduce((n, scope) => n + scope.opening.indexBuilds + scope.rows.reduce((n, row) => n + row.indexBuilds, 0), 0)),
  peakBrowserTreeRssMiB: stats(runs[variant].map(run => run.peakBrowserTreeRssMiB)),
  maxRenderSpanMs: Math.max(...runs[variant].flatMap(run => run.scopes.flatMap(scope => scope.rows.map(row => row.renderMs)))),
  maxLongTaskMs: Math.max(...runs[variant].flatMap(run => run.scopes.flatMap(scope => scope.rows.map(row => row.longestTaskMs)))),
  keystrokesWithLongTask: runs[variant].flatMap(run => run.scopes.flatMap(scope => scope.rows)).filter(row => row.longestTaskMs >= 50).length,
  keystrokes: runs[variant].reduce((n, run) => n + run.scopes.reduce((n, scope) => n + scope.rows.length, 0), 0),
  requests: runs[variant].reduce((n, run) => n + run.scopes.reduce((n, scope) => n + scope.rows.reduce((n, row) => n + row.network.length, 0), 0), 0),
};
// The fixed primary query and aggregation match the pre-sampling CPU protocol.
// Wall-clock diagnostics above never decide the candidate's publication gate.
const hashes = new Map();
for (const run of report.results) for (const scope of run.scopes) for (const row of scope.rows) {
  assert.match(row.hash, /^[a-f0-9]{64}$/); assert.match(row.mapHash, /^[a-f0-9]{64}$/);
  const key = JSON.stringify([scope.member, scope.group, row.query]);
  const value = JSON.stringify([row.hash, row.mapHash]);
  if (hashes.has(key)) assert.equal(value, hashes.get(key), 'Full rows or final pixels changed'); else hashes.set(key, value);
}
const cpu = run => median(run.scopes.map(scope => scope.rows.find(row => row.query === 'a')?.cpuMs));
const complete = runs.before.map(before => ({ before, after: runs.after.find(after => after.pair === before.pair) }));
assert.equal(new Set(complete.map(pair => pair.before.pair)).size, complete.length, 'Duplicate pair');
const validCpu = complete.every(pair => cpu(pair.before) > 0 && Number.isFinite(cpu(pair.before)) && Number.isFinite(cpu(pair.after)) && cpu(pair.after) >= 0);
const gains = validCpu ? complete.map(pair => 100 * (1 - cpu(pair.after) / cpu(pair.before))) : [];
const faster = gains.filter(value => value > 0).length;
const fixedOrder = report.protocol?.pairs === 20 && report.protocol.order.every(({pair, order}) =>
  JSON.stringify(order) === JSON.stringify(pair % 2 ? ['after', 'before'] : ['before', 'after']));
const completeTwenty = complete.length === 20 && Array.from({length:20}, (_, pair) => pair).every(pair => complete.some(row => row.before.pair === pair));
output.cpuGate = { primaryQuery: 'a', counter: 'renderer ThreadTime', wallTimeIsGate: false,
  completePairs: complete.length, allCompleteOutputHashesEqual: true, faster,
  pairedCpuGainPercent: gains.length ? stats(gains) : null,
  decision: fixedOrder && completeTwenty && validCpu && faster >= 18 && median(gains) >= 5 ? 'candidate-passes-cpu-gate' : 'undecided',
  targetedCorrectnessChecksRequired: true };
console.log(JSON.stringify(round(output), null, 2));
