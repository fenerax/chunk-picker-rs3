import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGroupState, importBackup, exportBackup, previewRestore, validateState, SAVE_COUNT_LIMITS } from '../app/core/state.mjs';
import { mapTransferRoster, transferReport } from '../app/save-transfer.mjs';
import { migrateTaskIdentities, migrateOwnedGameplay } from '../app/tasks/migration.mjs';
import { openStore } from '../app/storage/store.mjs';
import { assertImportWork, IMPORT_WORK_LIMITS } from '../app/import-work.mjs';
import { migrationSummary } from '../app/picker-context-http.mjs';
import { parseJSONStream } from '../app/storage/json-stream.mjs';

const roster = [{ id: 'source', name: 'Synthetic player' }];
function largeSave() {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: 5_000 }, (_, i) => ({ id: `custom:synthetic-${i}`, label: `Synthetic task ${i}`, category: 'Custom' }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  state.members[0].taskStatus = Object.fromEntries(state.tasks.slice(0, 500).map(task => [task.id, { favorite: true }]));
  return state;
}

test('large hostile synthetic transfer report and restore preview use linear lookups', () => {
  const incoming = largeSave(), before = structuredClone(incoming);
  // Overlap exercises definition comparisons and completion differences in both directions.
  const removedTasks = Array.from({ length: 1_250 }, (_, i) => ({ id: `custom:removed-${i}`, label: `Synthetic removed task ${i}`, category: 'Custom' }));
  before.tasks.push(...removedTasks);
  before.members[0].completedTasks = [...before.members[0].completedTasks.slice(0, 3_750), ...removedTasks.map(task => task.id)];
  const backup = exportBackup(incoming);
  const start = performance.now();
  const state = importBackup(backup);
  const report = transferReport(state);
  const preview = previewRestore(before, state);
  const elapsed = performance.now() - start;
  assert.equal(report.records.length, 5_000);
  assert.equal(report.records[0].rawValue.completed, true);
  assert.equal(report.records.at(-1).rawValue.completed, true);
  assert.equal(preview.members[0].completedTasks.added.length, 1_250);
  assert.equal(preview.members[0].completedTasks.removed.length, 1_250);
  assert.equal(preview.tasks.changed.length, 0);
  // Normally a few hundred ms; generous headroom for shared CI workers, while
  // still rejecting the former tens-of-seconds quadratic implementation.
  assert.ok(elapsed < 2_000, `large transfer preview took ${elapsed.toFixed(0)} ms`);
  console.log(`Synthetic 5,000-task preview: ${elapsed.toFixed(0)} ms`);
});

function editedSave(tasks, edits) {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: tasks }, (_, i) => ({ id: `custom:synthetic-${i}`, category: 'Custom', label: `Synthetic ${i}` }));
  state.revision = edits;
  for (let i = 0; i < edits; i++) {
    const before = { ...state.tasks[0] }, after = { ...before, label: `Edited ${i}` };
    state.tasks[0] = after;
    state.history.push({ id: `revision-${i + 1}`, revision: i + 1, type: 'edit-task', at: '2026-01-01T00:00:00.000Z',
      undo: { taskChanges: [{ id: before.id, before: { exists: true, value: before, index: 0 }, after: { exists: true, value: after, index: 0 } }] } });
  }
  return { format: 'rs3-chunk-picker', schemaVersion: 1, state };
}

