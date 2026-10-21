import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { originalLocalChanges } from '../app/integrations/original-local-changes.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';
import { baseline, locallyChanged, review, syncCommand, apply, capture, rows, transferred, extraTasks, world } from './original-sync-local-fixture.mjs';

test('fixture keeps local unlocks, filters their old candidates/offers, and applies only the genuine original lock', () => {
  const state = locallyChanged(), before = structuredClone(state), proposal = review(state), member = proposal.preview.members[0];
  assert.deepEqual(member.chunks, { unlock: [], lock: ['12855'], keepLocal: ['12851', '12852'] });
  assert.deepEqual(member.selections.after, ['12853']);
  assert.deepEqual(member.pendingRoll.after, ['12854']);
  const synced = apply(state, syncCommand(proposal));
  assert.deepEqual(synced.members[0].unlocked, ['12850', '12851', '12852']);
  assert.deepEqual(synced.members[0].selected, ['12853']);
  assert.deepEqual(synced.members[0].pendingRoll, ['12854']);
  assert.deepEqual(synced.members[1], state.members[1]);
  assert.deepEqual(state, before);
  assert.deepEqual(apply(synced, { type: 'undo' }).members, state.members);
});

test('fixture never re-ticks the 172 Player 2 contributions, a later untick, or a task backlogged here', () => {
  const state = locallyChanged(), proposal = review(state), tasks = proposal.preview.members[0].tasks;
  assert.equal(transferred.length, 172);
  assert.equal(tasks.keepLocal.length, 174);
  assert.deepEqual(tasks.complete.map(task => task.id), [extraTasks[2].id]);
  assert.ok(tasks.keepLocal.some(task => task.id === extraTasks[1].id && task.reason === 'Backlogged here'));
  const synced = apply(state, syncCommand(proposal, ['tasks'], ['player1', 'player2']));
  for (const task of transferred) {
    assert.equal(synced.members[0].taskStatus[task.id].challengeCompleted, false);
    assert.equal(synced.members[1].taskStatus[task.id].challengeCompleted, true);
  }
  assert.equal(synced.members[0].taskStatus[extraTasks[0].id].challengeCompleted, false);
  assert.deepEqual(synced.members[0].taskStatus[extraTasks[1].id], { backlogged: true, backlogReason: 'Save food for later' });
  assert.equal(synced.members[0].taskStatus[extraTasks[2].id].challengeCompleted, true);
  assert.deepEqual(synced.members[0].completedTasks, []);
  assert.deepEqual(synced.history.at(-1).command.members[0].tasks.complete, [extraTasks[2].id]);
});

test('local protections survive repeated sync, unrelated group sync and a portable backup', () => {
  let state = locallyChanged();
  state = apply(state, syncCommand(review(state), ['tasks']));
  state = apply(state, syncCommand(review(state), ['rules']));
  state = apply(state, syncCommand(review(state)));
  state = importBackup(exportBackup(state));
  const member = review(state).preview.members[0];
  assert.deepEqual(member.chunks.keepLocal, ['12851', '12852']);
  assert.equal(member.tasks.keepLocal.length, 174);
  assert.deepEqual(member.chunks.lock, []);
  assert.deepEqual(member.tasks.complete, []);
});

test('an original that temporarily agrees does not consume local unlock protection', () => {
  let state = locallyChanged();
  const agreeing = capture(); agreeing.maps.qxa.chunks.unlocked = ['12850', '12851', '12852'];
  agreeing.maps.qxa.chunks.selected = ['12853']; agreeing.maps.qxa.chunks.potential = ['12854'];
  state = apply(state, syncCommand(review(state, agreeing), ['chunks']));
  assert.deepEqual(review(state).preview.members[0].chunks.keepLocal, ['12851', '12852']);
});

test('held original candidates and pending choices can be synced alone without reclassifying a local unlock', () => {
  const state = locallyChanged();
  const synced = apply(state, syncCommand(review(state), ['selections', 'pendingRoll']));
  assert.deepEqual(synced.members[0].unlocked, state.members[0].unlocked);
  assert.deepEqual(synced.members[0].selected, ['12853']);
  assert.deepEqual(synced.members[0].pendingRoll, ['12854']);
});

test('Undo releases local cleanup even after a later tasks sync leaves the value alone', () => {
  let state = baseline();
  const id = extraTasks[0].id;
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: id, challengeCompleted: false });
  const untickRevision = state.revision;
  state = apply(state, syncCommand(review(state), ['tasks']));
  state = apply(state, { type: 'undo', undoRevision: untickRevision });
  assert.equal(review(state).preview.members[0].tasks.keepLocal.some(task => task.id === id), false);
  assert.equal(state.members[0].taskStatus[id].challengeCompleted, true);

  // Undoing a backlog must not fossilize protection from an earlier false flag.
  const backlogId = extraTasks[1].id;
  state = baseline({ [backlogId]: { challengeCompleted: false } });
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: backlogId, backlogged: true });
  const backlogRevision = state.revision;
  state = apply(state, syncCommand(review(state), ['tasks']));
  state = apply(state, { type: 'undo', undoRevision: backlogRevision });
  assert.equal(review(state).preview.members[0].tasks.keepLocal.some(task => task.id === backlogId), false);
  assert.ok(review(state).preview.members[0].tasks.complete.some(task => task.id === backlogId));
});

