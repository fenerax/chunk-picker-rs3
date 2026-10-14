import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { normalizeSandboxRequest, applySandboxChanges, sandboxDelta, compactSandboxPrediction } from '../app/sandbox.mjs';

const chunkIds = Array.from({ length: 42 }, (_, index) => String(12341 + index));
const world = buildWorld({ chunks: Object.fromEntries(chunkIds.map(id => [id, {}])), walkableChunks: chunkIds, walkableChunksF2P: chunkIds });
function fixture() {
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'], selected: ['12342'],
    pendingRoll: ['12343', '12344'], blacklisted: ['12345'] }, { id: 'two', name: 'Two', unlocked: ['12346'] }]);
  state.tasks = [{ id: 'custom:saved', label: 'Saved', category: 'Quest' }];
  state.members[0].taskStatus = { 'custom:saved': { challengeCompleted: true, note: 'Keep' } };
  return { state, body: { memberId: 'one', baseRevision: 0, changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } } };
}


test('omitted change arrays normalize to empty while explicit invalid values are rejected', () => {
  const { state, body } = fixture();
  assert.deepEqual(normalizeSandboxRequest({ ...body, changes: { unlockChunks: ['12342'] } }, { state, world }).changes,
    { unlockChunks: ['12342'], lockChunks: [], doneTasks: [] });
  for (const field of ['unlockChunks', 'lockChunks', 'doneTasks']) assert.throws(() =>
    normalizeSandboxRequest({ ...body, changes: { [field]: null } }, { state, world }));
});

test('sandbox strictly bounds chunks, completion checks, rules, revisions and unsupported fields', () => {
  const { state, body } = fixture();
  const invalid = [
    { ...body, memberId: 'absent' }, { ...body, baseRevision: -1 }, { ...body, baseRevision: 0.1 },
    { ...body, state }, { ...body, previewChunkId: '12341-0' },
    ...[
      { unlockChunks: chunkIds.slice(0, 41) }, { unlockChunks: chunkIds.slice(0, 40), lockChunks: [chunkIds[40]] },
      { unlockChunks: ['12342', '12342'] }, { unlockChunks: ['12342'], lockChunks: ['12342'] },
      { unlockChunks: [12342] }, { unlockChunks: ['0'] }, { unlockChunks: ['12341-0'] },
      { lockChunks: ['99999'] }, { doneTasks: ['unknown'] }, { doneTasks: Array(501).fill('custom:saved') },
      { taskRules: { 'Show Quest Tasks': 'false' } }, { taskRules: { 'Rare Drop Amount': 'nonsense' } },
      { taskRules: { Unknown: true } }, { taskRules: JSON.parse('{"__proto__":true}') },
      { taskRules: { 'Kill X Amount': [] } }, { completedTasks: ['custom:saved'] },
    ].map(changes => ({ ...body, changes: { ...body.changes, ...changes } })),
  ];
  for (const candidate of invalid) assert.throws(() => normalizeSandboxRequest(candidate, { state, world }), undefined, JSON.stringify(candidate));
  assert.throws(() => normalizeSandboxRequest({ ...body, changes: { ...body.changes, get taskRules() { return {}; } } }, { state, world }));
});

test('sandbox edits affect only the target and never actual completion, history or its input', () => {
  const { state } = fixture(), before = structuredClone(state);
  const catalogue = [{ id: 'custom:dynamic', label: 'Dynamic', category: 'Quest' }];
  const hypothetical = applySandboxChanges(state, 'one', { unlockChunks: ['12343', '12345'], lockChunks: ['12341'],
    doneTasks: ['custom:dynamic'], taskRules: { 'Show Skill Tasks': false } }, catalogue);
  assert.deepEqual(state, before);
  assert.equal(hypothetical.revision, state.revision);
  assert.equal(hypothetical.history, state.history);
  assert.equal(hypothetical.members[1], state.members[1]);
  const member = hypothetical.members[0];
  assert.deepEqual(member.unlocked, ['12343', '12345']);
  assert.deepEqual(member.selected, ['12342', '12344']);
  assert.deepEqual(member.pendingRoll, []);
  assert.deepEqual(member.blacklisted, []);
  assert.deepEqual(member.completedTasks, []);
  assert.equal(member.questProgress, state.members[0].questProgress);
  assert.equal(member.taskStatus['custom:dynamic'].challengeCompleted, true);
  assert.deepEqual(member.taskStatus['custom:saved'], before.members[0].taskStatus['custom:saved']);
  assert.deepEqual(hypothetical.tasks.at(-1), { id: 'custom:dynamic', label: 'Dynamic', category: 'Quest' });
  const reset = applySandboxChanges(state, 'one', { unlockChunks: [], lockChunks: [], doneTasks: [] });
  assert.deepEqual(reset, state, 'Removing hypothetical checks returns to saved checks');
});

