import test from 'node:test';
import assert from 'node:assert/strict';
import { attest, verifyInputs, sha, resultValue, compareValues, validateEngineReport, operations } from '../scripts/experiments/q2-diff-engine/inputs.mjs';
import { classifyTest, selectTests, concurrencyFor } from '../scripts/test-selection.mjs';
import { calculatorChanged } from '../scripts/experiments/q2-diff-engine/pr.mjs';
import { cleanupOwned } from '../scripts/experiments/q2-diff-engine/cleanup.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { budget } from '../scripts/experiments/q2-diff-engine/run.mjs';
const input = { definitionBytes: '{"chunks":{}}', datasetOptions: { cacheWalking: false }, extraRules: [] };
function provider() {
  return { datasetId: 'synthetic', datasetContractVersion: 1, capabilities: {}, overlayOrder: {}, gameDefaults: {},
    workerSelection: () => ({}), files: [{ path: 'pack.json', kind: 'input', bytes: 2, sha256: sha('{}') },
      { path: 'engine.mjs', kind: 'evidence', bytes: 10, sha256: sha('old code') }],
    bytes: name => { assert.equal(name, 'pack.json'); return Buffer.from('{}'); } };
}
test('input attestation permits changed engine evidence and rejects changed packs, definitions, values and options', async () => {
  const a = provider(), b = provider(); b.files[1].sha256 = sha('new code');
  const first = await attest(a, async () => ({ key: 1 }), input), second = await attest(b, async () => ({ key: 1 }), input);
  assert.equal(verifyInputs(first, second), sha(JSON.stringify(first)));
  for (const edit of [v => v.definitionsSHA256 = sha('other bytes'), v => v.optionsSHA256 = sha('other options'),
    v => v.extraRulesSHA256 = sha('other rules'), v => v.valuesSHA256 = sha('other definitions'),
    v => v.files[0].sha256 = sha('other pack'), v => v.files.push({ path: 'new input' }),
    v => v.capabilities.extra = true, v => v.contractVersion++]) {
    const changed = structuredClone(first); edit(changed); assert.throws(() => verifyInputs(first, changed), /Data inputs differ/);
  }
  assert.notEqual((await attest(b, async () => ({}), { ...input, definitionBytes: '{ "chunks":{} }' })).definitionsSHA256, first.definitionsSHA256);
  b.bytes = () => Buffer.from('[]'); await assert.rejects(attest(b, async () => ({}), input), /verification/);
  b.packed = true; await assert.rejects(attest(b, async () => ({}), input), /Public tracked/);
});
test('lane comparator keeps gameplay fields and array order while ignoring its existing volatile fields', () => {
  const a = { full: { tasks: [{ status: 'available', elapsedMs: 5 }], metrics: { elapsedMs: 2, availableCount: 1 } } };
  const b = structuredClone(a); b.full.metrics.elapsedMs++;
  assert.deepEqual(compareValues(a, b), []);
  b.full.tasks[0].status = 'blocked'; assert.equal(compareValues(a, b)[0].path, '/full/tasks/0/status');
  b.full.tasks[0].status = 'available'; b.full.tasks[0].elapsedMs++;
  assert.equal(compareValues(a, b).length, 1);
  assert.equal(compareValues({ items: ['a', 'b'] }, { items: ['b', 'a'] }).length, 2);
});
test('only verified how-task provenance is rebound; unrelated digests and envelope-like gameplay fields stay significant', () => {
  const left = { id: 1, timingMs: 2, result: { id: 'task', context: { datasetDigest: 'code-a' }, otherDigest: 'a' } };
  const right = { id: 2, timingMs: 3, result: { id: 'task', context: { datasetDigest: 'code-b' }, otherDigest: 'a' } };
  assert.deepEqual(resultValue(left, 'how-task', 'code-a', 'input'), resultValue(right, 'how-task', 'code-b', 'input'));
  assert.throws(() => resultValue(right, 'how-task', 'unverified', 'input'), /Unattested/);
  const value = resultValue({ result: { id: 3, timingMs: 4, datasetDigest: 'game-data' } }, 'evaluate', 'code-a', 'input');
  assert.equal(value.result.datasetDigest, 'game-data'); assert.equal(value.result.timingMs, 4);
});
test('report acceptance refuses empty, partial, missing-operation, missing-harvest and over-budget runs', () => {
  const report = { format: 'q2-engine-diff-v1', complete: true, exitCode: 0, errors: 0, differences: 0,
    inputsVerified: true, requestPairs: 100, expectedPairs: 100, sources: { synthetic: 29, harvest: 71 },
    resultPairs: 100, errorPairs: 0, successfulSources: { synthetic: 29, harvest: 71 },
    successfulRequests: Object.fromEntries(operations.map(type => [type, 1])), requests: Object.fromEntries(operations.map(type => [type, 1])), durationMs: 100, limits: { wallMs: 1000 } };
  assert.equal(validateEngineReport(report), true);
  for (const edit of [v => v.complete = false, v => v.requestPairs--, v => v.expectedPairs = 0,
    v => v.inputsVerified = false, v => v.sources.harvest = 0, v => delete v.successfulRequests.predict,
    v => v.durationMs = 1001, v => v.durationMs = NaN, v => v.requestPairs = NaN, v => v.differences++, v => v.errors++, v => delete v.errors, v => v.exitCode = 13]) {
    const changed = structuredClone(report); edit(changed); assert.throws(() => validateEngineReport(changed));
  }
  for (const value of ['NaN', '-1', '1.5', 'Infinity', '1001']) assert.throws(() => budget(value, 100, 1, 1000));
});

test('PR selection includes calculator code and data changes, excluding unrelated UI and release notes', () => {
  for (const file of ['app/tasks/engine.mjs', 'app/core/planning.mjs', 'app/data/settings.mjs', 'app/dataset-inputs.mjs',
    'app/datasets/open-f2p/wiki-derived/dataset.json', 'app/play-view.mjs', 'app/sandbox.mjs']) assert(calculatorChanged([file]));
  for (const file of ['README.md', 'app/web/app.css', 'app/server.mjs', 'app/data/changelog.json', 'app/data/roadmap.json']) assert(!calculatorChanged([file]));
});

test('cleanup refuses a poisoned owned-worktree receipt', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'q2-cleanup-unit-'));
  try {
    await writeFile(path.join(out, 'owned.json'), JSON.stringify({ scratch: path.join(out, 'owned'), worktrees: ['/'] }));
    await assert.rejects(cleanupOwned(out), /Invalid owned paths/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('full-corpus detectors require the explicit engine-differential suite', () => {
  const q2 = 'q2-diff-engine-integration.test.mjs', unit = 'q2-diff-engine.test.mjs', y03 = 'y03-fuzz-ci-integration.test.mjs';
  assert.equal(classifyTest(q2), 'engine-differential-only');
  assert.deepEqual(selectTests([q2, unit, y03], 'quick'), [unit]);
  assert.deepEqual(selectTests([q2, unit, y03], 'full'), [unit]);
  assert.deepEqual(selectTests([q2, unit, y03], 'differential'), [y03]);
  assert.deepEqual(selectTests([q2, unit, y03], 'engine-differential'), [q2]);
  assert.equal(concurrencyFor('engine-differential', {}), 1);
});
