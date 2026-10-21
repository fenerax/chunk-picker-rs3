import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGroupState } from '../app/core/state.mjs';

const now = () => new Date('2026-10-08T12:00:00Z');

test('a backlog can carry an optional reason, validated, saved per member and undoable', () => {
  let state = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  state = applyCommand(state, { type: 'add-task', task: { id: 'custom:wait', label: 'Wait for a partner', category: 'Custom' } }, { now });
  const backlogged = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:wait', backlogged: true, backlogReason: 'Waiting for Reed' }, { now });
  assert.deepEqual(backlogged.members[0].taskStatus['custom:wait'], { backlogged: true, backlogReason: 'Waiting for Reed' });
  assert.equal(backlogged.members[1].taskStatus?.['custom:wait'], undefined, 'only the chosen member');
  assert.throws(() => applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:wait', backlogged: true, backlogReason: 'x'.repeat(501) }, { now }), /at most 500/);
  assert.throws(() => applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:wait', backlogReason: 3 }, { now }), /string/);
  const restored = applyCommand(backlogged, { type: 'set-task-status', memberId: 'a', taskId: 'custom:wait', backlogged: false }, { now });
  assert.equal(restored.members[0].taskStatus['custom:wait'].backlogged, false);
  const undone = applyCommand(restored, { type: 'undo' }, { now });
  assert.deepEqual(undone.members[0].taskStatus['custom:wait'], { backlogged: true, backlogReason: 'Waiting for Reed' });
});

test('restore all backlog returns every backlogged task for one member in one undoable change', () => {
  let state = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  for (const id of ['custom:one', 'custom:two', 'custom:three']) state = applyCommand(state, { type: 'add-task', task: { id, label: id, category: 'Custom' } }, { now });
  state = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:one', backlogged: true, backlogReason: 'Later' }, { now });
  state = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:two', backlogged: true, note: 'keep me' }, { now });
  state = applyCommand(state, { type: 'set-task-status', memberId: 'b', taskId: 'custom:three', backlogged: true }, { now });
  const restored = applyCommand(state, { type: 'clear-backlog', memberId: 'a' }, { now });
  assert.deepEqual(restored.members[0].taskStatus['custom:one'], { backlogged: false });
  assert.deepEqual(restored.members[0].taskStatus['custom:two'], { backlogged: false, note: 'keep me' });
  assert.equal(restored.members[1].taskStatus['custom:three'].backlogged, true, 'the other player is untouched');
  assert.equal(restored.history.at(-1).command.restored, 2);
  assert.equal(restored.revision, state.revision + 1);
  assert.equal(restored.history.length, state.history.length + 1);
  const undone = applyCommand(restored, { type: 'undo' }, { now });
  assert.deepEqual(undone.members[0].taskStatus, state.members[0].taskStatus);
  assert.throws(() => applyCommand(restored, { type: 'clear-backlog', memberId: 'a' }, { now }), /Nothing is backlogged/);
});

function subsetFixture() {
  let state = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  for (const id of ['custom:one', 'custom:two', 'custom:three', 'custom:active']) {
    state = applyCommand(state, { type: 'add-task', task: { id, label: id, category: 'Custom' } }, { now });
  }
  for (const id of ['custom:one', 'custom:two', 'custom:three']) {
    state = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: id,
      backlogged: true, backlogReason: `Later: ${id}`, note: `Note: ${id}`, favorite: true, challengeCompleted: true }, { now });
  }
  state = applyCommand(state, { type: 'set-task-status', memberId: 'b', taskId: 'custom:one', backlogged: true, backlogReason: 'Partner' }, { now });
  return state;
}

test('restore a backlog subset preserves other statuses and is one exact undoable change', () => {
  const state = subsetFixture();
  const taskIds = ['custom:two', 'custom:one'];
  const restored = applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds }, { now, expectedRevision: state.revision });
  for (const id of taskIds) {
    const { backlogReason, ...status } = state.members[0].taskStatus[id];
    assert.deepEqual(restored.members[0].taskStatus[id], { ...status, backlogged: false });
  }
  assert.deepEqual(restored.members[0].taskStatus['custom:three'], state.members[0].taskStatus['custom:three']);
  assert.deepEqual(restored.members[1], state.members[1], 'the other player is untouched');
  assert.equal(restored.revision, state.revision + 1);
  assert.equal(restored.history.length, state.history.length + 1);
  assert.deepEqual(restored.history.at(-1).command, { type: 'clear-backlog', memberId: 'a', taskIds, restored: 2 });
  assert.deepEqual(applyCommand(restored, { type: 'undo' }, { now }).members, state.members);
});

