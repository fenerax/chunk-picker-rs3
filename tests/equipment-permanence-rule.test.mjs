import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEquipment, buildCurrentBiS, buildEquipmentCatalogue } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity, selectEquipmentRecommendations, selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { taskRuleDefinitions, taskRuleBehavior, taskRuleValueError } from '../app/data/settings.mjs';
import { applyCommand, createGroupState } from '../app/core/state.mjs';

const ruleId = 'Non-permanent BiS';
const weapon = (tier, extras = {}) => ({ slot: '2h weapon', class: 'melee', tier, ability_damage: tier * 9.6, accuracy: tier * 20, speed: 3, ...extras });
const helmet = (damage, extras = {}) => ({ slot: 'head', class: 'melee', melee_damage: damage, armour: damage * 10, prayer: damage, weight: -damage, ...extras });
const equipment = {
  'Corrupt dragon spear': weapon(60),
  'Rune spear': weapon(50),
  'Adamant spear': weapon(40),
  'Corrupt dragon helm': helmet(60),
  'Rune full helm': helmet(50),
  'Adamant full helm': helmet(40),
};
const definitions = { equipment };
const input = { equipment: Object.entries(equipment).map(([name, data]) => ({ name, slot: data.slot, sources: [{ kind: 'shop', name: 'Fixture shop' }] })), tasks: [], access: { areas: [] } };
// These permanence comparisons deliberately include members-only spear tiers.
const state = (rules = {}) => ({ members: [{ id: 'a', completedTasks: [], taskRules: rules }], rules: { 'content.f2p': false } });
const run = (saved = state(), result = input, data = definitions) => evaluateEquipment(result, saved, 'a', data);
const melee = planning => planning.loadouts.find(row => row.style === 'Melee').best;


test('absent and explicitly enabled rules preserve complete equipment output', () => {
  assert.deepEqual(run(), run(state({ [ruleId]: true })));
  assert.equal(melee(run()).mainHand, 'Corrupt dragon spear');
  assert.equal(run().recommendations.find(row => row.style === 'Melee' && row.slot === 'head').equipment.name, 'Corrupt dragon helm');
  assert.deepEqual(selectEquipmentRecommendations(input, {}, definitions), selectEquipmentRecommendations(input, { [ruleId]: true }, definitions));
});



test('ammunition and repairable or rechargeable gear remain candidates when disabled', () => {
  const data = { equipment: {
    'Bow fixture': { ...weapon(70), class: 'ranged' },
    'Rune arrow': { slot: 'ammo', class: 'ranged', tier: 50, ability_damage: 500, is_consumable: true },
    'Chaotic maul': weapon(80, { charges: 30000 }),
    'Crystal bow': { ...weapon(70), class: 'ranged', charges: 2500 },
  }, codeItems: { ammoTools: { 'Rune arrow': { 'Bow fixture': true }, 'No ammo': { 'Crystal bow': true } } } };
  const result = { ...input, equipment: Object.entries(data.equipment).map(([name, raw]) => ({ name, slot: raw.slot, sources: [] })) };
  const planning = run(state({ [ruleId]: false, 'Show Best in Slot 1H and 2H': true }), result, data);
  assert.equal(melee(planning).mainHand, 'Chaotic maul');
  assert.equal(planning.loadouts.find(row => row.style === 'Ranged').best.mainHand, 'Crystal bow');
  const bowOnly = { ...result, equipment: result.equipment.filter(row => row.name !== 'Crystal bow') };
  assert.equal(run(state({ [ruleId]: false }), bowOnly, data).loadouts.find(row => row.style === 'Ranged').best.ammunition, 'Rune arrow');
});



