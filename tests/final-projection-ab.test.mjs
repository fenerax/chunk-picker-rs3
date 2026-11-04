import test from 'node:test';
import assert from 'node:assert/strict';
import { median, summary, pairedComparison, summarizeTrials } from '../scripts/perf/final-projection-ab.mjs';
test('paired bootstrap preserves pairing and detects a constant shift reproducibly', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(summary([3, 1, 2]), { n: 3, median: 2, min: 1, max: 3 });
  const pairs = Array.from({ length: 10 }, (_, i) => [i * 100 + 100, i * 100 + 90]);
  const result = pairedComparison(pairs);
  assert.equal(result.difference, -10);
  assert.deepEqual(result.pairedBootstrap95, [-10, -10]);
  assert.deepEqual(pairedComparison(pairs), result);
  assert.deepEqual(pairedComparison(pairs.map(([a]) => [a, a])).pairedBootstrap95, [0, 0]);
  assert.throws(() => pairedComparison([]), /Pairs/);
  assert.throws(() => pairedComparison([[1, NaN]]), /Pairs/);
});
test('measurement summaries join arms by block and omit incomplete blocks', () => {
  const trials = [
    { population: 'preview', block: 0, arm: 'reference', report: { requests: { first: { wallMs: 100 } } } },
    { population: 'preview', block: 1, arm: 'candidate', report: { requests: { first: { wallMs: 999 } } } },
    { population: 'preview', block: 0, arm: 'candidate', report: { requests: { first: { wallMs: 90 } } } },
  ];
  const metrics = summarizeTrials(trials);
  assert.equal(metrics['preview.requests.first.wallMs'].reference.n, 1);
  assert.equal(metrics['preview.requests.first.wallMs'].difference, -10);
});
