// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOwners, warmupPlan, capProjection, steadyStateRule, COMPILED_CODE_ALLOWANCE_BYTES } from '../scripts/perf/owned-acceptance/steady-state.mjs';
import { decision, MiB } from '../scripts/perf/owned-acceptance/metrics.mjs';
import { shapes } from '../scripts/perf/owned-acceptance/profile.mjs';
import { scopeDecision } from '../scripts/perf/owned-acceptance/scope.mjs';
import { createResponseCache, createRepresentation } from '../app/http-response.mjs';
import { createSnapshotHotSet } from '../app/tasks/snapshot-hot-set.mjs';
import { createEligibilityBudget } from '../app/tasks/eligibility-cache.mjs';

function evidence() {
  const owners = allowedOwners.map(owner => ({ owner, id: owner, scope: 'group', group: 0, complete: true,
    workload: { newEntriesPerCycle: 2 }, dimensions: [
      { unit: 'entries', used: 4, cap: 4, enforced: true }, { unit: 'chargeBytes', used: 64, cap: 128, enforced: true }] }));
  return { warmup: { status: 'reached', owners: owners.map(row => ({ owner: row.owner, id: row.id,
    requiredEntries: 4, attainedEntries: 4, asserted: true, basis: 'cap' })) },
    samples: [0, 1, 2, 3].map(i => ({ heapUsedBytes: 1000 + i, nativeBytes: 10 - i, owners: structuredClone(owners) })),
    compiledCode: { heapGrowthBytes: 3, source: 'non-native-code-feedback-spot-check' },
    spotChecks: [{ owners: [{ owner: 'response-caches', used: 64, cap: 128 }], unattributedHeapGrowthBytes: 0, nativeGrowthBytes: -1000 }] };
}

test('enforced warmed flat owners within caps allow only attributed bounded code growth', () => {
  const proof = evidence(), result = steadyStateRule(proof);
  assert.equal(result.eligible, true); assert.deepEqual(result.reasons, []);
  assert.equal(result.heapGrowthBytes, 3); assert.equal(result.nativeGrowthBytes, -3);
  assert.equal(warmupPlan(proof.samples[0].owners).minimumCycles, 2);
  const caps = capProjection(proof.samples[0].owners);
  assert.equal(caps.perGroupByteCapSum, 5 * 128); assert.equal(caps.projectedTotal100GroupBytes, 100 * 5 * 128);
});

test('entries-only owners cannot certify steady state or a complete cap projection', () => {
  const proof = evidence();
  for (const sample of proof.samples) for (const owner of sample.owners)
    owner.dimensions = owner.dimensions.filter(dimension => dimension.unit === 'entries');
  assert.equal(steadyStateRule(proof).eligible, false);
  const projection = capProjection(proof.samples[0].owners);
  assert.equal(projection.complete, false);
  assert.equal(projection.missingByteCaps.length, allowedOwners.length);
  assert.equal(projection.projectedTotal100GroupBytes, null);
});

test('missing attained entries on every warm-up owner cannot certify steady state', () => {
  const proof = evidence();
  for (const owner of proof.warmup.owners) delete owner.attainedEntries;
  const verdict = steadyStateRule(proof);
  assert.equal(verdict.eligible, false);
  for (const owner of proof.warmup.owners) assert(verdict.reasons.includes(`warmup-unasserted:${owner.owner}/${owner.id}`));
});

test('missing and nonnumeric counters fail closed throughout the steady-state rule', () => {
  const fields = [
    ['sample heap', (proof, value) => { proof.samples[0].heapUsedBytes = value; }],
    ['sample native', (proof, value) => { proof.samples[0].nativeBytes = value; }],
    ['ledger used', (proof, value) => { proof.samples[0].owners[0].dimensions[1].used = value; }],
    ['ledger cap', (proof, value) => { proof.samples[0].owners[0].dimensions[1].cap = value; }],
    ['admissions per cycle', (proof, value) => { proof.samples[0].owners[0].workload.newEntriesPerCycle = value; }],
    ['working set', (proof, value) => { proof.samples[0].owners[0].workload.workingSetEntries = value; }],
    ['required entries', (proof, value) => { proof.warmup.owners[0].requiredEntries = value; }],
    ['attained entries', (proof, value) => { proof.warmup.owners[0].attainedEntries = value; }],
    ['unattributed heap', (proof, value) => { proof.spotChecks[0].unattributedHeapGrowthBytes = value; }],
    ['spot owner used', (proof, value) => { proof.spotChecks[0].owners[0].used = value; }],
    ['spot owner cap', (proof, value) => { proof.spotChecks[0].owners[0].cap = value; }],
    ['compiled heap', (proof, value) => { proof.compiledCode.heapGrowthBytes = value; }],
  ];
  const invalid = [undefined, null, NaN, Infinity, -Infinity, -1, 0.5, '4', true, Number.MAX_SAFE_INTEGER + 1];
  for (const [name, set] of fields) for (const value of invalid) {
    const proof = evidence(); set(proof, value);
    const verdict = steadyStateRule(proof);
    assert.equal(verdict.eligible, false, `${name}: ${String(value)}`);
    assert(!verdict.reasons.some(reason => reason.startsWith('owner-over-cap:') || reason.startsWith('spot-check-owner-over-cap:')),
      `invalid evidence is not a proven cap violation: ${name}: ${String(value)}`);
  }
  const tooMany = evidence(); tooMany.warmup.owners[0].attainedEntries = 5;
  assert.equal(steadyStateRule(tooMany).eligible, false, 'attainment cannot exceed the enforced entry cap');
  const zeroAdmissions = evidence(); zeroAdmissions.samples[0].owners[0].workload.newEntriesPerCycle = 0;
  assert.equal(steadyStateRule(zeroAdmissions).eligible, false);
  // Native growth is signed diagnostic data, but still cannot be malformed.
  for (const value of invalid.filter(value => value !== -1)) {
    const proof = evidence(); proof.spotChecks[0].nativeGrowthBytes = value;
    if (value !== undefined) assert.equal(steadyStateRule(proof).eligible, false);
  }
});