test('clearing backlog releases only that choice; explicit negative no-ops still express local intent', () => {
  let state = baseline(), id = extraTasks[1].id;
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: id, backlogged: true });
  state = apply(state, { type: 'clear-backlog', memberId: 'player1' });
  assert.ok(review(state).preview.members[0].tasks.complete.some(task => task.id === id));
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: id, challengeCompleted: false });
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: id, challengeCompleted: false });
  assert.equal(state.history.at(-1).undo, undefined);
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: id, favorite: true, note: 'Local note' });
  assert.ok(review(state).preview.members[0].tasks.keepLocal.some(task => task.id === id));
});

test('snapshot History and sparse History find the same local choices', () => {
  let state = baseline();
  const before = structuredClone(state.members[0]);
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: extraTasks[0].id, challengeCompleted: false });
  const expected = originalLocalChanges(state, state.members[0]);
  state.history.at(-1).undo = { members: [before] };
  assert.deepEqual(originalLocalChanges(state, state.members[0]), expected);
  const previous = structuredClone(state.members[0]);
  state = apply(state, { type: 'set-chunk', memberId: 'player1', chunkId: '12851', status: 'unlocked' });
  const sparse = originalLocalChanges(state, state.members[0]);
  state.history.at(-1).undo = { members: [previous] };
  assert.deepEqual(originalLocalChanges(state, state.members[0]), sparse);
});

test('original imports and note edits do not masquerade as local cleanup', () => {
  let state = baseline();
  state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: extraTasks[1].id, note: 'Review later', favorite: true });
  const proposal = review(state);
  assert.deepEqual(proposal.preview.members[0].chunks.keepLocal, []);
  assert.deepEqual(proposal.preview.members[0].tasks.keepLocal, []);
  assert.equal(proposal.preview.members[0].tasks.complete.length, 2);
  assert.deepEqual(proposal.preview.members[0].chunks.lock, ['12855']);
});

test('local personal unticks also prevent stale originals from reintroducing challenge checks', () => {
  let state = baseline(), id = extraTasks[1].id;
  state = apply(state, { type: 'complete-task', memberId: 'player1', taskId: id, completed: true });
  state = apply(state, { type: 'complete-task', memberId: 'player1', taskId: id, completed: false });
  assert.ok(review(state).preview.members[0].tasks.keepLocal.some(task => task.id === id));
  assert.equal(rows.length, 175);
  assert.equal(applyCommand(state, syncCommand(review(state), ['tasks']), { expectedRevision: state.revision }).members[0].completedTasks.length, 0);
});

test('a historical note alias cannot hide a canonical local backlog choice', () => {
  const state = locallyChanged(), task = extraTasks[1];
  state.members[0].taskStatus[legacyTaskId(task.category, task.label)] = { note: 'Historical note only' };
  const tasks = review(state).preview.members[0].tasks;
  assert.equal(tasks.keepLocal.length, 174);
  assert.ok(tasks.keepLocal.some(row => row.id === task.id && row.reason === 'Backlogged here'));
  assert.deepEqual(tasks.complete.map(task => task.id), [extraTasks[2].id]);
});

test('rolled unlocks and both accepted choices are protected through sparse and legacy snapshot History', () => {
  let state = baseline();
  state = apply(state, { type: 'set-rule', ruleId: 'roll.neighborMode', value: 'manual' });
  state = apply(state, { type: 'set-chunk', memberId: 'player1', chunkId: '12851', status: 'selected' });
  state = applyCommand(state, { type: 'roll', memberId: 'player1', count: 1 }, { expectedRevision: state.revision, world, random: () => 0 });
  assert.deepEqual(review(state).preview.members[0].chunks.keepLocal, ['12851']);

  state = baseline();
  const offers = capture(true); offers.maps.qxa.chunks.potential = ['12851', '12852'];
  state = apply(state, syncCommand(review(state, offers), ['pendingRoll']));
  const before = structuredClone(state.members[0]);
  state = apply(state, { type: 'unlock-both', memberId: 'player1' });
  assert.deepEqual(review(state).preview.members[0].chunks.keepLocal, ['12851', '12852']);
  state.history.at(-1).undo = { members: [before] };
  assert.deepEqual(review(state).preview.members[0].chunks.keepLocal, ['12851', '12852']);
  state = apply(state, { type: 'undo' });
  assert.deepEqual(review(state).preview.members[0].chunks.keepLocal, []);
});

test('previous History retained only for restore inspection does not protect the restored active save', () => {
  const state = locallyChanged();
  state.provenance = { restore: { previousHistory: state.history } };
  state.history = [];
  const member = review(state).preview.members[0];
  assert.deepEqual(member.chunks.keepLocal, []);
  assert.deepEqual(member.tasks.keepLocal, []);
});
