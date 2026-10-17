import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { withActivityTimingTags } from '../app/data/activity-timing.mjs';
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

for (const Achievement of [false, true]) for (const showArea of [false, true])
  for (const Complete of [false, true]) for (const Any of [false, true]) {
    test(`achievement controls: Achievement=${Achievement}, area=${showArea}, Complete=${Complete}, Any=${Any}`, () => {
      const rules = { Achievement, 'Show Diary Tasks': showArea, 'Show Diary Tasks Complete': Complete,
        'Show Diary Tasks Any': Any, 'Misc achievements': true, 'Combat Mastery achievements': true };
      const data = definitions({
        'Earlier tier': area({ ManualShow: true, Reward: 'Earlier token', NPCs: ['Inaccessible fixture NPC'] }),
        'Later duty': area({ Tasks: { 'Earlier tier': 'Diary' }, Output: 'Fixture achievement output' }),
        'Ready area duty': area({}),
        'Explicit false marker': area({ ManualShow: false }),
        'Misc duty': { BaseQuest: 'Skills achievements', Category: ['Misc achievements'] },
        'Combat duty': { BaseQuest: 'Combat Mastery achievements', Category: ['Combat Mastery achievements'] },
      });
      data.challenges.Extra = { 'Use achievement output': { Items: ['Fixture achievement output'] } };
      const result = evaluate(data, state(rules));
      for (const name of ['Ready area duty', 'Explicit false marker']) {
        assert.equal(row(result, name).status, showArea ? 'available' : 'blocked', name);
        assert.equal(row(result, name).hidden, !Achievement, `${name} uses the independent display gate`);
      }
      assert.equal(row(result, 'Earlier tier').status, 'blocked');
      assert.equal(row(result, 'Later duty').status, showArea && Any ? 'available' : 'blocked');
      if (showArea && Any) {
        assert.equal(row(result, 'Later duty').obligation, true, 'a waived earlier tier does not remove the current personal duty');
        assert.equal(row(result, 'Later duty').hidden, !Achievement);
      }
      for (const name of ['Misc duty', 'Combat duty']) {
        assert.equal(row(result, name).status, 'available', `${name} is independent of area eligibility`);
        assert.equal(row(result, name).hidden, !Achievement);
      }
      assert.equal(result.items.some(item => item.name === 'Fixture achievement output'), showArea && Any);
      assert.equal(row(result, 'Use achievement output', 'Extra').status, showArea && Any ? 'available' : 'blocked');
      const expected = [];
      if (Achievement) {
        if (!Complete) expected.push('Misc duty', 'Combat duty');
        if (showArea) {
          expected.push('Explicit false marker');
          if (!Complete) expected.push('Ready area duty', ...(Any ? ['Later duty'] : []));
        }
      }
      assert.deepEqual(selectedNames(result.presentation), expected.sort());
    });
  }

test('achievement family and subfamily tags are conjunctive eligibility gates independent of display', () => {
  const families = ['Combat Mastery achievements', 'Comp achievements', 'MQC achievements', 'Misc achievements', 'Misc Combat achievements'];
  const data = definitions(Object.fromEntries(families.map(family => [family, { Category: [family, 'Fixture subfamily'] }])));
  for (const enabledFamily of families) for (const subfamily of [false, true]) for (const Achievement of [false, true]) {
    const rules = Object.fromEntries(families.map(family => [family, family === enabledFamily]));
    Object.assign(rules, { Achievement, 'Show Diary Tasks': false, 'Fixture subfamily': subfamily });
    const result = evaluate(data, state(rules));
    for (const family of families) assert.equal(row(result, family).status,
      family === enabledFamily && subfamily ? 'available' : 'blocked', family);
    assert.deepEqual(selectedNames(result.presentation), Achievement && subfamily ? [enabledFamily] : []);
  }
});



