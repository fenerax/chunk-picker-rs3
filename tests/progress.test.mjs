import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress.mjs';
import { createRuleRegistry, taskCompletion, challengeCompletion } from '../app/core/rules.mjs';
import { permanentTaskId, legacyTaskId } from '../app/tasks/identity.mjs';
import { equipmentContext } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { createContext, runInContext } from 'node:vm';
import { createTaskIconPainter } from '../app/web/task-icon-painter.mjs';

const registry = createRuleRegistry();
test('completion APIs and displayed facts recognize old catalogue and progress keys', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", id = permanentTaskId('Quest', raw), oldId = legacyTaskId('Quest', raw);
  const state = { rules: {}, tasks: [{ id: oldId, category: 'Quest', label: "Cook's Assistant" }],
    members: [{ id: 'actor1', completedTasks: [oldId], taskStatus: { [oldId]: { challengeCompleted: true } } }] };
  const before = structuredClone(state), facts = createTaskFactsIndex(state, 'actor1', registry);
  assert.equal(facts.get(id).actual, true); assert.equal(facts.get(oldId).personal, true);
  assert.equal(taskCompletion(state, oldId, 'actor1', registry).group, true);
  assert.equal(challengeCompletion(state, id, 'actor1', registry).personal, true);
  assert.deepEqual(state, before);
});
test('sidebar and equipment agree on actual personal evidence without copying quest progress or challenge checks', () => {
  const id = equipmentTaskIdentity('Sword', { slot: 'main hand weapon' }).id;
  const state = { rules: {}, tasks: [{ id }], members: [
    { id: 'actor1', unlocked: [], completedTasks: [], taskStatus: {} },
    { id: 'reed', unlocked: [], completedTasks: [id], taskStatus: {} },
  ] };
  const before = structuredClone(state);
  for (const mode of ['any', 'all', 'personal']) for (const owner of ['actor1', 'reed']) {
    state.rules['tasks.completion'] = mode;
    const facts = createTaskFactsIndex(state, owner, registry).get(id);
    const equipment = equipmentContext({ name: 'Sword', sources: [] }, {}, state, owner, { equipment: { Sword: { slot: 'main hand weapon' } } });
    assert.equal(facts.group, equipment.challenge.challengeSatisfied);
    assert.equal(facts.personal, false, 'Actual evidence does not manufacture an explicit checkbox.');
    assert.equal(facts.actual, owner === 'reed');
    assert.deepEqual(facts.completedBy, ['reed']);
  }
  delete state.rules['tasks.completion'];
  assert.deepEqual(state, before);
});

test('goal percentage counts distinct displayed goals independently of hiding completed rows', () => {
  const state = { rules: {}, tasks: Array.from({ length: 11 }, (_, id) => ({ id: String(id) })), members: [
    { id: 'a', completedTasks: ['0', '1', '2', '3', '4', '10'], taskStatus: { '0': { challengeCompleted: true } } },
  ] };
  const facts = createTaskFactsIndex(state, 'a', registry), goals = state.tasks.slice(0, 10);
  assert.deepEqual(goalProgress([...goals, goals[0]], facts), { completed: 5, total: 10, percent: 50 });
  assert.deepEqual(goalProgress([], facts), { completed: 0, total: 0, percent: 0 });
  assert.equal(goals.filter(task => !facts.get(task.id).group).length, 5);
});

test('trusted derived rows render before persistence while unrelated task queries still reject', () => {
  const state = { rules: {}, tasks: [], members: [{ id: 'a', completedTasks: [], taskStatus: {} }] };
  const before = structuredClone(state), generated = { id: 'derived:drop', completionIds: ['derived:drop'] };
  const facts = createTaskFactsIndex(state, 'a', registry, { tasks: [generated] });
  assert.equal(facts.get(generated.id).group, false);
  assert.deepEqual(goalProgress([generated], facts), { completed: 0, total: 1, percent: 0 });
  assert.throws(() => facts.get('untrusted', ['untrusted']), /Unknown task/);
  assert.deepEqual(state, before, 'Derived admission must not enlarge the saved catalogue.');
});

