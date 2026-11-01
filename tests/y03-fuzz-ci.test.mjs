import test from 'node:test';
import assert from 'node:assert/strict';
import { definitions, makeState, requestsFor, randomFor } from '../scripts/experiments/y03-fuzz-ci/generator.mjs';
import { normalize, differences, EXIT, publicEnvironment } from '../scripts/experiments/y03-fuzz-ci/semantic.mjs';
import { shrink } from '../scripts/experiments/y03-fuzz-ci/shrink.mjs';
import { validateReport } from '../scripts/experiments/y03-fuzz-ci/validate-report.mjs';
import { createGroupState, validateState } from '../app/core/state.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { classifyTest, selectTests } from '../scripts/test-selection.mjs';

test('fixed public generator covers valid solo/duo saves, all sizes and nine worker operations', () => {
  const defs = definitions(), sizes = new Set(), owners = new Set(), requests = new Set();
  for (let i = 0; i < 50; i++) {
    const state = makeState(i, 19003, defs, createGroupState, taskId);
    validateState(state); owners.add(state.members.length);
    assert.deepEqual(state, makeState(i, 19003, defs, createGroupState, taskId));
    assert.notDeepEqual(state, makeState(i, 19004, defs, createGroupState, taskId));
    for (const member of state.members) { sizes.add(member.unlocked.length); assert.equal(new Set(member.unlocked).size, member.unlocked.length); }
    for (const request of requestsFor(state, defs, i)) requests.add(request.type);
  }
  assert.deepEqual([...owners].sort(), [1, 2]); assert.deepEqual([...sizes].sort((a, b) => a - b), [1, 2, 12, 47, 48]);
  assert.equal(requests.size, 9);
  const smoke = [0, 1].map(i => makeState(i, 19003 + i, defs, createGroupState, taskId));
  assert.equal(smoke.flatMap((state, i) => requestsFor(state, defs, i)).length, 29);
  assert.deepEqual(smoke.map(state => state.members[0].unlocked.length), [1, 2]);
});

test('cheap units stay quick and real-process detectors run only in differential', () => {
  assert.equal(classifyTest('y03-fuzz-ci.test.mjs'), 'quick');
  assert.equal(classifyTest('y03-fuzz-ci-integration.test.mjs'), 'differential-only');
  assert.deepEqual(selectTests(['y03-fuzz-ci.test.mjs', 'y03-fuzz-ci-integration.test.mjs']), ['y03-fuzz-ci.test.mjs']);
  assert.deepEqual(selectTests(['y03-fuzz-ci.test.mjs', 'y03-fuzz-ci-integration.test.mjs'], 'full'), ['y03-fuzz-ci.test.mjs']);
});

test('PRNG and operation order replay exactly', () => {
  const a = randomFor(19), b = randomFor(19);
  for (let i = 0; i < 10000; i++) { const value = a(); assert.equal(value, b()); assert(value >= 0 && value < 1); }
  const defs = definitions(), state = makeState(1, 19003, defs, createGroupState, taskId);
  assert.deepEqual(requestsFor(state, defs, 1), requestsFor(state, defs, 1));
});

test('normalization excludes documented telemetry and retains semantic counters, statuses, errors and order', () => {
  const value = { id: 42, timingMs: { totalMs: 4 }, evaluationMs: 5,
    result: { cache: { baselineHit: true }, metrics: { elapsedMs: 3, passes: 2, availableCount: 1 },
      tasks: [{ id: 't', cache: 'game data', elapsedMs: 9, timingMs: 7, status: 'blocked' }], items: ['b', 'a'] },
    full: { metrics: { elapsedMs: 8, passes: 3 } }, prepared: [{ play: { metrics: { elapsedMs: 4, passes: 2 } } }] };
  const changed = structuredClone(value);
  changed.id++; changed.timingMs.totalMs++; changed.evaluationMs++; changed.result.cache.baselineHit = false;
  changed.result.metrics.elapsedMs++; changed.full.metrics.elapsedMs++; changed.prepared[0].play.metrics.elapsedMs++;
  assert.deepEqual(normalize(value), normalize(changed));
  const edits = [v => v.result.metrics.passes++, v => v.result.metrics.availableCount++, v => v.full.metrics.passes++,
    v => v.result.tasks[0].status = 'available', v => v.result.items.reverse(), v => v.result.tasks[0].cache = 'other',
    v => v.result.tasks[0].elapsedMs++, v => v.result.tasks[0].id = 'other', v => v.result.tasks[0].timingMs++,
    v => v.full.cache = true, v => v.resultCache = true, v => v.error = { name: 'TypeError' }];
  for (const edit of edits) { const other = structuredClone(value); edit(other); assert(differences(normalize(value), normalize(other)).length > 0); }
  assert(differences(normalize({ error: { name: 'TypeError' } }), normalize({ error: { name: 'RangeError' } })).length);
  assert.deepEqual(differences({ 'a/b': [1] }, { 'a/b': [2] }), ['/a~1b/0']);
});