test('maximum admitted edit replay and unresolved reports scale with input, including parse, migration and preview', async t => {
  async function sample(scale) {
    const document = editedSave(IMPORT_WORK_LIMITS.tasks * scale, IMPORT_WORK_LIMITS.history * scale);
    assertImportWork(document);
    const text = Buffer.from(JSON.stringify(document));
    const root = await mkdtemp(path.join(tmpdir(), 'synthetic-import-scale-'));
    const store = await openStore({ dataDir: root, initialState: createGroupState(roster) });
    const start = performance.now();
    const parsed = await parseJSONStream([text]);
    const replayStart = performance.now();
    const state = importBackup(parsed);
    const replayMs = performance.now() - replayStart;
    const summary = migrationSummary(state);
    const preview = previewRestore(createGroupState(roster), state);
    const report = transferReport(state, { warnings: summary.warnings });
    assert.equal(state.tasks.length, document.state.tasks.length);
    assert.equal(preview.tasks.added.length, state.tasks.length);
    assert.equal(report.counts.dropped, 0);
    const replacement = await store.previewReplacement(parsed);
    assert.equal(replacement.state.history.length, 1);
    const applied = await store.replace(parsed, 0);
    assert.equal(applied.revision, 1);
    assert.deepEqual(applied.provenance.restore.incomingHistory, state.history);
    assert.equal((await store.backup()).state.tasks.length, state.tasks.length);
    await store.close();
    await rm(root, { recursive: true, force: true });
    const elapsed = performance.now() - start;
    // Independently exercise the reviewer's catalogue × unresolved shape.
    const unresolved = document.state;
    unresolved.history = [];
    unresolved.provenance = { taskIdentityMigration: { unresolved: unresolved.tasks.map(task => ({ originalId: task.id, path: 'synthetic' })) } };
    assertImportWork(unresolved);
    const reportStart = performance.now();
    const summaryStart = performance.now();
    for (let repeat = 0; repeat < 8; repeat++) assert.equal(migrationSummary(unresolved).warnings.length, unresolved.tasks.length);
    const summaryMs = performance.now() - summaryStart;
    const migrated = migrateTaskIdentities(unresolved);
    assert.equal(migrated.state.tasks.length, unresolved.tasks.length);
    return { total: elapsed + performance.now() - reportStart, replay: replayMs, summary: summaryMs };
  }
  await sample(0.5); // Warm module/JIT caches before comparing growth.
  const small = [], large = [];
  for (let i = 0; i < 3; i++) { small.push(await sample(0.5)); large.push(await sample(1)); }
  const median = values => values.sort((a, b) => a - b)[1];
  const one = median(small.map(row => row.total)), two = median(large.map(row => row.total));
  for (const field of ['replay', 'summary']) {
    const before = median(small.map(row => row[field])), after = median(large.map(row => row[field]));
    assert.ok(after < before * 3.2 + 5, `superlinear ${field} growth: ${before.toFixed(1)} → ${after.toFixed(1)} ms`);
    t.diagnostic(`${field}: 1x ${before.toFixed(1)} ms, 2x ${after.toFixed(1)} ms`);
  }
  t.diagnostic(`Synthetic maximum ${IMPORT_WORK_LIMITS.tasks} tasks / ${IMPORT_WORK_LIMITS.history} edits: 1x ${one.toFixed(0)} ms, 2x ${two.toFixed(0)} ms`);
  assert.ok(Math.max(...large.map(row => row.total)) < 1_500, `maximum import path exceeded CI budget: ${JSON.stringify(large)}`);
  assert.ok(two < one * 3.2, `superlinear import growth: ${one.toFixed(0)} → ${two.toFixed(0)} ms`);
});

