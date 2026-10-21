import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld } from '../app/data/world.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import corrections from '../app/data/cache-surface-corrections.2026-10-08.v1.json' with { type: 'json' };

const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const options = { dataset: selectedDataset, cacheWalking: true, cacheResources: true };
const world = buildWorld(definitions, options);
const fixtures = [
  ['11569', '11569-1000001', 'tree:teak', 'Teak tree', 4],
  ['13106', '13106-1000002', 'tree:acadia', 'Acadia tree', 3],
  ['12853', '12853-1000001', 'facility:bank-booth', 'Bank booth', 6],
  ['12853', '12853-1000001', 'facility:anvil', 'Anvil', 2],
  ['12342', '12342-1000001', 'facility:furnace', 'Furnace', 1],
  ['12850', '12850-1000001', 'facility:furnace', 'Furnace', 1],
  ['12850', '12850-1000001', 'facility:anvil', 'Anvil', 1],
];
function enteredState(rows = fixtures) {
  return { rules: { 'content.f2p': true }, members: [{ id: 'synthetic',
    unlocked: [...new Set(rows.map(([base]) => base))],
    // Explicit entered components isolate source collection from travel planning.
    sectionOverrides: Object.fromEntries(rows.map(([, component]) => [component, true])), sourceBacklogs: {} }] };
}

test('expanded committed catalogue supplies named trees and normal F2P facilities at exact components', () => {
  for (const [base, component, classKey, name, count] of fixtures) {
    const resource = world.cacheResources.byComponent.get(component)?.get(classKey);
    assert(resource, `${base} ${classKey} needs witnessed cache contents`);
    assert.equal(resource.count, count, `${component} ${name}`);
    assert.equal(new Set(resource.placements.map(row => row.id)).size, count);
    const node = world.resourceContents.get(base);
    assert.equal(node.Object[name], world.cacheResources.byChunk.get(base).get(classKey).count);
    assert.equal(node.ObjectProvenance[name].source, 'game-data');
    assert.equal(world.cacheWalking.components.get(component).free, true);
  }
  const access = calculateAccess(buildAccessIndex(definitions, options), enteredState(), 'synthetic');
  for (const [, component, , name] of fixtures) {
    assert(access.objects.has(name), `${name} should be available on an entered free component`);
    assert(access.locations.get(`Object:${name}`).includes(component));
  }
});

test('expanded resources preserve walking topology and cannot attach to mapfix3 excluded geometry', () => {
  const retained = buildWorld(definitions, { ...options, cacheResources: false });
  assert.deepEqual(world.sectionTopology, retained.sectionTopology);
  assert.deepEqual(world.cacheWalking.components, retained.cacheWalking.components);
  const invalid = new Set(corrections.invalidRegionIds);
  const excluded = new Set(corrections.nonWalkingComponentIds);
  for (const [id, resources] of world.cacheResources.byComponent) {
    const component = world.cacheWalking.components.get(id);
    assert(component, `An attachment requires a walking component: ${id}`);
    assert(!invalid.has(component.base));
    assert(!excluded.has(`${component.base}:${component.label}`));
    for (const resource of resources.values()) for (const placement of resource.placements) {
      assert.equal(placement.chunkId, component.base);
      assert(placement.components.includes(`${component.base}:${component.label}`));
    }
  }
});

test('unconfirmed Lumbridge bank booth remains retained-only beside witnessed facilities', () => {
  const chunk = world.resourceContents.get('12850');
  assert.equal(chunk.Sections['1'].Object['Bank booth'], 1);
  assert.equal(chunk.Sections['1'].ObjectProvenance['Bank booth'].source, 'retained-only');
  assert(![...world.cacheResources.byComponent].some(([id, resources]) => id.startsWith('12850-') && resources.has('facility:bank-booth')));
});

test('Musa Point and North Al Kharid have one merged cache quantity with a retained section route', () => {
  for (const [base, retainedName, name, count] of [['11569', 'Teak', 'Teak tree', 4], ['13106', 'Acadia tree', 'Acadia tree', 3]]) {
    const record = world.resourceContents.get(base);
    assert.equal(record.Sections['1'].Object[retainedName], undefined);
    assert.equal(record.Object[name], count);
    assert.equal(record.ObjectProvenance[name].source, 'game-data');
    assert.equal(record.ObjectProvenance[name].cacheOnly, false);
    assert.deepEqual(record.ObjectProvenance[name].retainedLocations, [base + '-1']);
  }
});

test('real Musa Point placements respect an authored alias gate and source backlog', () => {
  const gated = structuredClone(definitions);
  gated.taskUnlocks.Objects.Teak = { '11569-1': { 'Synthetic orchard gate': 'Nonskill' } };
  const index = buildAccessIndex(gated, options), state = enteredState([fixtures[0]]);
  const blocked = calculateAccess(index, state, 'synthetic');
  assert(!blocked.objects.has('Teak tree'));
  const validTasks = new Set(['Nonskill\u0000Synthetic orchard gate']);
  const admitted = calculateAccess(index, state, 'synthetic', { validTasks });
  assert(admitted.objects.has('Teak tree'));
  assert.deepEqual(admitted.locations.get('Object:Teak tree'), ['11569-1000001']);
  state.members[0].sourceBacklogs.objects = { Teak: true };
  const backlogged = calculateAccess(index, state, 'synthetic', { validTasks });
  assert(!backlogged.objects.has('Teak tree'));
  assert(!backlogged.objects.has('Teak'));
});