test('bounded shrinker validates candidates, preserves owner/unlock and marks censored exhaustion', async () => {
  const original = { members: [{ id: 'owner', unlocked: ['keep', 'remove', 'other'], selected: [], completedTasks: ['a', 'b'] }], rules: { unused: true }, tasks: [] };
  const valid = state => { assert(state.members[0].unlocked.length); };
  const accepts = state => state.members[0].unlocked.includes('keep');
  const reduced = await shrink(original, { memberId: 'owner' }, accepts, valid, 80);
  assert.deepEqual(reduced.state.members[0].unlocked, ['keep']); assert.deepEqual(reduced.state.members[0].completedTasks, []);
  assert.equal(reduced.censored, false); assert.deepEqual(original.members[0].unlocked, ['keep', 'remove', 'other']);
  const capped = await shrink(original, { memberId: 'owner' }, accepts, valid, 1);
  assert.equal(capped.attempts, 1); assert.equal(capped.censored, true);
});

test('input selectors and incomplete/malformed reports fail closed', () => {
  assert.throws(() => publicEnvironment({ RS3_PACKS_DIR: '/synthetic/path' }), /Unset RS3/);
  assert.doesNotThrow(() => publicEnvironment({ PATH: '/bin' }));
  for (const report of [null, {}, { format: 'y03-report-v1', complete: false }, { format: 'y03-report-v1', complete: true, exitCode: 15 }]) {
    assert.throws(() => validateReport(report, {}));
  }
  assert.equal(EXIT.mismatch, 10);
});

test('strict acceptance checks a complete report and rejects each partial or incorrect gate field', () => {
  const digest = 'a'.repeat(64), sha = 'b'.repeat(40);
  const report = { format: 'y03-report-v1', complete: true, exitCode: 0, harnessCommit: sha, harnessDirty: false,
    commits: [sha, sha], adapters: ['worker-cold-v1', 'worker-warm-v1'], adapterSHA256: digest,
    normalization: 'worker-json-v1', fault: 'none', profile: 'smoke', seeds: [19003, 19004], requestedCases: 2,
    completedCases: 2, requestPairs: 29, replayPairs: 29, requests: { 'prepare-rules': 2, evaluate: 6,
      'roll-pool': 3, predict: 3, 'death-estimates': 3, 'chunk-planning': 3, sandbox: 3, 'area-check': 3, 'how-task': 3 },
    views: { full: 3, 'play-v1': 3 }, errors: 0, differences: 0, nondeterministicFields: 0, faultControlPairs: 0, failures: [],
    limits: { requestMs: 5000, wallMs: 110000, rssBytes: 1073741824, shrinkAttempts: 12,
      sampleMs: 20, bridgeOldGenerationMiB: 256, workerOldGenerationMiB: 512 },
    durationMs: 1000, peakRSSBytes: [100, 100], engines: [{ datasetDigest: digest }, { datasetDigest: digest }],
    harnessSourceSHA256: digest, definitionsSHA256: digest, statesSHA256: digest, corpusSHA256: digest, resultSHA256: digest };
  const expected = { harnessCommit: sha, commits: [sha, sha], adapterSHA256: digest, profile: 'smoke' };
  assert.equal(validateReport(report, expected), true);
  assert.equal(validateReport(report, { ...expected, coordinatorDurationMs: 110000 }), true);
  assert.throws(() => validateReport(report, { ...expected, coordinatorDurationMs: 110001 }), { exitCode: 15 });
  const mutations = [v => v.complete = false, v => v.exitCode = 15, v => v.harnessCommit = 'c'.repeat(40),
    v => v.harnessDirty = true, v => v.commits.reverse().push(sha), v => v.adapters.reverse(),
    v => v.adapterSHA256 = 'd'.repeat(64), v => v.seeds.reverse(), v => v.completedCases--, v => v.requestPairs--,
    v => v.replayPairs--, v => v.requests.predict--, v => v.views.full--, v => v.errors++, v => v.differences++,
    v => v.nondeterministicFields++, v => v.failures.push({ kind: 'budget' }), v => v.limits.wallMs++,
    v => v.durationMs = 110001, v => v.peakRSSBytes[1] = 1073741825, v => v.engines[1].datasetDigest = 'c'.repeat(64),
    v => delete v.resultSHA256, v => delete v.corpusSHA256];
  for (const mutate of mutations) {
    const other = structuredClone(report); mutate(other); assert.throws(() => validateReport(other, expected));
  }
});
