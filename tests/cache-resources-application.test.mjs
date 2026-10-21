import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCacheResources, cacheResourceContentsEnabled } from '../app/data/cache-resources.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { datasetCapabilities } from '../app/datasets.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

const component = '12339-1000001';
const otherComponent = '12339-1000002';
const selectors = { mappings: [{ name: 'Yew tree', classKeys: ['tree:yew'] }, { name: 'Furnace', classKeys: ['facility:furnace'] }] };
function catalogue(placements = [{ id: 'fixture:yew', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: [component] }]) {
  return { provenance: { decoderCommit: 'fixture', buildSchema: 950 }, coverage: [['12339', 'decoded']],
    classes: [{ key: 'tree:yew', name: 'Yew tree' }, { key: 'facility:furnace', name: 'Furnace' }], placements };
}
function fakeWorld() {
  return { chunks: new Map([['12339', { name: 'Fixture' }], ['100', { name: 'Uncovered' }]]),
    cacheWalking: { components: new Map([[component, {}], [otherComponent, {}]]),
      legacyToComponents: new Map([['12339-1', [component]], ['12339-2', [otherComponent]]]) } };
}
function fixture() {
  return { chunks: { '12339': { Object: { 'Yew tree': 9, Furnace: 1, 'Fishing spot (net/bait)': 1 },
    NPC: { Bob: 1 }, Shop: { Shop: 1 }, Spawn: { Coin: 2 } }, '100': { Object: { 'Yew tree': 3 } } },
    sections: { '12339': { 0: [] } }, walkableChunks: ['12339'], walkableChunksF2P: ['12339'],
    challenges: { Woodcutting: { 'Cut yew': { Objects: ['Yew tree'] } } } };
}

test('confirmed static counts come from exact components; nonstatic declarations and uncovered chunks are unchanged', () => {
  const definitions = fixture(), before = structuredClone(definitions);
  const world = applyCacheResources(fakeWorld(), definitions, { enabled: true, resourceCatalogue: catalogue(), resourceSelectors: selectors });
  assert.equal(world.resourceContents.get('100'), definitions.chunks['100']);
  const record = world.resourceContents.get('12339');
  assert.deepEqual(record.Object, { Furnace: 1, 'Fishing spot (net/bait)': 1, 'Yew tree': 1 });
  assert.equal(record.ObjectProvenance.Furnace.source, 'retained-only');
  assert.equal(record.ObjectProvenance['Fishing spot (net/bait)'].source, 'retained-only');
  assert.equal(record.ObjectProvenance['Yew tree'].source, 'game-data');
  assert.deepEqual(record.ObjectProvenance['Yew tree'].components, [component]);
  assert.deepEqual(record.ObjectProvenance['Yew tree'].retainedLocations, ['12339']);
  assert.deepEqual(world.cacheResources.retainedNodes.get('12339').Object, { Furnace: 1, 'Fishing spot (net/bait)': 1 }, 'Display aggregation must not bypass cache-only component access');
  assert.deepEqual(record.NPC, before.chunks['12339'].NPC);
  assert.deepEqual(record.Shop, before.chunks['12339'].Shop);
  assert.deepEqual(record.Spawn, before.chunks['12339'].Spawn);
  assert.deepEqual(definitions, before, 'The retained reference must not be mutated');
});

test('same-class declarations merge once and preserve both original section access routes', () => {
  const definitions = { chunks: { '12339': { Sections: { 1: { Object: { 'Yew tree': 9 } }, 2: { Object: { 'Yew tree': 3 } } } } } };
  const world = applyCacheResources(fakeWorld(), definitions, { enabled: true, resourceCatalogue: catalogue(), resourceSelectors: selectors });
  const record = world.resourceContents.get('12339');
  assert.deepEqual(record.Sections[1].Object, {});
  assert.deepEqual(record.Sections[2].Object, {});
  assert.equal(record.Object['Yew tree'], 1);
  assert.deepEqual(record.ObjectProvenance['Yew tree'].retainedLocations, ['12339-1', '12339-2']);
  assert.deepEqual(world.cacheResources.byComponent.get(component).get('tree:yew').gateLocations, ['12339-1', '12339-2']);
});

test('unwitnessed or foreign component placements never replace retained declarations', () => {
  const world = applyCacheResources(fakeWorld(), fixture(), { enabled: true, resourceCatalogue: catalogue([
    { id: 'missing', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: [] },
    { id: 'foreign', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: ['99999-1000001'] },
  ]), resourceSelectors: selectors });
  assert.equal(world.resourceContents.get('12339').Object['Yew tree'], 9);
  assert.equal(world.cacheResources.byComponent.size, 0);
});

