import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from '../app/data/cache-interiors.2026-10-08.v1.json' with { type: 'json' };
import { buildInteriorMapIndex, getInteriorArea, getInteriorMap, getInteriorTile, interiorTileAddress } from '../app/core/interior-maps.mjs';
import { assembleInteriorSquare } from '../scripts/cache/interior-layout.mjs';
import { buildSurfaceLayout } from '../scripts/cache/surface.mjs';
import { buildInteriorCandidates } from '../scripts/cache/interior-catalogue.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { readFileSync } from 'node:fs';
import { buildInteriorPreview } from '../scripts/preview-interior-maps.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('every retained non-surface record has mapping or explicit unknown; input provenance is current', () => {
  const index = buildInteriorMapIndex(catalogue);
  assert.equal(index.areas.size, catalogue.summary.pickerAreas);
  assert.equal(index.maps.size, catalogue.summary.mapPlanes);
  assert.equal(index.tiles.size, catalogue.summary.tiles);
  for (const input of catalogue.inputs.filter(i => i.hashKind === 'repository-lf')) assert.equal(sha256RepositoryText(readFileSync(new URL(`../${input.file}`, import.meta.url))), input.sha256);
  for (const [file, hash] of Object.entries(catalogue.generatorSourceHashes)) assert.equal(sha256RepositoryText(readFileSync(new URL(`../${file}`, import.meta.url))), hash);
  for (const area of catalogue.areas) {
    assert.ok(area.evidence.length);
    assert.ok(area.unknowns.length);
    assert.equal(area.status === 'mapped', area.layers.length > 0);
  }
});
test('named samples select reviewed identities and preserve numeric aliases', () => {
  const index = buildInteriorMapIndex(catalogue);
  assert.deepEqual(getInteriorArea(index, 'Lumbridge Cellar').mapIds, [31]);
  assert.deepEqual(getInteriorArea(index, '13207').mapIds, [31]);
  assert.deepEqual(getInteriorArea(index, 'Lumbridge Catacombs').mapIds, [164, 165]);
  assert.ok(getInteriorMap(index, 164, 1));
  assert.deepEqual(getInteriorArea(index, 'Varrock Sewers').mapIds, [592]);
  assert.deepEqual(getInteriorArea(index, 'Draynor Sewers').mapIds, [542]);
  assert.deepEqual(getInteriorArea(index, 'Ashdale Caves').mapIds, [665]);
  assert.deepEqual(getInteriorArea(index, '9030').mapIds, [719]);
  assert.deepEqual(getInteriorArea(index, '8774').mapIds, [719]);
  assert.equal(getInteriorMap(index, 164, 1).boundsKind, 'reviewed-direct-source-XY-coverage');
  assert.equal(getInteriorArea(index, 'Not a picker area'), null);
  assert.equal(catalogue.specialCases[0].status, 'no-distinct-interior-verified');
});
test('tile lookup preserves map and plane and north-up coordinate convention', () => {
  const index = buildInteriorMapIndex(catalogue), t = getInteriorMap(index, 164, 1).tiles[0];
  assert.equal(getInteriorTile(index, 164, 0, t.x, t.y).plane, 0);
  assert.equal(getInteriorTile(index, 164, 1, t.x, t.y).plane, 1);
  const point = interiorTileAddress(index, 164, 1, t.x * 64 + 32, t.y * 64 + 48);
  assert.equal(point.pixelX, 128);
  assert.equal(point.pixelY, 64);
  assert.equal(interiorTileAddress(index, 164, 1, -1, -1), null);
});
test('catalogue index rejects traversal, wrong planes, invalid hashes and surface identities', () => {
  for (const change of [c => c.maps[0].tiles[0].path = '../else.png', c => c.maps[0].mapId = 28,
    c => c.maps[0].tiles[0].plane = 7, c => c.maps[0].tiles[0].sha256 = 'x', c => c.assets.directory = 'https://example.invalid']) {
    const input = structuredClone(catalogue); change(input);
    assert.throws(() => buildInteriorMapIndex(input));
  }
});
test('8x8 pastes copy exact source-plane cells and walls; unstated cells remain void', () => {
  const paste = { original_plane: 2, n_planes: 1, original_regionX: 1, original_regionY: 2,
    original_chunkX: 1, original_chunkY: 2, new_plane: 1, new_regionX: 3, new_regionY: 4, new_chunkX: 5, new_chunkY: 6 };
  const layout = buildSurfaceLayout({ name: 'fixture' }, { squares: [], chunks: [paste], width: 1, height: 1 }, { mapId: 777, plane: 1 });
  const terrain = Array.from({ length: 16384 }, (_, i) => ({ fixtureId: i }));
  const cache = { archive: () => new Map([[3, 'tiles'], [0, 'locs']]), file: () => Buffer.from('fixture'),
    table: () => ({ entries: new Map([[257, { version: 1 }]]) }), decoders: { decode: kind => kind === 'tiles' ? { tiles: terrain } :
      { locations: [{ id: 10, uses: [{ x: 9, y: 17, plane: 2, type: 0, rotation: 1 }, { x: 9, y: 17, plane: 0, type: 0 }] }] } } };
  const square = assembleInteriorSquare(cache, layout, 3, 4);
  assert.equal(square.tiles.tiles[41 * 64 + 49].fixtureId, 2 * 4096 + 9 * 64 + 17);
  assert.equal(square.tiles.tiles[0], undefined);
  assert.deepEqual(square.locations.locations[0].uses[0], { x: 41, y: 49, plane: 0, type: 0, rotation: 1 });
  assert.equal(square.locations.locations[0].uses.length, 1);
  assert.deepEqual(square.provenance.blocks[0].translation, { x: 160, y: 160, plane: -1 });
});
test('ambiguous exact names remain unknown instead of selecting a tutorial instance', () => {
  const output = buildInteriorCandidates({ chunks: { 'Fixture cave': {} } },
    { mapRecords: [{ id: 1, name: 'Fixture cave', pastePresent: true, declaredPastes: { squares: 1, chunks: 0 } }, { id: 2, name: 'Fixture cave', pastePresent: true, declaredPastes: { squares: 1, chunks: 0 } }] },
    { stations: [], routes: [] }, { connections: [] });
  assert.equal(output.areas[0].status, 'unknown');
  assert.deepEqual(output.areas[0].candidateMapIds, [1, 2]);
});
test('preview uses existing area gates then joins display data without state or task changes', () => {
  const definitions = { chunks: { '7495': { Connect: { 'Fixture cave': true } }, 'Fixture cave': { Connect: { '7495': true }, Objects: { Rock: {} } } },
    walkableChunks: ['7495'], walkableChunksF2P: ['7495'], sections: {}, challenges: {} };
  const state = createGroupState([{ id: 'member', name: 'Synthetic member', unlocked: ['7495'] }]);
  const before = JSON.stringify(state);
  const report = buildInteriorPreview(definitions, state, { cacheWalking: false, cacheResources: false, cacheArchaeology: false, reviewedOverlays: false });
  assert.equal(JSON.stringify(state), before);
  assert.ok(report.members[0].accessibleAreas.some(a => a.areaId === 'Fixture cave' && a.status === 'unknown'));
  assert.equal(report.members[0].counts.taskChanges, 0);
  assert.equal(report.members[0].counts.availabilityGains, 0);
  assert.equal(report.accessEffect, 'none');
});