test('Any alias relaxation requires Reward presence and counts distinct qualified alternatives', () => {
  const data = definitions({
    'Reward A': area({ Reward: false, NPCs: ['Inaccessible fixture NPC'] }),
    'Reward B': area({ Reward: 'B', NPCs: ['Inaccessible fixture NPC'] }),
    'Plain target': area({ NPCs: ['Inaccessible fixture NPC'] }),
    'Reachable plain target': area({}),
    'Two rewards': area({ Tasks: { 'Rewards[+]x2': 'Diary' } }),
    'Valid and relaxed choices': area({ Tasks: { 'Attainable[+]x2': 'Diary' } }),
    'Duplicate reward': area({ Tasks: { 'Duplicate[+]x2': 'Diary' } }),
    'Insufficient rewards': area({ Tasks: { 'Mixed[+]x2': 'Diary' } }),
    'Alias tier': area({ ManualShow: true, Tasks: { 'Rewards[+]x2': 'Diary' } }),
    'Alias parent reward': area({ Reward: false, Tasks: { 'Rewards[+]': 'Diary' } }),
    'Unknown alias': area({ Tasks: { 'Unknown[+]': 'Diary' } }),
  }, { codeItems: { tasksPlus: { 'Rewards[+]': ['Reward A--Diary', 'Reward B--Diary'],
    'Duplicate[+]': ['Reward A--Diary', 'Reward A--Diary'], 'Mixed[+]': ['Reward A--Diary', 'Plain target--Diary'],
    'Attainable[+]': ['Reward A--Diary', 'Reachable plain target--Diary'] } } });
  for (const Any of [false, true]) {
    const result = evaluate(data, state({ 'Show Diary Tasks Any': Any }));
    for (const name of ['Two rewards', 'Alias tier', 'Valid and relaxed choices']) assert.equal(row(result, name).status, Any ? 'available' : 'blocked', name);
    for (const name of ['Duplicate reward', 'Insufficient rewards', 'Alias parent reward']) assert.equal(row(result, name).status, 'blocked', name);
    assert.equal(row(result, 'Unknown alias').status, 'unsupported');
  }
});

test('Combat Mastery prerequisite exception is independent of Any and does not erase other gates', () => {
  const data = definitions({
    'Combat tier': { BaseQuest: 'Combat Mastery achievements', Reward: 'Combat token', NPCs: ['Inaccessible fixture NPC'] },
    'Combat duty': { BaseQuest: 'Combat Mastery achievements', Category: ['Combat Mastery achievements'], Tasks: { 'Combat tier': 'Diary' } },
    'Combat alias duty': { BaseQuest: 'Combat Mastery achievements', Category: ['Combat Mastery achievements'], Tasks: { 'Combat tiers[+]': 'Diary' } },
    'Whole combat tier': { BaseQuest: 'Combat Mastery achievements', ManualShow: true, Tasks: { 'Combat tier': 'Diary' } },
  }, { codeItems: { tasksPlus: { 'Combat tiers[+]': ['Combat tier--Diary'] } } });
  for (const Any of [false, true]) for (const family of [false, true]) {
    const result = evaluate(data, state({ 'Show Diary Tasks Any': Any, 'Combat Mastery achievements': family }));
    for (const name of ['Combat duty', 'Combat alias duty']) assert.equal(row(result, name).status, family ? 'available' : 'blocked', name);
    assert.equal(row(result, 'Whole combat tier').status, 'blocked');
  }
});

test('ordinary cross-category suffix exception does not relax cross-category aliases', () => {
  const data = definitions({
    'Plain cross dependency': area({ Tasks: { 'Cross tier': 'Extra' } }),
    'Suffixed cross dependency': area({ Tasks: { 'Cross tier--fixture': 'Extra' } }),
    'Uncounted cross alias': area({ Tasks: { 'Cross[+]': 'Extra' } }),
    'Counted cross alias': area({ Tasks: { 'Cross[+]x2': 'Extra' } }),
  }, { codeItems: { tasksPlus: { 'Cross[+]': ['Cross tier--Extra', 'Other cross tier--Extra'] } } });
  data.challenges.Extra = {
    'Cross tier': { Reward: 'Cross token', NPCs: ['Inaccessible fixture NPC'] },
    'Other cross tier': { Reward: 'Other token', NPCs: ['Inaccessible fixture NPC'] },
  };
  for (const Any of [false, true]) {
    const result = evaluate(data, state({ 'Show Diary Tasks Any': Any }));
    assert.equal(row(result, 'Plain cross dependency').status, 'blocked');
    assert.equal(row(result, 'Suffixed cross dependency').status, Any ? 'available' : 'blocked');
    assert.equal(row(result, 'Uncounted cross alias').status, 'blocked');
    assert.equal(row(result, 'Counted cross alias').status, 'blocked');
  }
});


