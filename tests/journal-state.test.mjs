import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, exportBackup, importBackup,
  previewRestore, getUndoEligibility, MAX_JOURNAL_LENGTH, importLegacyMaps, taskClaimInvalidatingEvent } from '../app/core/state.mjs';
import { migrateGameplay, hasCurrentJournalMigration } from '../app/tasks/migration.mjs';
import { describeHistoryEvent, historyChangeType } from '../app/web/history-text.mjs';
import { buildProgressModel } from '../app/core/progress-timeline.mjs';

const state = () => createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'bbb' }, { id: 'reed', name: 'Reed' }]);
const journal = (note, memberId = 'actor1') => ({ type: 'set-journal', memberId, note });
const options = { now: () => '2026-10-12T12:00:00.000Z', world: { chunks: new Map([['100', { id: '100' }]]) } };

test('journal saves literal plain text independently, clears, and validates every boundary', () => {
  const before = state(), text = '  # Today\n<script>alert("test")</script>\nPlayer 😀  ';
  const saved = applyCommand(before, journal(text), options);
  assert.equal(saved.members[0].journal, text);
  assert.deepEqual(saved.members[1], before.members[1]);
  assert.deepEqual(saved.members[0].notes, undefined);
  assert.equal(before.members[0].journal, undefined);
  assert.deepEqual(saved.history[0].command, journal(text));
  assert.deepEqual(saved.history[0].undo.memberChanges[0].changes.map(change => change.path), [['journal']]);
  assert.equal(applyValidatedCommand(saved, journal('  \n'), options).members[0].journal, '  \n');
  assert.equal(Object.hasOwn(applyCommand(saved, journal(''), options).members[0], 'journal'), false);
  assert.equal(applyCommand(before, journal('x'.repeat(MAX_JOURNAL_LENGTH)), options).members[0].journal.length, MAX_JOURNAL_LENGTH);
  for (const value of [null, 42, {}, [], 'x'.repeat(MAX_JOURNAL_LENGTH + 1)]) {
    assert.throws(() => applyCommand(before, journal(value), options), /journal.*(?:string|10000)/);
    assert.throws(() => applyValidatedCommand(before, journal(value), options), /journal.*(?:string|10000)/);
    const invalid = state(); invalid.members[0].journal = value;
    assert.throws(() => validateState(invalid), /journal.*(?:string|10000)/);
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: invalid }), /journal.*(?:string|10000)/);
  }
  assert.throws(() => applyCommand(before, { ...journal('text'), chunkId: '100' }, options), /Unknown command field/);
  assert.equal(taskClaimInvalidatingEvent({ command: journal('text') }), false);
});

