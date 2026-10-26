// Summarize complete member-switch AB/BA observations without application imports.
// node scripts/perf/member-switch-summary.mjs <paired.json> [interruption.json]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const round = value => Math.round(value * 1000) / 1000;
function spread(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = fraction => { const index = (rows.length - 1) * fraction, lower = Math.floor(index); return rows[lower] + (rows[Math.ceil(index)] - rows[lower]) * (index - lower); };
  return rows.length ? Object.fromEntries(Object.entries({ n: rows.length, min: rows[0], p25: q(.25), median: q(.5), p75: q(.75), max: rows.at(-1) }).map(([k, v]) => [k, round(v)])) : null;
}
function paired(rows, metric) {
  const pairs = new Map();
  for (const row of rows) {
    const entry = pairs.get(row.pair) ?? {}; assert(!entry[row.variant]); entry[row.variant] = row; pairs.set(row.pair, entry);
  }
  const observations = [...pairs].map(([pair, values]) => {
    assert(values.before && values.after, 'Incomplete pair');
    const before = metric(values.before), after = metric(values.after);
    return { pair, before, after, delta: after - before, ratio: before > 0 ? after / before : null };
  });
  return { before: spread(observations.map(r => r.before)), after: spread(observations.map(r => r.after)),
    delta: spread(observations.map(r => r.delta)), ratio: spread(observations.map(r => r.ratio)) };
}
function verify(report) {
  assert(report.complete !== false, 'Run did not complete');
  assert.equal(report.observations.length, 2 * report.pairs, 'Missing observation');
  for (let i = 0; i < report.pairs; i++) {
    const actual = report.observations.slice(i * 2, i * 2 + 2);
    assert.deepEqual(actual.map(r => [r.pair, r.variant]), (i % 2 ? ['after', 'before'] : ['before', 'after']).map(v => [i, v]), 'Order must alternate AB/BA');
    if (actual[0].switches.length) {
      assert.equal(actual[0].switches.length, 4); assert.equal(actual[1].switches.length, 4);
      assert.deepEqual(actual[0].switches.map(s => s.responses.map(r => r.hash)), actual[1].switches.map(s => s.responses.map(r => r.hash)), 'Full normalized responses changed');
      for (const row of actual) for (const action of row.switches) {
        assert.equal(action.responses.length, 1); assert.equal(action.responses[0].status, 200);
        assert(action.responses[0].rows > 0); assert(row.peakServer > 0 && row.peakTotal > 0);
      }
    } else for (const row of actual) assert.equal(row.interruption.status, 200);
  }
}
function compact(row) {
  return { pair: row.pair, variant: row.variant, firstOpenMs: row.firstOpen.time, preparation: row.preparation,
    peakServerMiB: row.peakServer / 1048576, peakWithCalculatorsMiB: row.peakTotal / 1048576, peakBrowserMiB: row.peakBrowser / 1048576,
    interruption: row.interruption, switches: row.switches.map(action => {
      const response = action.responses[0], resource = action.resources[0], json = action.jsonTimings.find(t => t.member === action.member);
      return { member: action.member, group: action.group, totalMs: action.totalMs, responseHash: response.hash,
        rows: response.rows, available: response.available, blocked: response.blocked, cacheHit: response.cache.hit,
        paidEvaluationMs: response.cache.hit ? 0 : response.cache.evaluationMs, requestMs: response.cache.requestMs,
        timingMs: response.cache.timingMs, decodedBytes: resource.decoded, encodedBytes: resource.encoded,
        beforeRequestMs: resource.start - action.started, headersMs: resource.headers - resource.start,
        transferMs: resource.end - resource.headers, afterBodyMs: action.event.time - resource.end,
        jsonAfterBodyMs: json.end - resource.end, afterJsonMs: action.event.time - json.end };
    }) };
}
const [switchFile, interruptFile] = process.argv.slice(2);
if (!switchFile || switchFile === '--help') {
  console.log('node scripts/perf/member-switch-summary.mjs <complete-paired.json> [complete-interruption.json]');
} else {
  const run = JSON.parse(await readFile(switchFile, 'utf8')); verify(run);
  const rows = run.observations.map(compact), cases = rows[0].switches.map((action, i) => ({ member: action.member, group: action.group,
    metrics: Object.fromEntries(['totalMs', 'paidEvaluationMs', 'requestMs', 'beforeRequestMs', 'headersMs', 'transferMs', 'afterBodyMs', 'jsonAfterBodyMs', 'afterJsonMs']
      .map(key => [key, paired(rows, row => row.switches[i][key])])) }));
  const result = { format: 'member-switch-summary-v1', node: run.node, pairs: run.pairs, order: 'AB/BA alternating', dwellMs: run.dwellMs,
    fixtureProfileSha256: run.fixture, normalizedFields: ['cache', 'metrics.elapsedMs'], fullResponseComparisons: run.pairs * 4,
    notes: ['Milliseconds; spread gives min, p25, median, p75, max. Ratios and deltas are paired before aggregation.',
      'Group view can paint from cached results before its background HTTP response ends; negative residuals in that mode are expected.',
      'Response.json includes body wait; jsonAfterBodyMs is the residual after transfer, not a standalone JSON.parse microbenchmark.',
      'RSS is sampled at 50 ms for owned processes; child discovery at 1 s. Browser RSS includes CDP response retention.',
      'The 12 s reading interval hides preparation. Calculation itself is not faster; immediate switches can still wait.'],
    cases, memory: Object.fromEntries(['peakServerMiB', 'peakWithCalculatorsMiB', 'peakBrowserMiB'].map(key => [key, paired(rows, row => row[key])])),
    firstOpenMs: paired(rows, row => row.firstOpenMs), observations: rows };
  if (interruptFile) {
    const interruption = JSON.parse(await readFile(interruptFile, 'utf8')); verify(interruption);
    result.interruption = { pairs: interruption.pairs, delayMs: interruption.interruptMs,
      unlockToTasksMs: paired(interruption.observations, row => row.interruption.ms), observations: interruption.observations.map(compact) };
  }
  console.log(JSON.stringify(result, (_, value) => typeof value === 'number' ? round(value) : value, 2));
}