test('completable tiers group only explicit same-family children while Activity Info retains all rows', () => {
  const names = {
    parent: '~|Fixture Achievements#Easy|~ Complete the Easy tier',
    child: '~|Fixture Achievements#Easy|~ Individual duty',
    tier: '~|Fixture Achievements#Beginner|~ Complete the Beginner tier',
    other: '~|Other Achievements#Easy|~ Other duty',
    unreferenced: '~|Fixture Achievements#Easy|~ Unreferenced duty',
  };
  const data = definitions({
    [names.parent]: area({ ManualShow: true, Tasks: { 'Children[+]': 'Diary', [names.tier]: 'Diary', [names.other]: 'Diary' } }),
    [names.child]: area({ Skills: { Mining: 1 } }),
    [names.tier]: area({ ManualShow: true }),
    [names.other]: { BaseQuest: 'Other Achievements' },
    [names.unreferenced]: area({}),
  }, { codeItems: { tasksPlus: { 'Children[+]': [names.child + '--Diary'] } } });
  const saved = state(), result = evaluate(data, saved);
  assert.deepEqual(selectedNames(result.presentation), [names.parent, names.tier, names.other, names.unreferenced].sort());
  assert.equal(row(result, names.child).status, 'available');
  assert.deepEqual(row(result, names.child).record.Skills, { Mining: 1 });
  assert.match(result.presentation.suppressed[row(result, names.child).id].join(' '), /achievement parent/);
  const activity = buildActivityInfo(result, saved, 'a', data);
  const group = activity.achievements.find(group => group.name === 'Fixture Achievements');
  assert.equal(group.tasks.length, 4);
  assert.equal(group.tasks.find(task => task.id === row(result, names.child).id).selected, false);
  assert.deepEqual(group.wholeCompletion.map(task => task.id).sort(), [row(result, names.parent).id, row(result, names.tier).id].sort());
  for (const extras of [{ status: 'blocked' }, { obligation: false }]) {
    const input = structuredClone(result);
    Object.assign(row(input, names.parent), extras);
    assert.ok(selectPresentedTasks(input, saved, 'a', data).tasks.some(task => task.rawLabel === names.child));
  }
  saved.members[0].taskStatus = { [row(result, names.parent).id]: { backlogged: true } };
  assert.ok(selectPresentedTasks(result, saved, 'a', data).tasks.some(task => task.rawLabel === names.child));
});

test('required achievement groups follow family rules independently of active selection and completion', () => {
  const families = ['Fixture Achievements', 'Combat Mastery achievements', 'Completionist achievements',
    'Skills achievements', 'Exploration achievements', 'Activities achievements', 'Combat achievements'];
  const data = definitions(Object.fromEntries(families.map(family => [`~|${family}#Easy|~ Duty`, { BaseQuest: family }])));
  for (const comp of [false, true]) for (const mqc of [false, true]) {
    const saved = state({ Achievement: false, 'Comp achievements': comp, 'MQC achievements': mqc,
      'Combat Mastery achievements': true, 'Misc achievements': false, 'Misc Combat achievements': true });
    saved.members[0].completedTasks = Object.keys(data.challenges.Diary).map(name => taskId('Diary', name));
    const result = evaluate(data, saved);
    assert.deepEqual(result.presentation.tasks, []);
    const activity = buildActivityInfo(result, saved, 'a', data);
    const required = Object.fromEntries(activity.achievements.map(group => [group.name, group.required]));
    assert.deepEqual(required, {
      'Fixture Achievements': true, 'Combat Mastery achievements': true, 'Completionist achievements': comp || mqc,
      'Skills achievements': false, 'Exploration achievements': false, 'Activities achievements': false, 'Combat achievements': true,
    });
    assert.ok(activity.achievements.every(group => group.personallyCompletedCount === 1));
  }
  const saved = state({ 'Combat Mastery achievements': false, 'Comp achievements': false, 'MQC achievements': false,
    'Misc achievements': true, 'Misc Combat achievements': false });
  const result = evaluate(data, saved), activity = buildActivityInfo(result, saved, 'a', data);
  assert.deepEqual(activity.achievements.filter(group => group.required).map(group => group.name).sort(),
    ['Fixture Achievements', 'Skills achievements', 'Exploration achievements', 'Activities achievements'].sort());
});

