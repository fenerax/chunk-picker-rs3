import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinishLineModel, finishLineGearTargets, finishLineSkillTargets } from '../app/web/finish-line-model.mjs';
import { helperSkills, helperTrialCaps } from '../app/web/helper-model.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';

const observation = (level, name = 'Account one') => ({ level, xp: 100, source: 'runemetrics', runescapeName: name, fetchedAt: '2026-10-13T10:00:00Z' });
const fixture = () => ({ revision: 8, rules: { 'content.f2p': true, 'tasks.completion': 'any' }, tasks: [], members: [
  { id: 'one', name: 'One', runescapeName: 'Account one', completedTasks: [], taskStatus: {}, obtainedEquipment: [] },
  { id: 'two', name: 'Two', runescapeName: 'Account two', completedTasks: [], taskStatus: {}, obtainedEquipment: [] },
] });
const group = (model, id) => model.groups.find(row => row.id === id);
const item = (model, id) => model.groups.flatMap(row => row.items).find(row => row.id === id);
const questDefinitions = { challenges: { Quest: {
  'A Complete the quest': { PickerId: 'rs3:task:a', QuestPoints: 1, BaseQuest: 'A' },
  'B Complete the miniquest': { PickerId: 'rs3:task:b', QuestPoints: 0, BaseQuest: 'B' },
  'C Complete the quest': { PickerId: 'rs3:task:c', QuestPoints: 2, BaseQuest: 'C', 'Not F2P': true },
  'D Complete the quest': { PickerId: 'rs3:task:d', QuestPoints: 1, members: true },
  'A step': { PickerId: 'rs3:task:step', BaseQuest: 'A' },
  'Archaeology Mystery: sample': { PickerId: 'rs3:task:mystery', QuestPoints: 0 },
} } };
const disableDefaults = state => {
  state.finishLine = { items: Object.fromEntries(buildFinishLineModel(state).groups.flatMap(row => row.items).map(row => [row.id, { enabled: false }])), customItems: [] };
};


test('F2P whole quest catalogue includes miniquests and stays F2P after members rule changes', () => {
  const state = fixture();
  const first = buildFinishLineModel(state, {}, questDefinitions);
  assert.deepEqual(group(first, 'quests').items.map(row => row.id), ['quest:rs3:task:a', 'quest:rs3:task:b']);
  state.rules['content.f2p'] = false;
  assert.deepEqual(group(buildFinishLineModel(state, {}, questDefinitions), 'quests').items, group(first, 'quests').items);
});

test('saved personal facts project aliases; quest challenge ticks and partner completions cannot finish own quests', () => {
  const state = fixture();
  state.members[0].completedTasks = [legacyTaskId('Quest', 'A Complete the quest')];
  state.members[0].taskStatus['rs3:task:b'] = { challengeCompleted: true };
  state.members[1].questProgress = { 'rs3:task:b': { ...observation(1, 'Account two'), title: 'B' } };
  const model = buildFinishLineModel(state, {}, questDefinitions);
  assert.equal(item(model, 'quest:rs3:task:a').players[0].done, true);
  assert.equal(item(model, 'quest:rs3:task:a').players[1].done, false);
  assert.equal(item(model, 'quest:rs3:task:b').players[0].done, false);
  assert.equal(item(model, 'quest:rs3:task:b').players[1].done, true);
  assert.equal(item(model, 'quest:rs3:task:b').duo.done, false);
});

test('unknown and wrong-account skill or quest observations earn zero; training ceilings never count', () => {
  const state = fixture();
  state.members[0].skillProgress = { Mining: observation(50, 'Someone else'), Attack: { ...observation(90), xp: Infinity }, Magic: { ...observation(90), source: 'manual' } };
  state.members[0].questProgress = { 'rs3:task:a': { ...observation(1, 'Someone else'), title: 'A' } };
  const model = buildFinishLineModel(state, { one: { memberId: 'one', stateRevision: 8, training: { Mining: { level: 99 } } } }, questDefinitions);
  for (const id of ['skill:Mining', 'skill:Attack', 'skill:Magic', 'quest:rs3:task:a']) {
    const row = item(model, id).players[0];
    assert.equal(row.known, false);
    assert.equal(row.current, null);
    assert.equal(row.ratio, 0);
    assert.match(row.status, /not synced|Not recorded/);
  }
});

test('enabled goals have equal weight; duo uses both completions and slower player ratio', () => {
  const state = fixture(); disableDefaults(state);
  state.finishLine.items['skill:Mining'] = { enabled: true, target: 50 };
  state.members[0].skillProgress = { Mining: observation(25) };
  state.members[1].skillProgress = { Mining: observation(50, 'Account two') };
  state.finishLine.customItems = [{ id: 'finish:challenge', text: 'Own challenge', completedBy: ['one', 'two'] }];
  const model = buildFinishLineModel(state);
  assert.equal(model.members[0].percent, 75);
  assert.equal(model.members[1].percent, 100);
  assert.deepEqual(model.duo, { percent: 75, done: 1, total: 2 });
  assert.equal(group(model, 'skills').total, 1);
  assert.equal(group(model, 'skills').done, 0);
  assert.equal(item(model, 'skill:Mining').duo.ratio, 0.5);
});







test('custom checks, duplicates and exclusion stay independent of saved task completion and cannot mutate inputs', () => {
  const state = fixture(); disableDefaults(state);
  state.finishLine.customItems = [
    { id: 'finish:one', text: '  Our finish criterion  ', completedBy: ['one', 'unknown'] },
    { id: 'finish:one', text: 'Duplicate', completedBy: ['one', 'two'] },
    { id: 'task:wrong', text: 'Wrong namespace', completedBy: ['one', 'two'] },
  ];
  state.members[1].completedTasks = ['finish:one'];
  const before = structuredClone(state), model = buildFinishLineModel(state);
  assert.equal(group(model, 'custom').items.length, 1);
  assert.equal(item(model, 'finish:one').label, 'Our finish criterion');
  assert.equal(item(model, 'finish:one').players[1].done, false);
  assert.deepEqual(model.duo, { percent: 0, done: 0, total: 1 });
  assert.deepEqual(state, before);
  state.finishLine.items['finish:one'] = { enabled: false };
  const excluded = buildFinishLineModel(state);
  assert.deepEqual(excluded.duo, { percent: 0, done: 0, total: 0 });
  assert.equal(item(excluded, 'finish:one').status, item(model, 'finish:one').status);
  assert.equal(item(excluded, 'finish:one').players[0].done, true);
});

test('displayed 100 requires every enabled goal complete and no-goal or no-member models stay zero', () => {
  const state = fixture(); disableDefaults(state);
  state.finishLine.items['skill:Mining'] = { enabled: true, target: 120 };
  for (const member of state.members) member.skillProgress = { Mining: observation(119, member.runescapeName) };
  for (let index = 0; index < 20; index++) state.finishLine.customItems.push({ id: `finish:done${index}`, text: 'Done', completedBy: ['one', 'two'] });
  const incomplete = buildFinishLineModel(state);
  assert.equal(incomplete.duo.percent, 99);
  assert.ok(incomplete.members.every(member => member.percent === 99));
  for (const member of state.members) member.skillProgress.Mining.level = 120;
  assert.equal(buildFinishLineModel(state).duo.percent, 100);
  state.finishLine.customItems = []; state.finishLine.items['skill:Mining'].enabled = false;
  assert.equal(buildFinishLineModel(state).duo.percent, 0);
  assert.equal(buildFinishLineModel({ ...fixture(), members: [] }).duo.percent, 0);
});
