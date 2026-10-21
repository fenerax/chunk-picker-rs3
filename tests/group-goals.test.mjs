import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, validateOwnedState,
  exportBackup, importBackup, previewRestore, getUndoEligibility, taskClaimInvalidatingEvent } from '../app/core/state.mjs';
import { MAX_GROUP_GOALS, groupGoalCommandTypes } from '../app/core/group-goals.mjs';
import { entityId } from '../app/tasks/identity.mjs';
import { projectPlayState } from '../app/play-view.mjs';

const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const options = { now: () => '2026-10-13T12:00:00.000Z' };
const add = { type: 'add-group-goal', goalId: 'group-goal:bank', text: 'Fill the shared bank', completion: 'players' };
const tick = { type: 'set-group-goal-done', goalId: add.goalId, memberId: 'actor1', done: true };
const update = { type: 'update-group-goal', goalId: add.goalId, text: 'Train together', completion: 'group' };

test('compact display retains a linked picker task without pinning it for either player', () => {
  const task = { id: 't:quest', label: 'Dragon Slayer', category: 'Quest' };
  const original = { ...createGroupState(owners), tasks: [task] };
  assert.equal(projectPlayState(original).tasks.length, 0);
  const state = applyCommand(original, { ...add, link: { kind: 'task', id: task.id, label: task.label } }, options);
  assert.deepEqual(projectPlayState(state).tasks, [task]);
  assert.deepEqual(state.members, original.members);
});

