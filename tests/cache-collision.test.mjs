import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSurfaceCollision, serializeCollision, defaultMorphId, BLOCK, WALL } from '../scripts/cache/collision.mjs';

const crop = { minX: 0, maxX: 191, minZ: 0, maxZ: 63 };
function square(x = 0, z = 0) {
  return { x, z, tiles: { tiles: Array.from({ length: 16384 }, () => ({ underlay: 1 })) }, locations: { locations: [] } };
}
function tile(s, x, z, plane = 0) { return s.tiles.tiles[plane * 4096 + x * 64 + z]; }
function loc(s, id, x, z, type = 10, rotation = 0, plane = 0) {
  s.locations.locations.push({ id, uses: [{ x, y: z, type, rotation, plane }] });
}
const analyze = (squares, defs = new Map(), extra = {}) => analyzeSurfaceCollision({ squares, locDefinitions: defs, crop, ...extra });

test('all 2350 crop regions are accounted for and missing squares are unknown', () => {
  const a = analyzeSurfaceCollision();
  assert.equal(a.regions.size, 2350);
  assert.deepEqual(a.summary.coverage, { missing: 2350 });
  assert.equal(a.query(1856, 1408).known, false);
  assert.equal(a.query(1856, 1408).walkable, false);
  assert.equal(a.query(1855, 1408).status, 'outside-crop');
  assert.equal(a.edges.length, 0);
});

test('terrain settings block water while decorative and shaped shore water stay walkable', () => {
  const s = square();
  tile(s, 1, 2).settings = 1;
  s.tiles.tiles[3 * 64 + 4] = {};
  s.nxttiles = { level0: [] };
  s.nxttiles.level0[(5 + 1) * 66 + 6 + 1] = { flags: 19, rest: { underlay: 1 } };
  s.nxttiles.level0[(6 + 1) * 66 + 6 + 1] = { flags: 17, rest: { underlay: 513, overlay: 42, shape: 20 } };
  const a = analyze([s]);
  assert.equal(a.query(1, 2).blockMask & BLOCK.TERRAIN, BLOCK.TERRAIN);
  assert.equal(a.query(3, 4).blockMask & BLOCK.VOID, BLOCK.VOID);
  assert.equal(a.query(5, 6).blockMask & BLOCK.WATER, BLOCK.WATER);
  assert.equal(a.query(5, 6).walkable, false);
  assert.equal(a.query(6, 6).water, true);
  assert.equal(a.query(6, 6).walkable, true);
  assert.equal(a.query(6, 6).blockMask & BLOCK.WATER, 0);
  assert.equal(Buffer.from(serializeCollision(a).regions[0].masks.water, 'base64')[6 * 64 + 6], 1);
  assert.equal(a.query(2, 1).walkable, true); // x-major, no transpose
});

test('bridge deck replaces ground collision and plane-one objects clip surface', () => {
  const s = square();
  tile(s, 10, 10).settings = 1;
  tile(s, 10, 10, 1).settings = 2;
  tile(s, 11, 10, 1).settings = 2;
  loc(s, 1, 10, 10, 10, 0, 0); // under bridge, excluded
  loc(s, 2, 11, 10, 10, 0, 1); // on deck, blocks
  const a = analyze([s], new Map([[1, {}], [2, {}]]));
  assert.equal(a.query(10, 10).sourcePlane, 1);
  assert.equal(a.query(10, 10).walkable, true);
  assert.equal(a.query(11, 10).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(12, 10).walkable, true);
});

test('object footprints rotate, decorations do not clip, opcode27 floor objects do', () => {
  const s = square();
  loc(s, 1, 10, 10, 10, 1);
  loc(s, 2, 20, 20, 22);
  loc(s, 3, 21, 20, 22);
  loc(s, 3, 22, 20, 4);
  const a = analyze([s], new Map([[1, { width: 2, length: 3 }], [2, {}], [3, { blocks_movement: true }]]));
  assert.equal(a.query(12, 11).walkable, false);
  assert.equal(a.query(11, 12).walkable, true);
  assert.equal(a.query(20, 20).walkable, true);
  assert.equal(a.query(21, 20).walkable, false);
  assert.equal(a.query(22, 20).walkable, true);
});

test('wall rotations and reciprocal boundary clipping split components', () => {
  const left = square(0), right = square(1);
  for (let z = 0; z < 64; z++) loc(left, 1, 63, z, 0, 2);
  loc(left, 2, 10, 10, 2, 0);
  loc(left, 3, 20, 20, 1, 0);
  const a = analyze([left, right], new Map([[1, {}], [2, {}], [3, {}]]));
  assert.equal(a.query(63, 10).wallMask & WALL.E, WALL.E);
  assert.equal(a.query(64, 10).wallMask & WALL.W, WALL.W);
  assert.equal(a.query(10, 10).wallMask & (WALL.W | WALL.N), WALL.W | WALL.N);
  assert.equal(a.query(20, 20).wallMask & WALL.NW, WALL.NW);
  assert.equal(a.edges.length, 0);
  const reached = a.reachable({ starts: [{ x: 1, z: 1 }], claimed: ['0', '256'] });
  assert.deepEqual(reached.regions, ['0']);
});

