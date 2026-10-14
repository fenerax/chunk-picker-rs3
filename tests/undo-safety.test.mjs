import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyValidatedCommand, createGroupState, exportBackup, importBackup, getUndoEligibility, validateHistoryActor } from '../app/core/state.mjs';

const now = () => '2026-10-10T12:00:00.000Z';
const options = { now, world: { chunks: new Map(['100', '101', '200'].map(id => [id, { id }])) } };
const actor = { kind: 'invite', inviteId: 'invite-a', label: 'Player', memberId: 'actor1' };
const note = (memberId, chunkId, text) => ({ type: 'set-note', memberId, chunkId, note: text });
function initial() {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.members[0].notes = { '100': 'Before', '101': 'Independent' };
  return state;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('older personal undo preserves independent later changes, attribution and monotonic history', () => {
  const first = applyCommand(initial(), note('actor1', '100', 'After'), { ...options, actor });
  const second = applyCommand(first, note('reed', '200', 'Partner note'), options);
  const third = applyCommand(second, note('actor1', '101', 'Later own note'), options);
  const before = structuredClone(third);
  assert.deepEqual(getUndoEligibility(freeze(third), 1), { canUndo: true, reason: null, undoRevision: 1 });
  assert.deepEqual(third, before, 'Preview does not mutate frozen gameplay or History');
  const undone = applyCommand(third, { type: 'undo', undoRevision: 1 }, { ...options, actor, expectedRevision: 3 });
  assert.equal(undone.revision, 4);
  assert.equal(undone.history.length, 4);
  assert.equal(undone.members[0].notes['100'], 'Before');
  assert.equal(undone.members[0].notes['101'], 'Later own note');
  assert.equal(undone.members[1].notes['200'], 'Partner note');
  assert.equal(undone.history[0].undoneRevision, 4);
  assert.deepEqual(undone.history[3].actor, actor);
  assert.deepEqual(undone.history[3].command, { type: 'undo', undoRevision: 1 });
  assert.deepEqual(importBackup(exportBackup(undone)), undone);
  assert.deepEqual(getUndoEligibility(undone), { canUndo: true, reason: null, undoRevision: 3 });
  const latest = applyCommand(undone, { type: 'undo' }, options);
  assert.equal(latest.history.at(-1).command.undoRevision, 3, 'Generic Undo still selects the latest global reversible command');
  assert.equal(latest.members[0].notes['100'], 'Before');
});

test('storage-owned sparse selected undo shares retained trees and copies only the target marker', () => {
  const original = initial();
  original.tasks = Array.from({ length: 512 }, (_, index) => ({ id: `custom:${index}`, label: `Task ${index}`, category: 'custom' }));
  original.identityRegistry = { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
  original.legacy = { maps: { exact: 'Retained imported facts' } };
  original.provenance = { archives: [{ evidence: 'Retained historical evidence' }] };
  let current = applyCommand(original, note('actor1', '100', 'After'), { ...options, actor });
  current = applyCommand(current, note('reed', '200', 'Keep partner note'), options);
  const command = { type: 'undo', undoRevision: 1 };
  const expected = applyCommand(current, command, { ...options, actor, expectedRevision: 2 });
  freeze(current);
  const retained = new Set([...current.tasks, ...current.history, current.identityRegistry, current.legacy, current.provenance]);
  const stringify = JSON.stringify, entries = Object.entries;
  let wholeStateCopies = 0, undone;
  JSON.stringify = function (value, ...args) {
    const candidate = value?.state ?? value;
    if (candidate?.tasks?.length >= 512 && Array.isArray(candidate.members)) wholeStateCopies++;
    return stringify.call(this, value, ...args);
  };
  Object.entries = value => {
    assert(!retained.has(value), 'Sparse selected undo traversed an unchanged catalogue, history or archival tree');
    return entries(value);
  };
  try { undone = applyValidatedCommand(current, command, { ...options, actor, expectedRevision: 2 }); }
  finally { JSON.stringify = stringify; Object.entries = entries; }
  assert.equal(wholeStateCopies, 0, 'Sparse selected undo must not serialize a whole state to copy it');
  assert.deepEqual(undone, expected);
  assert.deepEqual(importBackup(exportBackup(undone)), expected, 'The complete public boundary still validates the resulting undo chain');
  for (const field of ['tasks', 'identityRegistry', 'legacy', 'provenance']) assert.equal(undone[field], current[field]);
  assert.notEqual(undone.history, current.history);
  assert.notEqual(undone.history[0], current.history[0]);
  assert.equal(undone.history[0].undo, current.history[0].undo);
  assert.equal(undone.history[1], current.history[1]);
  assert.equal(current.history[0].undoneRevision, undefined);
  assert.equal(current.members[0].notes['100'], 'After');
  undone.members[0].notes['100'] = 'Changed private output';
  assert.equal(current.members[0].notes['100'], 'After');
  assert.equal(current.history[0].undo.memberChanges[0].changes[0].before.value, 'Before');
});

test('preview and selected undo reject overlapping later writes even if their value returns', () => {
  let current = applyCommand(initial(), note('actor1', '100', 'After'), options);
  current = applyCommand(current, note('actor1', '100', 'Another'), options);
  current = applyCommand(current, note('actor1', '100', 'After'), options);
  const eligibility = getUndoEligibility(current, 1);
  assert.equal(eligibility.canUndo, false);
  assert.match(eligibility.reason, /later command changed the same saved value/i);
  assert.throws(() => applyCommand(current, { type: 'undo', undoRevision: 1 }, options), { message: eligibility.reason });
});

test('optional container removal and cross-field chunk conflicts remain blocked', () => {
  const absent = initial(); delete absent.members[0].notes;
  const first = applyCommand(absent, note('actor1', '100', 'Created'), options);
  const later = applyCommand(first, note('actor1', '101', 'Unrelated entry'), options);
  assert.equal(getUndoEligibility(later, 1).canUndo, false);
  assert.throws(() => applyCommand(later, { type: 'undo', undoRevision: 1 }, options), /later command/);
  const chunks = initial(); chunks.members[0].unlocked = ['100'];
  const world = { chunks: new Map([['100', { id: '100' }]]) };
  const locked = applyCommand(chunks, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'locked' }, { ...options, world });
  const selected = applyCommand(locked, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'selected' }, { ...options, world });
  const eligibility = getUndoEligibility(selected, 1);
  assert.equal(eligibility.canUndo, false);
  assert.match(eligibility.reason, /same saved value/);
  assert.throws(() => applyCommand(selected, { type: 'undo', undoRevision: 1 }, options), { message: eligibility.reason });
  const cleared = applyCommand(selected, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'locked' }, { ...options, world });
  assert.equal(getUndoEligibility(cleared, 1).canUndo, false, 'A later inverse would restore an overlapping selection even when current arrays are empty');
});

