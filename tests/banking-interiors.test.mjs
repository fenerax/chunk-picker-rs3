import test from 'node:test';
import assert from 'node:assert/strict';
import { interiorBankCandidates } from '../app/training/banking-interiors.mjs';

const evidence = () => ({ schemaVersion: 1, candidates: [{
  id: 'upper-service', label: 'Upper-floor service', kind: 'bank', members: false,
  chunkId: '257', x: 72, y: 75, plane: 2, mapId: 7,
  entryPoint: { x: 70, y: 70, plane: 0, mapId: 7 }, witnessTiles: [[69, 70], [70, 69]],
  interiorTileSteps: 5, interiorSeconds: 5.4,
  interiorEstimate: { estimated: true, accessEffect: 'none', assumptions: ['Upper geometry is unverified.'] },
}] });

test('interior estimates require explicit evidence and preserve the service floor', () => {
  assert.deepEqual(interiorBankCandidates(), []);
  const [row] = interiorBankCandidates(evidence());
  assert.equal(row.plane, 2); assert.equal(row.entryPoint.plane, 0);
  assert.equal(row.interiorEstimate.accessEffect, 'none');
  assert.deepEqual(row.witnessTiles, [[69, 70], [70, 69]]);
});

test('caller changes cannot alter supplied route evidence', () => {
  const input = evidence(), result = interiorBankCandidates(input);
  result[0].witnessTiles[0][0] = 0;
  result[0].interiorEstimate.assumptions.length = 0;
  assert.equal(input.candidates[0].witnessTiles[0][0], 69);
  assert.equal(interiorBankCandidates(input)[0].interiorEstimate.assumptions.length, 1);
});

test('invalid floors, timing, duplicate identities and access-changing evidence fail closed', () => {
  for (const change of [{ plane: 0 }, { interiorSeconds: -1 }, { interiorSeconds: Infinity },
    { entryPoint: { x: 70, y: 70, plane: 1, mapId: 7 } }, { witnessTiles: [[NaN, 70]] },
    { interiorEstimate: { estimated: true, accessEffect: 'entry', assumptions: [] } }]) {
    const input = evidence(); Object.assign(input.candidates[0], change);
    assert.throws(() => interiorBankCandidates(input), /Invalid banking interior/);
  }
  const duplicate = evidence(); duplicate.candidates.push(duplicate.candidates[0]);
  assert.throws(() => interiorBankCandidates(duplicate), /Invalid banking interior/);
});
