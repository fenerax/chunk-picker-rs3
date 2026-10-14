import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { houseStorageCatalogue, houseStorageRule } from '../app/data/poh-storage.mjs';
import { buildHouseStorageCatalogue, evaluateHouseStorage } from '../app/tasks/house-storage.mjs';
import { taskRuleDefinitions, taskRuleBehavior } from '../app/data/settings.mjs';

// Pure evaluator fixtures only: no server imports, file outputs or live state.
const quest = "There's No Place Like Home...";
const definitions = supplies => ({ chunks: { 100: { Object: { 'Furniture workbench': 1, 'Furniture storage': 1 }, Spawn: Object.fromEntries(supplies.map(name => [name, 1])) } },
  challenges: { Quest: { 'Complete housing tutorial': { BaseQuest: quest, Chunks: ['100'], QuestPoints: 1 } } } });
const state = (enabled = true, f2p = false, level = 120) => ({ rules: { 'content.f2p': f2p }, taskRules: { [houseStorageRule]: enabled },
  members: [{ id: 'm', unlocked: ['100'], completedTasks: [], passiveLevels: { Construction: level } }] });
const storageRows = result => result.tasks.filter(row => row.kind === 'house-storage');
const evaluate = (supplies, saved = state(), mutate = () => {}) => {
  const input = definitions(supplies); mutate(input);
  const before = structuredClone({ input, saved });
  const result = createTaskEngine(input).evaluate(saved, 'm');
  assert.deepEqual({ input, saved }, before);
  return result;
};




test('items, materials, the housing tutorial and both furniture facilities gate generation', () => {
  const supplies = ['Mask of Dragith Nurn', 'Oak plank'];
  for (const current of [[], ['Mask of Dragith Nurn'], ['Oak plank']]) assert.equal(storageRows(evaluate(current)).length, 0);
  for (const facility of ['Furniture workbench', 'Furniture storage']) {
    const result = evaluate(supplies, state(), input => delete input.chunks[100].Object[facility]);
    assert.equal(storageRows(result).length, 0); assert(result.houseStorage.exclusions.some(row => row.kind === 'location'));
  }
  const missingQuest = evaluate(supplies, state(), input => input.challenges.Quest = {});
  assert.equal(storageRows(missingQuest).length, 0); assert(missingQuest.houseStorage.exclusions.some(row => row.kind === 'quest'));
  const lockedQuest = evaluate(supplies, state(), input => input.challenges.Quest['Complete housing tutorial'].Chunks = ['200']);
  assert.equal(storageRows(lockedQuest).length, 0);
});





