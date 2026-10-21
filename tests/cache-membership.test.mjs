import test from 'node:test';
import assert from 'node:assert/strict';
import { rawFreeAt, analyzeMembership } from '../scripts/cache/membership.mjs';

const square = hex => ({ nonmembarea: Uint8Array.from(Buffer.from(hex, 'hex')) });

test('copied-cache geographic masks agree with independent Wiki calibration points', () => {
  // Lumbridge (3200,3215), Wiki revision 37148560: members=No.
  assert.equal(rawFreeAt(square('ffffffffffffffff'), 0, 15), true);
  // Canifis (3496,3488), Wiki revision 37124299: members=Yes.
  assert.equal(rawFreeAt(square('0000000000000000'), 40, 32), false);
  // Shantay Pass (3305,3123), revision 37130849: members=No.
  // The north-facing free strip disproves MSB-first southern bits.
  const shantay = square('008080e0e0e0e000');
  assert.equal(rawFreeAt(shantay, 41, 51), true);
  assert.equal(rawFreeAt(shantay, 41, 3), false);
  // Rug merchant south of the gate (3311,3109), revision 37130854.
  // The gate article establishes that the southern desert is members geography.
  // Transposing X/Z would incorrectly set this point's bit.
  assert.equal(rawFreeAt(shantay, 47, 37), false);
});

test('analysis counts only collision component tiles and preserves uncertain policy matches', () => {
  const labels = new Uint16Array(4096);
  labels[0] = 1; labels[7] = 1; labels[63 * 64 + 63] = 2;
  const memberLabels = new Uint16Array(4096); memberLabels[100] = 1;
  const unknownLabels = new Uint16Array(4096); unknownLabels[200] = 1;
  const analysis = { regions: new Map([
    ['12850', { id: '12850', status: 'decoded', componentMasks: labels,
      components: [{ id: '12850:1', label: 1, tiles: 2 }, { id: '12850:2', label: 2, tiles: 1 }] }],
    ['13878', { id: '13878', status: 'decoded', componentMasks: memberLabels,
      components: [{ id: '13878:1', label: 1, tiles: 1 }] }],
    ['12592', { id: '12592', status: 'partial', componentMasks: unknownLabels,
      components: [{ id: '12592:1', label: 1, tiles: 1 }] }],
  ]) };
  const world = { chunks: new Map(['12850', '13878', '12592'].map(id => [id, { name: id }])),
    walkable: new Set(['12850', '13878', '12592']), f2p: new Set(['13878', '12592']),
    sectionMembership: new Map([['12850', new Map([['1', false], ['2', true]])]]) };
  const result = analyzeMembership(analysis, [
    { x: 50, z: 50, tiles: square('0100000000000000') },
    { x: 54, z: 54, tiles: square('0000000000000000') },
  ], { sectionCandidates: [
    { region: '12850', section: '1', candidates: [{ component: '12850:1', hits: 1, missing: [] }] },
    { region: '12850', section: '2', candidates: [
      { component: '12850:1', hits: 1, missing: [] }, { component: '12850:2', hits: 1, missing: [] },
    ] },
  ] }, { world });
  assert.deepEqual(result.summary.tiles, { free: 2, members: 2, unknown: 1 });
  assert.equal(result.regions[0].classification, 'mixed');
  assert.equal(result.regions[2].anyFreeWalkableTile, null);
  assert.deepEqual(result.discrepancies.freeWalkableTilesOutsideF2p.map(row => row.region), ['12850']);
  assert.deepEqual(result.discrepancies.f2pWithoutFreeWalkableTiles.map(row => row.region), ['13878']);
  assert.deepEqual(result.discrepancies.unknownRegionMembership.map(row => row.region), ['12592']);
  assert.equal(result.discrepancies.sectionPolicyConflicts.length, 1);
  assert.equal(result.sections[1].match, 'ambiguous');
  assert.equal(result.sections[1].classification, 'mixed');
  assert.equal(result.discrepancies.unresolvedSectionPolicies.length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('8x8 blocks follow documented southwest north then east order', () => {
  const mask = square('0100800000000080');
  assert.equal(rawFreeAt(mask, 0, 0), true);
  assert.equal(rawFreeAt(mask, 7, 7), true);
  assert.equal(rawFreeAt(mask, 8, 0), false);
  assert.equal(rawFreeAt(mask, 0, 8), false);
  assert.equal(rawFreeAt(mask, 16, 56), true);
  assert.equal(rawFreeAt(mask, 56, 16), false);
  assert.equal(rawFreeAt(mask, 63, 63), true);
});

test('partial collision coverage cannot prove a homogeneous section policy conflict', () => {
  const labels = new Uint16Array(4096); labels[0] = 1;
  const world = { chunks: new Map([['12850', { name: 'Partial fixture' }]]),
    walkable: new Set(['12850']), f2p: new Set(),
    sectionMembership: new Map([['12850', new Map([['1', false]])]]) };
  const result = analyzeMembership({ regions: new Map([['12850', {
    id: '12850', status: 'partial', componentMasks: labels,
    components: [{ id: '12850:1', label: 1, tiles: 1 }],
  }]]) }, [{ x: 50, z: 50, tiles: square('ffffffffffffffff') }], {
    sectionCandidates: [{ region: '12850', section: '1',
      candidates: [{ component: '12850:1', hits: 1, missing: [] }] }],
  }, { world });
  assert.equal(result.regions[0].anyFreeWalkableTile, true);
  assert.equal(result.regions[0].components[0].status, 'partial');
  assert.equal(result.sections[0].classification, 'unknown');
  assert.equal(result.discrepancies.sectionPolicyConflicts.length, 0);
  assert.equal(result.discrepancies.unresolvedSectionPolicies.length, 1);
});

test('unknown masks remain unknown and invalid input cannot imply free terrain', () => {
  assert.equal(rawFreeAt({}, 0, 0), null);
  assert.equal(rawFreeAt({ nonmembarea: null }, 63, 63), null);
  assert.throws(() => rawFreeAt({ nonmembarea: new Uint8Array(7) }, 0, 0), TypeError);
  assert.throws(() => rawFreeAt({ nonmembarea: Array(8).fill(255) }, 0, 0), TypeError);
  for (const coordinate of [-1, 64, 0.5, NaN, Infinity]) {
    assert.throws(() => rawFreeAt({}, coordinate, 0), RangeError);
    assert.throws(() => rawFreeAt({}, 0, coordinate), RangeError);
  }
});
