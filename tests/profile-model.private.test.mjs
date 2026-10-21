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

test('all 29 saved account levels supply totals and shared combat formula without training ceilings', () => {
  const state = fixture(), member = state.members[0];
  member.skillProgress = Object.fromEntries(playerControlSkills.map(skill => [skill, observation(10)]));
  member.runeMetricsSync = observation();
  member.skillProgress.Invention = observation(20);
  const model = buildProfileModel(state, 'one', { memberId: 'one', stateRevision: 4, training: { Mining: { level: 110, cap: 110 } } });
  assert.equal(model.skills.rows.length, 29);
  assert.equal(model.skills.knownCount, 29);
  assert.equal(model.skills.totalLevel, 300);
  assert.equal(model.skills.combatLevel, combatLevelFromSkills(Object.fromEntries(playerControlSkills.map(skill => [skill, 10]))));
  assert.equal(model.skills.rows.find(row => row.skill === 'Mining').level, 10);
  assert.equal(model.skills.rows.find(row => row.skill === 'Mining').f2pCap, null);
  assert.equal(model.skills.rows.find(row => row.skill === 'Agility').f2pCap, 5);
  assert.equal(model.skills.rows.find(row => row.skill === 'Invention').level, 20);
  assert.equal(model.skills.lastSyncAt, at);
});

test('missing, invalid and different-account data stay unknown, never level one', () => {
  const state = fixture(), member = state.members[0];
  member.skillProgress = { Mining: observation(40), Magic: observation(99, 'other'), Attack: { ...observation(90), source: 'manual' },
    Strength: { ...observation(90), xp: Infinity } };
  member.runeMetricsSync = observation(1, 'other');
  const model = buildProfileModel(state, 'one', { training: { Magic: { level: 99 }, Attack: { level: 120 } } });
  assert.equal(model.skills.knownCount, 1);
  assert.equal(model.skills.knownLevelTotal, 40);
  assert.equal(model.skills.totalLevel, null);
  assert.equal(model.skills.combatLevel, null);
  assert.equal(model.skills.lastSyncAt, null);
  assert.equal(model.skills.rows.find(row => row.skill === 'Magic').level, null);
  assert.throws(() => buildProfileModel(state, 'both'), /Unknown member/);
});

test('personal combat retains observed members skill values despite F2P content rules', () => {
  const state = fixture(), member = state.members[0];
  member.skillProgress = Object.fromEntries(playerControlSkills.map(skill => [skill, observation(1)]));
  member.skillProgress.Necromancy = observation(90);
  member.skillProgress.Summoning = observation(80);
  const levels = Object.fromEntries(Object.entries(member.skillProgress).map(([skill, fact]) => [skill, fact.level]));
  assert.equal(buildProfileModel(state, 'one').skills.combatLevel, combatLevelFromSkills(levels));
  assert.notEqual(buildProfileModel(state, 'one').skills.combatLevel, combatLevelFromSkills(levels, { f2p: true }));
});

test('many skill categories condense into five stable picker sections with BiS and other counts', () => {
  const state = fixture();
  state.tasks = ['Mining', 'Magic', 'Combat', 'Invention', 'BiS', 'Extra', 'Custom'].map((category, index) => ({ id: `task${index}`, category, label: category }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  const model = buildProfileModel(state, 'one');
  assert.equal(model.tasks.categories.length, 5);
  assert.equal(model.tasks.categories.find(row => row.category === 'Skills').completed, 4);
  assert.equal(model.tasks.categories.find(row => row.category === 'BiS / gear').completed, 1);
  assert.equal(model.tasks.categories.find(row => row.category === 'Other').completed, 2);
  assert.equal(model.tasks.categoryBreakdown.length, 7);
});

test('completion categories count own actual and ticked IDs once and keep unclassified IDs explicit', () => {
  const state = fixture();
  state.tasks = [{ id: 'smith', category: 'Smithing', label: 'Smith' }, { id: 'diary', category: 'Diary', label: 'Diary task' },
    { id: 'quest-step', category: 'Quest', label: 'Quest step' }, { id: 'partner', category: 'Mining', label: 'Partner only' }];
  state.members[0].completedTasks = ['smith', 'smith', 'unknown'];
  state.members[0].taskStatus = { smith: { challengeCompleted: true }, diary: { challengeCompleted: true }, 'quest-step': { challengeCompleted: true } };
  state.members[1].completedTasks = ['partner'];
  const before = structuredClone(state), model = buildProfileModel(state, 'one');
  assert.deepEqual(model.tasks.categoryBreakdown, [
    { category: 'Diary', completed: 1, ticked: 1, actual: 0 },
    { category: 'Quest', completed: 1, ticked: 1, actual: 0 },
    { category: 'Smithing', completed: 1, ticked: 1, actual: 1 },
  ]);
  assert.deepEqual(model.tasks.categories, [
    { category: 'Quests', completed: 1, ticked: 1, actual: 0 },
    { category: 'Skills', completed: 1, ticked: 1, actual: 1 },
    { category: 'BiS / gear', completed: 0, ticked: 0, actual: 0 },
    { category: 'Diaries / achievements', completed: 1, ticked: 1, actual: 0 },
    { category: 'Other', completed: 0, ticked: 0, actual: 0 },
  ]);
  assert.equal(model.tasks.completedCount, 3);
  assert.equal(model.tasks.unknownCount, 1);
  assert.deepEqual(model.achievements, { ticked: 1, total: 1, label: 'ticked in the picker' });
  assert.deepEqual(state, before);
});