test('reachability never traverses an unclaimed middle region', () => {
  const a = analyze([square(0), square(1), square(2)]);
  assert.equal(a.edges.length, 2);
  assert.equal(a.edges[0].portals.length, 64);
  assert.deepEqual(a.reachable({ starts: [{ x: 1, z: 1 }], claimed: ['0', '512'] }).regions, ['0']);
  assert.deepEqual(a.reachable({ starts: [{ x: 1, z: 1 }], claimed: ['0', '256', '512'] }).regions, ['0', '256', '512']);
  assert.throws(() => a.reachable({ starts: [{ x: 1, z: 1 }] }), /claimed/);
  assert.deepEqual(a.reachable({ starts: ['0:999'], claimed: ['0'] }).components, []);
});

test('Open names/actions remain closed; reviewed door evidence has conditional potential scenario', () => {
  const s = square();
  for (let z = 0; z < 64; z++) loc(s, z === 10 ? 2 : 1, 31, z, 0, 2);
  const defs = new Map([[1, {}], [2, { name: 'Quest gate', actions_0: 'Open', quests: [123] }]]);
  const closed = analyze([s], defs);
  assert.equal(closed.regions.get('0').components.length, 2);
  assert.equal(closed.potential, null);
  assert.equal(closed.doors[0].classification, 'conditional-unverified');
  assert.deepEqual(closed.doors[0].conditionHints.quests, [123]);
  const a = analyze([s], defs, { openableEvidence: new Map([[2, { passableWhenOpen: true,
    evidence: 'fixture: gate is passable after quest123', conditions: ['quest123 complete'] }]]) });
  assert.equal(a.regions.get('0').components.length, 2);
  assert.equal(a.potential.regions.get('0').components.length, 1);
  assert.equal(a.reachable({ starts: [{ x: 1, z: 1 }], claimed: ['0'], scenario: 'potential' }).conditions[0].conditions[0], 'quest123 complete');
});

test('morph variants conservatively retain blockers and player-var uncertainty', () => {
  const s = square();
  loc(s, 1, 10, 10);
  const defs = new Map([[1, { walkable: true, morphs_1_v2: { varbit: 98765, varp: 65535, options: [2, 3], default: 32767 } }],
    [2, { walkable: true }], [3, { walkable: false, width: 2 }]]);
  const a = analyze([s], defs);
  assert.equal(defaultMorphId(defs.get(1)), 2);
  assert.equal(a.query(11, 10).blockMask & BLOCK.MORPH, BLOCK.MORPH);
  assert.equal(a.uncertainties[0].varbit, 98765);
  assert.equal(a.summary.conditionalMorphs, 1);
});

test('missing loc definitions mark partial coverage; masks survive serialization', () => {
  const s = square(); loc(s, 123, 1, 1);
  const a = analyze([s]);
  assert.equal(a.query(1, 1).known, false);
  assert.equal(a.regions.get('0').status, 'partial');
  assert.equal(a.query(63, 63).known, false); // missing dimensions cannot be assumed one tile
  const serialized = serializeCollision(a);
  assert.equal(Buffer.from(serialized.regions[0].masks.reasons, 'base64')[65] & BLOCK.UNKNOWN, BLOCK.UNKNOWN);
  assert.equal(serialized.regions[0].components.length, 0);
  assert.equal(Buffer.from(serialized.regions[0].masks.components, 'base64').length, 8192);
  assert.equal(serialized.regions[0].masks.componentType, 'uint16-le');
});

test('missing locations fail closed even when terrain decoded successfully', () => {
  const s = square(); delete s.locations;
  const a = analyze([s]);
  assert.equal(a.regions.get('0').status, 'partial');
  assert.equal(a.query(32, 32).known, false);
  assert.equal(a.summary.walkableTiles, 0);
});

test('unknown loc footprints cross east and north boundaries up to opcode size maximum', () => {
  const s = square(); loc(s, 123, 63, 10, 10, 1);
  const extendedCrop = { minX: 0, maxX: 383, minZ: 0, maxZ: 319 };
  const squares = [];
  for (let x = 0; x < 6; x++) for (let z = 0; z < 5; z++) squares.push(x === 0 && z === 0 ? s : square(x, z));
  const a = analyze(squares, new Map(), { crop: extendedCrop });
  assert.equal(a.query(64, 10).known, false);
  assert.equal(a.query(317, 264).known, false);
  assert.equal(a.query(318, 265).known, false); // reciprocal wall halo
  assert.equal(a.query(319, 265).known, true);
  assert.equal(a.query(64, 266).known, true);
  assert.equal(a.regions.get('256').status, 'partial');
  assert.equal(a.query(61, 10).known, true);
});

