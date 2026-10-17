import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { buildChunkPlanningIndex } from '../app/tasks/chunk-planning-index.mjs';

const state = (unlocked = ['100']) => ({ rules: {}, members: [{ id: 'm', unlocked, completedTasks: [] }] });
const supply = paymentAlternatives => ({ mode: 'closure-only', paymentAlternatives });
const find = (result, label) => result.tasks.find(row => row.rawLabel === label);
const has = (result, name) => result.items.some(row => row.name === name);
const definitions = payment => ({ chunks: { 100: { NPC: { Supplier: 1 }, Spawn: payment ? { [payment]: 1 } : {} }, 101: {} },
  challenges: { Nonskill: { Purchase: { NPCs: ['Supplier'], Output: 'Rope', DialogueSupply: supply([{ Coins: 15 }, { Wool: 4 }]) } } } });

test('dialogue supplies need an admitted NPC and one reachable payment alternative', () => {
  for (const payment of ['Coins', 'Wool']) {
    const engine = createTaskEngine(definitions(payment));
    const result = engine.evaluate(state(), 'm');
    assert.equal(find(result, 'Purchase').status, 'available');
    assert.ok(has(result, 'Rope'));
    const source = result.items.find(row => row.name === 'Rope').sources[0];
    assert.equal(source.balanceVerified, false);
    assert.equal(source.renewable, true);
    assert.deepEqual(source.dialogueSupply.paymentAlternatives, [{ Coins: 15 }, { Wool: 4 }]);
    assert.match(find(result, 'Purchase').explanation, /held balance.*not tracked/i);
    assert.ok(!has(engine.evaluate(state(['101']), 'm'), 'Rope'));
  }
  const unpaid = createTaskEngine(definitions()).evaluate(state(), 'm');
  assert.equal(find(unpaid, 'Purchase').status, 'blocked');
  assert.equal(find(unpaid, 'Purchase').blockers[0].kind, 'payment-source');
  assert.ok(!has(unpaid, 'Rope'));
});

test('dialogue payment cannot bootstrap its own output or an unpaid cycle', () => {
  const data = definitions();
  data.challenges.Nonskill.Cycle = { Items: ['Rope'], Output: 'Coins' };
  const result = createTaskEngine(data).evaluate(state(), 'm');
  assert.ok(!has(result, 'Coins')); assert.ok(!has(result, 'Rope'));
  const saved = state(); saved.members[0].completedTasks = [taskId('Nonskill', 'Purchase')];
  assert.ok(!has(createTaskEngine(definitions()).evaluate(saved, 'm'), 'Rope'));
});

test('ordinary harvest requires its reviewed local object without Farming or cross-location substitution', () => {
  const data = { chunks: { 100: { Object: { Onion: 1 } }, 101: {}, 102: { Object: { Onion: 1 } } }, challenges: { Nonskill: {
    Harvest: { Objects: ['Onion'], SourceLocations: [{ field: 'Objects', name: 'Onion', locations: ['100'] }], Output: 'Onion' },
  } } };
  const engine = createTaskEngine(data), result = engine.evaluate(state(), 'm');
  assert.ok(has(result, 'Onion')); assert.equal(result.training.Farming.primary, false);
  assert.ok(!has(engine.evaluate(state(['101', '102']), 'm'), 'Onion'));
  assert.equal(find(engine.evaluate(state(['102']), 'm'), 'Harvest').obligation, false);
  const both = engine.evaluate(state(['100', '102']), 'm');
  assert.deepEqual(find(both, 'Harvest').sources[0].locations, ['100']);
  const index = buildChunkPlanningIndex(data, both, { chunks: new Map([['100', {}], ['102', {}]]) });
  assert.ok(!index.byLocation.get('102')?.has(taskId('Nonskill', 'Harvest')));
  const completed = state(['101', '102']); completed.members[0].completedTasks = [taskId('Nonskill', 'Harvest')];
  assert.ok(!has(engine.evaluate(completed, 'm'), 'Onion'));
});

test('finite completion rewards expose quantities without renewable item or training closure', () => {
  const rewards = [{ item: 'Egg', quantity: 10 }, { item: 'Feather', quantity: 300 }, { item: 'Coins', quantity: 3000 }];
  const data = { chunks: { 100: {}, 101: {} }, challenges: {
    Quest: { Finish: { Chunks: ['100'], QuestPoints: 4, BaseQuest: 'Example quest', FiniteRewards: rewards } },
    Fishing: { 'Use feathers': { Items: ['Feather'], Primary: true, Output: 'Fish' } },
    Cooking: { 'Cook eggs': { Items: ['Egg'], Primary: true, Output: 'Food' } },
  } };
  const engine = createTaskEngine(data), saved = state(), before = structuredClone(saved);
  const result = engine.evaluate(saved, 'm');
  assert.deepEqual(saved, before);
  assert.equal(result.points.QuestPointsNeeded, 4);
  assert.equal(result.finiteRewards.length, 3);
  assert.deepEqual(result.finiteRewards.map(({ item, quantity }) => ({ item, quantity })), rewards);
  assert.ok(result.finiteRewards.every(row => row.status === 'attainable-on-completion' && row.remainingQuantity === null && row.renewable === false));
  for (const item of ['Egg', 'Feather', 'Coins', 'Fish', 'Food']) assert.ok(!has(result, item));
  assert.equal(result.training.Fishing.primary, false); assert.equal(result.training.Cooking.primary, false);
  const blocked = engine.evaluate(state(['101']), 'm');
  assert.ok(blocked.finiteRewards.every(row => row.status === 'completion-blocked'));
  saved.members[0].completedTasks = [taskId('Quest', 'Finish')];
  const completed = engine.evaluate(saved, 'm');
  assert.ok(completed.finiteRewards.every(row => row.status === 'completion-recorded' && row.claimStatus === 'untracked'));
  assert.ok(!has(completed, 'Feather'));
  completed.finiteRewards[0].quantity = 999;
  assert.equal(engine.evaluate(saved, 'm').finiteRewards[0].quantity, 10);
});

