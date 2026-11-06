// Summarize search-typing.mjs results, retaining the pair as the sampling unit.
// node scripts/perf/search-typing-summary.mjs .local/search-perf/paired/results.json
import { readFile } from 'node:fs/promises';
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
  rowCopy, domPage: row => row.listMs - row.rowCopyMs, map: row => row.mapMs };
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
console.log(JSON.stringify(round(output), null, 2));
