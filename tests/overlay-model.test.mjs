import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayPayload, overlayText } from '../app/overlay-model.mjs';

const world = { chunks: new Map([['100', { name: '<b>First chunk</b>' }], ['101', { name: 'Second chunk' }], ['102', { name: 'Third chunk' }]]), surface: new Set(['100', '101', '102']) };
function state() {
  return { revision: 7, rules: { 'tasks.completion': 'personal' }, tasks: [
    { id: 'one', label: '<b>Mine ore</b>', category: 'Mining' },
    { id: 'two', label: 'Finish quest', category: 'Quests' },
    { id: 'three', label: 'Save this for later', category: 'Mining' },
    { id: 'four', label: 'Secret journal entry', memberIds: ['reed'] },
  ], members: [
    { id: 'actor1', name: 'Player', journal: 'Private free text', unlocked: ['100', '100-1'], pendingRoll: [], completedTasks: ['two'], taskStatus: { one: { favorite: true, note: 'Private task note' }, two: { favorite: true }, three: { favorite: true, backlogged: true }, four: { favorite: true } } },
    { id: 'reed', name: 'Reed', unlocked: ['100', '101-2'], pendingRoll: [], completedTasks: [], taskStatus: { two: { favorite: true } } },
  ], history: [], provenance: { secret: 'never serialize' }, legacy: { private: true } };
}
const model = (value, widget, player = 'duo', variant = 'full') => overlayPayload({ state: value, world, widget, player, variant });
const event = (revision, type, memberId, command = {}) => ({ revision, type, at: '2026-10-13T10:00:00.000Z', command: { type, memberId, ...command } });

test('goals expose only unfinished admitted personal pins and display text', () => {
  assert.deepEqual(model(state(), 'goals'), { revision: 7, widget: 'goals', heading: 'Current goals', players: [
    { name: 'Player', goals: [{ label: 'Mine ore' }] }, { name: 'Reed', goals: [{ label: 'Finish quest' }] },
  ] });
  assert.deepEqual(model(state(), 'goals', 'actor1', 'compact').players, [{ name: 'Player', goals: [{ label: 'Mine ore' }] }]);
  const serialized = JSON.stringify(model(state(), 'goals'));
  for (const privateField of ['journal', 'taskStatus', 'provenance', 'legacy', 'Private', 'memberIds']) assert.equal(serialized.includes(privateField), false);
});

test('goals use shared completion rules without moving personal pins between players', () => {
  const value = state();
  value.rules['tasks.completion'] = 'any';
  assert.deepEqual(model(value, 'goals', 'reed').players[0].goals, []);
  value.rules['tasks.completion'] = 'all';
  assert.deepEqual(model(value, 'goals', 'reed').players[0].goals, [{ label: 'Finish quest' }]);
  value.members[1].taskStatus.two.challengeCompleted = true;
  assert.deepEqual(model(value, 'goals', 'reed').players[0].goals, []);
});

test('group goal choices expose only open display text and per-player ticks, in saved order', () => {
  const value = state();
  value.groupGoals = [
    { id: 'group-goal:food', text: '<b>Stock food</b>', completion: 'group', completedBy: [], done: false, link: { kind: 'item', id: 'private-id', label: 'Private linked label' } },
    { id: 'group-goal:picks', text: 'Both get a pickaxe', completion: 'players', completedBy: ['actor1'], done: false },
    { id: 'group-goal:done', text: 'Finished plan', completion: 'players', completedBy: ['actor1', 'reed'], done: true },
    { id: 'group-goal:done-group', text: 'Finished group plan', completion: 'group', completedBy: [], done: true },
  ];
  const groupGoals = [{ label: 'Stock food' }, { label: 'Both get a pickaxe', players: [{ name: 'Player', done: true }, { name: 'Reed', done: false }] }];
  assert.deepEqual(overlayPayload({ state: value, world, widget: 'goals', player: 'duo', goals: 'group' }),
    { revision: 7, widget: 'goals', heading: 'Current goals', groupGoals });
  assert.deepEqual(overlayPayload({ state: value, world, widget: 'goals', player: 'actor1', goals: 'both' }),
    { revision: 7, widget: 'goals', heading: 'Current goals', players: [{ name: 'Player', goals: [{ label: 'Mine ore' }] }], groupGoals });
  assert.equal(Object.hasOwn(model(value, 'goals'), 'groupGoals'), false);
  const payload = overlayPayload({ state: value, world, widget: 'goals', player: 'duo', goals: 'group' });
  for (const field of ['id', 'text', 'completion', 'completedBy', 'link', 'Private', 'Finished', 'tasks', 'history']) assert.equal(JSON.stringify(payload).includes(`"${field}"`), false);
  delete value.groupGoals;
  assert.deepEqual(overlayPayload({ state: value, world, widget: 'goals', player: 'duo', goals: 'group' }).groupGoals, []);
});