test('restore subset rejects malformed, empty, duplicate, unsafe or unknown ID lists', () => {
  const state = subsetFixture();
  const before = structuredClone(state);
  for (const taskIds of [null, 'custom:one', [], [null], [1], [{}], [''], [' '],
    ['__proto__'], ['prototype'], ['constructor'], ['custom:one', 'custom:one'],
    Array.from({ length: 5001 }, (_, index) => `custom:${index}`)]) {
    assert.throws(() => applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds }, { now }), TypeError);
    assert.deepEqual(state, before, 'rejected commands leave state and history unchanged');
  }
});

test('restore subset validates every status and the revision before changing any task', () => {
  const state = subsetFixture();
  const before = structuredClone(state);
  for (const id of ['custom:active', 'custom:missing']) {
    assert.throws(() => applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds: ['custom:one', id] }, { now }), /no longer backlogged/);
    assert.deepEqual(state, before);
  }
  assert.throws(() => applyCommand(state, { type: 'clear-backlog', memberId: 'b', taskIds: ['custom:one', 'custom:two'] }, { now }), /no longer backlogged/);
  assert.throws(() => applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds: ['custom:one'] }, { now, expectedRevision: state.revision - 1 }), /Revision conflict/);
  assert.deepEqual(state, before);
  const restored = applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds: ['custom:one'] }, { now });
  assert.throws(() => applyCommand(restored, { type: 'clear-backlog', memberId: 'a', taskIds: ['custom:two', 'custom:one'] }, { now }), /no longer backlogged/);
  assert.equal(restored.members[0].taskStatus['custom:two'].backlogged, true);
});

test('restore subset uses saved task IDs when the current calculated catalogue omits the task', () => {
  const state = subsetFixture();
  const restored = applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds: ['custom:one'] }, { now, taskCatalogue: new Map() });
  assert.equal(restored.members[0].taskStatus['custom:one'].backlogged, false);
  assert.deepEqual(restored.tasks, state.tasks, 'restoring status does not register or replace catalogue rows');
  assert.deepEqual(applyCommand(restored, { type: 'undo' }, { now }).members, state.members);
});

test('a large saved reason group restores in one command without a fixed task-count limit', () => {
  const state = createGroupState([{ id: 'a', name: 'A' }]);
  const taskIds = Array.from({ length: 5001 }, (_, index) => `custom:large-${index}`);
  state.tasks = taskIds.map(id => ({ id, label: id, category: 'Custom' }));
  state.members[0].taskStatus = Object.fromEntries(taskIds.map(id => [id, { backlogged: true, backlogReason: 'Later' }]));
  const restored = applyCommand(state, { type: 'clear-backlog', memberId: 'a', taskIds }, { now, expectedRevision: state.revision });
  assert.equal(restored.revision, state.revision + 1);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0].command.restored, taskIds.length);
  assert.ok(Object.values(restored.members[0].taskStatus).every(status => status.backlogged === false));
});

test('clear-challenge-ticks unticks only that player\'s listed ticks in one undoable change', () => {
  let state = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  for (const id of ['custom:one', 'custom:two', 'custom:three']) state = applyCommand(state, { type: 'add-task', task: { id, label: id, category: 'Custom' } }, { now });
  for (const [member, id] of [['a', 'custom:one'], ['a', 'custom:two'], ['b', 'custom:one']]) state = applyCommand(state, { type: 'set-task-status', memberId: member, taskId: id, challengeCompleted: true, ...(id === 'custom:two' ? { note: 'keep' } : {}) }, { now });
  const cleared = applyCommand(state, { type: 'clear-challenge-ticks', memberId: 'a', taskIds: ['custom:one', 'custom:two', 'custom:three'], reason: 'Reed did these' }, { now });
  assert.equal(cleared.members[0].taskStatus['custom:one'].challengeCompleted, false);
  assert.deepEqual(cleared.members[0].taskStatus['custom:two'], { challengeCompleted: false, note: 'keep' });
  assert.equal(cleared.members[1].taskStatus['custom:one'].challengeCompleted, true, 'partner untouched');
  assert.deepEqual(cleared.history.at(-1).command.taskIds, ['custom:one', 'custom:two']);
  assert.deepEqual(applyCommand(cleared, { type: 'undo' }, { now }).members[0].taskStatus, state.members[0].taskStatus);
  assert.throws(() => applyCommand(cleared, { type: 'clear-challenge-ticks', memberId: 'a', taskIds: ['custom:one'] }, { now }), /None of those/);
});
