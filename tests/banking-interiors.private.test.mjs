import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const interiorEvidence = JSON.parse(await readFile(new URL('../app/data/banking-interiors.json', import.meta.url), 'utf8'));
import { interiorBankCandidates } from '../app/training/banking-interiors.mjs';

test('upstairs estimates preserve service floor and only nominate staircase perimeter approaches', () => {
  const candidates = interiorBankCandidates(interiorEvidence);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.deepEqual([candidate.x, candidate.y, candidate.plane, candidate.mapId], [3208, 3221, 2, 28]);
    assert.equal(candidate.entryPoint.plane, 0);
    assert.equal(candidate.witnessTiles.length, 8);
    const { x, y } = candidate.entryPoint;
    for (const [px, py] of candidate.witnessTiles) {
      assert.equal(px >= x && px < x + 2 && py >= y && py < y + 2, false);
      assert.equal((px >= x && px < x + 2) || (py >= y && py < y + 2), true);
    }
    assert.equal(candidate.interiorEstimate.estimated, true);
    assert.equal(candidate.interiorEstimate.accessEffect, 'none');
  }
  assert.deepEqual(candidates.map(row => row.interiorTileSteps), [13, 8]);
});

test('caller changes cannot alter later calculator evidence', () => {
  const first = interiorBankCandidates(interiorEvidence);
  first[0].witnessTiles[0][0] = 0;
  first[0].interiorEstimate.stairPlacementIds.length = 0;
  first[0].interiorEstimate.sourceHashes['objects.placements.v1.json.gz'] = 'changed';
  const again = interiorBankCandidates(interiorEvidence);
  assert.equal(again[0].witnessTiles[0][0], 3203);
  assert.equal(again[0].interiorEstimate.stairPlacementIds.length, 3);
  assert.match(again[0].interiorEstimate.sourceHashes['objects.placements.v1.json.gz'], /^[a-f0-9]{64}$/);
});
