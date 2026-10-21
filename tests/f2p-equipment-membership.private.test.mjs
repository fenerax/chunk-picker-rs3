import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEquipment, buildCurrentBiS } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity, selectEquipmentRecommendations, selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { itemMembership } from '../app/data/item-membership.mjs';

const weapon = (tier, slot = '2h weapon', extras = {}) => ({ slot, class: 'melee', tier,
  ability_damage: tier * 10, accuracy: tier * 20, ...extras });
const state = (f2p = true) => ({ members: [{ id: 'a', sourceMapId: 'fixture', unlocked: [], completedTasks: [], taskRules: {
  'Show Best in Slot 1H and 2H': true, 'Show Best in Slot Shield': true,
  'Show Best in Slot Defensive Tasks': true, 'Show Best in Slot Weight Tasks': true,
} }], rules: { 'content.f2p': f2p } });
const input = equipment => ({ equipment: Object.entries(equipment).map(([name, data]) => ({ name, slot: data.slot,
  sources: [{ kind: 'manual', name: 'Synthetic source override' }] })), tasks: [], access: {} });

test('cache membership gates raw recommendation rows even when definitions omit the members flag', () => {
  assert.equal(itemMembership('Boots of lightness').members, true);
  const equipment = {
    'Boots of lightness': { slot: 'feet', class: 'all', armour: 100, prayer: 10, weight: -4, members: false },
    'Fixture unknown boots': { slot: 'feet', class: 'all', armour: 10, prayer: 1, weight: 1 },
  };
  const result = input(equipment);
  const free = selectEquipmentRecommendations(result, { F2P: true }, { equipment });
  assert.ok(free.recommendations.length > 0);
  assert.ok(free.recommendations.every(row => row.equipment.name === 'Fixture unknown boots'));
  const unrestricted = selectEquipmentRecommendations(result, { F2P: false }, { equipment });
  assert.ok(unrestricted.recommendations.some(row => row.equipment.name === 'Boots of lightness'));
});

