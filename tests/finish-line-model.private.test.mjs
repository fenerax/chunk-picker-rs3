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

test('draft has all helper skills, exact trial caps, researched targets and stable groups', () => {
  const model = buildFinishLineModel(fixture());
  assert.equal(model.draft, true);
  assert.deepEqual(model.groups.map(row => row.id), ['quests', 'skills', 'gear', 'achievements', 'custom']);
  assert.deepEqual(group(model, 'skills').items.map(row => row.skill), helperSkills);
  assert.ok(!item(model, 'skill:Invention'));
  for (const [skill, cap] of Object.entries(helperTrialCaps)) {
    assert.equal(item(model, `skill:${skill}`).target, cap);
    assert.equal(item(model, `skill:${skill}`).maxTarget, cap);
  }
  for (const row of group(model, 'skills').items) assert.ok(row.reason?.length);
  assert.equal(item(model, 'skill:Runecrafting').target, 57);
  assert.equal(item(model, 'skill:Smithing').target, 50);
  assert.equal(group(model, 'gear').items.length, 4);
});

test('invalid target overrides fall back; trial caps cannot be raised, while lowered targets are accepted', () => {
  const state = fixture();
  state.finishLine = { items: { 'skill:Mining': { target: 99 }, 'skill:Agility': { target: 6 },
    'skill:Magic': { target: 0 }, 'skill:Necromancy': { target: 10 }, 'skill:Smithing': { target: 2.5 } } };
  const model = buildFinishLineModel(state);
  assert.equal(item(model, 'skill:Mining').target, 99);
  assert.equal(item(model, 'skill:Agility').target, 5);
  assert.equal(item(model, 'skill:Necromancy').target, 10);
  assert.equal(item(model, 'skill:Magic').target, finishLineSkillTargets.Magic);
  assert.equal(item(model, 'skill:Smithing').target, finishLineSkillTargets.Smithing);
});

test('gear baseline is independent of geography, obtainable gear and partner ownership', () => {
  const state = fixture();
  const goal = finishLineGearTargets.find(row => row.style === 'ranged');
  state.members[1].obtainedEquipment = goal.components.flatMap(part => part.options[0]);
  const result = { memberId: 'one', stateRevision: 8, currentBiS: { obtainable: { loadouts: [{ style: 'Ranged', best: { mainHand: 'Shortbow', items: ['Shortbow'] } }] },
    owned: { recordedObtained: [], recordedBest: { recommendations: [], loadouts: [] } } } };
  const model = buildFinishLineModel(state, { one: result });
  assert.equal(item(model, 'gear:ranged').players[0].done, false);
  assert.equal(item(model, 'gear:ranged').players[1].done, true);
  assert.ok(item(model, 'gear:ranged').details.some(row => /Yew shortbow.*Rune arrow/.test(row)));
  state.members[0].unlocked = ['everything'];
  assert.deepEqual(group(buildFinishLineModel(state, { one: result }), 'gear'), group(model, 'gear'));
});

test('gear requires an entire compatible hand setup and accepts whole tied alternatives', () => {
  const state = fixture(), goal = finishLineGearTargets.find(row => row.style === 'magic');
  state.members[0].obtainedEquipment = goal.components.slice(0, -1).flatMap(part => part.options[0]);
  state.members[0].obtainedEquipment.push('Gravite wand');
  assert.equal(item(buildFinishLineModel(state), 'gear:magic').players[0].done, false);
  state.members[0].obtainedEquipment.push('Gravite orb');
  assert.equal(item(buildFinishLineModel(state), 'gear:magic').players[0].done, true);
  state.members[0].obtainedEquipment = goal.components.flatMap(part => part.options[0]);
  assert.equal(item(buildFinishLineModel(state), 'gear:magic').players[0].done, true);
});

test('own recorded Current BiS is usable, while stale, wrong-player and nested wrong-player results are rejected', () => {
  const state = fixture(), goal = finishLineGearTargets.find(row => row.style === 'melee');
  const result = { memberId: 'one', stateRevision: 8, currentBiS: { memberId: 'one', owned: { recordedObtained: goal.components.flatMap(part => part.options[0]).map(name => ({ name })) } } };
  assert.equal(item(buildFinishLineModel(state, { one: result }), 'gear:melee').players[0].done, true);
  for (const value of [{ ...result, stateRevision: 7 }, { ...result, memberId: 'two' }, { ...result, currentBiS: { ...result.currentBiS, memberId: 'two' } }]) {
    assert.equal(item(buildFinishLineModel(state, { one: value }), 'gear:melee').players[0].done, false);
  }
});

test('personal obtain completion aliases count, challenge-only Obtain ticks do not', () => {
  const state = fixture();
  const definitions = { equipment: { 'Amulet of power': { slot: 'neck' } } };
  const alias = legacyTaskId('BiS', 'Obtain an ~|amulet of power|~');
  state.members[0].taskStatus[alias] = { challengeCompleted: true };
  assert.equal(item(buildFinishLineModel(state, {}, definitions), 'gear:necromancy').players[0].current, 0);
  state.members[0].completedTasks = [alias];
  assert.equal(item(buildFinishLineModel(state, {}, definitions), 'gear:necromancy').players[0].current, 1);
});

test('achievement ticks are personal recorded evidence; a shared engine satisfaction cannot finish the duo', () => {
  const state = fixture();
  state.members[0].taskStatus['rs3:task:002de8'] = { challengeCompleted: true };
  const model = buildFinishLineModel(state, { two: { memberId: 'two', stateRevision: 8,
    tasks: [{ id: 'rs3:task:002de8', category: 'Diary', label: 'Hard Lumbridge', challengeSatisfied: true }] } });
  const row = item(model, 'achievement:rs3:task:002de8');
  assert.equal(row.players[0].done, true);
  assert.equal(row.players[1].done, false);
  assert.equal(row.duo.done, false);
});

