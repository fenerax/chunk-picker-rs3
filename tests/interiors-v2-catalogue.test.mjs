import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import before from '../app/data/cache-interiors.2026-10-08.v1.json' with { type: 'json' };
import catalogue from '../app/data/cache-interiors.2026-10-08.v2.json' with { type: 'json' };
import { CACHE_INTERIORS } from '../app/data/cache-interiors.mjs';
import { buildInteriorMapIndex, getInteriorArea, getInteriorMap, getInteriorTile } from '../app/core/interior-maps.mjs';
import { directSourceLayout, regionLayout, layoutAnchor, resolveNamedAliases } from '../scripts/cache/interiors-v2-catalogue.mjs';
import { buildSurfaceLayout } from '../scripts/cache/surface.mjs';
import { buildInteriorPriority } from '../scripts/cache/interiors-v2-priority.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const index = buildInteriorMapIndex(catalogue);
const repository = resolve(import.meta.dirname, '..');

test('v2 is active, has complete explicit coverage and loses no previously mapped record', () => {
  assert.deepEqual(CACHE_INTERIORS, catalogue);
  assert.equal(catalogue.version, '2026-10-08.v2');
  assert.equal(before.areas.filter(area => area.status === 'mapped').length, 893);
  assert.equal(index.areas.size, 1979);
  assert.equal(index.areas.size, catalogue.summary.pickerAreas);
  assert.ok(catalogue.summary.mappedAreas > 893);
  assert.equal(catalogue.summary.mappedAreas + catalogue.summary.unknownAreas, 1979);
  assert.deepEqual([...index.areas.keys()].sort(), before.areas.map(area => area.areaId).sort());
  for (const old of before.areas.filter(area => area.status === 'mapped')) {
    const current = getInteriorArea(index, old.areaId);
    assert.equal(current.status, 'mapped', old.areaId);
    for (const mapId of old.mapIds) assert.ok(current.mapIds.includes(mapId), `${old.areaId} lost map ${mapId}`);
  }
  for (const area of catalogue.areas) {
    assert.ok(area.evidence.length, area.areaId);
    assert.ok(area.unknowns.length, area.areaId);
    assert.equal(area.bounds, null, `${area.areaId} must not invent a semantic enclosure`);
    assert.equal(area.status === 'mapped', area.layers.length > 0, area.areaId);
    if (area.status === 'unknown') assert.deepEqual(area.mapIds, [], area.areaId);
    for (const layer of area.layers) {
      const map = getInteriorMap(index, layer.mapId, layer.plane);
      assert.ok(map?.tiles.length, `${area.areaId} has no rendered map tiles`);
      assert.ok(layer.bounds.minX >= map.bounds.minX && layer.bounds.maxX <= map.bounds.maxX && layer.bounds.minY >= map.bounds.minY && layer.bounds.maxY <= map.bounds.maxY, `${area.areaId} layer bounds exceed rendered coverage`);
      assert.ok(map.tiles.some(tile => tile.x * 64 < layer.bounds.maxX && (tile.x + 1) * 64 > layer.bounds.minX && tile.y * 64 < layer.bounds.maxY && (tile.y + 1) * 64 > layer.bounds.minY), `${area.areaId} has no tile overlapping its source-region display coverage`);
    }
  }
});

test('v2 repository inputs and generator hashes match current Git LF source bytes', () => {
  const inputs = catalogue.inputs.filter(input => input.hashKind === 'repository-lf');
  assert.ok(inputs.length > 0);
  for (const input of inputs) assert.equal(sha256RepositoryText(readFileSync(resolve(repository, input.file))), input.sha256, input.file);
  assert.ok(Object.keys(catalogue.generatorSourceHashes).length > 0);
  for (const [file, hash] of Object.entries(catalogue.generatorSourceHashes)) assert.equal(sha256RepositoryText(readFileSync(resolve(repository, file))), hash, file);
});