test('packed catalogue rows use the committed schema columns', () => {
  const data = catalogue();
  data.schema = { placementColumns: ['id', 'objectId', 'classKey', 'chunkId', 'components'] };
  data.placements = [['packed', 42, 'tree:yew', '12339', [component]]];
  const world = applyCacheResources(fakeWorld(), fixture(), { enabled: true, resourceCatalogue: data, resourceSelectors: selectors });
  assert.equal(world.resourceContents.get('12339').Object['Yew tree'], 1);
});

test('one placement with two facility classes is counted once in chunk info', () => {
  const data = catalogue([
    { id: 'altar', objectId: 42, classKey: 'facility:altar:astral', chunkId: '12339', components: [component] },
    { id: 'altar', objectId: 42, classKey: 'runecrafting:astral', chunkId: '12339', components: [component] },
  ]);
  data.classes = [{ key: 'facility:altar:astral', name: 'Astral altar' }, { key: 'runecrafting:astral', name: 'Astral altar' }];
  const world = applyCacheResources(fakeWorld(), fixture(), { enabled: true, resourceCatalogue: data, resourceSelectors: selectors });
  const record = world.resourceContents.get('12339');
  assert.equal(record.Object['Astral altar'], 1);
  assert.deepEqual(record.ObjectProvenance['Astral altar'].placements, ['altar']);
  assert.deepEqual(record.ObjectProvenance['Astral altar'].classKeys, ['facility:altar:astral', 'runecrafting:astral']);
  assert.equal(world.cacheResources.summary.attachedPlacements, 1, 'A multi-class placement is one physical object');
});

test('unsettled section geometry keeps retained access while showing one confirmed cache quantity', () => {
  const world = fakeWorld();
  world.cacheWalking.mapping = [{ legacy: '12339-1', components: [1], resourceUnresolved: true, project: false }];
  const definitions = { chunks: { '12339': { Sections: { 1: { Object: { 'Yew tree': 3 } } } } } };
  applyCacheResources(world, definitions, { enabled: true, resourceCatalogue: catalogue(), resourceSelectors: selectors });
  assert.equal(world.resourceContents.get('12339').Sections[1].Object['Yew tree'], undefined);
  assert.equal(world.resourceContents.get('12339').Object['Yew tree'], 1);
  assert.deepEqual(world.resourceContents.get('12339').ObjectProvenance['Yew tree'].retainedLocations, ['12339-1']);
});

test('a reviewed physical synonym cannot bypass source gates or backlogs', () => {
  const definitions = fixture();
  definitions.taskUnlocks = { Objects: { Yew: { '12339': { 'Open orchard': 'Nonskill' } } } };
  const mapped = { mappings: [...selectors.mappings, { name: 'Yew', classKeys: ['tree:yew'] }] };
  const index = buildAccessIndex(definitions, { cacheWalking: true, cacheResources: true, resourceCatalogue: catalogue(), resourceSelectors: mapped });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {}, sourceBacklogs: {} }] };
  assert(!calculateAccess(index, state, 'm').objects.has('Yew tree'));
  state.members[0].sourceBacklogs.objects = { Yew: true };
  const access = calculateAccess(index, state, 'm', { validTasks: new Set(['Nonskill\u0000Open orchard']) });
  assert(!access.objects.has('Yew tree'));
  assert(!access.objects.has('Yew'));
});

test('a confirmed taskUnlocks source keeps its retained access without entering its disconnected component', () => {
  const definitions = fixture();
  delete definitions.chunks['12339'].Object['Yew tree'];
  definitions.taskUnlocks = { Objects: { 'Yew tree': { '12339': true } } };
  const index = buildAccessIndex(definitions, { cacheWalking: true, cacheResources: true, resourceCatalogue: catalogue([
    { id: 'isolated', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: [otherComponent] },
  ]), resourceSelectors: selectors });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {} }] };
  const access = calculateAccess(index, state, 'm');
  assert(access.objects.has('Yew tree'));
  assert.deepEqual(access.locations.get('Object:Yew tree'), ['12339']);
  assert(!access.components.has(otherComponent));
});

test('unknown cache resources are visible for review without certifying task yields', () => {
  const definitions = fixture(); delete definitions.chunks['12339'].Object['Yew tree'];
  const data = catalogue([{ id: 'unknown', objectId: 42, classKey: 'tree:unknown:tree', chunkId: '12339', components: [component] }]);
  data.classes.push({ key: 'tree:unknown:tree', name: 'Tree' });
  const index = buildAccessIndex(definitions, { cacheWalking: true, cacheResources: true, resourceCatalogue: data, resourceSelectors: selectors });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {} }] };
  const access = calculateAccess(index, state, 'm');
  assert(!access.objects.has('Tree'));
  assert(!access.objects.has('Tree (untyped)'));
  assert.equal(index.world.resourceContents.get('12339').Object['Tree (untyped)'], 1);
});

