import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, getUndoEligibility, exportBackup, importBackup } from '../app/core/state.mjs';
import { migrateTaskIdentities } from '../app/tasks/migration.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { playerControlSkills } from '../app/core/player-controls.mjs';
const alternateSkill = playerControlSkills.includes('Firemaking') ? 'Firemaking' : playerControlSkills.find(skill => skill !== 'Woodcutting');

const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const options = { now: () => '2026-10-12T12:00:00.000Z' };
const task = { id: 'custom:logs', label: 'Gather acadia logs', category: 'Woodcutting', skill: 'Woodcutting', level: 50, memberIds: ['actor1'] };
const editable = ({ id, category, completionIds, ...fields }) => fields;
const add = (apply = applyCommand) => apply(createGroupState(owners), { type: 'add-task', task }, options);

test('custom task fields survive saved-state validation, backups, and identity migration', () => {
  const state = add();
  assert.deepEqual(validateState(state).tasks[0], task);
  assert.deepEqual(importBackup(exportBackup(state)).tasks[0], task);
  const migrated = migrateTaskIdentities(state).state;
  assert.deepEqual(migrated.tasks.find(row => row.id === task.id), task);
  const legacy = createGroupState(owners);
  legacy.tasks = [{ id: 'custom:old', label: 'Legacy task', category: 'Custom' }];
  const restored = importBackup(exportBackup(legacy));
  assert.equal(restored.tasks[0].memberIds, undefined);
  assert.equal(restored.tasks[0].skill, undefined);
  assert.equal(restored.tasks[0].level, undefined);
  assert.deepEqual(migrateTaskIdentities(restored).state.tasks[0], legacy.tasks[0]);
});

test('editing a legacy task preserves its existing free-text category', () => {
  for (const apply of [applyCommand, applyValidatedCommand]) {
    const state = createGroupState(owners);
    state.tasks = [{ id: 'custom:old-category', label: 'Gather supplies', category: 'Supplies' }];
    const edited = apply(state, { type: 'update-task', taskId: 'custom:old-category', task: { label: 'Gather more supplies', memberIds: ['reed'] } }, options);
    assert.equal(edited.tasks[0].category, 'Supplies');
    assert.deepEqual(apply(edited, { type: 'undo' }, options).tasks, state.tasks);
  }
});

test('catalogue preparation discards ordinary calculated levels while preserving custom declarations', () => {
  const state = add();
  state.tasks.push({ id: 'fixture:mining', label: 'Mine copper ore', category: 'Mining', level: 1, completionIds: ['fixture:mining'] });
  const migrated = migrateTaskIdentities(state).state;
  assert.equal(migrated.tasks.find(row => row.id === 'fixture:mining').level, undefined);
  assert.equal(migrated.tasks.find(row => row.id === 'fixture:mining').completionIds, undefined);
  assert.deepEqual(migrated.tasks.find(row => row.id === task.id), task);
  assert.doesNotThrow(() => validateState(migrated));
});