test('aggregate admission refuses count products and text/codec amplification before import', () => {
  const document = editedSave(IMPORT_WORK_LIMITS.tasks, IMPORT_WORK_LIMITS.history);
  assert.doesNotThrow(() => assertImportWork(document));
  document.state.members[0].completedTasks = document.state.tasks.map(task => task.id);
  assert.throws(() => importBackup(document), /safe import work limit/);
  assert.throws(() => importBackup(editedSave(20_000, 2_000)), /safe import work limit/);
  assert.throws(() => assertImportWork({ evidence: 'x'.repeat(IMPORT_WORK_LIMITS.text + 1) }), /safe import work limit/);
  assert.throws(() => assertImportWork({ version: 1, entries: [{ length: IMPORT_WORK_LIMITS.units + 1 }] }), /safe import work limit/);
  const aliases = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`synthetic-${i}`, Array(500).fill('candidate')]));
  assert.throws(() => assertImportWork({ aliases }), /safe import work limit/);
  const ambiguous = { aliases: { synthetic: Array(400).fill('candidate') }, uses: Array(400).fill('synthetic') };
  assert.throws(() => assertImportWork(ambiguous), /safe import work limit/);
  const budget = {};
  assertImportWork({ evidence: 'x'.repeat(IMPORT_WORK_LIMITS.text / 2) }, { budget });
  assert.throws(() => assertImportWork({ evidence: 'x'.repeat(IMPORT_WORK_LIMITS.text / 2) }, { budget }), /safe import work limit/);
  const deleted = editedSave(1, IMPORT_WORK_LIMITS.history);
  deleted.state.tasks = [];
  for (const [i, event] of deleted.state.history.entries()) {
    const task = { id: `custom:deleted-${i}`, category: 'Custom', label: `Deleted ${i}` };
    event.undo.taskChanges = [{ id: task.id, before: { exists: true, index: 0, value: task }, after: { exists: false } }];
  }
  assert.throws(() => assertImportWork(deleted), /safe import work limit/);
});

test('retained backup imports enforce the budget before static-field validation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-retained-import-bound-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initialState = editedSave(20_000, 0).state;
  const store = await openStore({ dataDir: root, initialState });
  try {
    await store.command({ type: 'set-rule', ruleId: 'content.f2p', value: false }, 0);
    const backup = (await store.listBackups()).find(row => row.revision === 0);
    const before = store.getState();
    await assert.rejects(store.readBackup(backup.id, { forImport: true }), error => error.status === 413 && /safe import work limit/.test(error.message));
    assert.deepEqual(store.getState(), before);
  } finally { await store.close(); }
});

test('roster remap preserves the removed preferred-method guard through reload', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-alternative-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createGroupState([{ ...roster[0], sourceMapId: 'synthetic-map' }]);
  state.tasks = [{ id: 'rs3:task:synthetic-method', category: 'Mining', label: 'Synthetic method' }];
  state.legacy = { maps: { 'synthetic-map': { chunkinfo: { altChallenges: { Mining: { group: 'rs3:task:synthetic-method' } } } } } };
  const migrated = migrateTaskIdentities(state).state;
  assert.equal(migrated.members[0].taskAlternatives.Mining.group, 'rs3:task:synthetic-method');
  delete migrated.members[0].taskAlternatives.Mining.group;
  const mapped = mapTransferRoster(migrated, [{ id: 'destination' }], { source: 'destination' });
  assert.deepEqual(mapped.provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'destination', sourceMapId: 'synthetic-map' }]);
  assert.deepEqual(migrated.provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'source', sourceMapId: 'synthetic-map' }]);
  for (let pass = 0; pass < 2; pass++) {
    const store = await openStore({ dataDir: root, initialState: mapped, migrateState: incoming => migrateTaskIdentities(incoming).state });
    try { assert.deepEqual(store.getState().members[0].taskAlternatives ?? {}, {});
      assert.deepEqual(store.getState().provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'destination', sourceMapId: 'synthetic-map' }]); } finally { await store.close(); }
  }
});

test('schema bounds imported rosters, catalogue and per-member progress before projection', () => {
  for (const [field, limit] of Object.entries(SAVE_COUNT_LIMITS)) {
    const state = createGroupState(roster);
    if (field === 'members') state.members = Array.from({ length: limit + 1 }, (_, i) => ({ ...state.members[0], id: `synthetic-${i}` }));
    if (field === 'tasks') state.tasks = Array.from({ length: limit + 1 }, (_, i) => ({ id: `custom:${i}`, label: 'Synthetic task', category: 'Custom' }));
    if (field === 'collectionRecords') state.provenance = { syntheticRecords: Array(limit + 1).fill(null) };
    if (field === 'memberRecords') state.members[0].completedTasks = Array.from({ length: limit + 1 }, (_, i) => `custom:${i}`);
    assert.throws(() => validateState(state), /save limit/);
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