test('walkable morph options retain the raw blocking flags and enlarged dimensions', () => {
  const s = square(); loc(s, 1, 63, 10);
  const defs = new Map([[1, { morphs_1: { options: [2], default: -1 } }], [2, { walkable: true, width: 3 }]]);
  const a = analyze([s, square(1)], defs);
  assert.equal(a.query(65, 10).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(66, 10).walkable, true);
});

test('large known footprints retain distinct cells beyond a 64-tile region', () => {
  const s = square(); loc(s, 1, 10, 10);
  const a = analyze([s, square(0, 1)], new Map([[1, { width: 2, length: 65 }]]),
    { crop: { minX: 0, maxX: 63, minZ: 0, maxZ: 127 } });
  assert.equal(a.query(11, 10).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(10, 74).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(11, 74).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(11, 75).walkable, true);
});

test('nested morph terminal footprints and variable metadata are retained', () => {
  const s = square(); loc(s, 1, 62, 10, 22);
  const defs = new Map([[1, { blocks_movement: true, morphs_1_v2: { varbit: 1, options: [2], default: -1 } }],
    [2, { width: 2, walkable: true, blocks_movement: false, morphs_2_v2: { varbit: 2, unk2: 3, options: [3], default: -1 } }],
    [3, { width: 4, walkable: true, blocks_movement: false }]]);
  const a = analyze([s, square(1)], defs);
  assert.equal(a.query(65, 10).blockMask & BLOCK.OBJECT, BLOCK.OBJECT);
  assert.equal(a.query(66, 10).walkable, true);
  assert.equal(a.uncertainties[0].branches.length, 2);
  assert.equal(a.uncertainties[0].branches[1].varbit, 2);
});

test('missing nested morph branches and cycles mark cross-region footprints unknown', () => {
  const s = square(); loc(s, 1, 63, 10);
  const cyclic = new Map([[1, { morphs_1: { options: [2], default: -1 } }],
    [2, { morphs_1: { options: [1], default: -1 } }]]);
  const a = analyze([s, square(1)], cyclic);
  assert.equal(a.query(64, 10).known, false);
  assert.equal(a.uncertainties.some(u => u.code === 'morph-cycle'), true);
  const missing = new Map([[1, { morphs_1: { options: [2], default: -1 } }],
    [2, { morphs_1: { options: [3], default: -1 } }]]);
  const b = analyze([s, square(1)], missing);
  assert.equal(b.query(64, 10).known, false);
  assert.equal(b.uncertainties.some(u => u.code === 'missing-morph-definition' && u.locId === 3), true);
});

function pastedSquare(x, sourceX, sourceY = 0, sourcePlane = 0) {
  const s = square(x);
  s.provenance = { sourceX, sourceY, sourcePlane, destinationPlane: 0, paste: {} };
  return s;
}

test('adjacent pasted display grass cannot walk between distant source game regions', () => {
  const a = analyze([pastedSquare(0, 10), pastedSquare(1, 30)]);
  assert.equal(a.query(63, 10).walkable, true);
  assert.equal(a.query(64, 10).walkable, true);
  assert.equal(a.edges.length, 0);
  assert.deepEqual(a.summary.nonContiguousSeams, { boundaries: 1, rejectedPortals: 64 });
  const seam = a.uncertainties.find(u => u.code === 'non-contiguous-seam');
  assert.deepEqual(seam.rejectedPortals[10].source, { x: 703, z: 10, plane: 0 });
  assert.deepEqual(seam.rejectedPortals[10].destinationSource, { x: 1920, z: 10, plane: 0 });
  assert.deepEqual(a.reachable({ starts: [{ x: 1, z: 1 }], claimed: ['0', '256'] }).regions, ['0']);
});

test('source continuity must preserve movement direction and plane offset', () => {
  const joined = analyze([pastedSquare(0, 10), pastedSquare(1, 11)]);
  assert.equal(joined.edges.length, 1);
  const reversed = analyze([pastedSquare(0, 11), pastedSquare(1, 10)]);
  assert.equal(reversed.edges.length, 0);
  const planes = analyze([pastedSquare(0, 10), pastedSquare(1, 11, 0, 1)]);
  assert.equal(planes.edges.length, 0);
});

