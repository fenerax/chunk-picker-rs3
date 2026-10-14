import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { migrateTaskIdentities, migrateGameplay, legacyTaskId, projectMemberTaskFacts } from '../app/tasks/migration.mjs';

const id = 'rs3:task:test-mining-identity';
const oldId = legacyTaskId('Mining', 'Mine coppr ore');
const catalogue = [{ id, label: 'Mine copper ore', rawLabel: 'Mine copper ore', category: 'Mining', kind: 'task', aliases: [oldId] }];
function saved() {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.tasks = [{ id: oldId, label: 'Mine coppr ore', category: 'Mining' }];
  state.members[0].completedTasks = [oldId];
  state.members[0].taskStatus = { [oldId]: { note: 'Keep this original note', favorite: true, backlogged: true, challengeCompleted: true } };
  state.members[0].taskAlternatives = { Mining: { '1': oldId } };
  return state;
}

test('label corrections project every personal task fact and retain exact original evidence', () => {
  const before = saved(), snapshot = structuredClone(before);
  const { state, report } = migrateTaskIdentities(before, { catalogue });
  assert.deepEqual(before, snapshot);
  assert.deepEqual(state.members[0].completedTasks, [id]);
  assert.deepEqual(state.members[0].taskStatus[id], before.members[0].taskStatus[oldId]);
  assert.equal(state.members[0].taskAlternatives.Mining['1'], id);
  assert.deepEqual(state.provenance.taskIdentityMigration.archives[0].members, before.members);
  assert.equal(report.recordsBefore, 3);
  assert.equal(report.recordsPreservedInActiveState, 3);
  assert.equal(report.lostRecords, 0);
  const restored = importBackup(JSON.stringify(exportBackup(state)));
  assert.deepEqual(restored, state);
  assert.deepEqual(migrateTaskIdentities(restored, { catalogue }).state, state);
  const cleared = applyCommand(restored, { type: 'complete-task', memberId: 'actor1', taskId: oldId, completed: false });
  assert.deepEqual(cleared.members[0].completedTasks, []);
  assert.equal(cleared.history.at(-1).command.requestedTaskId, oldId);
  assert.deepEqual(applyCommand(cleared, { type: 'undo' }).members, state.members);
});

test('canonical false fields take precedence and conflicting aliases remain archived', () => {
  const before = saved();
  before.tasks.push({ id, label: 'Mine copper ore', category: 'Mining' });
  before.members[0].taskStatus[id] = { challengeCompleted: false, note: '' };
  const { state, report } = migrateTaskIdentities(before, { catalogue });
  assert.equal(state.members[0].taskStatus[id].challengeCompleted, false);
  assert.equal(state.members[0].taskStatus[id].note, '');
  assert.equal(state.members[0].taskStatus[id].favorite, true);
  assert(report.conflicts.length > 0);
  assert(report.recordsPreservedInArchives > 0);
  assert.equal(report.lostRecords, 0);
  assert.deepEqual(state.provenance.taskIdentityMigration.archives[0].members, before.members);
  assert.deepEqual(migrateTaskIdentities(state, { catalogue }).state, state);
});

test('unresolved facts and orphan registry aliases survive review, migration and portable restore', () => {
  const before = createGroupState([{ id: 'actor1', name: 'Player' }]);
  before.members[0].completedTasks = ['t_missing-check'];
  before.members[0].taskStatus = { 't_missing-note': { note: 'Do not lose me', favorite: true } };
  before.identityRegistry = { schemaVersion: 1, entries: {}, aliases: { 'lost-old-alias': 'rs3:task:missing-target' }, unresolved: [] };
  const { state, report, warnings } = migrateTaskIdentities(before);
  assert.equal(state.identityRegistry.aliases['lost-old-alias'], 'rs3:task:missing-target');
  assert.deepEqual(state.members[0].completedTasks, ['t_missing-check']);
  assert.equal(state.members[0].taskStatus['t_missing-note'].note, 'Do not lose me');
  assert.equal(report.lostRecords, 0);
  assert(report.unresolved.some(row => row.originalId === 'lost-old-alias'));
  assert(warnings.some(warning => warning.includes('t_missing-note')));
  assert.deepEqual(importBackup(exportBackup(state)), state);
});

test('validation resolves portable saved aliases before checking canonical catalogue references', () => {
  const before = saved();
  before.tasks = [{ id, label: 'Mine copper ore', category: 'Mining' }];
  before.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, label: 'Mine copper ore', kind: 'task', category: 'Mining', aliases: [oldId] } }, aliases: { [oldId]: id }, unresolved: [] };
  const state = validateState(before);
  assert.deepEqual(state.members[0].completedTasks, [id]);
  assert.equal(state.members[0].taskStatus[id].note, 'Keep this original note');
  assert.deepEqual(state.provenance.taskIdentityMigration.archives[0].members, before.members);
});

