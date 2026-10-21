import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld } from '../app/data/world.mjs';
import { interiorCandidates } from '../app/web/interior-view.mjs';

const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const world = buildWorld(definitions, { dataset: selectedDataset, cacheResources: false, cacheArchaeology: false });

test('actual numeric named interiors remain discoverable when aliases overlap the surface grid', () => {
  for (const id of ['10307', '9030', '8774']) {
    assert.equal(world.surface.has(id), true, `${id} exercises a numeric surface collision`);
    assert.equal(typeof definitions.chunks[id].Name, 'string');
    assert.ok(interiorCandidates(id, world.resourceContents.get(id), world).includes(id));
  }
  for (const [origin, destination] of [['12339', '10307'], ['11318', '9030'], ['11574', '8774']]) {
    assert.ok(interiorCandidates(origin, world.resourceContents.get(origin), world).includes(destination), `${origin} discovers ${destination}`);
  }
});

test('ordinary surface records do not become interior candidates from geometry or Nickname', () => {
  const fixture = { chunks: new Map([['12339', { name: 'Draynor' }], ['12850', { name: 'Lumbridge' }]]),
    areas: new Map(), surface: new Set(['12339', '12850']),
    resourceContents: new Map([['12339', { Nickname: 'Draynor' }], ['12850', { Nickname: 'Lumbridge' }]]) };
  assert.deepEqual(interiorCandidates('12339', { Nickname: 'Draynor', Connect: { '12850': true } }, fixture), []);
  fixture.mapConnections = [{ from: { chunkId: '12339' }, to: { chunkId: '12850', interiorMap: { areaId: '12850', status: 'mapped' } } }];
  assert.deepEqual(interiorCandidates('12339', { Nickname: 'Draynor' }, fixture), []);
});

test('section declarations and cache components recognize retained Name without changing world state', () => {
  const before = [...world.surface];
  const record = { Nickname: 'Draynor', Sections: { 1: { Connect: { '10307-2': true } } },
    CacheComponents: { 1000001: { Connect: { '8774': true, '12850': true } } } };
  assert.deepEqual(interiorCandidates('12339', record, world), ['10307', '8774']);
  assert.deepEqual([...world.surface], before);
});

test('explicit offSurface references discover mapped and unknown areas from either chunk direction or section', () => {
  const fixture = { ...world, mapConnections: { connections: [
    { from: { chunkId: '12339', sectionId: '12339-4' }, to: { chunkId: '99999', offSurface: true, interiorMap: { areaId: 'Mapped Cave', status: 'mapped' } } },
    { from: { offSurface: true, interiorMap: { areaId: 'Unknown Cave', status: 'unknown' } }, to: { locationId: '12339-5' } },
    { from: { chunkId: '12850' }, to: { offSurface: true, interiorMap: { areaId: 'Unrelated Cave', status: 'mapped' } } },
    { from: { chunkId: '12339' }, to: { offSurface: true, interiorMap: { areaId: 'Mapped Cave', status: 'mapped' } } },
  ] } };
  const original = structuredClone(fixture.mapConnections);
  assert.deepEqual(interiorCandidates('12339', { Nickname: 'Draynor' }, fixture), ['Mapped Cave', 'Unknown Cave']);
  assert.deepEqual(interiorCandidates('12339-7', { Nickname: 'Draynor section' }, fixture), ['Mapped Cave', 'Unknown Cave']);
  assert.deepEqual(fixture.mapConnections, original);
  fixture.mapConnections = fixture.mapConnections.connections;
  assert.deepEqual(interiorCandidates('12339', { Nickname: 'Draynor' }, fixture), ['Mapped Cave', 'Unknown Cave']);
});
