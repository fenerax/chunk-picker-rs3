import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { applyCommand, createGroupState } from '../app/core/state.mjs';

const ruleId = 'Non-permanent BiS';
const definitions = {
  chunks: { '12341': { Spawn: { 'Corrupt dragon spear': 1, 'Rune spear': 1, 'Corrupt dragon helm': 1, 'Rune full helm': 1 } } },
  sections: {}, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {}, codeItems: {},
  equipment: {
    'Corrupt dragon spear': { slot: '2h weapon', class: 'melee', tier: 60, ability_damage: 600, accuracy: 1200, speed: 3, requirements: { Attack: 60 } },
    'Rune spear': { slot: '2h weapon', class: 'melee', tier: 50, ability_damage: 500, accuracy: 1000, speed: 3, requirements: { Attack: 50 } },
    'Corrupt dragon helm': { slot: 'head', class: 'melee', tier: 60, armour: 300, requirements: { Defence: 60 } },
    'Rune full helm': { slot: 'head', class: 'melee', tier: 50, armour: 250, requirements: { Defence: 50 } },
  },
};

test('task worker applies the rule to active Obtain tasks, Current BiS and obligations, and Undo restores them', async t => {
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions }) });
  t.after(() => worker.terminate());
  await once(worker, 'message');
  let sequence = 0;
  const evaluate = async state => {
    const response = once(worker, 'message');
    worker.postMessage({ id: ++sequence, state, memberId: 'a' });
    const [message] = await response;
    assert.equal(message.error, undefined);
    return message.result;
  };
  const original = createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'], passiveLevels: { Attack: 60, Defence: 60 } }]);
  // Include the members-only spear tiers to isolate the permanence rule.
  original.rules['content.f2p'] = false;
  const before = await evaluate(original);
  const explicit = await evaluate(applyCommand(original, { type: 'set-task-rule', memberId: 'a', ruleId, value: true }));
  for (const field of ['equipmentPlanning', 'currentBiS', 'presentation']) assert.deepEqual(explicit[field], before[field], field);
  const beforeTasks = before.presentation.tasks.filter(row => row.category === 'BiS');
  assert.ok(beforeTasks.some(row => row.equipmentName === 'Corrupt dragon spear'));
  assert.ok(beforeTasks.some(row => row.equipmentName === 'Corrupt dragon helm'));
  const changed = applyCommand(original, { type: 'set-task-rule', memberId: 'a', ruleId, value: false });
  const after = await evaluate(changed);
  const afterTasks = after.presentation.tasks.filter(row => row.category === 'BiS');
  assert.ok(afterTasks.some(row => row.equipmentName === 'Rune spear'));
  assert.ok(afterTasks.some(row => row.equipmentName === 'Rune full helm'));
  assert.ok(!afterTasks.some(row => row.equipmentName.startsWith('Corrupt dragon')));
  assert.doesNotMatch(JSON.stringify(after.equipmentPlanning), /Corrupt dragon/);
  assert.equal(after.currentBiS.obtainable.loadouts.find(row => row.style === 'Melee').best.mainHand, 'Rune spear');
  assert.equal(after.currentBiS.obtainable.recommendations.find(row => row.style === 'Melee' && row.slot === 'head').equipment.name, 'Rune full helm');
  const oldIds = beforeTasks.filter(row => row.equipmentName.startsWith('Corrupt dragon')).map(row => row.id);
  assert.ok(oldIds.every(id => !after.equipmentPlanning.obligationIds.includes(id)));
  const undone = await evaluate(applyCommand(changed, { type: 'undo' }));
  for (const field of ['equipmentPlanning', 'currentBiS', 'presentation']) assert.deepEqual(undone[field], before[field], field);
});