test('objects and reciprocal walls cannot spill into an unrelated pasted neighbor', () => {
  const s = pastedSquare(0, 10), neighbor = pastedSquare(1, 30);
  loc(s, 1, 63, 10);
  loc(s, 2, 63, 20, 0, 2);
  const defs = new Map([[1, { width: 3 }], [2, {}]]);
  const a = analyze([s, neighbor], defs);
  assert.equal(a.query(63, 10).walkable, false);
  assert.equal(a.query(64, 10).walkable, true);
  assert.equal(a.query(64, 20).wallMask & WALL.W, 0);
  assert.equal(a.query(63, 20).wallMask & WALL.E, WALL.E);
  const continuous = analyze([s, pastedSquare(1, 11)], defs);
  assert.equal(continuous.query(64, 10).walkable, false);
  assert.equal(continuous.query(64, 20).wallMask & WALL.W, WALL.W);
});

test('unknown object footprint halos also stop at unrelated display seams', () => {
  const s = pastedSquare(0, 10); loc(s, 123, 63, 10);
  const a = analyze([s, pastedSquare(1, 30)]);
  assert.equal(a.query(63, 10).known, false);
  assert.equal(a.query(64, 10).known, true);
});

test('original-game footprints clip non-adjacent displayed source neighbors and duplicates', () => {
  const s = pastedSquare(0, 10); loc(s, 1, 63, 10); loc(s, 2, 63, 20, 0, 2);
  const a = analyze([s, pastedSquare(1, 30), pastedSquare(2, 11), pastedSquare(3, 11)],
    new Map([[1, { width: 3 }], [2, {}]]), { crop: { minX: 0, maxX: 255, minZ: 0, maxZ: 63 } });
  assert.equal(a.query(64, 10).walkable, true); // unrelated display neighbor
  assert.equal(a.query(128, 10).walkable, false); // physical source neighbor
  assert.equal(a.query(192, 10).walkable, false); // duplicate of physical source neighbor
  assert.equal(a.query(128, 20).wallMask & WALL.W, WALL.W);
  assert.equal(a.query(192, 20).wallMask & WALL.W, WALL.W);
});

test('unknown original footprints project into non-adjacent source neighbors', () => {
  const s = pastedSquare(0, 10); loc(s, 123, 63, 10);
  const a = analyze([s, pastedSquare(1, 30), pastedSquare(2, 11)]);
  assert.equal(a.query(64, 10).known, true);
  assert.equal(a.query(128, 10).known, false);
});

test('optional raw source halo clips mapped tiles from anchors outside displayed crop', () => {
  const outside = square(9); loc(outside, 1, 63, 10); loc(outside, 2, 63, 20, 0, 2);
  const a = analyze([pastedSquare(0, 10)], new Map([[1, { width: 3 }], [2, {}]]),
    { sourceSquares: new Map([['9:0', outside]]) });
  assert.equal(a.query(0, 10).walkable, false);
  assert.equal(a.query(1, 10).walkable, false);
  assert.equal(a.query(2, 10).walkable, true);
  assert.equal(a.query(0, 20).wallMask & WALL.W, WALL.W);
  assert.equal(a.summary.sourceCollision.mode, 'original-squares');
});

test('raw source bridge planes govern outside-anchor clipping and plane-offset projection', () => {
  const outside = square(9); tile(outside, 63, 10, 1).settings = 2;
  loc(outside, 1, 63, 10, 10, 0, 1); // bridge surface on effective source plane0
  loc(outside, 1, 63, 20, 10, 0, 1); // ordinary source plane1
  const a = analyze([pastedSquare(0, 10)], new Map([[1, { width: 2 }]]), { sourceSquares: [outside] });
  assert.equal(a.query(0, 10).walkable, false);
  assert.equal(a.query(0, 20).walkable, true);
  const plane1 = analyze([pastedSquare(0, 10, 0, 1)], new Map([[1, { width: 2 }]]), { sourceSquares: [outside] });
  assert.equal(plane1.query(0, 10).walkable, true);
  assert.equal(plane1.query(0, 20).walkable, false);
});

test('potential source-halo gates retain conditions in the affected displayed region', () => {
  const outside = square(9); loc(outside, 1, 63, 10, 0, 2);
  const a = analyze([pastedSquare(0, 10)], new Map([[1, { name: 'Gate', actions_0: 'Open' }]]),
    { sourceSquares: [outside], openableEvidence: new Map([[1, { passableWhenOpen: true,
      evidence: 'fixture: externally anchored gate opens', conditions: ['quest123'] }]]) });
  assert.equal(a.query(0, 10).wallMask & WALL.W, WALL.W);
  assert.equal(a.query(0, 10, 'potential').wallMask & WALL.W, 0);
  assert.deepEqual(a.reachable({ starts: [{ x: 0, z: 10 }], claimed: ['0'], scenario: 'potential' }).conditions[0].conditions, ['quest123']);
});
