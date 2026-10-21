import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';

// Synthetic definitions only: no server, private save, asset cache or outputs.
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
const state = (taskRules = {}, f2p = false) => ({ rules: { 'content.f2p': f2p },
  members: [{ id: 'a', unlocked: ['1'], completedTasks: [], taskRules }] });
const definitions = (Diary, extra = {}) => ({ chunks: { '1': {} }, challenges: { Diary }, ...extra });
const row = (result, name, category = 'Diary') => result.tasks.find(task => task.rawLabel === name && task.category === category);
const selectedNames = result => result.tasks.filter(task => task.category === 'Diary').map(task => task.rawLabel).sort();
const evaluate = (data, saved) => {
  const before = structuredClone({ data, saved });
  const result = createTaskEngine(data, options).evaluate(saved, 'a');
  result.presentation = selectPresentedTasks(result, saved, 'a', data);
  assert.deepEqual({ data, saved }, before, 'evaluation and presentation preserve declarations and saved facts');
  return result;
};
const area = record => ({ BaseQuest: 'Fixture Achievements', Category: ['Show Diary Tasks'], ...record });

test('Any relaxes ordinary prior-tier duties while keeping tier, unknown, and local requirements', () => {
  const data = definitions({
    Prior: area({ NPCs: ['Inaccessible fixture NPC'] }),
    Duty: area({ Tasks: { Prior: 'Diary' } }),
    'False marker': area({ ManualShow: false, Tasks: { Prior: 'Diary' } }),
    'Whole tier': area({ ManualShow: true, Tasks: { Prior: 'Diary' } }),
    'Unknown target': area({ Tasks: { Unknown: 'Diary' } }),
    'Local condition': area({ Tasks: { Prior: 'Diary' }, NPCs: ['Other inaccessible fixture NPC'] }),
    'Nonarea duty': { BaseQuest: 'Skills achievements', Tasks: { Prior: 'Diary' } },
  });
  for (const Any of [false, true]) {
    const result = evaluate(data, state({ 'Show Diary Tasks Any': Any }));
    for (const name of ['Duty', 'False marker']) assert.equal(row(result, name).status, Any ? 'available' : 'blocked', name);
    for (const name of ['Whole tier', 'Local condition', 'Nonarea duty']) assert.equal(row(result, name).status, 'blocked', name);
    assert.equal(row(result, 'Unknown target').status, 'unsupported');
  }
});

test('malformed Any values default off for eligibility and ownership while preserving saved diagnostics', () => {
  const ruleId = 'Show Diary Tasks Any';
  const data = definitions({
    Prior: area({ Reward: false, NPCs: ['Inaccessible fixture NPC'] }),
    Duty: area({ Tasks: { Prior: 'Diary' }, Output: 'Fixture malformed Any output' }),
    'Alias duty': area({ Tasks: { 'Prior tiers[+]': 'Diary' } }),
  }, { codeItems: { tasksPlus: { 'Prior tiers[+]': ['Prior--Diary'] } } });
  for (const value of ['banana', null, 1]) {
    const saved = state({ [ruleId]: value }), result = evaluate(data, saved);
    for (const name of ['Duty', 'Alias duty']) {
      assert.equal(row(result, name).status, 'blocked', `${name}: ${String(value)}`);
      assert.equal(row(result, name).obligation, false, `${name} retains its unwaived prerequisite`);
    }
    assert.deepEqual(result.presentation.tasks, []);
    assert.equal(result.items.some(item => item.name === 'Fixture malformed Any output'), false);
    const diagnostics = result.diagnostics.filter(entry => entry.code === 'invalid-task-rule' && entry.ruleId === ruleId);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].value, value);
    assert.equal(diagnostics[0].memberId, 'a');
    assert.match(diagnostics[0].detail, /boolean.*saved value is preserved.*rule default/i);
    assert.equal(saved.members[0].taskRules[ruleId], value);
  }
});

test('F2P membership, supply and skill-cap gates remain authoritative with Any enabled', () => {
  const data = definitions({
    Prior: area({ Reward: 'Tier token', NPCs: ['Inaccessible fixture NPC'] }),
    'Free duty': area({ Tasks: { Prior: 'Diary' } }),
    'Member duty': area({ 'Not F2P': true, Tasks: { Prior: 'Diary' } }),
    'Member supply': area({ Items: ['Magic longbow'], Tasks: { Prior: 'Diary' } }),
    'Member skill': area({ Skills: { Agility: 6 }, Tasks: { Prior: 'Diary' } }),
  }, { chunks: { '1': { Spawn: { 'Magic longbow': 1 } } } });
  data.challenges.Agility = { 'Fixture agility training': { Primary: true, Level: 1 } };
  for (const f2p of [false, true]) {
    const result = evaluate(data, state({ 'Show Diary Tasks Any': true }, f2p));
    assert.equal(row(result, 'Free duty').status, 'available');
    for (const name of ['Member duty', 'Member supply', 'Member skill']) {
      assert.equal(row(result, name).status, f2p ? 'blocked' : 'available', name);
      if (f2p) assert.ok(row(result, name).blockers.some(blocker => blocker.kind === 'membership'), name);
    }
  }
});

