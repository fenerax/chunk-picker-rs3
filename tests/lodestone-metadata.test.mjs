import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { surfaceLodestones, preCorrectionSurfaceLodestones } from '../app/data/lodestones.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { buildAccessIndex } from '../app/tasks/access.mjs';
import { componentLocations } from '../app/core/cache-surface.mjs';
import review from '../docs/research/cache-lodestone-corrections.2026-10-08.v1.json' with { type: 'json' };

const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const world = buildWorld(definitions, { dataset: selectedDataset });

test('all 28 surface destinations match current Wiki coordinate regions and ordinary membership variants', () => {
  assert.equal(surfaceLodestones.length, 28);
  assert.equal(review.lodestones.length, 29);
  assert.equal(review.summary.currentWikiCoordinates, 29);
  assert.equal(review.summary.cacheStructs, 58);
  for (const stone of surfaceLodestones) {
    const evidence = review.lodestones.find(row => row.name === stone.name);
    const { x, y, region } = evidence.wiki.coordinate;
    assert.equal(String((x >> 6) * 256 + (y >> 6)), region, stone.name);
    assert.equal(stone.chunkId, region, stone.name);
    assert.equal(stone.location, evidence.runtimeLocation, stone.name);
    assert.equal(stone.f2p, evidence.wiki.f2p, stone.name);
    assert.match(evidence.wiki.permalink, /^https:\/\/runescape\.wiki\/w\/Special:PermanentLink\/\d+$/);
    assert.equal(evidence.cache.length, 2, `${stone.name}: retain both cache structs`);
  }
  assert.equal(surfaceLodestones.filter(stone => stone.f2p).length, 12);
});

test('Anachronia entry moves to evidenced region without retaining the old section or fabricating a landing', () => {
  const stone = surfaceLodestones.find(row => row.name === 'Anachronia');
  assert.equal(stone.location, '15426');
  const entries = [...world.cacheWalking.entryEvidence.values()].flat().filter(entry => entry.detail === 'Anachronia lodestone landing.');
  assert.deepEqual(entries.map(entry => entry.location), ['15426']);
  assert.equal(world.cacheWalking.entryEvidence.get('15683')?.some(entry => entry.kind === 'lodestone'), undefined);
  assert.deepEqual(componentLocations(world, stone.location, { landing: true }), [], 'unknown section correspondence stays unresolved');
  const evidence = review.lodestones.find(row => row.name === 'Anachronia');
  for (const candidate of evidence.cache) {
    assert.deepEqual(candidate.coordinates[0].surface.map(({ x, y, region }) => ({ x, y, region })), [{ x: 3895, y: 4259, region: '15426' }]);
  }
});

test('Ashdale and Prifddinas preserve encoded plane uncertainty; Um has no fabricated surface route', () => {
  for (const [name, plane] of [['Ashdale', 2], ['Prifddinas', 1]]) {
    const evidence = review.lodestones.find(row => row.name === name);
    assert.equal(evidence.status, 'wiki-base-verified-cache-plane-unresolved');
    for (const row of evidence.cache) {
      assert.equal(row.coordinates[0].plane, plane);
      assert.deepEqual(row.coordinates[0].surface, []);
    }
  }
  const um = review.lodestones.find(row => row.name === 'City of Um');
  assert.equal(um.wiki.f2p, true);
  assert.deepEqual(um.validation.membershipCandidates, [0, 1]);
  assert.equal(surfaceLodestones.some(stone => stone.name === 'City of Um'), false);
  assert.equal(world.cacheWalking.entryEvidence.has('4123'), false);
  for (const row of um.cache) {
    assert.deepEqual([row.coordinates[0].x, row.coordinates[0].y, row.coordinates[0].plane], [1083, 1768, 1]);
    assert.deepEqual(row.coordinates[0].surface, []);
    assert.equal(row.coordinates[0].mapProjections[0].mapId, 742);
  }
});

test('before-state destination injection preserves walking geometry and terrain-only footprint', () => {
  const before = buildAccessIndex(definitions, { dataset: selectedDataset, lodestones: preCorrectionSurfaceLodestones }).world;
  const after = buildAccessIndex(definitions, { dataset: selectedDataset, lodestones: surfaceLodestones }).world;
  assert.deepEqual([...before.surface], [...world.surface]);
  assert.deepEqual([...after.surface], [...world.surface]);
  for (const candidate of [before, after]) {
    assert.deepEqual(candidate.chunks, world.chunks);
    assert.deepEqual(candidate.neighbors, world.neighbors);
    assert.deepEqual(candidate.cacheWalking.topology, world.cacheWalking.topology);
    assert.deepEqual(candidate.cacheWalking.components, world.cacheWalking.components);
    assert.deepEqual(candidate.cacheWalking.coverage, world.cacheWalking.coverage);
    assert.ok(candidate.chunks.get('18488').terrainOnly);
  }
  assert.ok(before.cacheWalking.entryEvidence.get('15683').some(entry => entry.kind === 'lodestone'));
  assert.equal(before.cacheWalking.entryEvidence.get('15426'), undefined);
  assert.ok(after.cacheWalking.entryEvidence.get('15426').some(entry => entry.kind === 'lodestone'));
  assert.equal(after.cacheWalking.entryEvidence.get('15683'), undefined);
  assert.deepEqual(preCorrectionSurfaceLodestones.filter(stone => stone.name !== 'Anachronia'), surfaceLodestones.filter(stone => stone.name !== 'Anachronia'));
});