for (const apply of [applyCommand, applyValidatedCommand]) {
  test(`${apply.name} edits a custom row in place, preserves statuses and restores its previous fields`, () => {
    let state = add(apply);
    state = apply(state, { type: 'set-task-status', memberId: 'actor1', taskId: task.id, favorite: true, note: 'Supply Reed', challengeCompleted: true }, options);
    const before = state;
    const changed = apply(state, { type: 'update-task', taskId: task.id, task: { label: 'Gather more logs', skill: alternateSkill, level: 60, memberIds: ['reed'] } }, options);
    assert.equal(changed.tasks[0].id, task.id);
    assert.equal(changed.tasks[0].category, alternateSkill);
    assert.deepEqual(changed.members, before.members);
    assert.deepEqual(changed.history.at(-1).undo.taskChanges[0].before.value, task);
    assert.equal(describeHistoryEvent(changed.history.at(-1)), 'Edited custom task “Gather more logs”');
    assert.deepEqual(apply(changed, { type: 'undo' }, options).tasks, before.tasks);
    assert.deepEqual(validateState(changed).tasks, changed.tasks);
    const defaulted = apply(changed, { type: 'update-task', taskId: task.id, task: { label: 'Share logs' } }, options);
    assert.deepEqual(defaulted.tasks[0], { id: task.id, label: 'Share logs', category: 'Custom' });
    assert.deepEqual(defaulted.members, before.members);
  });

  test(`${apply.name} deletes all custom-task references and Undo restores the complete row and facts`, () => {
    const state = createGroupState(owners);
    state.tasks = [{ id: 'custom:first', label: 'First', category: 'Custom' }, task, { id: 'custom:last', label: 'Last', category: 'Custom' }];
    state.members[0].completedTasks = [task.id];
    state.members[0].taskStatus = { [task.id]: { favorite: true, note: 'Keep this note', challengeCompleted: true } };
    state.members[1].taskStatus = { [task.id]: { backlogged: true, backlogReason: 'After dinner' } };
    state.members[1].taskAlternatives = { Woodcutting: { logs: task.id } };
    state.taskClaims = {};
    const before = validateState(state);
    const changed = apply(before, { type: 'delete-task', taskId: task.id }, options);
    assert.deepEqual(changed.tasks.map(row => row.id), ['custom:first', 'custom:last']);
    for (const member of changed.members) {
      assert.ok(!member.completedTasks.includes(task.id));
      assert.equal(member.taskStatus?.[task.id], undefined);
    }
    assert.equal(changed.members[1].taskAlternatives.Woodcutting?.logs, undefined);
    assert.equal(changed.taskClaims[task.id], undefined);
    assert.equal(describeHistoryEvent(changed.history.at(-1)), 'Deleted custom task “Gather acadia logs”');
    assert.equal(getUndoEligibility(changed).canUndo, true);
    const undone = apply(changed, { type: 'undo' }, options);
    assert.deepEqual(undone.tasks, before.tasks);
    assert.deepEqual(undone.members, before.members);
    assert.deepEqual(undone.taskClaims, before.taskClaims);
    assert.deepEqual(validateState(undone).tasks, before.tasks);
  });

  test(`${apply.name} rejects invalid task fields, built-in mutations and stale revisions atomically`, () => {
    const state = add(apply), snapshot = JSON.stringify(state);
    const invalid = [
      { ...editable(task), label: '' }, { ...editable(task), skill: 'Unknown' },
      { label: 'No skill', level: 40 }, { ...editable(task), level: 0 },
      { ...editable(task), level: 121 }, { ...editable(task), level: 1.5 },
      { ...editable(task), level: '50' }, { ...editable(task), memberIds: [] },
      { ...editable(task), memberIds: ['missing'] }, { ...editable(task), memberIds: ['actor1', 'actor1'] },
      { ...editable(task), memberIds: 'reed' }, { ...editable(task), id: 'custom:new' },
      { ...editable(task), category: 'Mining' },
    ];
    for (const fields of invalid) assert.throws(() => apply(state, { type: 'update-task', taskId: task.id, task: fields }, options), TypeError);
    for (const fields of invalid.filter(fields => !fields.id && !fields.category)) {
      assert.throws(() => apply(state, { type: 'add-task', task: { id: 'custom:bad', category: fields.skill ?? 'Custom', ...fields } }, options), TypeError);
    }
    for (const type of ['update-task', 'delete-task']) {
      const command = { type, taskId: 'rs3:task:builtin', ...(type === 'update-task' ? { task: { label: 'Replace' } } : {}) };
      assert.throws(() => apply(state, command, options), /Only custom/);
      assert.throws(() => apply(state, { ...command, taskId: 'custom:missing' }, options), /Unknown custom/);
      assert.throws(() => apply(state, { ...command, taskId: task.id }, { ...options, expectedRevision: 0 }), /Revision conflict/);
    }
    assert.equal(JSON.stringify(state), snapshot);
  });
}

