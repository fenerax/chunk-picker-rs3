import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGroupState, importBackup, exportBackup, previewRestore, validateState, SAVE_COUNT_LIMITS } from '../app/core/state.mjs';
import { mapTransferRoster, transferReport } from '../app/save-transfer.mjs';
import { migrateOwnedGameplay } from '../app/tasks/migration.mjs';
import { openStore } from '../app/storage/store.mjs';

const roster = [{ id: 'source', name: 'Synthetic player' }];
function largeSave() {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: 40_000 }, (_, i) => ({ id: `custom:synthetic-${i}`, label: `Synthetic task ${i}`, category: 'Custom' }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  state.members[0].taskStatus = Object.fromEntries(state.tasks.slice(0, 4_000).map(task => [task.id, { favorite: true }]));
  return state;
}

test('large hostile synthetic transfer report and restore preview use linear lookups', () => {
  const incoming = largeSave(), before = structuredClone(incoming);
  // Overlap exercises definition comparisons and completion differences in both directions.
  const removedTasks = Array.from({ length: 10_000 }, (_, i) => ({ id: `custom:removed-${i}`, label: `Synthetic removed task ${i}`, category: 'Custom' }));
  before.tasks.push(...removedTasks);
  before.members[0].completedTasks = [...before.members[0].completedTasks.slice(0, 30_000), ...removedTasks.map(task => task.id)];
  const backup = exportBackup(incoming);
  const start = performance.now();
  const state = importBackup(backup);
  const report = transferReport(state);
  const preview = previewRestore(before, state);
  const elapsed = performance.now() - start;
  assert.equal(report.records.length, 40_000);
  assert.equal(report.records[0].rawValue.completed, true);
  assert.equal(report.records.at(-1).rawValue.completed, true);
  assert.equal(preview.members[0].completedTasks.added.length, 10_000);
  assert.equal(preview.members[0].completedTasks.removed.length, 10_000);
  assert.equal(preview.tasks.changed.length, 0);
  // Normally a few hundred ms; generous headroom for shared CI workers, while
  // still rejecting the former tens-of-seconds quadratic implementation.
  assert.ok(elapsed < 2_000, `large transfer preview took ${elapsed.toFixed(0)} ms`);
  console.log(`Synthetic 40,000-task preview: ${elapsed.toFixed(0)} ms`);
});

test('schema bounds imported rosters, catalogue and per-member progress before projection', () => {
  for (const [field, limit] of Object.entries(SAVE_COUNT_LIMITS)) {
    const state = createGroupState(roster);
    if (field === 'members') state.members = Array.from({ length: limit + 1 }, (_, i) => ({ ...state.members[0], id: `synthetic-${i}` }));
    if (field === 'tasks') state.tasks = Array.from({ length: limit + 1 }, (_, i) => ({ id: `custom:${i}`, label: 'Synthetic task', category: 'Custom' }));
    if (field === 'collectionRecords') state.provenance = { syntheticRecords: Array(limit + 1).fill(null) };
    if (field === 'memberRecords') state.members[0].completedTasks = Array.from({ length: limit + 1 }, (_, i) => `custom:${i}`);
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state }), /save limit/);
  }
  const state = createGroupState(roster);
  state.members[0].taskStatus = Object.fromEntries(Array.from({ length: SAVE_COUNT_LIMITS.memberRecords + 1 }, (_, i) => [`custom:${i}`, { favorite: true }]));
  assert.throws(() => validateState(state), /member.taskStatus exceeds the save limit/);
});

test('remap then store load preserves cleared legacy fields and original migration attribution', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-roster-guards-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createGroupState([{ ...roster[0], sourceMapId: 'synthetic-map' }]);
  state.legacy = { maps: { 'synthetic-map': { chunks: { stickeredNotes: { '100': 'Archived synthetic note' } },
    chunkNotes: 'Archived synthetic journal', rules: { SyntheticRule: false } } } };
  const options = { definitions: { challenges: {} }, taskMap: {}, catalogue: [] };
  const migrated = migrateOwnedGameplay(state, options).state;
  assert.equal(migrated.members[0].notes['100'], 'Archived synthetic note');
  assert.equal(migrated.members[0].taskRules.SyntheticRule, false);
  delete migrated.members[0].notes['100'];
  delete migrated.members[0].taskRules.SyntheticRule;
  delete migrated.members[0].journal;
  migrated.legacy.gameplayMigration.unresolved = [{ memberId: 'source', sourceMapId: 'synthetic-map', source: 'checkedAllTasks', category: 'Custom', legacyKey: 'synthetic-unknown', reason: 'unknown legacy task ID' }];
  migrated.legacy.gameplayMigration.taskStatusProvenance = [{ memberId: 'source', taskId: 'custom:synthetic', sources: [] }];
  const originalMigration = structuredClone(migrated.legacy.gameplayMigration);
  const mapped = mapTransferRoster(migrated, [{ id: 'destination' }], { source: 'destination' });
  for (const field of ['migratedMembers', 'journalMigratedMembers', 'unresolved', 'taskStatusProvenance']) {
    assert.equal(mapped.legacy.gameplayMigration[field][0].memberId, 'destination');
  }
  assert.deepEqual(mapped.provenance.transferRoster.gameplayMigration, originalMigration);
  assert.deepEqual(migrated.legacy.gameplayMigration, originalMigration);
  const open = () => openStore({ dataDir: root, initialState: mapped, migrateState: incoming => migrateOwnedGameplay(incoming, options).state });
  let store = await open();
  try {
    const loaded = store.getState();
    assert.deepEqual(loaded.members[0].notes, {});
    assert.deepEqual(loaded.members[0].taskRules, {});
    assert.equal(loaded.members[0].journal, undefined);
    assert.deepEqual(loaded.provenance.transferRoster.gameplayMigration, originalMigration);
  } finally { await store.close(); }
  store = await open();
  try {
    assert.deepEqual(store.getState().members[0].notes, {});
    assert.deepEqual(store.getState().members[0].taskRules, {});
    assert.equal(store.getState().members[0].journal, undefined);
  } finally { await store.close(); }
});
