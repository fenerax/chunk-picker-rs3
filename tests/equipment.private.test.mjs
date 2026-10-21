import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEquipmentCatalogue, equipmentPower, evaluateEquipment, buildCurrentBiS } from '../app/tasks/equipment.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';
import { migrateTaskIdentities } from '../app/tasks/migration.mjs';

const state = (taskRules = {}) => ({ members: [{ id: 'a', completedTasks: [], taskRules }], rules: { 'content.f2p': false } });
const weapon = (tier, slot = '2h weapon', klass = 'melee', extras = {}) => ({ slot, class: klass, tier, ability_damage: tier * (slot === 'off-hand weapon' ? 4.8 : 9.6), accuracy: tier * 20, speed: 3, requirements: { [klass === 'melee' ? 'Attack' : klass === 'magic' ? 'Magic' : 'Ranged']: tier }, ...extras });
const run = (equipment, codeItems = {}, taskRules = {}, names = Object.keys(equipment)) => evaluateEquipment({ equipment: names.map(name => ({ name, slot: equipment[name].slot, sources: [{ kind: 'shop', name: 'Test shop' }] })), training: { Attack: { level: 99, primary: true } }, access: { areas: [] } }, state(taskRules), 'a', { equipment, codeItems });

test('style, consumable primary and display rules constrain generated loadouts', () => {
  const equipment = { Stabber: weapon(50, '2h weapon', 'melee', { style: 'stab' }), Slasher: weapon(60, '2h weapon', 'melee', { style: 'slash' }) };
  const result = run(equipment, {}, { 'Show Best in Slot Melee Style Tasks': true });
  assert.deepEqual(result.loadouts.map(row => row.style), ['Stab', 'Slash']);
  assert.deepEqual(run(equipment, {}, { 'Show Best in Slot Tasks': false }).tasks, []);
  const consumable = { Dart: weapon(90, 'main hand weapon', 'ranged', { is_consumable: true }) };
  const saved = state({ 'Consumable Primary BiS': true });
  assert.deepEqual(evaluateEquipment({ equipment: [{ name: 'Dart', sources: [{ kind: 'drop', probability: .1 }] }] }, saved, 'a', { equipment: consumable, codeItems: { ammoTools: { 'No ammo': { Dart: true } } } }).tasks, []);
});

