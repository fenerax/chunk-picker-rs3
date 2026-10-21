import test from 'node:test';
import assert from 'node:assert/strict';
import { questMapLocations } from '../app/web/quest-map-model.mjs';

const step = (name, chunks, tasks) => ({ BaseQuest: name, ...(chunks ? { Chunks: chunks } : {}), ...(tasks ? { Tasks: tasks } : {}) });
const definitions = {
  chunks: { '100': {}, '101': {}, '102': {}, '103': {}, '999': {}, Cave: {} },
  quests: { Example: '100, Choice[+]x2, Cave, Unknown area' },
  codeItems: { chunksPlus: { 'Choice[+]': ['101-1', 'Nested[+]'], 'Nested[+]': ['102-2', '101-3'] }, tasksPlus: { 'Subtasks[+]': ['Craft ingredient--optional'] } },
  challenges: {
    Quest: {
      '~|Example|~ 1': step('Example', ['100-1']),
      '~|Example|~ 2a': step('Example', ['103'], { 'Subtasks[+]': 'Crafting', '~|Other|~ Complete the quest': 'Quest' }),
      '~|Example|~ 2b': step('Example', ['choice[+]x2']),
      '~|Example|~ Complete the quest': step('Example', ['100']),
      '~|Other|~ Complete the quest': step('Other', ['999']),
    },
    Crafting: { 'Craft ingredient': { Chunks: ['102-1'], Tasks: { 'Craft ingredient': 'Crafting' } } },
  },
};

test('collects the entire declared quest route and listed subrequirements, including prerequisite quests, without source guesses', () => {
  const result = questMapLocations({ task: { rawLabel: '~|Example|~ Complete the quest' }, definitions, unlocked: ['100', '102'] });
  assert.equal(result.quest, 'Example');
  assert.deepEqual(result.ids, ['100', '101', '102', '103', '999']);
  assert.deepEqual(result.lockedIds, ['101', '103', '999']);
  assert.deepEqual(result.interiors, ['Cave']);
  assert.deepEqual(result.missing, ['Unknown area']);
  assert.equal(result.alternatives[0].count, 2);
  assert.deepEqual(result.alternatives[0].locations, ['101-1', '102-2', '101-3']);
});

test('a linked prerequisite completion includes its recorded route even when it has no own Chunks', () => {
  const defs = { chunks: { '100': {}, '101': {} }, quests: { Example: '100', Other: '101' }, challenges: { Quest: {
    '~|Example|~ step': step('Example', ['100'], { '~|Other|~ Complete the quest': 'Quest' }),
    '~|Other|~ Complete the quest': { BaseQuest: 'Other', QuestPoints: 1, Tasks: { '~|Example|~ step': 'Quest' } },
  } } };
  const result = questMapLocations({ quest: 'Example', definitions: defs });
  assert.deepEqual(result.ids, ['100', '101']); assert.deepEqual(result.missing, []);
});

test('listed task alternatives warn about all candidates and unknown subrequirement geography remains explicit', () => {
  const defs = { chunks: { '100': {}, '101': {} }, codeItems: { tasksPlus: { 'Endings[+]': ['Ending A', 'Ending B'] } }, challenges: {
    Quest: { 'Example step': { BaseQuest: 'Example', Chunks: ['100'], Tasks: { 'Endings[+]': 'Crafting' } } },
    Crafting: { 'Ending A': { Chunks: ['101'] }, 'Ending B': {} },
  } };
  const result = questMapLocations({ quest: 'Example', definitions: defs });
  assert.deepEqual(result.ids, ['100', '101']); assert.deepEqual(result.missing, ['Ending B']);
  assert.equal(result.alternatives[0].count, 1); assert.deepEqual(result.alternatives[0].tasks, ['Ending A', 'Ending B']);
});

test('unresolved aliases, cycles, absent step geography and undefined chunks remain explicit', () => {
  const defs = { chunks: {}, codeItems: { chunksPlus: { 'Loop[+]': ['Loop[+]'] } }, challenges: { Quest: {
    '~|Empty|~ 1': step('Empty'), '~|Empty|~ 2': step('Empty', ['Loop[+]', 'Missing[+]x3', '900']),
  } } };
  assert.deepEqual(questMapLocations({ quest: 'Empty', definitions: defs }).missing, ['Empty 1', 'Loop[+]', 'Missing[+]x3', '900']);
  assert.deepEqual(questMapLocations({ quest: 'Absent', definitions: defs }).missing, ['Absent']);
});

test('only cells on the supplied surface can be highlighted and unlocked remains ownership based', () => {
  const world = { surface: new Set(['100', '101']), areas: new Map([['Cave', {}]]) };
  const result = questMapLocations({ quest: 'Example', definitions, world, unlocked: new Set(['100']) });
  assert.deepEqual(result.ids, ['100', '101']);
  assert.deepEqual(result.lockedIds, ['101']);
  assert.ok(result.missing.includes('102-2'));
});

test('a whole completion record without Chunks uses its declared route without a false missing warning', () => {
  const defs = { chunks: { '100': {} }, quests: { Example: '100' }, challenges: { Quest: {
    '~|Example|~ Complete the quest': { BaseQuest: 'Example', QuestPoints: 0 },
  } } };
  const result = questMapLocations({ task: { record: { BaseQuest: 'Example', QuestPoints: 0 } }, definitions: defs });
  assert.equal(result.quest, 'Example');
  assert.deepEqual(result.ids, ['100']);
  assert.deepEqual(result.missing, []);
});
