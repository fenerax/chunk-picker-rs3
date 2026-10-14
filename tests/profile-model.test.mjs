import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileModel } from '../app/web/profile-model.mjs';
import { playerControlSkills } from '../app/core/player-controls.mjs';
import { combatLevelFromSkills } from '../app/core/combat-level.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';

const at = '2026-10-12T18:00:00.000Z';
const observation = (level = 10, name = 'player') => ({ level, xp: 1000, source: 'runemetrics', runescapeName: name, fetchedAt: at });
const fixture = () => ({ revision: 4, rules: { 'content.f2p': true }, tasks: [], members: [
  { id: 'one', name: 'One', runescapeName: 'player', unlocked: ['1', '2'], completedTasks: [], taskStatus: {} },
  { id: 'two', name: 'Two', runescapeName: 'partner', unlocked: [], completedTasks: [], taskStatus: {} },
] });






test('questProgress counts personal whole quests including zero points with current F2P denominator', () => {
  const state = fixture();
  const definitions = { challenges: { Quest: {
    'A Complete the quest': { QuestPoints: 1, BaseQuest: 'A' },
    'B Complete the miniquest': { QuestPoints: 0, BaseQuest: 'B' },
    'C Complete the quest': { QuestPoints: 2, BaseQuest: 'C', 'Not F2P': true },
    'A step': { BaseQuest: 'A' },
    'Archaeology Mystery: example': { QuestPoints: 0 },
  } } };
  const id = label => permanentTaskId('Quest', label, definitions.challenges.Quest[label]);
  state.members[0].questProgress = {
    [id('A Complete the quest')]: { ...observation(), title: 'A' },
    [id('B Complete the miniquest')]: { ...observation(1, 'other'), title: 'B' },
    [id('C Complete the quest')]: { ...observation(), title: 'C' },
  };
  state.members[0].taskStatus[id('B Complete the miniquest')] = { challengeCompleted: true };
  const model = buildProfileModel(state, 'one', null, definitions);
  assert.equal(model.quests.completed, 1);
  assert.equal(model.quests.total, 2);
  assert.equal(model.quests.unknownCompletionCount, 1);
  state.rules['content.f2p'] = false;
  const members = buildProfileModel(state, 'one', null, definitions);
  assert.equal(members.quests.total, 3);
  assert.equal(members.quests.completed, 2);
  assert.equal(buildProfileModel(fixture(), 'one').quests.total, null);
});

test('recorded gear includes compatible hands, ties and unknown slots, excludes obtainable plan', () => {
  const state = fixture();
  const result = { memberId: 'one', stateRevision: 4, currentBiS: { owned: {
    recordedObtained: [{ name: 'Sword' }, { name: 'Shield' }, { name: 'Sword' }],
    recordedBest: { recommendations: [{ style: 'Melee', slot: 'head', equipment: { name: 'Helm' }, alternatives: [{ name: 'Other helm' }] }],
      loadouts: [{ style: 'Melee', best: { mainHand: 'Sword', offHand: 'Shield', items: ['Sword', 'Shield'], mode: 'dual', alternatives: [] } }] },
  }, obtainable: { recommendations: [{ style: 'Magic', slot: 'head', equipment: { name: 'Unobtained hat' } }] } } };
  const before = structuredClone(result), model = buildProfileModel(state, 'one', result);
  assert.equal(model.gear.totalRecorded, 2);
  assert.equal(model.gear.defaultStyle, 'Melee');
  assert.equal(model.gear.styles.length, 1);
  const slots = model.gear.styles[0].slots;
  assert.deepEqual(slots.find(row => row.slot === 'main hand').items, [{ name: 'Sword' }]);
  assert.deepEqual(slots.find(row => row.slot === 'off-hand').items, [{ name: 'Shield' }]);
  assert.equal(slots.find(row => row.slot === 'main hand').coupled, true);
  assert.deepEqual(slots.find(row => row.slot === 'head').items, [{ name: 'Helm' }, { name: 'Other helm' }]);
  assert.equal(slots.find(row => row.slot === 'feet').known, false);
  assert.deepEqual(result, before);
  assert.equal(buildProfileModel(state, 'one', { ...result, memberId: 'two' }).gear.available, false);
  assert.equal(buildProfileModel(state, 'one', { ...result, stateRevision: 3 }).gear.available, false);
});

test('header uses own unlocked count and labels earliest retained date precisely', () => {
  const state = fixture();
  const stats = { stateRevision: 4, members: [{ id: 'two', timeline: [{ at: '2025-01-01T00:00:00Z' }] },
    { id: 'one', timeline: [{ at }, { at: '2026-10-01T00:00:00Z' }, { at: '123' }] }] };
  const header = buildProfileModel(state, 'one', null, {}, stats).header;
  assert.equal(header.unlockedCount, 2);
  assert.equal(header.firstUnlockAt, '2026-10-01T00:00:00Z');
  assert.equal(header.firstUnlockLabel, 'First recorded unlock');
  assert.equal(buildProfileModel(state, 'one').header.firstUnlockAt, null);
  assert.equal(buildProfileModel(state, 'one', null, {}, { ...stats, stateRevision: 3 }).header.firstUnlockAt, null);
});

test('personally marked achievement tasks are included even without a separate challenge tick', () => {
  const state = fixture();
  state.tasks = [{ id: 'diary', category: 'Diary', label: 'Diary task' }];
  state.members[0].completedTasks = ['diary'];
  assert.equal(buildProfileModel(state, 'one').achievements.ticked, 1);
});