// Reviewed timing gates also apply to supplies and generated equipment goals.
{
  const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
    metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
    skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
  const description = 'Score 1,111 in a session of the Big Chinchompa minigame.';
  const definitions = {
    chunks: { '1': { Spawn: { 'Protea flower': 1, 'Ordinary flower': 1 }, Shop: { 'Fixture shop': true } } },
    shopItems: { 'Fixture shop': { 'Ordinary flower': 1 } },
    challenges: { Diary: { 'Fixture score': { Category: ['Comp achievements'], Description: description, Chunks: ['1'] },
      'Untimed fixture': { Category: ['Comp achievements'], Chunks: ['1'] } },
      Crafting: { 'Fixture recipe': { Items: ['Protea flower'], Output: 'Fixture product', Level: 1 } } },
    equipment: { 'Protea flower': { slot: '2h weapon', class: 'melee', tier: 1, style: 'slash', ability_damage: 10, accuracy: 20, speed: 3, requirements: {} } },
  };
  const saved = taskRules => ({ rules: { 'content.f2p': false }, members: [{ id: 'a', unlocked: ['1'], completedTasks: [], taskRules }] });

  for (const [Timegated, DnD, allowed] of [[false, true, false], [true, false, false], [true, true, true]]) {
    test(`activity timing gates achievement, supplies and equipment: Timegated=${Timegated}, DnD=${DnD}`, () => {
      const state = saved({ Timegated, DnD, 'Comp achievements': true });
      const before = structuredClone({ definitions, state });
      const result = createTaskEngine(definitions, options).evaluate(state, 'a');
      const score = result.tasks.find(row => row.rawLabel === 'Fixture score');
      assert.deepEqual(score.record.Category, ['Comp achievements', 'Timegated', 'DnD']);
      assert.equal(score.status === 'available', allowed);
      assert.equal(result.tasks.find(row => row.rawLabel === 'Untimed fixture').status, 'available');
      assert.equal(result.items.some(item => item.name === 'Protea flower'), allowed);
      assert.equal(result.items.some(item => item.name === 'Fixture product'), allowed, 'disabled activity cannot supply a recipe');
      assert.ok(result.items.some(item => item.name === 'Ordinary flower'));
      const equipment = evaluateEquipment(result, state, 'a', definitions);
      assert.equal(equipment.tasks.some(row => row.equipmentName === 'Protea flower'), allowed);
      const presented = selectPresentedTasks(result, state, 'a', definitions);
      assert.equal(presented.tasks.some(row => row.id === score.id), allowed);
      if (!allowed) assert.ok(result.diagnostics.some(row => row.code === 'activity-rule-disabled'));
      assert.deepEqual({ definitions, state }, before);
    });
  }

  test('timing tags are idempotent and unrelated activities keep their authored classification', () => {
    const record = { Description: description, Category: ['Comp achievements'] };
    const tagged = withActivityTimingTags('Diary', record);
    assert.equal(withActivityTimingTags('Diary', tagged), tagged);
    assert.equal(withActivityTimingTags('Hunter', record), record);
    const other = { Description: 'Catch an ordinary chinchompa.', Category: ['Minigame'] };
    assert.equal(withActivityTimingTags('Diary', other), other);
  });

  test('reward-shop supplies respect timing rules without blocking the same ordinary item elsewhere', () => {
    const data = { ...definitions, chunks: { '1': { Spawn: { 'Ordinary flower': 1 }, Shop: { 'Reward Shop (Big Chinchompa)': true } } },
      shopItems: { 'Reward Shop (Big Chinchompa)': { 'Fixture reward': 1, 'Ordinary flower': 1 } } };
    const engine = createTaskEngine(data, options);
    const off = engine.evaluate(saved({ Timegated: false, DnD: true }), 'a');
    assert.equal(off.items.some(item => item.name === 'Fixture reward'), false);
    assert.deepEqual(off.items.find(item => item.name === 'Ordinary flower').sources.map(source => source.kind), ['spawn']);
    const on = engine.evaluate(saved({ Timegated: true, DnD: true }), 'a');
    assert.ok(on.items.some(item => item.name === 'Fixture reward'));
  });
}
