import test from 'node:test';
import assert from 'node:assert/strict';
import { duoFixture } from './fixtures/partner.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildPartnerSupplyModel } from '../app/web/partner-supply-model.mjs';

const row = (result, label) => result.tasks.find(task => task.id === taskId('Extra', label));
const resultsFor = (engine, state) => new Map(state.members.map(member => [member.id,
  { ...engine.evaluate(state, member.id), memberId: member.id, stateRevision: state.revision }]));

test('existing engine supply proof feeds own tasks without inheriting partner obligations', () => {
  const { state, engine } = duoFixture(), results = resultsFor(engine, state), own = row(results.get('player1'), 'Own');
  assert.deepEqual(own.partnerItemNeeds.map(({ sources, ...need }) => need), [{ requirement: 'Bar', count: 1, ownCount: 0, items: ['Bar'] }]);
  const requests = buildPartnerSupplyModel(state, results).members[0].requests;
  assert.deepEqual(requests.map(request => request.items[0].name), ['Bar']);
  assert.equal(requests[0].needs[0].label, 'Own'); assert.equal(requests[0].items[0].quantity, null);
});

test('unconnected supplies do not produce a request', () => {
  const { state, engine } = duoFixture(false, '12849'), results = resultsFor(engine, state);
  assert.equal(row(results.get('player1'), 'Own').partnerItemNeeds, undefined);
  assert.equal(buildPartnerSupplyModel(state, results).members[0].requests.length, 0);
});

test('aliases retain missing distinct choices and suppress locally satisfied alternatives', () => {
  const { data, state } = duoFixture();
  data.codeItems.itemsPlus = { 'Supply[+]': ['Own sword', 'Partner sword', 'Gem'] };
  data.challenges.Extra.Choice = { Chunks: ['12850'], Items: ['Supply[+]x2'] };
  data.challenges.Extra.LocalChoice = { Chunks: ['12850'], Items: ['Supply[+]'] };
  const results = resultsFor(createTaskEngine(data), state), need = row(results.get('player1'), 'Choice').partnerItemNeeds[0];
  assert.equal(need.count, 2); assert.equal(need.ownCount, 1); assert.deepEqual(need.items, ['Partner sword', 'Gem']);
  assert.equal(row(results.get('player1'), 'LocalChoice').partnerItemNeeds, undefined);
  const choice = buildPartnerSupplyModel(state, results).members[0].requests.find(request => request.choiceCount);
  assert.equal(choice.choiceCount, 1); assert.deepEqual(choice.items.map(item => item.name), ['Gem', 'Partner sword']);
  assert.ok(choice.items.every(item => item.quantity === null));
});

test('source policies remain authoritative even for otherwise blocked own tasks', () => {
  const { data, state } = duoFixture();
  data.challenges.Extra.Rejected = { Chunks: ['12850'], Items: ['Partner sword'], NonShop: true };
  data.challenges.Extra.Blocked = { Chunks: ['12850'], Items: ['Partner sword'], Skills: { Mining: 50 } };
  const results = resultsFor(createTaskEngine(data), state);
  assert.equal(row(results.get('player1'), 'Rejected').partnerItemNeeds, undefined);
  assert.equal(row(results.get('player1'), 'Blocked').status, 'blocked');
  assert.equal(row(results.get('player1'), 'Blocked').partnerItemNeeds[0].items[0], 'Partner sword');
  assert.ok(buildPartnerSupplyModel(state, results).members[0].requests.some(request => request.needs.some(need => need.label === 'Blocked')));
});

test('whole-quest goals inherit item proof from the existing compiled same-quest steps', () => {
  const { data, state } = duoFixture();
  state.members[0].taskRules['Show Quest Tasks Complete'] = true;
  data.codeItems.tasksPlus = { 'Either step[+]': ['Collect', 'Other quest'] };
  data.challenges.Quest = {
    Complete: { BaseQuest: 'Test quest', QuestPoints: 1, Chunks: ['12850'], Tasks: { Return: 'Quest' } },
    Return: { BaseQuest: 'Test quest', Chunks: ['12850'], Tasks: { Collect: 'Quest', 'Other quest': 'Quest', 'Either step[+]': 'Quest' } },
    Collect: { BaseQuest: 'Test quest', Chunks: ['12850'], Items: ['Partner sword'] },
    'Other quest': { BaseQuest: 'External quest', Chunks: ['12850'], Items: ['Gem'] },
  };
  const results = resultsFor(createTaskEngine(data), state), own = results.get('player1');
  const get = label => own.tasks.find(task => task.id === taskId('Quest', label));
  assert.deepEqual(get('Complete').dependencyTaskIds, [get('Return').id]);
  assert.deepEqual(get('Return').dependencyTaskIds, [get('Collect').id]);
  assert.equal(get('Collect').hidden, true); assert.equal(get('Complete').hidden, false);
  const requests = buildPartnerSupplyModel(state, results).members[0].requests;
  const questNeed = requests.find(request => request.items[0].name === 'Partner sword');
  assert.deepEqual(questNeed.needs.map(need => need.taskId), [get('Complete').id]);
});