test('five requested areas select reviewed identities with independent City of Um planes', () => {
  for (const [id, mapId] of [['10307', 168], ['13214', 10003], ['1546', 10004], ['23', 742], ['5706', 653]]) {
    const area = getInteriorArea(index, id);
    assert.equal(area.status, 'mapped', id);
    assert.deepEqual(area.mapIds, [mapId], id);
    assert.ok(area.layers.some(layer => layer.mapId === mapId));
    assert.equal(area.bounds, null);
  }
  for (const plane of [0, 1, 2]) assert.ok(getInteriorArea(index, '23').layers.some(layer => layer.mapId === 742 && layer.plane === plane));
  assert.ok(!getInteriorArea(index, '23').layers.some(layer => layer.plane === 3), 'absent source plane4 must not become a phantom layer');
  for (const mapId of [10003, 10004]) {
    const map = getInteriorMap(index, mapId, 0);
    assert.equal(map.cacheMapId, null);
    assert.equal(map.layoutEvidence.cacheMapId, null);
    assert.equal(map.layoutEvidence.kind, 'reviewed-direct-source-template');
    assert.equal(map.boundsKind, 'reviewed-static-source-template-coverage');
    assert.ok(map.tiles.some(tile => tile.artworkPixels > 0));
    assert.equal(getInteriorMap(index, mapId, 1), null, 'scenery without decoded floors is not a floor layer');
  }
  // Inspect source transforms when the local immutable artifact is available.
  const manifestPath = resolve(repository, '.local/map-assets', catalogue.assets.manifestPath);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath));
    const um = manifest.maps.find(map => map.mapId === 742 && map.plane === 0);
    const blocks = um.tiles.flatMap(tile => tile.provenance.blocks);
    assert.ok(blocks.some(block => block.source.plane === 1 && block.destination.plane === 0 && block.translation.plane === -1));
  }
});

test('selected map28 off-surface coverage needs both explicit flags; layers refer to real maps', () => {
  const map = catalogue.maps.find(map => map.mapId === 28);
  assert.ok(map);
  assert.equal(map.offSurface, true);
  assert.equal(map.boundsKind, 'exact-selected-off-surface-paste-coverage');
  assert.ok(getInteriorMap(index, 28, map.plane));
  for (const mutate of [copy => copy.maps.find(map => map.mapId === 28).offSurface = false,
    copy => copy.maps.find(map => map.mapId === 28).boundsKind = 'exact-layout-coverage',
    copy => copy.areas.find(area => area.status === 'mapped').layers[0].mapId = 999999,
    copy => copy.areas.find(area => area.status === 'mapped').layers[0].bounds.minX = NaN,
    copy => {
      const layer = copy.areas.find(area => area.status === 'mapped').layers[0];
      const map = copy.maps.find(map => map.mapId === layer.mapId && map.plane === layer.plane);
      layer.bounds = { ...layer.bounds, maxX: map.bounds.maxX + 8 };
    }]) {
    const copy = structuredClone(catalogue); mutate(copy); assert.throws(() => buildInteriorMapIndex(copy));
  }
  for (const map of catalogue.maps) for (const tile of map.tiles) assert.strictEqual(getInteriorTile(index, map.mapId, map.plane, tile.x, tile.y), tile);
});

test('public captured fixture deterministically supplies 153 unlocked surface chunks, seven candidates and 41 neighbours', () => {
  const definitions = JSON.parse(readFileSync(resolve(repository, 'rs3-chunkpicker-chunkinfo-export.json')));
  const fixture = JSON.parse(readFileSync(resolve(repository, 'tests/fixtures/original-sync/capture.json')));
  assert.equal(fixture.metadata.source, 'firebase-public-rest');
  const connections = JSON.parse(readFileSync(resolve(repository, 'archive/data/map-connections.2026-10-08.v2.json')));
  const priority = buildInteriorPriority({ definitions, fixture, connections, catalogue: before });
  assert.equal(priority.seeds.unlocked.length, 153);
  assert.equal(priority.seeds.candidate.length, 7);
  assert.equal(priority.seeds.oneRing.length, 41);
  assert.ok(priority.seeds.candidate.every(id => !priority.seeds.unlocked.includes(id)));
  assert.equal(priority.ranked.length, before.summary.unknownAreas);
  assert.equal(priority.accessEffect, 'none');
  const cave = priority.ranked.find(area => area.areaId === '5706');
  assert.equal(cave.distance, 1);
  assert.deepEqual(cave.witness.path, ['12339', '5706']);
});