test('ordinary independent supplies survive finite reward exclusion', () => {
  const data = { chunks: { 100: { Spawn: { Egg: 1 } } }, challenges: { Quest: { Finish: { FiniteRewards: [{ item: 'Egg', quantity: 10 }] } } } };
  const result = createTaskEngine(data).evaluate(state(), 'm');
  assert.ok(has(result, 'Egg'));
  assert.ok(result.items.find(row => row.name === 'Egg').sources.every(source => source.kind !== 'reward'));
});

test('personal entry alternatives accept personal quest or recorded manual evidence only', () => {
  const observation = `${selectedDataset.identityNamespace ?? 'rs3'}:${selectedDataset.capabilities.independent ? 'activity' : 'task'}:entry-observation`;
  const data = { chunks: { 100: {} }, challenges: {
    Nonskill: {
      Observation: { PickerId: observation, ManualChecks: ['Confirm the entry in game.'] },
      Entry: { PersonalRequirementAlternatives: [{ quest: 'Example quest' }, { completedTask: observation }], Output: 'Entry proof' },
    }, Quest: { Finish: { QuestPoints: 1, BaseQuest: 'Example quest' } },
  } };
  const engine = createTaskEngine(data), saved = state();
  assert.equal(find(engine.evaluate(saved, 'm'), 'Entry').status, 'blocked');
  assert.match(find(engine.evaluate(saved, 'm'), 'Entry').explanation, /recorded Observation/);
  assert.ok(!find(engine.evaluate(saved, 'm'), 'Entry').explanation.includes(observation));
  saved.members[0].taskStatus = { [observation]: { challengeCompleted: true } };
  saved.members.push({ id: 'partner', unlocked: [], completedTasks: [observation, taskId('Quest', 'Finish')] });
  assert.equal(find(engine.evaluate(saved, 'm'), 'Entry').status, 'blocked');
  for (const id of [observation, taskId('Quest', 'Finish')]) {
    saved.members[0].completedTasks = [id];
    assert.equal(find(engine.evaluate(saved, 'm'), 'Entry').status, 'available');
  }
});

test('malformed or ambiguous supply and reward declarations fail closed', () => {
  for (const bad of [supply([{ Coins: 0 }]), supply([]), { mode: 'wallet', paymentAlternatives: [{ Coins: 1 }] }]) {
    const data = definitions('Coins'); data.challenges.Nonskill.Purchase.DialogueSupply = bad;
    const result = createTaskEngine(data).evaluate(state(), 'm');
    assert.equal(find(result, 'Purchase').status, 'unsupported'); assert.ok(!has(result, 'Rope'));
  }
  const noSeller = definitions('Coins'); delete noSeller.challenges.Nonskill.Purchase.NPCs;
  assert.equal(find(createTaskEngine(noSeller).evaluate(state(), 'm'), 'Purchase').status, 'unsupported');
  for (const field of [['Objects'], 'toString']) {
    const data = definitions('Coins');
    data.challenges.Nonskill.Purchase.SourceLocations = [{ field, name: 'Supplier', locations: ['100'] }];
    const result = createTaskEngine(data).evaluate(state(), 'm');
    assert.equal(find(result, 'Purchase').status, 'unsupported'); assert.ok(!has(result, 'Rope'));
  }
  for (const reward of [[{ item: 'Egg', quantity: 0 }], [{ item: 'Rope', quantity: 10 }]]) {
    const data = definitions('Coins'); data.challenges.Nonskill.Purchase.FiniteRewards = reward;
    const result = createTaskEngine(data).evaluate(state(), 'm');
    assert.equal(find(result, 'Purchase').status, 'unsupported'); assert.ok(!has(result, 'Rope'));
  }
  const indirect = { chunks: { 100: {} }, codeItems: { dropTables: { Prize: { Feather: 'Always' } } }, challenges: {
    Quest: { Finish: { Output: 'Prize', FiniteRewards: [{ item: 'Feather', quantity: 300 }] } },
  } };
  const result = createTaskEngine(indirect).evaluate(state(), 'm');
  assert.equal(find(result, 'Finish').status, 'unsupported'); assert.ok(!has(result, 'Feather'));
});