test('sandbox delta counts presented active goals and projects tasks/items without source graphs', () => {
  const task = id => ({ id, label: id, category: 'Quest', status: 'available', sources: ['private evidence'], record: { Output: 'large graph' } });
  const a = task('a'), b = task('b'), hidden = task('other-method');
  const before = { tasks: [a, hidden], presentation: { tasks: [a] }, items: [{ name: 'Old', sources: ['graph'] }], access: { areas: ['Old area'] } };
  const after = { tasks: [b, hidden], presentation: { tasks: [b] }, items: [{ name: 'New', sources: ['graph'] }], access: { areas: ['New area'] } };
  const delta = sandboxDelta(before, after);
  assert.deepEqual(delta.tasksAdded.map(row => row.id), ['b']);
  assert.deepEqual(delta.tasksRemoved.map(row => row.id), ['a']);
  assert.equal(Object.hasOwn(delta.tasksAdded[0], 'sources'), false);
  assert.deepEqual(delta.itemsAdded, [{ name: 'New' }]);
  assert.deepEqual(delta.areasAdded, ['New area']);
  const projected = compactSandboxPrediction({ delta: { tasksAdded: [b], itemsAdded: after.items, areasAdded: ['New area'] }, result: { metrics: { availableCount: 1 }, coverage: {} } });
  assert.equal(projected.delta.tasksAdded[0].id, 'b');
  assert.deepEqual(projected.delta.itemsAdded, [{ name: 'New' }]);
});

test('sandbox challenge deltas follow the displayed any/all/personal completion facts without inferring game completion', () => {
  const registry = createRuleRegistry();
  for (const mode of ['any', 'all', 'personal']) {
    const { state } = fixture();
    state.rules['tasks.completion'] = mode;
    state.members[0].taskStatus = {};
    const task = { ...state.tasks[0], status: 'available', challengeSatisfied: false, personalCompleted: false };
    const result = { tasks: [task], presentation: { tasks: [task] }, access: {}, items: [] };
    const afterState = applySandboxChanges(state, 'one', { unlockChunks: [], lockChunks: [], doneTasks: [task.id] });
    const delta = sandboxDelta(result, result, { beforeState: state, afterState, memberId: 'one', registry });
    assert.equal(delta.tasksRemoved.length, mode === 'all' ? 0 : 1, mode);
    assert.equal(delta.tasksAdded.length, 0);
    assert.deepEqual(afterState.members[0].completedTasks, []);
    afterState.members[1] = { ...afterState.members[1], taskStatus: { [task.id]: { challengeCompleted: true } } };
    assert.equal(sandboxDelta(result, result, { beforeState: state, afterState, memberId: 'one', registry }).tasksRemoved.length, 1);
    assert.equal(sandboxDelta(result, result, { beforeState: afterState, afterState, memberId: 'one', registry }).tasksAdded.length, 0);
  }
});

test('sandbox delta excludes a newly reachable collection goal whose completion family is already satisfied', () => {
  const { state } = fixture();
  const task = { id: 'custom:new-tier', label: 'New tier', category: 'Diary', status: 'available',
    completionGroup: 'tiers', completionIds: ['custom:new-tier', 'custom:saved'] };
  const before = { tasks: [], presentation: { tasks: [] }, access: {}, items: [] };
  const after = { tasks: [task], presentation: { tasks: [task] }, collectionPlanning: { completionGroups: { tiers: task.completionIds } }, access: {}, items: [] };
  const delta = sandboxDelta(before, after, { beforeState: state, afterState: state, memberId: 'one', registry: createRuleRegistry() });
  assert.deepEqual(delta.tasksAdded, []);
});

test('sandbox custom challenge deltas match sidebar goals outside the engine catalogue and exclude backlogs', () => {
  const { state } = fixture();
  state.members[0].taskStatus = {};
  const result = { tasks: [], presentation: { tasks: [] }, access: {}, items: [] };
  const registry = createRuleRegistry();
  const afterState = applySandboxChanges(state, 'one', { unlockChunks: [], lockChunks: [], doneTasks: ['custom:saved'] });
  assert.deepEqual(sandboxDelta(result, result, { beforeState: state, afterState, memberId: 'one', registry })
    .tasksRemoved.map(row => row.id), ['custom:saved']);
  state.members[0].taskStatus['custom:saved'] = { backlogged: true };
  assert.deepEqual(sandboxDelta(result, result, { beforeState: state, afterState, memberId: 'one', registry }).tasksRemoved, []);
});