const mapped = (id, mapId, bounds) => ({ areaId: id, name: 'Cave', status: 'mapped', mapIds: [mapId], layers: [{ mapId, plane: 0, bounds }], entrances: [], evidence: [], unknowns: [] });
const unknown = () => ({ areaId: 'Cave', name: 'Cave', status: 'unknown', mapIds: [], layers: [], entrances: [], evidence: [], unknowns: ['Unresolved'], bounds: null });
test('equal-name aliases require unanimous map identity and combine only witnessed partial layer coverage', () => {
  const left = { minX: 64, minY: 128, maxX: 72, maxY: 136 }, right = { minX: 80, minY: 128, maxX: 88, maxY: 136 };
  const areas = [mapped('1000', 77, left), mapped('1001', 77, right), unknown()];
  assert.equal(resolveNamedAliases(areas), 1);
  assert.equal(areas[2].bounds, null);
  assert.deepEqual(areas[2].mapIds, [77]);
  assert.deepEqual(areas[2].aliasAreaIds, ['1000', '1001']);
  assert.deepEqual(areas[2].layers[0].bounds, { minX: 64, minY: 128, maxX: 88, maxY: 136 });
  const conflict = [mapped('1000', 77, left), mapped('1001', 78, right), unknown()];
  assert.equal(resolveNamedAliases(conflict), 0);
  assert.equal(conflict[2].status, 'unknown');
  assert.deepEqual(conflict[2].layers, []);
});

test('direct source layouts preserve exact planes and coordinates; source-region selection rejects unrelated blocks', () => {
  const direct = directSourceLayout(10003, 2, [{ x: 51, y: 158 }], [{ kind: 'synthetic-witness' }]);
  assert.equal(direct.blocks.size, 64);
  for (const block of direct.blocks.values()) {
    assert.equal(block.source.plane, 2);
    assert.deepEqual(block.source, block.destination);
    assert.deepEqual(block.translation, { x: 0, y: 0, plane: 0 });
    assert.ok(block.source.x >= 3264 && block.source.x < 3328 && block.source.y >= 10112 && block.source.y < 10176);
  }
  const chunks = [0, 1].map(offset => ({ original_plane: 1, n_planes: 1, original_regionX: 1 + offset, original_regionY: 2, original_chunkX: 1, original_chunkY: 2,
    new_plane: 0, new_regionX: 3 + offset, new_regionY: 4, new_chunkX: 5, new_chunkY: 6 }));
  const layout = buildSurfaceLayout({ name: 'Synthetic plane transform' }, { squares: [], chunks, width: 1, height: 1 }, { mapId: 742, plane: 0 });
  const selected = regionLayout(layout, { minX: 64, maxX: 128, minY: 128, maxY: 192 });
  assert.equal(selected.blocks.size, 1);
  const block = selected.blocks.values().next().value;
  assert.deepEqual(block.source, { x: 72, y: 144, plane: 1 });
  assert.deepEqual(block.destination, { x: 232, y: 304, plane: 0 });
  assert.deepEqual(layoutAnchor(selected, []), { x: 236, y: 308, plane: 0, mapId: 742, precision: 'source-region-anchor', coordinateEvidence: { kind: 'retained-source-region-paste', source: { x: 76, y: 148, plane: 1 }, translation: block.translation, paste: block.paste, evidence: [], scope: 'Exact source/display association, not an entrance or player arrival.' } });
  assert.equal(regionLayout(layout, { minX: 999, maxX: 1007, minY: 999, maxY: 1007 }).blocks.size, 0);
  assert.equal(layoutAnchor({ blocks: new Map() }, []), null);
});
