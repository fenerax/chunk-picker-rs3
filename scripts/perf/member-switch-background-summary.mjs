// Public/synthetic-only summary; no app imports or saved credentials.
// node scripts/perf/member-switch-background-summary.mjs switch.json running.json idle.json
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const round = n => Math.round(n * 1000) / 1000;
function spread(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  assert(sorted.length && sorted.every(Number.isFinite));
  const quantile = fraction => {
    const index = (sorted.length - 1) * fraction, lower = Math.floor(index);
    return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
  };
  return { n: sorted.length, min: sorted[0], p25: quantile(.25), median: quantile(.5), p75: quantile(.75), max: sorted.at(-1) };
}
function paired(report, select) {
  const values = Array.from({ length: report.pairs }, (_, i) => {
    const rows = report.observations.filter(row => row.pair === i);
    return { before: select(rows.find(row => row.variant === 'before')), after: select(rows.find(row => row.variant === 'after')) };
  });
  const before = spread(values.map(row => row.before)), after = spread(values.map(row => row.after));
  return { before, after, delta: spread(values.map(row => row.after - row.before)),
    ratio: spread(values.map(row => row.after / row.before)), medianRatio: after.median / before.median, peakRatio: after.max / before.max,
    medianChangePct: 100 * (after.median / before.median - 1),
    pairedMedianChangePct: 100 * (spread(values.map(row => row.after / row.before)).median - 1),
    peakChangePct: 100 * (after.max / before.max - 1) };
}
function verify(report, scenario) {
  assert.equal(report.scenario, scenario); assert.equal(report.complete, true); assert.equal(report.requirePreparation, true);
  assert.equal(report.pairs, 7); assert.equal(report.observations.length, 14);
  let comparisons = 0;
  for (let i = 0; i < report.pairs; i++) {
    const rows = report.observations.slice(i * 2, i * 2 + 2);
    assert.deepEqual(rows.map(row => [row.pair, row.variant]), (i % 2 ? ['after', 'before'] : ['before', 'after']).map(variant => [i, variant]));
    const after = rows.find(row => row.variant === 'after'), prep = after.preparationAtAction;
    assert.equal(prep.byteLimit, 32 * 1024 ** 2); assert(prep.bytes <= prep.byteLimit); assert(prep.ready <= 1);
    if (scenario === 'unlock-running') {
      assert.equal(prep.active, 1); assert(after.preparationAfterAction.cancelled >= 1);
      assert(after.preparationAfterAction.lastCancellationMs >= 0);
    } else { assert.equal(prep.ready, 1); assert.equal(prep.active, 0); assert.equal(prep.pending, 0); }
    if (scenario === 'switch') {
      for (const row of rows) {
        assert.deepEqual(row.switches.map(s => s.group), [false, false, true, true]);
        assert.equal(new Set(row.switches.map(s => s.member)).size, 2);
        for (const s of row.switches) {
          assert.equal(s.responses.length, 1); assert.equal(s.responses[0].status, 200);
          assert(s.responses[0].available > 0 && s.responses[0].blocked > 0);
        }
      }
      assert.deepEqual(rows[0].switches.map(s => s.responses[0].hash), rows[1].switches.map(s => s.responses[0].hash)); comparisons += 4;
    } else {
      for (const row of rows) { assert.equal(row.interruption.status, 200); assert.equal(row.validation.length, 6); }
      assert.deepEqual(rows[0].validation, rows[1].validation); comparisons += 6;
    }
    for (const row of rows) assert(row.peakServer > 0 && row.peakTotal > 0 && row.peakAll >= row.peakTotal);
  }
  return comparisons;
}
const files = process.argv.slice(2);
if (files.length !== 3 || files.includes('--help')) {
  console.log('node scripts/perf/member-switch-background-summary.mjs <switch.json> <unlock-running.json> <unlock-idle.json>');
} else {
  const scenarios = ['switch', 'unlock-running', 'unlock-idle'];
  const reports = await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8'))));
  assert(reports.every(report => report.fixture === reports[0].fixture && report.node === reports[0].node));
  const comparisons = reports.reduce((count, report, i) => count + verify(report, scenarios[i]), 0);
  const memory = report => Object.fromEntries([['serverMiB', 'peakServer'], ['serverAndCalculatorsMiB', 'peakTotal'], ['browserMiB', 'peakBrowser'], ['allProcessesMiB', 'peakAll']]
    .map(([label, field]) => [label, paired(report, row => row[field] / 1048576)]));
  const cases = Object.fromEntries(reports.map(report => [report.scenario, {
    actionMs: paired(report, row => report.scenario === 'switch' ? row.switches[0].totalMs : row.interruption.ms), memory: memory(report),
    firstOpenMs: paired(report, row => row.firstOpen.time),
    ...(report.scenario === 'unlock-running' ? { cancellationMs: spread(report.observations.filter(row => row.variant === 'after').map(row => row.preparationAfterAction.lastCancellationMs)) } : {}),
  }]));
  const switchReport = reports[0];
  const breakdown = variant => {
    const rows = switchReport.observations.filter(row => row.variant === variant).map(row => row.switches[0]);
    return { workerMs: spread(rows.map(row => row.responses[0].cache.hit ? 0 : row.responses[0].cache.evaluationMs)),
      workerShare: spread(rows.map(row => (row.responses[0].cache.hit ? 0 : row.responses[0].cache.evaluationMs) / row.totalMs)),
      transferMs: spread(rows.map(row => row.resources[0].end - row.resources[0].headers)),
      afterBodyMs: spread(rows.map(row => row.event.time - row.resources[0].end)) };
  };
  const within = metric => metric.medianRatio <= 1.03 && metric.ratio.median <= 1.03;
  const budgets = {
    interruptedUnlock: within(cases['unlock-running'].actionMs), idleUnlock: within(cases['unlock-idle'].actionMs),
    peakRSS: Object.values(cases).every(c => ['serverMiB', 'serverAndCalculatorsMiB', 'allProcessesMiB'].every(key => c.memory[key].peakRatio <= 1.03)),
  };
  const result = { format: 'member-switch-background-summary-v1', node: reports[0].node, fixtureProfileSha256: reports[0].fixture,
    pairsPerScenario: 7, order: 'AB/BA alternating; independent server and browser per observation', normalizedFields: ['cache', 'metrics.elapsedMs'],
    fullResponseComparisons: comparisons, cases, switchBreakdown: { before: breakdown('before'), after: breakdown('after') },
    budgets, syntheticBudgetPass: Object.values(budgets).every(Boolean),
    notes: ['All times are milliseconds. Spread gives min, p25, median, p75, max; ratios and deltas are paired before aggregation.',
      'Unlock budgets require both the ratio of medians and the median paired ratio to be at most 1.03.',
      'RSS budgets compare maximum observed peaks per scenario, including server alone, server with calculators, and all processes with Chromium.',
      'RSS sampling is every 50 ms, with descendant discovery every 1 s; brief unsampled peaks remain possible.',
      'Switch waits 12 s after the first list to allow idle preparation. Immediate switches remain foreground calculations.',
      'Unlock-running starts 800 ms after the first list and requires preparation active. Unlock-idle requires completed preparation and no preparation queued/running.',
      'A scale-400 synthetic save does not replace the required scrubbed real-save GitHub runner benchmark.'] };
  console.log(JSON.stringify(result, (_, value) => typeof value === 'number' ? round(value) : value, 2));
}