test('group goal text and member names use the existing credential redaction boundary', () => {
  const value = state(), secret = 'a'.repeat(43);
  value.groupGoals = [{ text: `Plan /join/${secret}`, completion: 'players', completedBy: [], done: false }];
  value.members[0].name = `<b>Player</b> #key=${secret}`;
  const payload = overlayPayload({ state: value, world, widget: 'goals', player: 'duo', goals: 'group' });
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(JSON.stringify(payload).includes('<b>'), false);
});

test('legacy personal pins and completions resolve to permanent saved task identities', () => {
  const value = state(), id = 'rs3:task:one';
  value.tasks = [{ id, label: 'Permanent goal', category: 'Mining', aliases: ['legacy-one'] }];
  value.identityRegistry = { entries: { [id]: { category: 'Mining', aliases: ['legacy-one'] } }, aliases: { 'legacy-one': id } };
  value.members[0].taskStatus = { 'legacy-one': { favorite: true } };
  assert.deepEqual(model(value, 'goals', 'actor1').players[0].goals, [{ label: 'Permanent goal' }]);
  value.members[0].completedTasks = ['legacy-one'];
  assert.deepEqual(model(value, 'goals', 'actor1').players[0].goals, []);
});

test('completion families satisfy pinned goals using the same shared completion scope', () => {
  const value = state();
  value.members[0].taskStatus.two.favorite = false;
  value.tasks[0].completionIds = ['one', 'two'];
  assert.deepEqual(model(value, 'goals', 'actor1').players[0].goals, []);
  value.members[0].completedTasks = [];
  value.members[1].completedTasks = ['two'];
  value.rules['tasks.completion'] = 'any';
  assert.deepEqual(model(value, 'goals', 'actor1').players[0].goals, []);
  value.rules['tasks.completion'] = 'personal';
  assert.deepEqual(model(value, 'goals', 'actor1').players[0].goals, [{ label: 'Mine ore' }]);
});

test('count uses personally unlocked surface bases and duo union without double counting', () => {
  const value = state(); value.members[0].unlocked.push('unknown', 'Interior');
  assert.deepEqual(model(value, 'count', 'actor1'), { revision: 7, widget: 'count', heading: 'Player · Unlocked chunks', unlocked: 1, total: 3 });
  assert.deepEqual(model(value, 'count'), { revision: 7, widget: 'count', heading: 'Duo · Unlocked chunks', unlocked: 2, total: 3 });
});

test('roll selects latest personal or duo event and omits event command/actor metadata', () => {
  const value = state();
  value.history = [event(1, 'roll', 'actor1', { count: 1, rolled: ['100'] }), event(2, 'roll', 'reed', { count: 1, rolled: ['101'] })];
  assert.deepEqual(model(value, 'roll').roll, { player: 'Reed', phase: 'unlocked', chunks: [{ id: '101', name: 'Second chunk' }] });
  assert.deepEqual(model(value, 'roll', 'actor1').roll, { player: 'Player', phase: 'unlocked', chunks: [{ id: '100', name: 'First chunk' }] });
  value.history[1].undoneRevision = 3;
  assert.equal(model(value, 'roll').roll.player, 'Player');
  assert.equal(JSON.stringify(model(value, 'roll')).includes('command'), false);
});

test('pending Roll 2 displays choices until selected; cancellation reveals preceding valid roll', () => {
  const value = state(), member = value.members[0];
  value.history = [event(1, 'roll', 'actor1', { count: 1, rolled: ['100'] }), event(2, 'roll', 'actor1', { count: 2, rolled: ['101', '102'] })];
  member.pendingRoll = ['101', '102'];
  assert.equal(model(value, 'roll', 'actor1').roll.phase, 'offered');
  assert.deepEqual(model(value, 'roll', 'actor1').roll.chunks.map(chunk => chunk.id), ['101', '102']);
  member.pendingRoll = []; value.history.push(event(3, 'unlock-selection', 'actor1', { chunkId: '102' }));
  assert.deepEqual(model(value, 'roll', 'actor1').roll.chunks, [{ id: '102', name: 'Third chunk' }]);
  value.history.pop(); value.history.push(event(3, 'cancel-roll', 'actor1'));
  assert.deepEqual(model(value, 'roll', 'actor1').roll.chunks, [{ id: '100', name: 'First chunk' }]);
});

test('imports with pending choices have explicit offered phase and empty history is null', () => {
  const value = state();
  assert.equal(model(value, 'roll').roll, null);
  value.members[0].pendingRoll = ['100', '102'];
  assert.equal(model(value, 'roll').roll.phase, 'offered');
});

test('display labels strip markup and credential-shaped text', () => {
  const secret = 'a'.repeat(43);
  const text = overlayText(`<b>Goal</b> /join/${secret} https://picker.example/overlay/goals#key=${secret} Bearer ${secret}`);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('<'), false);
  assert.match(text, /^Goal /);
  assert.equal(overlayText('long '.repeat(200)).length <= 240, true);
});
