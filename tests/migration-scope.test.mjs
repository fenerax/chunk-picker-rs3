import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, validateState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { migrateGameplay, migrateOwnedGameplay, migrateTaskIdentities } from '../app/tasks/migration.mjs';
import { legacyTaskId, permanentTaskId, lookupPermanentId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';

const state = () => createGroupState([{ id: 'synthetic-owner', name: 'Synthetic owner' }]);





test('implicit legacy references preserve NFC matching and categories named task', () => {
  for (const [category, rawLabel, suffix] of [
    ['Synthetic cafe\u0301', 'Cafe\u0301 / subject', 'nfc'],
    ['task', 'Synthetic task-category subject', 'task-category'],
  ]) {
    const old = legacyTaskId(category, rawLabel), id = `rs3:task:synthetic-reference:${suffix}`;
    const before = state();
    before.members[0].taskStatus = { [old]: { favorite: true } };
    const catalogue = [{ id, category, rawLabel, label: 'Current synthetic label', aliases: [] }];
    const migrated = migrateTaskIdentities(before, { catalogue }).state;
    assert.deepEqual(migrated.members[0].taskStatus[id], { favorite: true });
    assert.equal(migrated.identityRegistry.entries[id].rawLabel, rawLabel);
  }
});

test('noncanonical URI escapes do not manufacture a competing implicit catalogue alias', () => {
  const category = 'Synthetic percent category', rawLabel = 'Cafe';
  const canonical = legacyTaskId(category, rawLabel), old = canonical.replace(':Cafe', ':%43afe');
  const id = 'rs3:task:synthetic-percent-authority', competitor = 'rs3:task:synthetic-percent-competitor';
  const before = state();
  before.tasks = [{ id: old, label: 'Saved authored label', category }];
  before.identityRegistry = { schemaVersion: 1, entries: {
    [id]: { id, kind: 'task', label: 'Registered authority', category, aliases: [] },
  }, aliases: { [old]: id }, unresolved: [] };
  before.revision = 1;
  before.history = [{ id: 'revision-1', revision: 1, type: 'synthetic-history-marker', at: '2026-01-01T00:00:00.000Z' }];
  const migrated = migrateGameplay(before, {
    catalogue: [{ id, label: 'Current authored label', category, rawLabel: 'Registered authority', aliases: [] }],
    dynamicCatalogue: [{ id: competitor, label: 'Implicit competing label', category, rawLabel, aliases: [] }],
  }).state;
  assert.equal(migrated.history.length, 1, 'Noncanonical spelling must not create an artificial collision boundary');
  assert.deepEqual(migrated.tasks, [{ id, label: 'Saved authored label', category }]);
});

test('unreferenced dynamic rows still reject displays emptied by encoding or markup', () => {
  for (const label of ['%20', '-_-3cb-_-3e-_-3c-_-2fb-_-3e', '<b></b>', '~|#target|~', '***']) {
    const row = { id: 'rs3:task:synthetic-invalid-display', label, category: 'Extra', rawLabel: 'Synthetic raw', aliases: [] };
    assert.throws(() => migrateGameplay(state(), { dynamicCatalogue: [row] }), /nonempty display labels/);
  }
});

test('dynamic duplicate comparison normalizes categories and displays while preserving exact raw labels', () => {
  const id = 'rs3:task:synthetic-normalized-duplicate', category = 'Synthetic cafe\u0301';
  const rows = [
    { id, label: 'Cafe\u0301', category, rawLabel: 'Synthetic raw', aliases: ['Synthetic alias'] },
    { id, label: 'Caf\u00e9', category: category.normalize('NFC'), rawLabel: 'Synthetic raw', aliases: ['Synthetic alias'] },
  ];
  const original = structuredClone(rows), before = state();
  before.members[0].completedTasks = [id];
  const migrated = migrateGameplay(before, { dynamicCatalogue: rows }).state;
  assert.deepEqual(rows, original, 'Lazy projection must not change input categories, labels or aliases');
  assert.deepEqual(migrated.tasks, [{ id, label: 'Caf\u00e9', category: category.normalize('NFC') }]);
  assert.throws(() => migrateGameplay(state(), { dynamicCatalogue: [rows[0], { ...rows[1], aliases: ['Different alias'] }] }), /Ambiguous dynamicCatalogue/);
  assert.throws(() => migrateGameplay(state(), { dynamicCatalogue: [rows[0], { ...rows[1], rawLabel: 'Different raw label' }] }), /Ambiguous dynamicCatalogue/);
});

test('referenced old-code chains retain catalogue metadata and every competing alias target', () => {
  const rawLabel = 'Synthetic chained catalogue subject', category = 'Synthetic chain';
  const seed = 't_synthetic_chain_seed', final = 't_synthetic_chain_final';
  for (const count of [1, 2]) {
    const before = state();
    before.members[0].taskStatus = { [final]: { favorite: true, note: 'Synthetic chained evidence' } };
    const original = structuredClone(before);
    const catalogue = Array.from({ length: count }, (_, i) => ({
      id: `rs3:task:synthetic-chain-target:${i}`, label: `Current synthetic chain label ${i}`,
      category, rawLabel, aliases: [], sourceId: `synthetic-current-source-${i}`,
    }));
    const result = migrateTaskIdentities(before, { catalogue,
      taskMap: { [rawLabel]: seed }, history: { current: { [seed]: final } } });
    assert.deepEqual(before, original, 'The public API must preserve its input');
    for (const row of catalogue) {
      assert.equal(result.state.identityRegistry.entries[row.id].label, row.label);
      assert.equal(result.state.identityRegistry.entries[row.id].sourceId, row.sourceId);
    }
    if (count === 1) {
      assert.deepEqual(result.state.members[0].taskStatus[catalogue[0].id], before.members[0].taskStatus[final]);
      assert.equal(result.state.members[0].taskStatus[final], undefined);
    } else {
      assert.deepEqual(result.state.members[0].taskStatus[final], before.members[0].taskStatus[final]);
      const unresolved = result.report.unresolved.find(row => row.originalId === final);
      assert.equal(unresolved.reason, 'ambiguous');
      assert.deepEqual(unresolved.candidates, catalogue.map(row => row.id));
    }
  }
});
