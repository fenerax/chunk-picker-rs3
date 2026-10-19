import test from 'node:test';
import assert from 'node:assert/strict';

process.env.RS3_DATASET ??= 'open-f2p';
const { applyCommand, createGroupState } = await import('../app/core/state.mjs');
const { tickActiveTaskPlan, tickActiveTaskQuestion } = await import('../app/web/tick-active-tasks-model.mjs');
const { describeHistoryEvent } = await import('../app/web/history-text.mjs');
const { tickActiveTasksDenied } = await import('../app/core/tick-active-tasks.mjs');

const now = () => new Date('2026-10-01T12:00:00Z');
const gameplay = state => JSON.parse(JSON.stringify({ members: state.members, tasks: state.tasks, identityRegistry: state.identityRegistry, taskClaims: state.taskClaims }));

function synthetic() {
  let state = createGroupState([{ id: 'a', name: 'Ash' }, { id: 'b', name: 'Birch' }]);
  for (const id of ['custom:one', 'custom:two', 'custom:three']) state = applyCommand(state, { type: 'add-task', task: { id, label: id, category: 'Custom' } }, { now });
  state = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:two', note: 'keep me' }, { now });
  state = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:three', challengeCompleted: true }, { now });
  return state;
}

test('tick-active-tasks ticks one player\'s listed tasks as one History entry and one exact Undo', () => {
  const before = synthetic();
  const catalogue = [{ id: 'synthetic:quest', label: 'Synthetic quest', category: 'Quest' }];
  const ticked = applyCommand(before, { type: 'tick-active-tasks', memberId: 'a', taskIds: ['custom:one', 'custom:two', 'custom:three', 'custom:one', 'synthetic:quest'], skipped: 2 },
    { now, taskCatalogue: catalogue, expectedRevision: before.revision });
  assert.equal(ticked.revision, before.revision + 1);
  assert.equal(ticked.history.length, before.history.length + 1, 'a single History entry');
  const event = ticked.history.at(-1);
  assert.equal(event.type, 'tick-active-tasks');
  assert.deepEqual(event.command.taskIds, ['custom:one', 'custom:two', 'synthetic:quest'], 'already ticked and repeated tasks are not saved again');
  assert.equal(event.command.ticked, 3); assert.equal(event.command.skipped, 2);
  assert.deepEqual(ticked.members[0].taskStatus['custom:two'], { note: 'keep me', challengeCompleted: true });
  assert.equal(ticked.members[0].taskStatus['synthetic:quest'].challengeCompleted, true);
  assert.equal(ticked.members[1].taskStatus?.['custom:one'], undefined, 'partner untouched');
  assert.ok(ticked.tasks.some(task => task.id === 'synthetic:quest'), 'catalogue task registered like a single tick');
  assert.equal(describeHistoryEvent(event, { memberName: id => ({ a: 'Ash' })[id] }), 'Ticked 3 active tasks (2 left for a choice) for Ash');

  const undone = applyCommand(ticked, { type: 'undo' }, { now });
  assert.deepEqual(gameplay(undone), gameplay(before), 'Undo restores the previous state exactly');
  assert.equal(undone.history.length, ticked.history.length + 1);
  assert.throws(() => applyCommand(ticked, { type: 'tick-active-tasks', memberId: 'a', taskIds: ['custom:one'] }, { now, expectedRevision: before.revision }), /revision|changed/i, 'stale revision refused');
});

test('tick-active-tasks validates its input', () => {
  const state = synthetic();
  const tick = command => () => applyCommand(state, { type: 'tick-active-tasks', memberId: 'a', ...command }, { now });
  assert.throws(tick({ taskIds: [] }), /List the active tasks/);
  assert.throws(tick({ taskIds: ['custom:three'] }), /already ticked/);
  assert.throws(tick({ taskIds: ['nope:missing'] }), /Unknown task/);
  assert.throws(tick({ taskIds: ['__proto__'] }), /nonempty strings/);
  assert.throws(tick({ taskIds: ['custom:one'], skipped: -1 }), /Skipped/);
  assert.throws(tick({ taskIds: ['custom:one'], ticked: 1 }), /key|unknown|field/i);
  assert.throws(() => applyCommand(state, { type: 'tick-active-tasks', memberId: 'nobody', taskIds: ['custom:one'] }, { now }), /member/i);
  assert.throws(tick({ taskIds: Array.from({ length: 5001 }, (_, index) => `custom:${index}`) }), /at most 5000/);
});

