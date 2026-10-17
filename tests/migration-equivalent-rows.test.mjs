import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { legacyTaskId, migrateTaskIdentities, migrateGameplay } from '../app/tasks/migration.mjs';

const id = 'rs3:task:synthetic-equivalent';
const alias = legacyTaskId('Mining', 'Synthetic ore');
const row = { id, label: 'Synthetic ore', category: 'Mining' };
const catalogue = [{ ...row, rawLabel: row.label, aliases: [alias], kind: 'task' }];
function saved() {
  const base = createGroupState([{ id: 'player', name: 'Player' }]);
  base.tasks = [{ ...row, id: alias }, { ...row }];
  return applyCommand(base, { type: 'set-journal', memberId: 'player', note: 'Keep this history' });
}

test('equivalent unreferenced catalogue rows keep History and the latest Undo', () => {
  const before = saved(), original = structuredClone(before);
  const result = migrateTaskIdentities(before, { catalogue });
  assert.deepEqual(before, original);
  assert.deepEqual(result.state.tasks, [row]);
  assert.deepEqual(result.state.history, before.history);
  assert.deepEqual(result.report.conflicts, []);
  const restored = importBackup(exportBackup(result.state));
  assert.equal(applyCommand(restored, { type: 'undo' }).members[0].journal, undefined);
  assert.deepEqual(migrateTaskIdentities(restored, { catalogue }).state, restored);
});

test('new explicit definition and label rows merge without resetting unrelated History', () => {
  const before = saved(); before.tasks = [];
  const definitions = { challenges: { Mining: { 'Synthetic ore': { PickerId: id } } } };
  const result = migrateGameplay(before, { catalogue, definitions });
  assert.deepEqual(result.state.tasks, [row]);
  assert.deepEqual(result.state.history, before.history);
  assert.deepEqual(result.report.identities.conflicts, []);
});

test('different catalogue rows retain the explicit Undo boundary', () => {
  const before = saved(); before.tasks[0].label = 'Different saved objective';
  const result = migrateTaskIdentities(before, { catalogue });
  assert.equal(result.state.history.length, 0);
  assert(result.report.conflicts.some(c => c.reason === 'multiple saved catalogue rows'));
  assert.deepEqual(result.state.provenance.taskIdentityMigration.archives[0].history, before.history);
});

test('equivalent rows with personal facts or History references remain conservative', () => {
  for (const change of [
    state => { state.members[0].completedTasks = [alias]; },
    state => { state.members[0].taskStatus = { [alias]: { favorite: true }, [id]: { favorite: false } }; },
    state => { state.history[0].command.taskId = alias; },
    state => { state.history[0].undo.taskChanges = [{ id, before: { exists: false }, after: { exists: true, value: row, index: 1 } }]; },
  ]) {
    const before = saved(); change(before);
    const result = migrateTaskIdentities(before, { catalogue });
    assert.equal(result.state.history.length, 0);
    assert(result.report.conflicts.some(c => c.reason === 'multiple saved catalogue rows'));
  }
});