test('assignment and skill declarations validate in saved rows and historical undo rows', () => {
  for (const fields of [{ memberIds: ['missing'] }, { category: 'Mining' }, { skill: undefined, level: 20 }]) {
    const saved = add(); saved.tasks[0] = { ...saved.tasks[0], ...fields };
    if (saved.tasks[0].skill === undefined) delete saved.tasks[0].skill;
    assert.throws(() => validateState(saved), TypeError);
  }
  const edited = applyValidatedCommand(add(), { type: 'update-task', taskId: task.id, task: { label: 'Updated', skill: 'Woodcutting', level: 60 } }, options);
  const malformed = structuredClone(edited);
  malformed.history.at(-1).undo.taskChanges[0].before.value.memberIds = ['missing'];
  assert.throws(() => validateState(malformed), /absent member/);
  assert.equal(getUndoEligibility(malformed).canUndo, false);
});

test('task status and completion History retain labels after deleting the saved task', () => {
  const names = { memberName: id => ({ actor1: 'Player', reed: 'Reed' })[id] };
  let state = add();
  state = applyCommand(state, { type: 'set-task-status', memberId: 'actor1', taskId: task.id, favorite: true }, options);
  state = applyCommand(state, { type: 'complete-task', memberId: 'reed', taskId: task.id, completed: true }, options);
  state = applyCommand(state, { type: 'delete-task', taskId: task.id }, options);
  assert.equal(describeHistoryEvent(state.history[1], names), 'Pinned “Gather acadia logs” for Player');
  assert.equal(describeHistoryEvent(state.history[2], names), 'Marked “Gather acadia logs” as done in-game for Reed');
});

test('identity migration preserves edited fields and editable command shape across restart', () => {
  let state = migrateTaskIdentities(add()).state;
  state = applyCommand(state, { type: 'update-task', taskId: task.id, task: { label: 'New task name', skill: alternateSkill, level: 60, memberIds: ['reed'] } }, options);
  const migrated = migrateTaskIdentities(state).state;
  assert.deepEqual(migrated.tasks.find(row => row.id === task.id), state.tasks[0]);
  assert.deepEqual(migrated.history.at(-1).command.task, state.history.at(-1).command.task);
  assert.deepEqual(validateState(migrated).tasks, state.tasks);
});

test('deleting an unfinished task removes its claim, Undo restores it, and assignments constrain new claims', () => {
  let state = add(applyValidatedCommand);
  assert.throws(() => applyValidatedCommand(state, { type: 'claim-task', memberId: 'reed', taskId: task.id }, options), /assigned/);
  state = applyValidatedCommand(state, { type: 'claim-task', memberId: 'actor1', taskId: task.id }, options);
  const before = state;
  const deleted = applyValidatedCommand(state, { type: 'delete-task', taskId: task.id }, options);
  assert.equal(deleted.taskClaims[task.id], undefined);
  assert.deepEqual(applyValidatedCommand(deleted, { type: 'undo' }, options).taskClaims, before.taskClaims);
  const reassigned = applyValidatedCommand(before, { type: 'update-task', taskId: task.id, task: { ...editable(task), memberIds: ['reed'] } }, options);
  assert.equal(reassigned.taskClaims[task.id], undefined);
  assert.deepEqual(applyValidatedCommand(reassigned, { type: 'undo' }, options).taskClaims, before.taskClaims);
});

test('permanent custom IDs preserve their declarations through edit migration and cannot be claimed after delete', () => {
  const permanent = { ...task, id: 'rs3:task:custom:12345678' };
  let state = applyCommand(createGroupState(owners), { type: 'add-task', task: permanent }, options);
  state = migrateTaskIdentities(state).state;
  const updated = applyCommand(state, { type: 'update-task', taskId: permanent.id, task: { label: 'Burn logs', skill: alternateSkill, level: 60, memberIds: ['reed'] } }, options);
  const migrated = migrateTaskIdentities(updated).state;
  assert.deepEqual(validateState(migrated).tasks, updated.tasks);
  assert.deepEqual(applyCommand(migrated, { type: 'undo' }, options).tasks, state.tasks);
  const deleted = applyCommand(updated, { type: 'delete-task', taskId: permanent.id }, options);
  assert.throws(() => applyCommand(deleted, { type: 'claim-task', taskId: permanent.id, memberId: 'reed' }, options), /Unknown task/);
});