test('direct calculations project saved aliases without changing originals or reviving false overrides', () => {
  const state = saved(), snapshot = structuredClone(state);
  state.members[0].taskStatus[id] = { challengeCompleted: false };
  const projected = projectMemberTaskFacts(state, state.members[0], catalogue);
  assert.deepEqual(projected.completedTasks, [id]);
  assert.equal(projected.taskStatus[id].challengeCompleted, false);
  assert.equal(projected.taskStatus[id].note, snapshot.members[0].taskStatus[oldId].note);
  assert.equal(state.members[0].taskStatus[oldId].challengeCompleted, true);
});

test('unknown false legacy checks are reported and retained without creating personal completion', () => {
  const state = createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'old' }]);
  state.legacy = { maps: { old: { chunkinfo: { completedChallenges: { Quest: { t_unknown_false: false } } } } } };
  const { state: result, report } = migrateGameplay(state);
  assert(report.unresolved.some(row => row.legacyKey === 't_unknown_false'));
  assert.equal(result.legacy.maps.old.chunkinfo.completedChallenges.Quest.t_unknown_false, false);
  assert.deepEqual(result.members[0].completedTasks, []);
});

test('renaming a category preserves its task alternative and canonical Automatic masks old preference', () => {
  const before = saved();
  const renamed = [{ ...catalogue[0], category: 'Gathering', aliases: [oldId, legacyTaskId('Gathering', 'Mine copper ore')] }];
  const moved = migrateTaskIdentities(before, { catalogue: renamed }).state;
  assert.equal(moved.members[0].taskAlternatives.Gathering['1'], id);
  assert.equal(moved.members[0].taskAlternatives.Mining, undefined);
  assert.equal(validateState(moved).tasks[0].category, 'Gathering');
  before.members[0].taskAlternatives.Gathering = { '1': null };
  const masked = migrateTaskIdentities(before, { catalogue: renamed });
  assert.equal(masked.state.members[0].taskAlternatives.Gathering['1'], null);
  assert(masked.report.conflicts.some(conflict => conflict.reason === 'conflicting renamed-category alternatives'));
  assert.deepEqual(masked.state.provenance.taskIdentityMigration.archives[0].members, before.members);
});

test('collision-free category rename rewrites sparse alternative paths and remains undoable after restore', () => {
  const base = createGroupState([{ id: 'actor1', name: 'Player' }]);
  base.tasks = [{ id, label: 'Mine copper ore', category: 'Mining' }];
  const selected = applyCommand(base, { type: 'set-task-alternative', memberId: 'actor1', category: 'Mining', group: '1', taskId: id });
  const automatic = applyCommand(selected, { type: 'set-task-alternative', memberId: 'actor1', category: 'Mining', group: '1', taskId: null });
  const originalHistory = structuredClone(automatic.history);
  const renamed = [{ ...catalogue[0], category: 'Gathering', aliases: [oldId] }];
  const migrated = migrateTaskIdentities(automatic, { catalogue: renamed }).state;
  assert.equal(migrated.members[0].taskAlternatives.Gathering['1'], null);
  assert.equal(migrated.history.length, 2, 'A simple category rename needs no undo boundary');
  for (const event of migrated.history) for (const change of event.undo.memberChanges) for (const patch of change.changes) {
    if (patch.path[0] === 'taskAlternatives' && patch.path.length > 1) assert.equal(patch.path[1], 'Gathering');
  }
  const restored = importBackup(exportBackup(migrated));
  const undoAutomatic = applyCommand(restored, { type: 'undo' });
  assert.equal(undoAutomatic.members[0].taskAlternatives.Gathering['1'], id);
  const undoSelection = applyCommand(undoAutomatic, { type: 'undo' });
  assert.equal(undoSelection.members[0].taskAlternatives, undefined);
  assert.deepEqual(migrated.provenance.taskIdentityMigration.archives[0].history, originalHistory);
});

test('alias projection preserves structural validation for malformed and unsafe member records', () => {
  const base = saved();
  base.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, kind: 'task', label: 'Mine copper ore', category: 'Mining', aliases: [oldId] } }, aliases: { [oldId]: id }, unresolved: [] };
  for (const corrupt of [
    state => { state.members[0].completedTasks = oldId; },
    state => { state.members[0].completedTasks = [oldId, oldId]; },
    state => { state.members[0].taskStatus = JSON.parse('{"__proto__":{"note":"Unsafe"}}'); },
    state => { state.members[0].taskStatus[oldId] = null; },
    state => { state.members[0].taskAlternatives = { Mining: false }; },
  ]) {
    const state = structuredClone(base); corrupt(state);
    const original = structuredClone(state);
    assert.throws(() => validateState(state), TypeError);
    assert.deepEqual(state, original);
  }
});
