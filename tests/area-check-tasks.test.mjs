import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAreaCheck } from '../app/tasks/area-check.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';

function fixture() {
  const definitions = {
    chunks: { '12850': { Object: { Rock: true } }, '12851': {}, '12852': {} },
    walkableChunks: ['12850', '12851', '12852'], walkableChunksF2P: ['12850', '12851', '12852'],
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850', '12852'] }, '12852': { '0': ['12851'] } },
    challenges: {
      Mining: { 'Mine rock': { Level: 1, Primary: true, Objects: ['Rock'] } },
      Quest: {
        'Zebra quest': { Chunks: ['12851'], QuestPoints: 1 },
        '~|Area quest|~': { Chunks: ['12851'], QuestPoints: 1 },
        'Combined quest': { Chunks: ['12851'], Skills: { Mining: 20 }, QuestPoints: 1 },
        'Completed quest': { Chunks: ['12851'], QuestPoints: 1 },
        'Partner completed quest': { Chunks: ['12851'], QuestPoints: 1 },
        'Backlogged quest': { Chunks: ['12851'], QuestPoints: 1 },
        'Members quest': { Chunks: ['12851'], QuestPoints: 1, 'Not F2P': true },
      },
      Diary: { 'Already doable': { Chunks: ['12850'] }, 'New achievement': { Chunks: ['12851'] } },
      Extra: { 'Later equipment': { Chunks: ['12851'], Level: 10 }, 'Early equipment': { Chunks: ['12851'], Level: 2 } },
      Nonskill: { 'Open access': { Chunks: ['12851'] } },
      Slayer: { 'Slayer duty': { Chunks: ['12851'], Level: 1, Primary: true } },
      Other: { 'Another duty': { Chunks: ['12851'] } },
    },
  };
  const engine = createTaskEngine(definitions), world = buildWorld(definitions);
  const state = createGroupState([{ id: 'one', name: 'Player', unlocked: ['12850'] }, { id: 'two', name: 'Player two' }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.rules['tasks.completion'] = 'any';
  state.rules['content.f2p'] = true;
  const id = label => engine.catalogue.find(task => task.label === label).id;
  state.members[0].completedTasks = [id('Completed quest')];
  state.members[1].completedTasks = [id('Partner completed quest')];
  state.members[0].taskStatus = { [id('Backlogged quest')]: { backlogged: true } };
  state.members[0].taskRules = { 'Show Nonskill Tasks': true };
  return { state, definitions, engine, world, catalogue: { methods: [] } };
}
const check = (context, draft = { chunkIds: ['12851'] }) => analyzeAreaCheck(context.state, 'one', draft, context);
const labels = scope => scope.categories.flatMap(group => group.tasks.map(task => task.label));

test('area tasks are new ordinary duties, excluding already doable, completed, shared-completed and backlog', () => {
  const context = fixture(), before = structuredClone(context.state), result = check(context);
  assert.deepEqual(labels(result.tasks.alone), ['Area quest', 'Zebra quest', 'New achievement',
    'Early equipment', 'Later equipment', 'Open access', 'Another duty', 'Slayer duty']);
  assert.equal(result.tasks.alone.total, 8);
  assert.ok(labels(result.tasks.combined).includes('Combined quest'));
  assert.equal(result.tasks.combined.total, 9);
  assert.deepEqual(result.tasks.combined.categories.map(group => group.category), ['Quest', 'Diary', 'Extra', 'Nonskill', 'Other', 'Slayer']);
  assert.deepEqual(context.state, before);
});

test('category visibility uses ordinary task-rule selection', () => {
  const context = fixture();
  Object.assign(context.state.members[0].taskRules, { 'Show Quest Tasks': false, Achievement: false, 'Show Nonskill Tasks': false });
  const result = check(context);
  for (const scope of Object.values(result.tasks)) {
    assert.ok(scope.categories.every(group => !['Quest', 'Diary', 'Nonskill'].includes(group.category)));
    assert.equal(scope.total, 4);
  }
});

test('members drafts compare against the current ordinary list and preserve both area scopes', () => {
  const context = fixture();
  const result = check(context, { chunkIds: ['12851'], asMembers: true });
  assert.ok(labels(result.tasks.alone).includes('Members quest'));
  assert.ok(labels(result.tasks.combined).includes('Members quest'));
  assert.ok(!labels(result.tasks.alone).includes('Combined quest'));
  assert.ok(labels(result.tasks.combined).includes('Combined quest'));
  assert.ok(!labels(result.tasks.combined).includes('Already doable'));
  assert.equal(context.state.rules['content.f2p'], true);
});

test('one baseline evaluation is reused across both scopes, or supplied by the live worker snapshot', () => {
  const context = fixture(), calls = [];
  const engine = { evaluate: (state, member) => { calls.push(state); return context.engine.evaluate(state, member); } };
  check({ ...context, engine });
  assert.equal(calls.length, 3);
  assert.equal(calls[0], context.state);
  const baseline = context.engine.evaluate(context.state, 'one');
  calls.length = 0;
  const supplied = check({ ...context, engine, baseline });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(state => state !== context.state));
  assert.deepEqual(supplied.tasks, check(context).tasks);
  calls.length = 0;
  const baselineTaskIds = selectPresentedTasks(baseline, context.state, 'one', context.definitions).tasks.map(task => task.id);
  // Production sends only ordinary presented IDs across the isolated lanes.
  assert.deepEqual(check({ ...context, engine, baselineTaskIds }).tasks, supplied.tasks);
  assert.equal(calls.length, 2);
  assert.equal(check(context, { chunkIds: [] }).tasks.alone.total, 0);
  assert.equal(check(context, { chunkIds: [] }).tasks.combined.total, 0);
});