test('an unlisted dominator owner and an owner over its cap each veto the rule', () => {
  const unlisted = evidence(); unlisted.spotChecks[0].owners.push({ owner: 'unexpected-retainer', used: 1, cap: 10 });
  assert(steadyStateRule(unlisted).reasons.includes('unlisted-owner:unexpected-retainer'));
  const over = evidence(); over.samples[1].owners[0].dimensions[1].used = 129;
  assert(steadyStateRule(over).reasons.some(reason => reason.startsWith('owner-over-cap:History')));
});

test('native/backing decreases cannot offset unexplained heap or excess compiled code', () => {
  const proof = evidence(); proof.compiledCode.heapGrowthBytes = 0;
  proof.samples[0].nativeBytes = 999999; proof.samples.at(-1).nativeBytes = 0;
  assert(steadyStateRule(proof).reasons.includes('residual-heap-growth'));
  proof.compiledCode.heapGrowthBytes = COMPILED_CODE_ALLOWANCE_BYTES + 1;
  assert(steadyStateRule(proof).reasons.includes('compiled-code-attribution-unavailable-or-over-bound'));
});

test('an uncovered maximum always vetoes a waiver', () => {
  const proof = evidence(); proof.uncoveredMaximum = { sample: 'commands-2' };
  assert(steadyStateRule(proof).reasons.includes('uncovered-maximum'));
});

test('complete enforced flat ledgers need no snapshots when there is no residual heap growth', () => {
  const proof = evidence(); proof.compiledCode = null; delete proof.spotChecks;
  proof.samples.forEach(row => { row.heapUsedBytes = 1000; });
  assert.equal(steadyStateRule(proof).eligible, true);
});

test('observing owners below caps or guessing saturation never proves warm-up', () => {
  const proof = evidence(); proof.warmup.status = 'observed';
  assert.equal(steadyStateRule(proof).eligible, false);
  proof.warmup.status = 'reached'; proof.warmup.owners[0].requiredEntries = 1;
  assert(steadyStateRule(proof).reasons.some(reason => reason.startsWith('warmup-unasserted:History')));
  const noCap = evidence().samples[0].owners; noCap[0].dimensions[0].cap = null; noCap[0].complete = false;
  assert.equal(warmupPlan(noCap).status, 'blocked');
  assert.equal(capProjection(noCap).projectedTotal100GroupBytes, null);
});

test('owner growth and changing inventories reject even if total ledger charges cancel', () => {
  const proof = evidence(); proof.samples[1].owners[0].dimensions[1].used++;
  proof.samples[1].owners[1].dimensions[1].used--;
  assert(steadyStateRule(proof).reasons.some(reason => reason.startsWith('nonflat-ledger:')));
  const missing = evidence(); missing.samples[1].owners.pop();
  assert(steadyStateRule(missing).reasons.includes('ledger-inventory-changed'));
});

function rawResult({ heapMiB = 300, groupMiB = 6 } = {}) {
  const history = Array.from({ length: 50 }, (_, index) => ({ index, revisionDelta: 4, activeEventDelta: 0,
    activeEvents: 0, archiveSegmentDelta: 0, logicalBytes: 0 }));
  const sample = round => ({ round, total: { heapUsed: heapMiB * MiB }, history });
  return { smoke: false, shape: shapes.acceptance, baseline: { total: { heapUsed: 0 } },
    groups: Array.from({ length: 50 }, (_, index) => ({ index, openBytes: groupMiB * MiB, commandBytes: 0 })),
    openSamples: [{ count: 50, ...sample(0) }], commandSamples: [sample(0)], settled: sample(0), readOnlyWarmup: sample(0),
    repeated: [1, 2, 3, 4].map(sample), mutationWarmup: sample(0), mutationRepeated: [1, 2, 3, 4].map(sample),
    mutationHistoryBaseline: history.map(() => ({ activeHistoryEntries: 0 })), postPublicationIO: { baseWrites: 0 }, errors: [] };
}

