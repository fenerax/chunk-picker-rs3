import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

const saved = () => ({ members: [{ id: 'player2', completedTasks: [] }, { id: 'player1', completedTasks: [] }], rules: { 'tasks.completion': 'any', 'content.f2p': true } });
const row = (category, rawLabel, record = {}, extra = {}) => ({ id: taskId(category, rawLabel), rawLabel, label: rawLabel.replace(/~\|([^|]+)\|~/g, '$1'), category, level: record.Level ?? 1, primary: record.Primary ?? false, record, status: 'available', sources: [], blockers: [], ...extra });

test('ActivityInfo exposes complete alternatives despite next-goal display pruning', () => {
  const low = row('Woodcutting', 'Cut ~|normal logs|~', { Level: 1, Primary: true }, { sources: [{ kind: 'objects', name: 'Tree', locations: ['12342'] }] });
  const high = row('Woodcutting', 'Cut ~|oak logs|~', { Level: 15, Primary: true });
  const blocked = row('Woodcutting', 'Cut ~|locked logs|~', { Level: 30, Primary: true }, { status: 'blocked', blockers: [{ kind: 'objects', detail: 'Tree is outside unlocked access.' }] });
  const result = { tasks: [low, high, blocked], training: { Woodcutting: { level: 110, cap: 110, primary: true, passiveLevel: 1 } }, presentation: { tasks: [high], suppressed: { [low.id]: ['A higher skill goal is available.'] } } };
  const before = structuredClone(result);
  const activity = buildActivityInfo(result, saved(), 'player2');
  assert.deepEqual(activity.skills[0].primaryMethods.map(task => task.id), [high.id, low.id]);
  assert.deepEqual(activity.skills[0].selectedGoals.map(task => task.id), [high.id]);
  assert.equal(activity.skills[0].blockedTasks[0].blockers[0].kind, 'objects');
  assert.equal(activity.skills[0].reachableLevel, 110);
  const summary = activity.skills[0].availableTasks.find(task => task.id === low.id);
  assert.equal(summary.evidenceTaskId, low.id);
  assert.equal(summary.sourceCount, 1);
  assert.equal(Object.hasOwn(summary, 'sources'), false);
  assert.deepEqual(result.tasks.find(task => task.id === summary.evidenceTaskId).sources, low.sources);
  assert.match(activity.skills[0].explanation, /highest level you can train to/);
  assert.match(activity.skills[0].explanation, /current skill level is recorded separately/);
  assert.deepEqual(result, before);
});

test('quest and achievement groups retain steps, zero-point completion and personal distinction', () => {
  const step = row('Quest', '~|Quest|~ Talk to someone', { BaseQuest: 'Quest' });
  const finish = row('Quest', '~|Quest|~ Complete the quest', { QuestPoints: 0 }, { challengeSatisfied: true, personalCompleted: false });
  const diary = row('Diary', '~|Lumbridge Achievements#Easy|~ Complete the Easy Diary', { ManualShow: true });
  const activity = buildActivityInfo({ tasks: [step, finish, diary] }, saved(), 'player2');
  assert.equal(activity.quests[0].tasks.length, 2);
  assert.equal(activity.quests[0].wholeCompletion[0].id, finish.id);
  assert.equal(activity.quests[0].personallyCompletedCount, 0);
  assert.equal(activity.quests[0].challengeSatisfiedCount, 1);
  assert.equal(activity.achievements[0].name, 'Lumbridge Achievements');
});

test('primary methods respect secondary input rules, including normalized zero threshold', () => {
  const task = row('Cooking', 'Cook fish', { Primary: true, Items: ['Fish*'] });
  const state = saved(); state.taskRules = { secondaryPrimaryNum: '1/0' };
  const activity = buildActivityInfo({ tasks: [task], training: { Cooking: { level: 99, cap: 99, primary: true } }, items: [{ name: 'Fish', sources: [{ kind: 'drop', probability: .0001 }] }] }, state, 'player2');
  assert.equal(activity.skills[0].primaryMethods.length, 1);
  state.taskRules.secondaryPrimaryNum = '1/1';
  assert.equal(buildActivityInfo({ tasks: [task], training: { Cooking: {} }, items: [{ name: 'Fish', sources: [{ kind: 'drop', probability: .0001 }] }] }, state, 'player2').skills[0].primaryMethods.length, 0);
});

