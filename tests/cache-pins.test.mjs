import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceLayout, sourceToSurface, surfaceToSource, unpackCoord } from '../scripts/cache/surface.mjs';
import { createDefinitionResolver, comparePinSnapshots, plainLabel, decodeSpriteFrames, rgbaPng } from '../scripts/cache/pins.mjs';
import { inflateSync } from 'node:zlib';

const square = (sx, sy, dx, dy, n_planes = 4) => ({ original_plane: 0, n_planes,
  original_regionX: sx, original_regionY: sy, new_plane: 0, new_regionX: dx, new_regionY: dy });

test('map pastes translate source instances and preserve repeated destinations', () => {
  const layout = buildSurfaceLayout({ name: 'Surface', internal_name: 'main' }, {
    squares: [square(33, 172, 64, 21), square(33, 172, 65, 21), square(32, 51, 32, 52, 0)], chunks: [], width: 47, height: 50 });
  const outputs = sourceToSurface(layout, 2123, 11012, 0);
  assert.deepEqual(outputs.map(q => [q.x, q.y]), [[4107, 1348], [4171, 1348]]);
  const source = surfaceToSource(layout, 4107, 1348);
  assert.deepEqual([source.x, source.y, source.plane], [2123, 11012, 0]);
  assert.equal(layout.blocks.size, 128);
  assert.equal(layout.disabled.length, 1);
  assert.equal(surfaceToSource(layout, 2048, 3328), null);
});

test('chunk pastes retain source plane and offset without rectangle fallback', () => {
  const layout = buildSurfaceLayout({ name: 'Surface' }, { squares: [], chunks: [{
    ...square(10, 20, 30, 40, 1), original_plane: 2, original_chunkX: 3, original_chunkY: 4,
    new_chunkX: 1, new_chunkY: 2 }], width: 1, height: 1 });
  assert.equal(sourceToSurface(layout, 665, 1314, 0).length, 0);
  assert.deepEqual(sourceToSurface(layout, 665, 1314, 2).map(q => [q.x, q.y, q.plane]), [[1929, 2578, 0]]);
  assert.equal(surfaceToSource(layout, 1920, 2560), null);
});

test('ambiguous destination blocks fail instead of selecting paste order', () => {
  assert.throws(() => buildSurfaceLayout({}, { squares: [square(1, 1, 3, 3), square(2, 2, 3, 3)],
    chunks: [], width: 1, height: 1 }), /Ambiguous/);
});

test('packed coordinates preserve plane and unsigned x/y bits', () => {
  assert.deepEqual(unpackCoord((3 << 28) | (5630 << 14) | 11000), { x: 5630, y: 11000, plane: 3 });
});

test('recursive defaults and conditional branches retain selectors and legacy definitions', () => {
  const locs = new Map([[1, { name: 'Base', morphs_2_v2: { varbit: 70000, varp: 65535,
    unk2: 2, options: [3, 32767], default: 4 } }], [2, { morphs_1: { varbit: 5, varp: 65535,
    options: [4], default: 32767 } }], [3, { maplabel: 30 }], [4, { maplabel: 40 }]]);
  const elements = new Map([[30, { sprite: 300 }], [40, { category: 5, legacy_switch_v2: {
    varbit: 70001, varp: 65535, value: 1, default_ref: 41, legacy_ref: 42 } }],
  [41, { sprite: 410, text: '<col=fff>Bank</col>' }], [42, { sprite: 420 }]]);
  const r = createDefinitionResolver(id => locs.get(id), id => elements.get(id));
  assert.equal(r.resolveObject(1).resolvedId, 4);
  assert.deepEqual(r.resolveObject(1).morphs.map(q => q.defaultId), [2, 4]);
  const label = r.resolveLabel(40);
  assert.equal(label.definition.sprite, 410);
  assert.equal(label.definition.category, 5);
  assert.equal(label.alternate.definition.sprite, 420);
  assert.equal(r.alternateElements(1).find(q => q.objectId === 3).conditions[0].option, 0);
  assert.equal(plainLabel(label.definition.text), 'Bank');
});

test('default morph cycles fail with an actionable chain', () => {
  const r = createDefinitionResolver(() => ({ morphs_1: { options: [1], default: 32767 } }), () => ({}));
  assert.throws(() => r.resolveObject(1), /1 -> 1/);
});

test('comparison respects surface identity and cannot migrate unrelated hidden IDs', () => {
  const current = [{ id: 'current', x: 3215, y: 3257, plane: 0, mapId: 28, spriteId: 18952 },
    { id: 'other-plane', x: 3215, y: 3257, plane: 1, mapId: 28, spriteId: 18952 }];
  const comparison = comparePinSnapshots(current, [{ ...current[0], id: 'old' }]);
  assert.equal(comparison.matchedPlacements, 1);
  assert.equal(comparison.added.length, 1);
  assert.equal(comparison.removed.length, 0);
});

const comparisonPin = (id, x, y, fields = {}) => ({ id, x, y, plane: 0, mapId: 28,
  category: 1156, spriteId: 22458, ...fields });

test('same-coordinate numeric category matches a sprite style change without added or removed facilities', () => {
  const current = comparisonPin('current-bank', 3215, 3257);
  const baseline = { id: 'old-bank', x: 3215, y: 3257, plane: 0, mapId: 28,
    spriteId: 18952, categoryId: 'bank', conditions: { icon: { unk_19: 1156 } } };
  const result = comparePinSnapshots([current], [baseline]);
  assert.equal(result.semanticMatchedPlacements, 1);
  assert.equal(result.matchedNumericCategoryPlacements, 1);
  assert.equal(result.spriteStyleChangeCount, 1);
  assert.deepEqual(result.spriteChangesAtSameCoordinateAndNumericCategory[0].baselineSpriteIds, [18952]);
  assert.deepEqual(result.spriteChangesAtSameCoordinateAndNumericCategory[0].currentSpriteIds, [22458]);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.movedCandidates.length, 0);
  assert.equal(result.exactSpriteComparison.added.length, 1);
  assert.equal(result.exactSpriteComparison.removed.length, 1);
});