test('an unmapped display label cannot revive an ambiguous task selector', () => {
  const definitions = fixture(); delete definitions.chunks['12339'].Object['Yew tree'];
  const data = catalogue([{ id: 'bank-chest', objectId: 42, classKey: 'facility:bank-chest:chest', chunkId: '12339', components: [component] }]);
  data.classes.push({ key: 'facility:bank-chest:chest', name: 'Chest' });
  const index = buildAccessIndex(definitions, { cacheWalking: true, cacheResources: true, resourceCatalogue: data, resourceSelectors: { mappings: [] } });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {} }] };
  const access = calculateAccess(index, state, 'm');
  assert(!access.objects.has('Chest'));
  assert.equal(index.world.resourceContents.get('12339').Object.Chest, 1);
});

test('unresolved authored source geometry keeps its gate on all same-base placements', () => {
  const world = fakeWorld();
  world.cacheWalking.mapping = [{ legacy: '12339-1', components: [1], resourceUnresolved: true, project: true }];
  const definitions = fixture();
  definitions.taskUnlocks = { Objects: { 'Yew tree': { '12339-1': { 'Open orchard': 'Nonskill' } } } };
  applyCacheResources(world, definitions, { enabled: true, resourceCatalogue: catalogue([
    { id: 'other', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: [otherComponent] },
  ]), resourceSelectors: selectors });
  assert(world.cacheResources.byComponent.get(otherComponent).get('tree:yew').gateLocations.includes('12339-1'));
});

test('explicit rollback keeps retained contents and walking geometry', () => {
  const definitions = fixture();
  const retained = buildWorld(definitions, { cacheWalking: true, cacheResources: false });
  assert(retained.cacheWalking);
  assert.equal(retained.resourceContentsMode, 'retained');
  assert.equal(retained.cacheResources, undefined);
  assert.deepEqual(retained.resourceContents.get('12339').Object, definitions.chunks['12339'].Object);
});

test('server rollback startup capability is a single explicit retained value', () => {
  const retained = datasetCapabilities({ RS3_RESOURCE_CONTENTS: 'retained' });
  assert.equal(retained.cacheResources, false);
  assert.equal(buildWorld(fixture(), { cacheWalking: true, cacheResources: retained.cacheResources }).resourceContentsMode, 'retained');
  assert.equal(datasetCapabilities({}).cacheResources, true);
  assert.equal(datasetCapabilities({ RS3_RESOURCE_CONTENTS: 'game-data' }).cacheResources, true);
  assert.equal(cacheResourceContentsEnabled(), datasetCapabilities(selectedDataset.environment).cacheResources);
});

test('task collection uses reached components and carries authored source requirements', () => {
  const definitions = fixture();
  definitions.taskUnlocks = { Objects: { 'Yew tree': { '12339': { 'Open orchard': 'Nonskill' } } } };
  const options = { cacheWalking: true, cacheResources: true, resourceCatalogue: catalogue(), resourceSelectors: selectors };
  const index = buildAccessIndex(definitions, options);
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {} }] };
  assert(!calculateAccess(index, state, 'm').objects.has('Yew tree'));
  const access = calculateAccess(index, state, 'm', { validTasks: new Set(['Nonskill\u0000Open orchard']) });
  assert(access.objects.has('Yew tree'));
  assert.deepEqual(access.locations.get('Object:Yew tree'), [component, '12339']);
  const blocked = structuredClone(state); blocked.members[0].sectionOverrides['12339-0'] = false;
  assert(!calculateAccess(index, blocked, 'm', { validTasks: new Set(['Nonskill\u0000Open orchard']) }).objects.has('Yew tree'));
});

test('a confirmed retained resource keeps access behind a closed door without entering its component', () => {
  const definitions = fixture();
  const index = buildAccessIndex(definitions, { cacheWalking: true, cacheResources: true, resourceCatalogue: catalogue([
    { id: 'isolated', objectId: 42, classKey: 'tree:yew', chunkId: '12339', components: [otherComponent] },
  ]), resourceSelectors: selectors });
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], sectionOverrides: {} }] };
  const access = calculateAccess(index, state, 'm');
  assert(access.components.has(component));
  assert(!access.components.has(otherComponent));
  assert(access.objects.has('Yew tree'));
  assert.deepEqual(access.locations.get('Object:Yew tree'), ['12339']);
});

test('task engine resource mode affects sources without affecting authored task IDs', () => {
  const definitions = fixture();
  const options = { cacheWalking: true, cacheResources: true, resourceCatalogue: catalogue(), resourceSelectors: selectors };
  const game = createTaskEngine(definitions, { ...options, cacheResources: true });
  const retained = createTaskEngine(definitions, { ...options, cacheResources: false });
  assert.deepEqual(game.catalogue, retained.catalogue);
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['12339'], selected: [], completedTasks: [], taskStatus: {}, sectionOverrides: {} }], tasks: [] };
  assert.deepEqual(game.evaluate(state, 'm').access.locations['Object:Yew tree'], [component, '12339']);
  assert.deepEqual(retained.evaluate(state, 'm').access.locations['Object:Yew tree'], ['12339']);
});