test('Slayer planning accepts available personal quests and fails closed for unsupported gates', () => {
  const assignment = row('Slayer', 'Receive a slayer assignment from ~|Jacquelyn|~', { Primary: true, NPCs: ['Jacquelyn'] });
  const quest = row('Quest', '~|The Blood Pact|~ Complete the quest', { QuestPoints: 1 }, { challengeSatisfied: true, personalCompleted: false });
  const definitions = { slayerMasterTasks: { Jacquelyn: { Bats: { CombatLevel: 15, Tasks: { [quest.rawLabel]: 'Quest' }, Weight: 10 }, Birds: { Weight: 10 }, Unknown: { OddGate: true, Weight: 10 } } }, codeItems: { slayerTasks: { Bats: { Bat: true }, Birds: { Chicken: true }, Unknown: { Bat: true } } } };
  const result = { tasks: [assignment, quest], training: { Combat: { level: 152 }, Slayer: { level: 5 } }, access: { monsters: ['Bat', 'Chicken'] } };
  let activity = buildActivityInfo(result, saved(), 'player2', definitions);
  assert.equal(activity.slayer.masters[0].reachable, true);
  assert.equal(activity.slayer.masters[0].tasks[0].planningEligible, true);
  assert.deepEqual(activity.slayer.masters[0].tasks[0].afterQuests, ['The Blood Pact']);
  assert.equal(activity.slayer.masters[0].tasks[0].currentUnlocked, false);
  quest.status = 'blocked';
  assert.equal(buildActivityInfo(result, saved(), 'player2', definitions).slayer.masters[0].tasks[0].planningEligible, false);
  assert.equal(activity.slayer.masters[0].tasks[1].planningEligible, true);
  assert.equal(activity.slayer.masters[0].tasks[2].blockers[0].kind, 'unsupported');
  quest.personalCompleted = true;
  activity = buildActivityInfo(result, saved(), 'player2', definitions);
  assert.equal(activity.slayer.masters[0].tasks[0].planningEligible, true);
  assert.match(activity.slayer.limitations[0], /current combat or Slayer level/);
});

test('clues retain blocked steps and geography counts without inventing a scroll probability', () => {
  const available = row('Nonskill', 'Dance here', { ClueTier: 'easy', ClueType: 'Emote' });
  const blocked = row('Nonskill', 'Dance elsewhere', { ClueTier: 'easy' }, { status: 'blocked' });
  const activity = buildActivityInfo({ tasks: [available, blocked], access: { bases: ['12342'] } }, saved(), 'player2', { clues: { easy: { '12342': true, '12595': true } } });
  assert.equal(activity.clues.tiers[0].availableCount, 1);
  assert.equal(activity.clues.tiers[0].totalCount, 2);
  assert.deepEqual(activity.clues.tiers[0].reachableLocations, ['12342']);
  assert.deepEqual(activity.activities, []);
  assert.equal(Object.hasOwn(activity.clues.tiers[0], 'successProbability'), false);
});

test('retained reference supplies all skill, quest, achievement, master and clue categories', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const state = saved(); state.members[0].unlocked = ['12342']; state.members[1].unlocked = ['11574'];
  state.members[0].sectionOverrides = { '12342-1': true };
  const result = createTaskEngine(definitions, { dataset: selectedDataset }).evaluate(state, 'player2');
  const before = JSON.stringify(state);
  const activity = buildActivityInfo(result, state, 'player2', definitions);
  assert.equal(activity.skills.length, 29);
  assert.ok(activity.quests.length > 0 && activity.quests.length < 200, 'Only own quest obligations are indexed');
  assert.ok(activity.achievements.length > 0);
  assert.equal(activity.slayer.masters.length, Object.keys(definitions.slayerMasterTasks).length);
  assert.equal(activity.clues.tiers.reduce((sum, tier) => sum + tier.totalCount, 0), result.tasks.filter(task => task.record.ClueTier && task.obligation).length);
  assert.equal(JSON.stringify(state), before);
});

test('the public malformed method keeps its permanent identity, blocked obligation and zero active goals', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const state = saved(); state.rules['content.f2p'] = false;
  state.members[0].unlocked = ['10811']; state.members[1].unlocked = [];
  const result = createTaskEngine(definitions, { dataset: selectedDataset }).evaluate(state, 'player2');
  const before = JSON.stringify({ state, result });
  const task = result.tasks.find(task => task.id === 'rs3:task:000038');
  assert.equal(task.label, 'Enter the Polar eagle eyrie|~', 'the source label is not rewritten');
  assert.equal(task.status, 'blocked'); assert.equal(task.obligation, true);
  const skill = buildActivityInfo(result, state, 'player2', definitions).skills.find(skill => skill.skill === 'Agility');
  const method = skill.blockedTasks.find(method => method.id === task.id);
  assert.ok(method, 'normal Activity Info admission includes the method');
  assert.equal(method.evidenceTaskId, task.id); assert.equal(method.label, task.label);
  assert.equal(method.personalCompleted, false); assert.equal(method.challengeSatisfied, false);
  assert.equal(skill.selectedGoals.length, 0);
  assert.equal(JSON.stringify({ state, result }), before);
});
