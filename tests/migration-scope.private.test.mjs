import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, validateState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { migrateGameplay, migrateOwnedGameplay, migrateTaskIdentities } from '../app/tasks/migration.mjs';
import { legacyTaskId, permanentTaskId, lookupPermanentId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';

const state = () => createGroupState([{ id: 'synthetic-owner', name: 'Synthetic owner' }]);

test('owned storage migration preserves the pure migration result without a second state clone', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", category = 'Quest';
  const old = legacyTaskId(category, raw), id = permanentTaskId(category, raw);
  const before = state();
  before.tasks = [{ id: old, label: 'Authored saved label', category }];
  before.members[0].taskStatus = { [old]: { backlogged: false, note: 'Synthetic retained evidence' } };
  const original = structuredClone(before), options = { catalogue: [lookupPermanentId(id)] };
  const pure = migrateGameplay(before, options);
  assert.deepEqual(before, original);
  const owned = structuredClone(before), result = migrateOwnedGameplay(owned, options);
  assert.equal(result.state, owned);
  assert.deepEqual(result, pure);
  assert.deepEqual(result.state.provenance.taskIdentityMigration.archives[0].members, original.members);
});

test('an unmaterialized dynamic competitor prevents skipping an ordinary canonical row', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", category = 'Quest';
  const old = legacyTaskId(category, raw), id = permanentTaskId(category, raw);
  const canonical = lookupPermanentId(id), competingId = 'rs3:task:synthetic-competitor';
  const before = state();
  before.tasks = [{ id: old, label: 'Saved quest label', category }];
  before.members[0].taskStatus = { [old]: { favorite: true, note: 'Preserve ambiguous evidence' } };
  const result = migrateGameplay(before, { catalogue: [canonical], dynamicCatalogue: [{
    id: competingId, label: 'Synthetic competing objective', category,
    rawLabel: 'Synthetic competing objective', aliases: [old],
  }] });
  assert.ok(result.state.tasks.some(row => row.id === id), 'Current ordinary row must remain available');
  assert.deepEqual(result.state.members[0].taskStatus[old], before.members[0].taskStatus[old]);
  assert.ok(result.report.identities.unresolved.some(row => row.originalId === old && row.reason === 'ambiguous'));
  const restored = importBackup(exportBackup(result.state));
  assert.deepEqual(restored.members[0].taskStatus[old], before.members[0].taskStatus[old]);
  assert.ok(restored.identityRegistry.entries[competingId], 'Unsaved competing decoder must survive portable restore');
});

test('valid sparse task-label history keeps distinct values through identity migration', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", category = 'Quest';
  const old = legacyTaskId(category, raw), id = permanentTaskId(category, raw);
  const before = state(), row = label => ({ id: old, label, category });
  before.tasks = [row('Authored after label')];
  before.revision = 1;
  before.history = [{ id: 'revision-1', revision: 1, type: 'synthetic-label-edit', at: '2026-01-01T00:00:00.000Z',
    undo: { taskChanges: [{ id: old, before: { exists: true, index: 0, value: row('Authored before label') },
      after: { exists: true, index: 0, value: row('Authored after label') } }] } }];
  assert.doesNotThrow(() => validateState(before));
  const migrated = migrateGameplay(before, { catalogue: [lookupPermanentId(id)] }).state;
  assert.equal(migrated.history.length, 1, 'Collision-free label history needs no undo boundary');
  assert.equal(migrated.history[0].undo.taskChanges[0].before.value.label, 'Authored before label');
  assert.equal(migrated.history[0].undo.taskChanges[0].after.value.label, 'Authored after label');
  const restored = applyCommand(validateState(migrated), { type: 'undo' });
  assert.deepEqual(restored.tasks[0], { id, label: 'Authored before label', category });
});

test('historical semantic aliases retain the current generated catalogue metadata', () => {
  const definitions = rate => ({ challenges: {}, drops: { Cow: { Bones: { '1': rate } } }, chunks: {} });
  const old = createCollectionEngine(definitions('1/10')).catalogue.find(row => row.objectiveKind === 'every-drop');
  const currentCatalogue = createCollectionEngine(definitions('1/20')).catalogue;
  const current = currentCatalogue.find(row => row.id === old.id), before = state();
  before.tasks = [{ id: old.aliases[0], label: old.label, category: old.category }];
  before.members[0].taskStatus = { [old.aliases[0]]: { challengeCompleted: true } };
  const migrated = migrateTaskIdentities(before, { catalogue: currentCatalogue }).state;
  assert.equal(migrated.members[0].taskStatus[current.id].challengeCompleted, true);
  assert.equal(migrated.identityRegistry.entries[current.id].rawLabel, current.rawLabel);
  assert.equal(migrated.identityRegistry.entries[current.id].label, current.label);
  assert.equal(migrated.identityRegistry.entries[current.id].sourceId, current.sourceId);
});

