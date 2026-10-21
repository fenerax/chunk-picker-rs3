import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createGroupState } from '../app/core/state.mjs';

const base = '12339', outdoor = '12339-1000001', indoor = '12339-1000002';
function fixture({ retained = true, gated = false } = {}) {
  const definitions = { chunks: { [base]: { Nickname: 'Synthetic door fixture',
    Object: retained ? { 'Yew tree': 9 } : {} } },
    sections: { [base]: { 0: [] } }, walkableChunks: [base], walkableChunksF2P: [base],
    challenges: { Woodcutting: { 'Cut synthetic yew': { Objects: ['Yew tree'] } } },
    ...(gated ? { taskUnlocks: { Objects: { 'Yew tree': { [base]: { 'Synthetic orchard gate': 'Nonskill' } } } } } : {}) };
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic', unlocked: [base] }]);
  state.rules['content.f2p'] = false;
  Object.assign(state.members[0], { sectionOverrides: {}, sourceBacklogs: {} });
  const options = { cacheWalking: true, cacheResources: true, metadataCorrections: false, lodestones: [],
    resourceCatalogue: { coverage: [[base, 'decoded']], classes: [{ key: 'tree:yew', name: 'Yew tree' }],
      placements: [{ id: 'synthetic:yew', objectId: 42, classKey: 'tree:yew', chunkId: base, components: [indoor] }] },
    resourceSelectors: { mappings: [{ name: 'Yew tree', classKeys: ['tree:yew'] }] } };
  return { definitions, state, options };
}

test('confirmed retained route preserves source gates, backlogs and source-location blocking behind a door', () => {
  const { definitions, state, options } = fixture({ gated: true }), index = buildAccessIndex(definitions, options);
  const validTasks = new Set(['Nonskill\u0000Synthetic orchard gate']);
  assert(!calculateAccess(index, state, 'synthetic').objects.has('Yew tree'));
  const admitted = calculateAccess(index, state, 'synthetic', { validTasks });
  assert(admitted.objects.has('Yew tree'));
  assert(admitted.components.has(outdoor));
  assert(!admitted.components.has(indoor));
  assert.deepEqual(admitted.locations.get('Object:Yew tree'), [base]);
  state.members[0].sourceBacklogs.objects = { 'Yew tree': true };
  assert(!calculateAccess(index, state, 'synthetic', { validTasks }).objects.has('Yew tree'));
  state.members[0].sourceBacklogs.objects = {};
  state.members[0].sectionOverrides[base + '-0'] = false;
  assert(!calculateAccess(index, state, 'synthetic', { validTasks }).objects.has('Yew tree'));
});

test('cache-only indoor resource requires its component, and display aggregation never admits it through the base', () => {
  const { definitions, state, options } = fixture({ retained: false }), index = buildAccessIndex(definitions, options);
  const row = index.world.resourceContents.get(base);
  assert.equal(row.Object['Yew tree'], 1);
  assert.equal(row.ObjectProvenance['Yew tree'].cacheOnly, true);
  assert.deepEqual(index.nodes.get(base).data.Object, {});
  assert(!calculateAccess(index, state, 'synthetic').objects.has('Yew tree'));
  state.members[0].sectionOverrides[indoor] = true;
  const reached = calculateAccess(index, state, 'synthetic');
  assert(reached.objects.has('Yew tree'));
  assert.deepEqual(reached.locations.get('Object:Yew tree'), [indoor]);
});

test('confirmed section routes are alternatives with their own gates, not an intersection of section access', () => {
  const { definitions, state, options } = fixture();
  definitions.chunks[base] = { Sections: { 1: { Object: { 'Yew tree': 4 } }, 2: { Object: { 'Yew tree': 5 } } } };
  definitions.sections[base] = { 1: [], 2: [] };
  definitions.taskUnlocks = { Objects: { 'Yew tree': { [base + '-1']: false, [base + '-2']: true } } };
  state.members[0].sectionOverrides = { [base + '-1']: true, [base + '-2']: true, [indoor]: false };
  const index = buildAccessIndex(definitions, options), access = calculateAccess(index, state, 'synthetic');
  assert(access.objects.has('Yew tree'));
  assert.deepEqual(access.locations.get('Object:Yew tree'), [base + '-2']);
  assert(!access.components.has(indoor));
  assert.equal(index.world.resourceContents.get(base).Object['Yew tree'], 1);
  state.members[0].sectionOverrides[base + '-2'] = false;
  assert(!calculateAccess(index, state, 'synthetic').objects.has('Yew tree'));
});

test('a blocked walking component leaves an independently accessible retained resource route without seeding entry', () => {
  const { definitions, state, options } = fixture();
  state.members[0].sectionOverrides = { [outdoor]: false, [indoor]: false };
  const access = calculateAccess(buildAccessIndex(definitions, options), state, 'synthetic');
  assert.equal(access.components.size, 0);
  assert(access.objects.has('Yew tree'));
  assert.deepEqual(access.locations.get('Object:Yew tree'), [base]);
});

test('lodestone injection keeps the resource options and rollback on both direct index and task engine paths', () => {
  const { definitions, state, options } = fixture({ retained: false });
  state.members[0].sectionOverrides[indoor] = true;
  const index = buildAccessIndex(definitions, options);
  assert.equal(index.world.resourceContentsMode, 'game-data');
  assert.equal(index.world.cacheResources.summary.attachedPlacements, 1);
  assert.equal(index.retained.world.resourceContentsMode, 'retained');
  assert.equal(index.retained.world.cacheResources, undefined);
  const game = createTaskEngine(definitions, options).evaluate(state, 'synthetic');
  const retained = createTaskEngine(definitions, { ...options, cacheResources: false }).evaluate(state, 'synthetic');
  assert(game.access.objects.includes('Yew tree'));
  assert(!retained.access.objects.includes('Yew tree'));
  assert.equal(buildAccessIndex(definitions, { ...options, cacheResources: false }).world.cacheResources, undefined);
});

test('retained compatibility respects a positively members-only base until explicitly overridden', () => {
  const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const index = buildAccessIndex(definitions, { dataset: selectedDataset, cacheWalking: true, cacheResources: true, lodestones: [] });
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic', unlocked: ['10028'] }]);
  state.rules['content.f2p'] = true;
  assert(index.membersOnlyBases.has('10028'));
  const blocked = calculateAccess(index, state, 'synthetic');
  assert.equal(blocked.components.size, 0);
  assert.equal(blocked.objects.size, 0);
  state.members[0].sectionOverrides = { '10028-0': true };
  const overridden = calculateAccess(index, state, 'synthetic');
  assert(overridden.objects.has('Bank booth'));
  assert.equal(overridden.components.size, 0);
});
