import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';

const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const index = buildAccessIndex(definitions, { dataset: selectedDataset });

test('unresolved retained approaches preserve named interiors and sources without manufacturing cache walking', () => {
  const unlocked = ['13361', '13105', '13620', '13619', '13618', '12092', '12348'];
  const sectionOverrides = { '13619-1': true, '13619-2': true, '12348-2': true };
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked, sectionOverrides }] };
  const validTasks = new Set(Object.keys(definitions.challenges.Nonskill).map(label => `Nonskill\u0000${label}`));
  const beforeState = JSON.stringify(state);
  const before = calculateAccess(index.retained, state, 'm', { validTasks });
  const after = calculateAccess(index, state, 'm', { validTasks });
  for (const area of ['Kharid-et - Barracks excavation site', 'Kharid-et - Carcerem excavation site',
    'Kharid-et - Praetorium excavation site', 'Polypore Dungeon', 'Abandoned Mine', 'Nature grotto', 'Lava Maze Dungeon']) {
    assert(before.areas.has(area), `fixture establishes retained ${area}`);
    assert(after.areas.has(area), `preserves ${area}`);
  }
  for (const [field, name] of [['objects', 'Cart tunnel'], ['objects', 'Fort debris'], ['objects', 'Carcerem debris'],
    ['npcs', 'Filliman Tarlock'], ['npcs', 'Zealot']]) {
    assert(before[field].has(name), `fixture establishes ${name}`);
    assert(after[field].has(name), `preserves ${name}`);
  }
  assert(after.diagnostics.some(row => row.code === 'unresolved-selector-retained-access'));
  const withoutPreservation = calculateAccess({ ...index, retained: undefined }, state, 'm', { validTasks });
  assert([...after.components].every(component => withoutPreservation.components.has(component)), 'preserving unresolved resources cannot add a cache walking component');
  assert.equal(JSON.stringify(state), beforeState);
});

test('unresolved preservation keeps pre-cache entry, personal blocks and task gates', () => {
  const make = (unlocked, sectionOverrides = {}) => ({ rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked, sectionOverrides }] });
  assert(!calculateAccess(index, make(['13620']), 'm').sections.has('13620-3'), 'ownership does not enter an unseeded section');
  assert(!calculateAccess(index, make(['13620', '13619'], { '13619-1': true, '13620-3': false }), 'm').areas.has('Polypore Dungeon'));
  const doc = make(['13620', '13619'], { '13619-2': true });
  const before = calculateAccess(index.retained, doc, 'm');
  const after = calculateAccess(index, doc, 'm');
  assert.equal(after.areas.has('Nature grotto'), before.areas.has('Nature grotto'));
  const gated = make(['13361', '13105']);
  assert(!calculateAccess(index, gated, 'm').areas.has('Kharid-et - Barracks excavation site'), 'the retained archaeology task gate remains required');
  assert(!calculateAccess(index, make(['7984'], { '7984-0': false }), 'm').objects.has('Crashed star'), 'an unresolved unsplit selector respects an explicit personal block');
});

test('positive all-members cache masks and intrinsic shop membership survive saved resource grants', () => {
  const state = { rules: { 'content.f2p': true }, members: [{ id: 'm', unlocked: ['8253', '8509'], sectionOverrides: { '8509-1': true } }] };
  const access = calculateAccess(index, state, 'm');
  assert(!access.shops.has('Moon Clan General Store'));
  assert(!access.shops.has('Moon Clan Fine Clothes'));
  assert(!access.shops.has("Baba Yaga's Magic Shop"));
  state.members[0].sectionOverrides['8253-2'] = true;
  const manuallyEntered = calculateAccess(index, state, 'm');
  assert(!manuallyEntered.shops.has('Moon Clan General Store'), 'an explicit saved section cannot waive intrinsic shop membership');
  assert(manuallyEntered.diagnostics.some(row => row.code === 'members-only-source' && row.source === 'Moon Clan General Store'));
  state.rules['content.f2p'] = false;
  assert(calculateAccess(index, state, 'm').shops.has('Moon Clan General Store'), 'the same saved route still grants the shop when membership is allowed');
});

test('retained partner uncertainty does not recover a positively absent cache region boundary', () => {
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked: ['11313'] }, { id: 'p', unlocked: ['11057'] }] };
  assert(evaluatePartnerConnections(index.retained.world, state, 'm', { lodestones: [] }).bases.includes('11057'));
  assert(!evaluatePartnerConnections(index.retainedResourceWorld, state, 'm', { lodestones: [] }).bases.includes('11057'));
  assert([...index.world.cacheWalking.topology.get('11057').values()].every(edges => edges.every(from => !from.startsWith('11313-'))));
});

test('known partner correspondences require their own portal even when other fragments join those regions', () => {
  assert(!index.resourceBoundaryAllowed('11825-1', '11569-1'), 'the reviewed mainland cannot substitute the separate island portal');
  assert(index.resourceBoundaryAllowed('11825-1', '11569-2'));
  assert([...index.world.cacheWalking.topology.get('11569').values()].some(edges => edges.some(from => from.startsWith('11825-'))));
});

test('a point anchor cannot erase unlocated partner approaches on the rest of the retained section', () => {
  const mapping = index.world.cacheWalking.mapping.find(record => record.legacy === '13372-1');
  assert.equal(mapping.method, 'declared-object-spatial-agreement');
  assert.equal(mapping.resourceUnresolved, true);
  assert(index.resourceBoundaryAllowed('13371', '13372-1'));
  assert(index.resourceBoundaryAllowed('13372-1', '13373-4'));
  const id = `13372-${1000000 + mapping.components[0]}`;
  assert.equal(index.world.cacheWalking.topology.get('13372').get(id.split('-')[1]).length, 0,
    'the laboratory footprint itself remains isolated and does not become walking transit');
});

test('an unqualified retained departure can use a witnessed boundary from a non-primary section', () => {
  assert(!index.resourceBoundaryAllowed('17200-1', '16944-0'));
  assert(index.resourceBoundaryAllowed('17200-2', '16944-0'));
  assert(index.resourceBoundaryAllowed('17200', '16944-0'), 'bare departures retain any entered section semantics');
});