test('mutually unique nearest category positions are unverified move candidates through 64 tiles', () => {
  const baseline = comparisonPin('old', 100, 100, { spriteId: 18952 });
  const result = comparePinSnapshots([comparisonPin('new', 164, 100)], [baseline]);
  assert.equal(result.movedCandidates.length, 1);
  assert.equal(result.counts.moved, 1);
  assert.equal(result.counts.verifiedMoved, 0);
  const moved = result.movedCandidates[0];
  assert.equal(moved.verified, false);
  assert.equal(moved.method, 'mutual-unique-nearest-category');
  assert.deepEqual(moved.displacement, { x: 64, y: 0, distanceTiles: 64 });
  assert.deepEqual(moved.from, { x: 100, y: 100, mapId: 28, plane: 0 });
  assert.deepEqual(moved.to, { x: 164, y: 100, mapId: 28, plane: 0 });
  assert.ok(moved.uncertaintyReasons.some(reason => reason.includes('unrelated')));
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  // Inclusive differences remain available even after heuristic pairing.
  assert.equal(result.semanticAdded.length, 1);
  assert.equal(result.semanticRemoved.length, 1);
  const beyond = comparePinSnapshots([comparisonPin('too-far', 165, 100)], [baseline]);
  assert.equal(beyond.movedCandidates.length, 0);
  assert.equal(beyond.added.length, 1);
  assert.equal(beyond.removed.length, 1);
});

test('equal nearest distances remain unmatched instead of guessing a moved facility', () => {
  const result = comparePinSnapshots([comparisonPin('west', 99, 100), comparisonPin('east', 101, 100)],
    [comparisonPin('old', 100, 100)]);
  assert.equal(result.movedCandidates.length, 0);
  assert.equal(result.added.length, 2);
  assert.equal(result.removed.length, 1);
});

test('nearest matching must be mutual and does not greedily rematch leftover neighbours', () => {
  const result = comparePinSnapshots([comparisonPin('new-near', 11, 100), comparisonPin('new-second', 12, 100)],
    [comparisonPin('old-near', 10, 100), comparisonPin('old-second', 20, 100)]);
  assert.equal(result.movedCandidates.length, 1);
  assert.deepEqual(result.movedCandidates[0].baseline.ids, ['old-near']);
  assert.deepEqual(result.movedCandidates[0].current.ids, ['new-near']);
  assert.deepEqual(result.added[0].ids, ['new-second']);
  assert.deepEqual(result.removed[0].ids, ['old-second']);
});

test('a default category label cannot supply strong move identity beyond the nearest threshold', () => {
  const result = comparePinSnapshots([comparisonPin('current-bank', 400, 100,
    { label: 'Bank', labelOrigin: 'cache-map-element-text' })],
  [comparisonPin('old-bank', 100, 100, { label: 'Bank', labelOrigin: 'category' })]);
  assert.equal(result.movedCandidates.length, 0);
  assert.equal(result.added.length, 1);
  assert.equal(result.removed.length, 1);
});

test('specific labels support candidates only when unique across the entire surface snapshot', () => {
  const named = (id, x) => comparisonPin(id, x, 100, { label: 'Named location', labelOrigin: 'source-tooltip' });
  const unique = comparePinSnapshots([named('new', 400)], [named('old', 100)]);
  assert.equal(unique.movedCandidates.length, 1);
  assert.equal(unique.movedCandidates[0].method, 'unique-label-or-object-identity');
  assert.equal(unique.movedCandidates[0].verified, false);
  const repeated = comparePinSnapshots([named('new', 400), named('retained-new', 800)],
    [named('old', 100), named('retained-old', 800)]);
  assert.equal(repeated.semanticMatchedPlacements, 1);
  assert.equal(repeated.movedCandidates.length, 0);
  assert.equal(repeated.added.length, 1);
  assert.equal(repeated.removed.length, 1);
});

test('paletted sprite decodes transposed pixels, per-pixel alpha and canvas anchors', () => {
  // 2x2 trimmed frame in a 4x5 canvas, offset 1/2, red-orange palette, one frame.
  const bytes = Buffer.from('03010001018040ff20ff8040000400050100010002000200020001', 'hex');
  const frame = decodeSpriteFrames(bytes)[0];
  assert.deepEqual([frame.x, frame.y, frame.width, frame.height, frame.fullwidth, frame.fullheight], [1,2,2,2,4,5]);
  assert.deepEqual([...frame.rgba], [255,128,64,128,255,128,64,255,0,0,0,0,255,128,64,32]);
  const png = rgbaPng(frame.width, frame.height, frame.rgba);
  assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  const compressedSize = png.readUInt32BE(33);
  const scanlines = inflateSync(png.subarray(41, 41 + compressedSize));
  assert.equal(scanlines[0], 0);
  assert.equal(scanlines[9], 0);
  assert.deepEqual([...scanlines.subarray(1,9)], [...frame.rgba.subarray(0,8)]);
});

test('RGB sprite decodes its independent alpha payload and rejects truncation', () => {
  const frame = decodeSpriteFrames(Buffer.from('000100020001ff000000ff0040ff8001', 'hex'))[0];
  assert.deepEqual([...frame.rgba], [255,0,0,64,0,255,0,255]);
  assert.throws(() => decodeSpriteFrames(Buffer.from('000100020001ff000000ff008001', 'hex')), /payload length/);
});
