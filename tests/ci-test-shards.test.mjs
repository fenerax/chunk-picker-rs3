import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { balanceTests, assertPartition, shardTests } from '../scripts/ci/test-shards.mjs';
import { timingTable } from '../scripts/ci/update-test-timings.mjs';
import { discoverTests } from '../scripts/test-selection.mjs';
import { mergeLinuxReports } from '../scripts/ci/coverage-gate.mjs';

test('deterministic timing-balanced shards cover every discovered full-suite file exactly once', async () => {
  const files = await discoverTests(undefined, 'full');
  const shards = await shardTests(files);
  assertPartition(files, shards);
  assert.deepEqual(await shardTests([...files].reverse()), shards);
  assert.equal(shards.length, 4);
  assert.ok(shards.every(shard => shard.files.length));
  // Calibrated against the complete Linux shard ledgers from run 42294078968.
  // Avoid the previous solo prefix followed by the longest shared file, while
  // retaining the full inventory and duration-based (not file-count) balance.
  const estimates = shards.map(shard => shard.estimatedMs);
  assert.ok(Math.max(...estimates) < 400_000, `Predicted critical path: ${estimates}`);
  assert.ok(Math.max(...estimates) - Math.min(...estimates) < 15_000, `Unbalanced plan: ${estimates}`);
  const longest = shards.find(shard => shard.files.includes('game-plugin-items.test.mjs'));
  assert.equal(longest.soloMs, 0, 'Do not delay the indivisible critical-path file with solo work');
  assert.throws(() => assertPartition(files, shards.slice(1)), /incomplete/);
  assert.throws(() => assertPartition(files, [...shards, shards[0]]), /duplicate/);
  const weights = { defaultMs: 10, files: { 'tests/slow.test.mjs': 100 } };
  const sample = balanceTests(['slow.test.mjs', 'new.test.mjs', 'other.test.mjs'], weights, 2);
  assert.equal(sample[0].wallMs, 100);
  assert.equal(sample[1].wallMs, 20);
  assert.throws(() => balanceTests([], weights, 0), /count/);
});

test('timing generation uses passing completed attempts and a conservative new-file default', () => {
  const ledger = (duration, outcome = 'pass') => [
    { schema: 'rs3-file-ledger-v1', lane: 'test', sha: 'a'.repeat(40), runId: '1', runAttempt: 1, files: ['tests/one.test.mjs'] },
    { type: 'admitted', file: 'tests/one.test.mjs', attempt: 1, value: { outcome: 'interrupted' } },
    { type: 'completed', file: 'tests/one.test.mjs', attempt: 1, value: { outcome, processWallMs: duration } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
  assert.deepEqual(timingTable([ledger(10), ledger(20), ledger(999, 'fail')]).files, { 'tests/one.test.mjs': 20 });
  assert.equal(timingTable([ledger(20)]).defaultMs, 20);
  assert.throws(() => timingTable([ledger(10, 'fail')]), /No completed/);
});

const report = file => {
  const name = ['synthetic pass'], occurrence = 1;
  return { schema: 'rs3-test-coverage-v1', lane: 'test', passed: true, files: [file], completedFiles: [file],
    tests: [{ file, name, occurrence, key: JSON.stringify([file, name, occurrence]), kind: 'test', status: 'pass' }],
    fileResults: [{ file, passed: true, recordCount: 1, counts: { tests: 1, suites: 0, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } }] };
};
test('coverage aggregation refuses missing, overlapping, misassigned and failed shard evidence', () => {
  const a = report('tests/a.test.mjs'), b = report('tests/b.test.mjs'), inventories = [a.files, b.files];
  assert.deepEqual(mergeLinuxReports([a, b], inventories).files, [...a.files, ...b.files]);
  assert.throws(() => mergeLinuxReports([a], inventories), /Missing/);
  assert.throws(() => mergeLinuxReports([a, a], [a.files, a.files]), /Duplicate/);
  assert.throws(() => mergeLinuxReports([b, a], inventories), /Incomplete/);
  assert.throws(() => mergeLinuxReports([a, { ...b, passed: false }], inventories), /failed/);
  assert.throws(() => mergeLinuxReports([a, { ...b, completedFiles: [] }], inventories), /Incomplete/);
});

test('workflow runs four fail-fast bounded shards and requires all reports', async () => {
  const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: \[gate, inputs\]/);
  assert.match(workflow, /fail-fast: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /npm test -- --shard=\$\{\{ matrix.shard \}\}\/4\s*$/m);
  assert.match(workflow, /test "\$TEST_RESULT" = success/);
  assert.match(workflow, /RS3_COVERAGE_SHARDS: 4/);
  assert.match(workflow, /test-shard-\$\{\{ matrix.shard \}\}-coverage/);
  for (const use of workflow.matchAll(/uses: (actions\/[^@\s]+)@([^\s]+)/g)) assert.match(use[2], /^[a-f0-9]{40}$/);
});