test('older unguarded rules, snapshots and catalogue inverses report unsupported; latest stays reversible', () => {
  for (const command of [
    { type: 'set-rule', ruleId: 'access.shared', value: false },
    { type: 'add-task', task: { id: 'custom:extra', label: 'Extra', category: 'custom' } },
  ]) {
    const first = applyCommand(initial(), command, options);
    const later = applyCommand(first, note('reed', '200', 'Later'), options);
    assert.equal(getUndoEligibility(first, 1).canUndo, true);
    const eligibility = getUndoEligibility(later, 1);
    assert.equal(eligibility.canUndo, false);
    assert.match(eligibility.reason, /guarded personal changes/);
    assert.throws(() => applyCommand(later, { type: 'undo', undoRevision: 1 }, options), { message: eligibility.reason });
  }
  const original = initial();
  const first = applyCommand(original, note('actor1', '100', 'Changed'), options);
  first.history[0].undo = { members: [structuredClone(original.members[0])] };
  const later = applyCommand(first, note('reed', '200', 'Later'), options);
  assert.equal(getUndoEligibility(later, 1).canUndo, false);
});

test('undo eligibility identifies already undone, missing, nonreversible and invalid revisions', () => {
  const changed = applyCommand(initial(), note('actor1', '100', 'Changed'), options);
  const undone = applyCommand(changed, { type: 'undo' }, options);
  for (const [revision, reason] of [[1, /already been undone/], [2, /not reversible/], [99, /not in the active history/], [0, /positive safe integer/]]) {
    const eligibility = getUndoEligibility(undone, revision);
    assert.equal(eligibility.canUndo, false);
    assert.match(eligibility.reason, reason);
    assert.throws(() => applyCommand(undone, { type: 'undo', undoRevision: revision }, options), { message: eligibility.reason });
  }
  assert.equal(getUndoEligibility(undone).canUndo, false);
  assert.throws(() => applyCommand(changed, { type: 'undo', undoRevision: 1 }, { ...options, expectedRevision: 0 }), /Revision conflict/);
});

test('linked invite actor snapshots accept only safe optional member identifiers', () => {
  assert.deepEqual(validateHistoryActor(actor), actor);
  const legacy = { kind: 'invite', inviteId: 'invite-a', label: 'Player' };
  assert.deepEqual(validateHistoryActor(legacy), legacy);
  for (const memberId of [null, '', 'with space', '../actor1', 'a'.repeat(65), 7]) assert.throws(() => validateHistoryActor({ ...actor, memberId }), /memberId/);
  assert.throws(() => validateHistoryActor({ kind: 'master', label: 'Admin', memberId: 'actor1' }), /Unknown history actor field/);
  const saved = applyCommand(initial(), note('reed', '200', 'Partner targeted action'), { ...options, actor });
  assert.equal(saved.history[0].actor.memberId, 'actor1', 'Actor identity stays separate from the action target');
  assert.deepEqual(importBackup(exportBackup(saved)).history[0].actor, actor);
});