function withRetention(result) {
  const proof = evidence();
  const covered = [result.commandSamples.at(-1), result.settled, result.readOnlyWarmup,
    ...result.repeated, result.mutationWarmup, ...result.mutationRepeated];
  covered.forEach(sample => { sample.ownerLedgers = structuredClone(proof.samples[0].owners); });
  result.retention = { ...proof, compiledCode: null, spotChecks: [], samples: covered.map(sample => ({
    heapUsedBytes: sample.total.heapUsed, nativeBytes: 0, owners: sample.ownerLedgers })) };
  return result;
}

test('a 210 MiB serial peak cannot hide growth within 201 to 204 MiB repeat phases', () => {
  const result = rawResult({ heapMiB: 201, groupMiB: 4 });
  result.commandSamples[0].total.heapUsed = 210 * MiB;
  for (const phase of [result.repeated, result.mutationRepeated])
    phase.forEach((sample, i) => { sample.total.heapUsed = (201 + i) * MiB; });
  const verdict = decision(withRetention(result));
  assert.equal(verdict.steadyState.heapGrowthBytes, 3 * MiB);
  assert.equal(verdict.steadyState.eligible, false);
  assert(verdict.steadyState.reasons.includes('residual-heap-growth'));
  assert.deepEqual(verdict.reasons, ['growth-on-every-read-only-repeat', 'positive-mutation-repeat-heap-slope']);
  assert.equal(verdict.acceptanceClaim, false);
});

test('malformed spot owner counters only deny the waiver for a flat 200 MiB raw pass', () => {
  for (const owner of [{ owner: 'response-caches', cap: 128 }, { owner: 'response-caches', used: 64 }]) {
    const result = withRetention(rawResult({ heapMiB: 200, groupMiB: 4 }));
    result.retention.spotChecks.push({ owners: [owner], unattributedHeapGrowthBytes: 0 });
    const verdict = decision(result);
    assert.equal(verdict.steadyState.eligible, false);
    assert.deepEqual(verdict.steadyState.reasons, ['invalid-spot-check-owner:response-caches']);
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.targetMet, true); assert.equal(verdict.acceptanceClaim, true);
  }
});

test('unlisted ledger and spot owners deny a waiver without rejecting passing raw gates', () => {
  for (const source of ['ledger', 'spot']) {
    const result = withRetention(rawResult({ heapMiB: 200, groupMiB: 4 }));
    if (source === 'ledger') {
      // Valid numeric counters over their cap: still only unsupported evidence.
      for (const sample of result.retention.samples) {
        const row = { ...structuredClone(sample.owners[0]), owner: 'unexpected-retainer', id: 'unexpected-retainer' };
        for (const dimension of row.dimensions) dimension.used = dimension.cap + 1;
        sample.owners.push(row);
      }
      result.retention.warmup.owners.push({ ...result.retention.warmup.owners[0], owner: 'unexpected-retainer', id: 'unexpected-retainer' });
    } else result.retention.spotChecks.push({ owners: [{ owner: 'unexpected-retainer', used: 129, cap: 128 }], unattributedHeapGrowthBytes: 0 });
    const verdict = decision(result);
    assert.equal(verdict.steadyState.eligible, false, source);
    assert.deepEqual(verdict.steadyState.reasons, ['unlisted-owner:unexpected-retainer'], source);
    assert.deepEqual(verdict.reasons, [], source); assert.equal(verdict.acceptanceClaim, true, source);
  }
});

test('cap violation words in incomplete-owner diagnostics cannot reject passing raw gates', () => {
  const result = withRetention(rawResult({ heapMiB: 200, groupMiB: 4 }));
  for (const sample of result.retention.samples) {
    sample.owners[0].complete = false;
    sample.owners[0].blockers = ['owner-over-cap'];
  }
  const verdict = decision(result);
  assert.equal(verdict.steadyState.eligible, false);
  assert.deepEqual(verdict.steadyState.reasons, ['incomplete-owner:History/History:owner-over-cap']);
  assert.deepEqual(verdict.reasons, []); assert.equal(verdict.acceptanceClaim, true);
});

