import test from 'node:test';
import assert from 'node:assert/strict';
import { backlogSearchTasks } from '../app/tasks/backlog-search.mjs';
import { createTrainingSourceIndex } from '../app/tasks/training-availability.mjs';

const fixture = () => ({
  definitions: {
    chunks: {
      '12341': { Nickname: 'Lumbridge', Sections: { 2: { Object: { Rock: 1 }, NPC: { Guide: 1 }, Monster: { Cow: 1 } } } },
      '12342': { Nickname: 'Varrock', Shop: { Store: 1 }, Spawn: { Egg: 1 } },
    },
    objectItems: { Rock: { Ore: 1 } }, shopItems: { Store: { Sword: 1 } }, drops: { Cow: { Bones: 1 } },
    codeItems: { objectsPlus: { 'Rocks[+]': ['Rock'] } },
    challenges: { Mining: { Mine: { Chunks: ['12341-2[+]'], Objects: ['Rocks[+]'], NPCs: ['Guide'], Items: ['Egg'] } } },
  },
  catalogue: [{ id: 'mine', rawLabel: 'Mine', category: 'Mining', aliases: ['old-mine'] },
    { id: 'other', rawLabel: 'Elsewhere', category: 'Mining', aliases: [] }],
  dynamicCatalogue: [{ id: 'kill', sourceId: 'entity:cow' }, { id: 'gear', itemId: 'entity:sword' }],
  registry: { entries: { 'entity:cow': { entityKind: 'monster', label: 'Cow' }, 'entity:sword': { entityKind: 'item', label: 'Sword' } }, aliases: {} },
});

test('static Backlog search resolves declared marked sections and source selectors by saved ID', () => {
  const input = fixture();
  assert.deepEqual(backlogSearchTasks({ ...input, taskIds: ['old-mine'] }), [{ id: 'old-mine', locations: [
    { id: '12341-2', name: 'Lumbridge' }, { id: '12342', name: 'Varrock' },
  ] }]);
});

test('dynamic Backlog rows locate source entities and obtainable items without evaluation', () => {
  const input = fixture();
  assert.deepEqual(backlogSearchTasks({ ...input, taskIds: ['kill', 'gear'] }), [
    { id: 'kill', locations: [{ id: '12341-2', name: 'Lumbridge' }] },
    { id: 'gear', locations: [{ id: '12342', name: 'Varrock' }] },
  ]);
});

test('explicit unregistered entity IDs retain exact source names without guessing unknown entities', () => {
  const input = fixture();
  input.dynamicCatalogue = [{ id: 'source', sourceId: 'rs3:unregistered:monster:Cow' },
    { id: 'item', itemId: 'rs3:unregistered:item:Sword' }, { id: 'unknown', sourceId: 'rs3:entity:missing' }];
  const rows = backlogSearchTasks({ ...input, taskIds: ['source', 'item', 'unknown'] });
  assert.deepEqual(rows.map(row => row.locations.map(location => location.id)), [['12341-2'], ['12342'], []]);
});

test('ambiguous catalogue aliases have no inferred locations and exact IDs still work', () => {
  const input = fixture();
  input.catalogue[1].aliases = ['old-mine'];
  assert.deepEqual(backlogSearchTasks({ ...input, taskIds: ['old-mine'] }), [{ id: 'old-mine', locations: [] }]);
  assert.equal(backlogSearchTasks({ ...input, taskIds: ['mine'] })[0].locations.length, 2);
});

test('saved registry resolves a unique alias and refuses ambiguous persisted identities', () => {
  const input = fixture();
  input.registry.entries.mine = { category: 'Mining', rawLabel: 'Mine', aliases: [] };
  input.registry.entries.other = { category: 'Mining', rawLabel: 'Elsewhere', aliases: [] };
  input.registry.aliases.saved = 'mine';
  input.registry.aliases.uncertain = ['mine', 'other'];
  const result = backlogSearchTasks({ ...input, taskIds: ['saved', 'uncertain'] });
  assert.equal(result[0].locations.length, 2);
  assert.deepEqual(result[1], { id: 'uncertain', locations: [] });
});

test('only requested IDs are returned, unknown metadata stays empty, and inputs are unchanged', () => {
  const input = fixture(), before = structuredClone(input), index = createTrainingSourceIndex(input.definitions), beforeIndex = structuredClone(index);
  const rows = backlogSearchTasks({ ...input, taskIds: ['gear', 'missing', 'gear'], sourceLocations: index });
  assert.deepEqual(rows.map(row => row.id), ['gear', 'missing']);
  assert.deepEqual(rows[1].locations, []);
  rows[0].locations[0].name = 'Changed output';
  assert.deepEqual(input, before); assert.deepEqual(index, beforeIndex);
  assert.deepEqual(backlogSearchTasks({ ...input, taskIds: [] }), []);
  assert.equal(backlogSearchTasks({ ...input, taskIds: ['kill'], sourceLocations: new Map(Object.entries(index)) })[0].locations.length, 1);
});