test('collection family evidence honors every completion scope without manufacturing exact personal progress', () => {
  const ids = ['drop:current', 'drop:old-rate', 'drop:other-source'];
  const completionIds = Object.freeze([ids[2], ids[0], ids[1], ids[1]]);
  const state = { rules: {}, tasks: ids.slice(1).map(id => ({ id })), members: [
    { id: 'actor1', completedTasks: [ids[1]], taskStatus: {} },
    { id: 'reed', completedTasks: [], taskStatus: { [ids[2]]: { challengeCompleted: true } } },
    { id: 'other', completedTasks: [], taskStatus: {} },
  ] };
  const before = structuredClone(state), generated = { id: ids[0], completionIds };
  for (const mode of ['any', 'all', 'personal']) for (const owner of ['actor1', 'reed', 'other']) {
    state.rules['tasks.completion'] = mode;
    const index = createTaskFactsIndex(state, owner, registry, { tasks: [generated] });
    const facts = index.get(ids[0], completionIds);
    assert.equal(facts.group, mode === 'any' || mode === 'personal' && owner !== 'other');
    assert.equal(facts.personal, false);
    assert.equal(facts.actual, false);
    assert.deepEqual(facts.completedBy, ['actor1', 'reed']);
    assert.strictEqual(index.get(ids[0], [...ids].reverse()), facts, 'Equivalent alias families share the cached facts.');
    assert.equal(index.get(ids[0]).group, false, 'Family satisfaction does not contaminate exact-ID queries.');
    assert.equal(goalProgress([generated, generated], index).completed, facts.group ? 1 : 0);
  }
  state.rules['tasks.completion'] = 'all';
  state.members[2].taskStatus[ids[1]] = { challengeCompleted: true };
  assert.equal(createTaskFactsIndex(state, 'actor1', registry, { tasks: [generated] }).get(ids[0], completionIds).group, true);
  delete state.members[2].taskStatus[ids[1]];
  delete state.rules['tasks.completion'];
  assert.deepEqual(state, before);
});

test('main task-facts cache refreshes when worker results add new derived IDs or alias families', async () => {
  const graph = await readScreenGraph();
  const source = ['buildTaskFactsCache', 'taskFacts'].map(name => screenFunctionSource(graph, name)).join('\n');
  const old = { id: 'drop:old' }, derived = { id: 'drop:new', completionGroup: 'item:drop' };
  const state = { rules: {}, tasks: [old], members: [{ id: 'a', completedTasks: [old.id], taskStatus: {} }] };
  const context = createContext({ createTaskFactsIndex, createTaskIconPainter, skillIcon: () => null, registry, state, memberId: 'a', result: { tasks: [old] }, taskFactsCache: undefined });
  runInContext(source, context);
  assert.equal(context.taskFacts(old).group, true);
  const first = context.taskFactsCache;
  context.result = { tasks: [derived], collectionPlanning: { completionGroups: { [derived.completionGroup]: [derived.id, old.id] } } };
  const facts = context.taskFacts(derived);
  assert.equal(facts.group, true);
  assert.equal(facts.actual, false);
  assert.notStrictEqual(context.taskFactsCache, first);
  assert.strictEqual(context.taskFactsCache.state, state);
  const second = context.taskFactsCache;
  assert.strictEqual(context.taskFacts(derived), facts);
  assert.strictEqual(context.taskFactsCache, second, 'Repeated rows reuse one index for the same state and result.');
  assert.equal(goalProgress([derived], second).percent, 100);
  context.result = { tasks: [{ id: derived.id }] };
  assert.equal(context.taskFacts(context.result.tasks[0]).group, false, 'Replacing a result must not reuse its old family evidence.');
});

test('compact completion-group references preserve family progress without per-row ID arrays', () => {
  const old = { id: 'drop:old' }, current = { id: 'drop:current', completionGroup: 'item:Bones' };
  const alternative = { id: 'drop:alternative', completionGroup: current.completionGroup };
  const state = { rules: {}, tasks: [old], members: [{ id: 'a', completedTasks: [old.id], taskStatus: {} }] };
  const before = structuredClone(state), family = Object.freeze([old.id, current.id, alternative.id]);
  const completionGroups = Object.freeze({ [current.completionGroup]: family });
  const index = createTaskFactsIndex(state, 'a', registry, { tasks: [current, alternative], completionGroups });
  assert.equal(index.get(current.id).group, true);
  assert.equal(index.get(current.id).actual, false);
  assert.equal(index.get(current.id).personal, false);
  assert.deepEqual(index.get(alternative.id).completedBy, ['a']);
  assert.equal(index.get(current.id, [current.id]).group, false, 'Explicit families still take precedence over the compact derived mapping.');
  assert.deepEqual(goalProgress([current, alternative], index), { completed: 2, total: 2, percent: 100 });
  assert.deepEqual(state, before);
  const missing = createTaskFactsIndex(state, 'a', registry, { tasks: [current] });
  assert.throws(() => missing.get(current.id), /Unknown completion group/);
});