test('valid numeric ledger and spot cap violations still reject a flat raw pass', () => {
  for (const source of ['ledger', 'spot']) {
    const result = withRetention(rawResult({ heapMiB: 200, groupMiB: 4 }));
    if (source === 'ledger') {
      for (const sample of result.retention.samples) sample.owners[0].dimensions[1].used = 129;
    } else result.retention.spotChecks.push({ owners: [{ owner: 'response-caches', used: 129, cap: 128 }], unattributedHeapGrowthBytes: 0 });
    const verdict = decision(result);
    assert.deepEqual(verdict.reasons, ['steady-state-owner-proof-rejected'], source);
    assert.equal(verdict.acceptanceClaim, false, source);
  }
});

test('an uncovered 201 MiB opening peak falls back to passing raw gates with flat 200 MiB repeats', () => {
  const result = withRetention(rawResult({ heapMiB: 200, groupMiB: 4 }));
  result.openSamples[0].total.heapUsed = 201 * MiB;
  const verdict = decision(result);
  assert.equal(verdict.steadyState.eligible, false);
  assert.deepEqual(verdict.steadyState.reasons, ['uncovered-maximum']);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.maximumGroupHeapBytes, 201 * MiB);
  assert.equal(verdict.worstPossibleGroupBytes, 5 * MiB);
  assert.equal(verdict.targetMet, true);
  assert.equal(verdict.acceptanceClaim, true);
});

test('missing snapshots/ledgers preserve every raw growth gate and explain the fallback', () => {
  const result = rawResult();
  result.repeated.forEach((row, i) => { row.total.heapUsed += i * 16 * MiB; });
  result.mutationRepeated.forEach((row, i) => { row.total.heapUsed += i * 16 * MiB; });
  const verdict = decision(result);
  for (const reason of ['unattributed-growth-needs-dominators', 'growth-on-every-read-only-repeat', 'positive-mutation-repeat-heap-slope'])
    assert(verdict.reasons.includes(reason));
  assert.match(verdict.steadyState.reasons[0], /ledger-evidence-missing; raw-growth-gates-apply/);
  assert.equal(verdict.acceptanceClaim, false);
});

test('targets remain goals while unchanged hard lines and smoke still block acceptance', () => {
  const result = rawResult(), verdict = decision(result);
  assert.equal(verdict.targetMet, false); assert.equal(verdict.status, 'within-hard-limits-target-missed');
  assert.equal(verdict.acceptanceClaim, true); assert.deepEqual(verdict.reasons, []);
  assert.deepEqual(verdict.thresholdsBytes, { targetPerGroup: 5 * MiB, rejectPerGroup: 15 * MiB, targetTotal: 250 * MiB, rejectTotal: 750 * MiB });
  assert.equal(scopeDecision(verdict, 'diagnostic').acceptanceClaim, false);
  assert.equal(scopeDecision(verdict, 'diagnostic').gatePassed, true);
  assert.equal(scopeDecision(verdict, 'full').acceptanceClaim, true);
  result.groups[0].openBytes = 15 * MiB + 1;
  assert(decision(result).reasons.includes('attributable-group-over-15-MiB'));
  result.settled.total.heapUsed = 750 * MiB + 1;
  assert(decision(result).reasons.includes('aggregate-over-750-MiB'));
  result.smoke = true; assert.equal(decision(result).acceptanceClaim, false);
});

test('source ledgers assert existing caps and retain only the admitted response/hot/budget owners', () => {
  const cache = createResponseCache({ maxEntries: 2, maxBytes: 12 });
  const a = createRepresentation(Buffer.from('aaaa')), b = createRepresentation(Buffer.from('bbbb')), c = createRepresentation(Buffer.from('cccc'));
  cache.set('a', a); cache.set('b', b);
  assert.equal(cache.retentionLedger().dimensions[0].used, 2);
  cache.set('c', c); assert.equal(cache.get('a'), undefined); assert.equal(cache.get('b'), b); assert.equal(cache.get('c'), c);
  assert.equal(cache.retentionLedger().dimensions[0].cap, 2);
  assert.equal(cache.retentionLedger().dimensions[1].used, 8);
  const hot = createSnapshotHotSet({ entryLimit: 1, byteLimit: 100 }), first = {}, second = {}; let demoted;
  hot.retain(first, 40, () => { demoted = first; }); hot.retain(second, 80, () => {});
  assert.equal(demoted, first); assert.equal(hot.retentionLedger().dimensions[0].used, 1);
  assert.equal(hot.retentionLedger().dimensions[1].used, 80);
  const budget = createEligibilityBudget({ byteLimit: 10, entryLimit: 1 }); const token = {};
  assert.equal(budget.admit(token, () => {}, { cost: 10 }), true);
  assert.equal(budget.retentionLedger().dimensions[1].used, 10);
  budget.forget(token); assert.equal(budget.retentionLedger().dimensions[1].used, 0);
});