test('changing skill clears an old-category alternative and validates both sides of its history', () => {
  for (const apply of [applyCommand, applyValidatedCommand]) {
    let state = add(apply);
    state = apply(state, { type: 'set-task-alternative', memberId: 'actor1', category: 'Woodcutting', group: 'logs', taskId: task.id }, options);
    const before = state;
    state = apply(state, { type: 'update-task', taskId: task.id, task: { label: 'Burn logs', skill: alternateSkill, level: 60 } }, options);
    assert.equal(state.members[0].taskAlternatives.Woodcutting?.logs, undefined);
    assert.deepEqual(validateState(state).tasks, state.tasks);
    assert.deepEqual(validateState(migrateTaskIdentities(state).state).tasks, state.tasks);
    const undone = apply(state, { type: 'undo' }, options);
    assert.deepEqual(undone.members, before.members);
    assert.deepEqual(validateState(undone).tasks, before.tasks);
  }
});

test('custom completion policies use assigned owners, ignore preserved unassigned checks, and default legacy rows to Both', () => {
  const registry = createRuleRegistry();
  for (const mode of ['any', 'all', 'personal']) {
    const state = add();
    state.rules['tasks.completion'] = mode;
    state.members[1].completedTasks = [task.id];
    let facts = createTaskFactsIndex(state, 'actor1', registry).get(task.id);
    assert.equal(facts.group, false, mode);
    assert.deepEqual(facts.completedBy, []);
    assert.deepEqual(facts.requiredBy, ['actor1']);
    assert.equal(createTaskFactsIndex(state, 'reed', registry).get(task.id).actual, false);
    state.members[0].taskStatus = { [task.id]: { challengeCompleted: true } };
    facts = createTaskFactsIndex(state, 'actor1', registry).get(task.id);
    assert.equal(facts.group, true, mode);
    assert.deepEqual(facts.completedBy, ['actor1']);
    state.tasks[0] = { ...state.tasks[0], memberIds: ['reed'] };
    state.members[1].completedTasks = [];
    facts = createTaskFactsIndex(state, 'reed', registry).get(task.id);
    assert.equal(facts.group, false, mode);
    assert.deepEqual(facts.completedBy, []);
    state.tasks[0] = { id: task.id, label: task.label, category: 'Custom' };
    facts = createTaskFactsIndex(state, 'reed', registry).get(task.id);
    assert.equal(facts.group, mode === 'any');
    assert.deepEqual(facts.requiredBy, mode === 'personal' ? ['reed'] : ['actor1', 'reed']);
  }
});

test('saved Both assignment overrides a preceding derived single-player assignment', () => {
  const state = add(); state.rules['tasks.completion'] = 'all';
  const old = state.tasks[0];
  state.tasks[0] = { id: old.id, label: old.label, category: old.category, skill: old.skill, level: old.level };
  state.members[0].taskStatus = { [old.id]: { challengeCompleted: true } };
  const facts = createTaskFactsIndex(state, 'actor1', createRuleRegistry(), { tasks: [old] }).get(old.id);
  assert.deepEqual(facts.requiredBy, ['actor1', 'reed']); assert.equal(facts.group, false);
});

test('all completion policy clears custom dibs when its sole assigned owner completes the task', () => {
  let state = add(applyValidatedCommand);
  state.rules['tasks.completion'] = 'all';
  state = applyValidatedCommand(state, { type: 'claim-task', taskId: task.id, memberId: 'actor1' }, options);
  state = applyValidatedCommand(state, { type: 'set-task-status', taskId: task.id, memberId: 'actor1', challengeCompleted: true }, options);
  assert.equal(state.taskClaims[task.id], undefined);
  assert.equal(state.members[1].taskStatus?.[task.id], undefined);
});