test('restore review reports replacing or removing the shared plan', () => {
  const empty = initial(), saved = applyCommand(empty, add, options);
  const removed = previewRestore(saved, exportBackup(empty));
  assert.deepEqual(removed.groupGoals.removed.map(goal => goal.id), [add.goalId]);
  assert.ok(removed.warnings.some(warning => /shared group goals \(1 current, 0 in the backup\)/.test(warning)));
  const changed = applyCommand(saved, update, options);
  assert.equal(previewRestore(saved, changed).groupGoals.changed[0].id, add.goalId);
  assert.ok(previewRestore(saved, changed).warnings.some(warning => warning.includes('shared group goals')));
  assert.equal(previewRestore(saved, saved).warnings.some(warning => warning.includes('shared group goals')), false);
});
function initial() {
  const state = createGroupState(owners);
  state.tasks = [{ id: 'custom:quest', label: 'A custom quest', category: 'quest' }];
  return validateState(state);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

for (const apply of [applyCommand, applyValidatedCommand]) {
  test(`${apply.name} derives players completion and supports one group check without altering account progress`, () => {
    const original = freeze(initial());
    let state = apply(original, add, { ...options, expectedRevision: 0 });
    assert.equal(state.groupGoals[0].done, false);
    state = apply(state, tick, options);
    assert.deepEqual(state.groupGoals[0].completedBy, ['actor1']);
    assert.equal(state.groupGoals[0].done, false);
    state = apply(state, { ...tick, memberId: 'reed' }, options);
    assert.equal(state.groupGoals[0].done, true);
    state = apply(state, { ...tick, done: false }, options);
    assert.deepEqual(state.groupGoals[0].completedBy, ['reed']);
    assert.equal(state.groupGoals[0].done, false);
    state = apply(state, { type: tick.type, goalId: add.goalId, done: true }, options);
    assert.deepEqual(state.groupGoals[0].completedBy, ['actor1', 'reed']);
    state = apply(state, update, options);
    assert.deepEqual(state.groupGoals[0].completedBy, []);
    assert.equal(state.groupGoals[0].done, true);
    state = apply(state, { type: tick.type, goalId: add.goalId, done: false }, options);
    assert.equal(state.groupGoals[0].done, false);
    state = apply(state, { ...update, completion: 'players' }, options);
    assert.deepEqual(state.groupGoals[0].completedBy, []);
    assert.deepEqual(state.members, original.members);
    assert.deepEqual(state.rules, original.rules);
    assert.deepEqual(state.tasks, original.tasks);
    assert.deepEqual(importBackup(exportBackup(state)).groupGoals, state.groupGoals);
    assert.doesNotThrow(() => validateOwnedState(structuredClone(state)));
    for (const type of groupGoalCommandTypes) assert.equal(taskClaimInvalidatingEvent({ type }), false);
  });

  test(`${apply.name} orders by final index, retains link labels and reverses edits/removals`, () => {
    const link = { kind: 'task', id: 'custom:quest', label: 'A custom quest' };
    let state = apply(initial(), { ...add, link }, options);
    state = apply(state, { ...add, goalId: 'group-goal:second', text: 'Second' }, options);
    const itemId = entityId('item', 'Bronze dagger');
    const thirdLink = itemId.startsWith('rs3:entity:') ? { kind: 'item', id: itemId, label: 'Bronze dagger' } : link;
    state = apply(state, { ...add, goalId: 'group-goal:third', text: 'Third', completion: 'group', link: thirdLink }, options);
    const beforeMove = state;
    state = apply(state, { type: 'move-group-goal', goalId: add.goalId, index: 2 }, options);
    assert.deepEqual(state.groupGoals.map(goal => goal.id), ['group-goal:second', 'group-goal:third', add.goalId]);
    assert.deepEqual(apply(state, { type: 'undo' }, options).groupGoals, beforeMove.groupGoals);
    state = apply(state, { ...update, completion: 'players' }, options);
    assert.deepEqual(state.groupGoals[2].link, link);
    const beforeUnlink = state;
    state = apply(state, { ...update, completion: 'players', link: null }, options);
    assert.equal(Object.hasOwn(state.groupGoals[2], 'link'), false);
    state = apply(state, { type: 'undo' }, options);
    assert.deepEqual(state.groupGoals, beforeUnlink.groupGoals);
    state = apply(state, { type: 'delete-task', taskId: link.id }, options);
    assert.deepEqual(state.groupGoals[2].link, link);
    assert.doesNotThrow(() => validateState(state));
    state = apply(state, { ...update, link }, options);
    assert.deepEqual(state.groupGoals[2].link, link);
    const beforeRemove = state;
    state = apply(state, { type: 'remove-group-goal', goalId: add.goalId }, options);
    assert.equal(state.history.at(-1).command.goalText, 'Train together');
    assert.deepEqual(apply(state, { type: 'undo' }, options).groupGoals, beforeRemove.groupGoals);
  });

  test(`${apply.name} guards older shared undo, restores absence and permits independent personal undo`, () => {
    const original = initial();
    let state = apply(original, add, options);
    assert.deepEqual(state.history[0].undo.groupGoalChanges.before, { exists: false });
    const undone = apply(state, { type: 'undo' }, options);
    assert.equal(Object.hasOwn(undone, 'groupGoals'), false);
    assert.doesNotThrow(() => validateState(undone));
    state = apply(state, tick, options);
    assert.equal(getUndoEligibility(state, 1).canUndo, false);
    const personal = apply(state, { type: 'set-journal', memberId: 'reed', note: 'Train later' }, options);
    const later = apply(personal, { ...tick, memberId: 'reed' }, options);
    const restored = apply(later, { type: 'undo', undoRevision: personal.revision }, options);
    assert.equal(restored.members[1].journal, undefined);
    assert.deepEqual(restored.groupGoals, later.groupGoals);
    assert.doesNotThrow(() => validateState(restored));
  });

  test(`${apply.name} rejects malformed commands and exhausted lists atomically`, () => {
    const state = freeze(apply(initial(), add, options)), serialized = JSON.stringify(state);
    const unknownLink = { kind: 'task', id: 'custom:absent', label: 'Absent' };
    const invalid = [
      add, { ...add, goalId: 'group-goal:new', text: ' padded ' },
      { ...add, goalId: 'group-goal:new', text: '' }, { ...add, goalId: 'group-goal:new', text: 'a'.repeat(201) },
      { ...add, goalId: 'group-goal:new', text: 'new\nline' }, { ...add, goalId: 'group-goal:constructor' },
      { ...add, goalId: 'group-goal:new', completion: 'personal' }, { ...update, goalText: 'Spoof' },
      { ...update, text: undefined }, { ...update, link: unknownLink }, { ...update, link: { ...unknownLink, other: true } },
      { ...update, link: { kind: 'item', id: entityId('monster', 'Goblin'), label: 'Goblin' } },
      { ...add, goalId: 'group-goal:new', link: null }, { ...tick, memberId: 'absent' }, { ...tick, done: 'true' },
      { ...tick, goalId: 'group-goal:absent' }, { type: 'move-group-goal', goalId: add.goalId, index: 1 },
      { type: 'move-group-goal', goalId: add.goalId, index: -1 }, { type: 'move-group-goal', goalId: add.goalId, index: 0.5 },
      { type: 'remove-group-goal', goalId: 'group-goal:absent' },
    ];
    for (const command of invalid) assert.throws(() => apply(state, command, options), TypeError, JSON.stringify(command));
    assert.throws(() => apply(state, tick, { ...options, expectedRevision: 0 }), /Revision conflict/);
    const group = apply(state, update, options);
    assert.throws(() => apply(group, tick, options), /no per-player/);
    assert.equal(JSON.stringify(state), serialized);
    const full = initial();
    full.groupGoals = Array.from({ length: MAX_GROUP_GOALS }, (_, index) => ({ id: `group-goal:${index}`, text: `Goal ${index}`, completion: 'group', completedBy: [], done: false }));
    assert.throws(() => apply(full, add, options), /Too many/);
  });
}

test('state validation rejects malformed saved goals and retained inverses including stale after guards', () => {
  const valid = applyCommand(initial(), add, options);
  const mutations = [
    state => { state.groupGoals[0].done = true; },
    state => { state.groupGoals[0].completedBy = ['actor1', 'actor1']; },
    state => { state.groupGoals[0].completedBy = ['absent']; },
    state => { state.groupGoals[0].completion = 'group'; state.groupGoals[0].completedBy = ['actor1']; },
    state => { state.groupGoals[0].unknown = true; },
    state => { state.groupGoals[0].link = { kind: 'item', id: 'custom:item', label: 'Item' }; },
    state => { state.groupGoals.push(structuredClone(state.groupGoals[0])); },
    state => { state.groupGoals = Array(MAX_GROUP_GOALS + 1).fill(state.groupGoals[0]); },
    state => { state.history[0].undo.groupGoalChanges.before = { exists: false, value: [] }; },
    state => { state.history[0].undo.groupGoalChanges.after.value[0].text = 'Stale text'; },
    state => { state.history[0].undo.groupGoalChanges.after.value[0].done = true; },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(valid); mutate(state);
    assert.throws(() => validateState(state), TypeError);
  }
  const empty = initial(); empty.groupGoals = [];
  assert.deepEqual(validateState(empty).groupGoals, []);
});