test('journal selected Undo preserves later chunk notes and partner journal but rejects conflicting journal writes', () => {
  const initial = state(); initial.members[0].journal = 'Before';
  let saved = applyCommand(initial, journal('After'), options);
  saved = applyCommand(saved, { type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Later chunk note' }, options);
  saved = applyCommand(saved, journal('Partner journal', 'reed'), options);
  assert.equal(getUndoEligibility(saved, 1).canUndo, true);
  const undone = applyValidatedCommand(saved, { type: 'undo', undoRevision: 1 }, options);
  assert.equal(undone.members[0].journal, 'Before');
  assert.equal(undone.members[0].notes['100'], 'Later chunk note');
  assert.equal(undone.members[1].journal, 'Partner journal');
  assert.deepEqual(importBackup(exportBackup(undone)), undone);
  const conflicting = applyCommand(applyCommand(saved, journal('Another'), options), journal('After'), options);
  assert.equal(getUndoEligibility(conflicting, 1).canUndo, false);
  assert.throws(() => applyCommand(conflicting, { type: 'undo', undoRevision: 1 }, options), /same saved value/);
  const created = applyCommand(state(), journal('Created'), options);
  assert.equal(Object.hasOwn(applyCommand(created, { type: 'undo' }, options).members[0], 'journal'), false);
  const invalid = structuredClone(created); invalid.history[0].undo.memberChanges[0].changes[0].after.value = 'x'.repeat(MAX_JOURNAL_LENGTH + 1);
  assert.throws(() => validateState(invalid), /undo journal.*10000/);
});

test('backups retain journals and restore previews reveal changes and older absence', () => {
  const saved = applyCommand(state(), journal('Remember the plan'), options);
  assert.equal(importBackup(exportBackup(saved)).members[0].journal, 'Remember the plan');
  const older = importBackup(exportBackup(state()));
  assert.equal(Object.hasOwn(older.members[0], 'journal'), false);
  const removal = previewRestore(saved, exportBackup(older));
  assert.deepEqual(removal.members[0].journal, { before: 'Remember the plan', after: null, changed: true });
  assert.ok(removal.warnings.some(warning => /removes the journal for Player/.test(warning)));
  const changed = applyCommand(saved, journal('Different plan'), options);
  assert.deepEqual(previewRestore(saved, changed).members[0].journal, { before: 'Remember the plan', after: 'Different plan', changed: true });
  assert.ok(previewRestore(saved, changed).warnings.some(warning => /changes the journal/.test(warning)));
  assert.equal(previewRestore(saved, saved).members[0].journal.changed, false);
});

test('legacy map-wide journal imports once, respects authored text and retains oversized or ambiguous sources', () => {
  const source = { maps: { bbb: { chunks: {}, chunkNotes: 'Day-_-201-_-0APlan' } } };
  const initial = importLegacyMaps(source, { members: [{ id: 'actor1', name: 'Player', mapId: 'bbb' }] }).state;
  assert.equal(initial.members[0].journal, 'Day 1\nPlan', 'Direct player-map imports include the journal');
  delete initial.members[0].journal;
  assert.equal(hasCurrentJournalMigration(initial), false);
  const migrated = migrateGameplay(initial, { definitions: { challenges: {} }, taskMap: {} });
  assert.equal(migrated.state.members[0].journal, 'Day 1\nPlan');
  assert.equal(migrated.report.imported.journals, 1);
  assert.deepEqual(migrated.state.legacy.maps.bbb, source.maps.bbb);
  assert.equal(hasCurrentJournalMigration(migrated.state), true);
  assert.equal(initial.members[0].journal, undefined);
  assert.ok(!migrated.warnings.some(warning => /map-wide note with no whole chunk/.test(warning)));
  const cleared = applyCommand(migrated.state, journal(''), options);
  assert.equal(migrateGameplay(cleared).state.members[0].journal, undefined, 'A deliberate clear is never re-imported');
  const authored = structuredClone(initial); authored.members[0].journal = '';
  assert.equal(migrateGameplay(authored).state.members[0].journal, '', 'Explicit authored empty value wins');
  const upgraded = structuredClone(migrated.state); delete upgraded.members[0].journal; delete upgraded.legacy.gameplayMigration.journalMigratedMembers;
  assert.equal(hasCurrentJournalMigration(upgraded), false);
  upgraded.legacy.gameplayMigration.journalMigratedMembers = [null, 7];
  assert.equal(hasCurrentJournalMigration(upgraded), false, 'Malformed optional legacy markers cannot break readiness');
  assert.equal(migrateGameplay(upgraded).state.members[0].journal, 'Day 1\nPlan', 'Older migrated saves receive the one-time journal upgrade');
  const oversized = structuredClone(initial); oversized.legacy.maps.bbb.chunkNotes = 'x'.repeat(MAX_JOURNAL_LENGTH + 1);
  const skipped = migrateGameplay(oversized);
  assert.equal(skipped.state.members[0].journal, undefined);
  assert.ok(skipped.warnings.some(warning => /journal exceeds 10000/.test(warning)));
  assert.equal(skipped.state.legacy.maps.bbb.chunkNotes, oversized.legacy.maps.bbb.chunkNotes);
  const keyed = structuredClone(initial); keyed.legacy.maps.bbb.chunkNotes = { '100': 'Whole chunk note' };
  const notes = migrateGameplay(keyed).state.members[0];
  assert.equal(notes.journal, undefined); assert.equal(notes.notes['100'], 'Whole chunk note');
});

test('journal History names the owner and groups edits with notes', () => {
  const event = { type: 'set-journal', command: journal('Plan') }, lookups = { memberName: () => 'Player' };
  assert.equal(describeHistoryEvent(event, lookups), 'Edited the journal for Player');
  assert.equal(describeHistoryEvent({ ...event, command: journal('') }, lookups), 'Cleared the journal for Player');
  assert.equal(historyChangeType(event), 'notes');
  const saved = applyCommand(state(), journal('Plan'), options);
  delete saved.history[0].undo;
  assert.equal(buildProgressModel(saved).history.boundary, null, 'A journal-only event does not hide earlier progress');
});