test('tick-active-tasks handles dibs exactly like the same single tick, including Undo', () => {
  let state = synthetic();
  state = applyCommand(state, { type: 'claim-task', memberId: 'a', taskId: 'custom:one' }, { now });
  const bulk = applyCommand(state, { type: 'tick-active-tasks', memberId: 'a', taskIds: ['custom:one'] }, { now });
  const single = applyCommand(state, { type: 'set-task-status', memberId: 'a', taskId: 'custom:one', challengeCompleted: true }, { now });
  assert.equal(bulk.taskClaims?.['custom:one'], undefined);
  assert.deepEqual(gameplay(bulk), gameplay(single));
  assert.deepEqual(gameplay(applyCommand(bulk, { type: 'undo' }, { now })), gameplay(applyCommand(single, { type: 'undo' }, { now })));
});

test('member guard: player links tick and undo only their own list; admins any', () => {
  const player = { memberId: 'a' }, partner = { memberId: 'b' }, admin = { admin: true };
  const command = { type: 'tick-active-tasks', memberId: 'a', taskIds: ['custom:one'] };
  assert.equal(tickActiveTasksDenied(player, command), undefined);
  assert.match(tickActiveTasksDenied(partner, command), /your own/);
  assert.match(tickActiveTasksDenied({}, command), /your own/);
  assert.equal(tickActiveTasksDenied(admin, command), undefined);
  const target = { type: 'tick-active-tasks', command };
  assert.match(tickActiveTasksDenied(partner, { type: 'undo' }, target), /undo your own/);
  assert.equal(tickActiveTasksDenied(player, { type: 'undo' }, target), undefined);
  assert.equal(tickActiveTasksDenied(partner, { type: 'undo' }, { type: 'set-note', command: { memberId: 'a' } }), undefined);
});

test('the plan counts shown rows: own unticked rows tick, choices and blocked rows are left', () => {
  const facts = new Map([['done', { personal: true }]]);
  const solo = tickActiveTaskPlan({ ownerId: 'a', personalFacts: task => facts.get(task.id) ?? {}, rows: [
    { id: 'one', status: 'available' }, { id: 'done', status: 'available' }, { id: 'blocked', status: 'blocked' }, { id: 'one', status: 'available' }] });
  assert.deepEqual(solo, { taskIds: ['one'], needChoice: 0, blocked: 1 });

  const row = (id, memberIds, extra = {}) => ({ id, task: { id, status: 'available' }, memberIds, facts: { group: false, personal: false }, ...extra });
  const duo = tickActiveTaskPlan({ ownerId: 'a', duo: true, rows: [
    row('mine', ['a']), row('shared', ['a', 'b']), row('partner', ['b']), row('done', ['a'], { facts: { group: true } }),
    row('blocked', ['a'], { tasksByMember: { a: { status: 'blocked' } } }),
    row('personal', ['a', 'b'], { personalCompletion: true, filterMemberIds: ['a'], facts: { group: true, personal: false } })] });
  assert.deepEqual(duo, { taskIds: ['mine', 'personal'], needChoice: 1, blocked: 1 });

  assert.equal(tickActiveTaskQuestion({ taskIds: Array(14).fill('x'), needChoice: 2, blocked: 0 }), 'Tick 14 active tasks? 2 need a choice and will be left.');
  assert.equal(tickActiveTaskQuestion({ taskIds: ['x'], needChoice: 1, blocked: 3 }, 'Ash'), 'Tick 1 active task for Ash? 1 needs a choice and will be left. 3 tasks shown as blocked will be left.');
});
