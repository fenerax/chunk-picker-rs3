import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld, findTaskIdCollisions, surfaceCoordinates } from '../app/data/world.mjs';
import { createRuleRegistry, evaluateRollPool } from '../app/core/rules.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('selected worlds carry a data-only dataset context into protected rule hooks', () => {
  const world = buildWorld({ chunks: { '100': {}, '101': {} }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] },
    { dataset: selectedDataset, cacheWalking: false, cacheResources: false, cacheArchaeology: false });
  let inspected = false;
  const registry = createRuleRegistry([{ id: 'test.dataset', label: 'Dataset', type: 'boolean', default: true, candidates({ world: snapshot }) {
    const context = snapshot.automaticTransportOptions.dataset;
    assert.equal(context.digest, selectedDataset.digest);
    assert.equal(context.datasetId, 'duo-legacy');
    assert(Object.values(context).every(value => typeof value !== 'function'));
    assert.throws(() => { context.digest = 'changed'; }, TypeError);
    inspected = true; return [];
  } }]);
  evaluateRollPool(world, createGroupState([{ id: 'fixture', name: 'Fixture', unlocked: ['100'] }]), 'fixture', registry);
  assert.equal(inspected, true);
});

test('retained Temple topology distinguishes geometric neighbors from its only recorded entry', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  assert.equal(world.chunks.get('12592').name, 'Temple of Amascut');
  assert.ok(world.neighbors.get('12592').includes('12336'));
  assert.ok(world.neighbors.get('12592').includes('12593'));
  assert.deepEqual([...world.sectionTopology.get('12592')], [['0', ['12848']]]);
  assert.ok(world.walkable.has('12592'));
  assert.equal(world.f2p.has('12592'), false, 'cache mask settles Temple of Amascut membership');
});

test('matches reference grid crop at the top-left and bottom-left boundaries', () => {
  const world = buildWorld({
    chunks: Object.fromEntries(['7495', '7496', '7494', '7751', '7239', '7446', '7445', '7447', '7702'].map(id => [id, {}])),
    walkableChunks: ['7495'], walkableChunksF2P: ['7495'],
  });
  assert.deepEqual(world.neighbors.get('7495'), ['7494', '7751']);
  assert.deepEqual(world.neighbors.get('7446'), ['7447', '7702']);
  assert.deepEqual(world.neighbors.get('7496'), []);
  assert.equal(world.surface.has('7239'), false);
  assert.deepEqual(surfaceCoordinates('7495'), { x: 0, y: 0 });
  assert.deepEqual(surfaceCoordinates('7446'), { x: 0, y: 49 });
  assert.deepEqual(surfaceCoordinates('19271'), { x: 46, y: 0 });
  assert.deepEqual(surfaceCoordinates('19222'), { x: 46, y: 49 });
  assert.equal(surfaceCoordinates('19527'), null);
});

test('last grid column and row do not admit defined off-map destinations', () => {
  const world = buildWorld({
    chunks: Object.fromEntries(['19271', '19270', '19272', '19015', '19527', '19222', '19221', '19223', '18966', '19478'].map(id => [id, {}])),
    walkableChunks: [], walkableChunksF2P: [],
  });
  assert.deepEqual(world.neighbors.get('19271'), ['19015', '19270']);
  assert.deepEqual(world.neighbors.get('19222'), ['18966', '19223']);
});

test('accepts F2P-only terrain with a diagnostic and never uses a nontext label', () => {
  const world = buildWorld({ chunks: { '12341': { Name: {} } }, walkableChunks: [], walkableChunksF2P: ['12341'] });
  assert.equal(world.chunks.get('12341').name, 'Chunk 12341');
  assert.equal(world.walkable.has('12341'), true);
  assert.deepEqual(world.issues.map(i => i.code), ['invalid-name', 'f2p-only-walkable']);
});

test('reports missing and malformed list destinations while keeping valid data', () => {
  const world = buildWorld({ chunks: { '12341': { Nickname: 'Barbarian Village' } },
    walkableChunks: [' 12341', '12341', '99999', 5], walkableChunksF2P: ['12341'] });
  assert.equal(world.chunks.get('12341').name, 'Barbarian Village');
  assert.deepEqual([...world.walkable], ['12341']);
  assert.deepEqual(world.issues.map(i => i.code), ['trimmed-id', 'missing-chunk', 'invalid-list-id']);
});

test('duplicate task IDs retain every label for later category-aware migration', () => {
  assert.deepEqual(findTaskIdCollisions({ 'Flower pot': 't_1', 'Elder stock': 't_1', 'Logs': 't_2', currentNextIndex: 3 }),
    [{ id: 't_1', labels: ['Flower pot', 'Elder stock'] }]);
});

test('invalid definition shapes fail before returning an incomplete index', () => {
  assert.throws(() => buildWorld({}), /chunks/);
  assert.throws(() => buildWorld({ chunks: {}, walkableChunks: {} }), /array/);
});

test('named interiors remain indexed separately and do not become roll destinations', () => {
  const world = buildWorld({ chunks: { '12341': {}, Zanaris: { Name: 'Zanaris' } },
    walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  assert.equal(world.areas.get('Zanaris').name, 'Zanaris');
  assert.equal(world.chunks.has('Zanaris'), false);
  assert.deepEqual(world.issues, []);
});
