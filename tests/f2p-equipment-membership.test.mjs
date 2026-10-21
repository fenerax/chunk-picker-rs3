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

test('F2P admission removes explicit members gear from all combat, specialist and upgrade choices', () => {
  const equipment = {
    'Fixture free sword': weapon(20, 'main hand weapon'),
    'Fixture free offhand': weapon(20, 'off-hand weapon'),
    'Fixture free twohand': weapon(30),
    'Fixture low twohand': weapon(10),
    'Fixture members sword': weapon(99, 'main hand weapon', { members: true }),
    'Fixture members offhand': weapon(99, 'off-hand weapon', { members: true }),
    'Fixture members twohand': weapon(99, '2h weapon', { members: true }),
    'Fixture free shield': { slot: 'off-hand', class: 'melee', armour: 20 },
    'Fixture members shield': { slot: 'off-hand', class: 'melee', armour: 999, members: true },
    'Fixture free armour': { slot: 'head', class: 'all', armour: 20, melee_damage: 2, prayer: 2, weight: 1 },
    'Fixture low armour': { slot: 'head', class: 'all', armour: 10, melee_damage: 1, prayer: 1, weight: 2 },
    'Fixture members armour': { slot: 'head', class: 'all', armour: 999, melee_damage: 99, prayer: 99, weight: -99, members: true },
  };
  const saved = state(), result = input(equipment), before = structuredClone({ saved, result, equipment });
  const free = evaluateEquipment(result, saved, 'a', { equipment });
  assert.equal(free.coverage.eligibleEquipment, 7);
  assert.ok(free.specialist.upgradePaths.length > 0);
  assert.ok(free.specialist.weight.recommendations.length > 0);
  assert.ok(free.specialist.tank.recommendations.length > 0);
  for (const row of [...free.tasks, ...free.catalogue]) assert.ok(!row.equipmentName.includes('Fixture members'));
  for (const row of free.recommendations) {
    assert.ok(!row.equipment.name.includes('Fixture members'));
    assert.ok(row.alternatives.every(name => !name.includes('Fixture members')));
  }
  assert.doesNotMatch(JSON.stringify({ loadouts: free.loadouts, paths: free.specialist.upgradePaths }), /Fixture members/);
  const unrestricted = evaluateEquipment(result, state(false), 'a', { equipment });
  assert.ok(unrestricted.recommendations.some(row => row.equipment.name === 'Fixture members armour'));
  assert.ok(unrestricted.loadouts.some(row => row.selected.some(value => value.mainHand === 'Fixture members twohand')));
  assert.deepEqual({ saved, result, equipment }, before);
});


test('members ammunition cannot support a free weapon loadout or appear on an upgrade path', () => {
  const equipment = {
    'Fixture bow': weapon(60, '2h weapon', { class: 'ranged' }),
    'Fixture arrows': { slot: 'ammo', class: 'ranged', tier: 20, ability_damage: 200 },
    'Fixture members arrows': { slot: 'ammo', class: 'ranged', tier: 99, ability_damage: 990, members: true },
  };
  const definitions = { equipment, codeItems: { itemsPlus: { 'FixtureArrow[+]': ['Fixture arrows', 'Fixture members arrows'] },
    ammoTools: { 'FixtureArrow[+]': { 'Fixture bow': true } } } };
  const free = evaluateEquipment(input(equipment), state(), 'a', definitions);
  assert.equal(free.loadouts.find(row => row.style === 'Ranged').best.ammunition, 'Fixture arrows');
  assert.doesNotMatch(JSON.stringify(free.specialist.upgradePaths), /Fixture members arrows/);
  const onlyMembersAmmo = input(equipment); onlyMembersAmmo.equipment = onlyMembersAmmo.equipment.filter(row => row.name !== 'Fixture arrows');
  const blocked = evaluateEquipment(onlyMembersAmmo, state(), 'a', definitions);
  assert.ok(!blocked.loadouts.some(row => row.style === 'Ranged'));
  assert.ok(blocked.diagnostics.some(row => row.kind === 'unavailable-ammunition'));
  assert.equal(evaluateEquipment(input(equipment), state(false), 'a', definitions).loadouts.find(row => row.style === 'Ranged').best.ammunition, 'Fixture members arrows');
});

test('saved obtain facts and manual source overrides cannot revive members gear in current BiS', () => {
  const equipment = { 'Fixture free sword': weapon(20), 'Fixture members sword': weapon(99, '2h weapon', { members: true }) };
  const saved = state(); saved.members[0].completedTasks = Object.entries(equipment).map(([name, data]) => equipmentTaskIdentity(name, data).id);
  saved.legacy = { maps: { fixture: { chunkinfo: { manualEquipment: { 'Fixture free sword': true, 'Fixture members sword': true } } } } };
  const result = input(equipment), before = structuredClone(saved), definitions = { equipment };
  const view = buildCurrentBiS(result, evaluateEquipment(result, saved, 'a', definitions), saved, 'a', definitions);
  assert.deepEqual(view.owned.recordedObtained.map(row => row.name), ['Fixture free sword']);
  assert.equal(view.owned.recordedBest.loadouts[0].best.mainHand, 'Fixture free sword');
  assert.deepEqual(view.importedSelections.map(row => row.name), ['Fixture free sword']);
  assert.ok(view.owned.recordedBest.coverage.excludedRecordedItems.some(row => row.name === 'Fixture members sword' && /membership/i.test(row.reason)));
  assert.deepEqual(saved, before);
  saved.rules['content.f2p'] = false;
  const unrestricted = buildCurrentBiS(result, evaluateEquipment(result, saved, 'a', definitions), saved, 'a', definitions);
  assert.equal(unrestricted.owned.recordedObtained.length, 2);
  assert.equal(unrestricted.importedSelections.length, 2);
});

test('presentation rejects leaked members equipment goals while keeping unknown and free alternatives', () => {
  const equipment = { 'Fixture members tool': { members: true }, 'Fixture free tool': { members: false } };
  const make = (id, record, extras = {}) => ({ id, category: 'BiS', rawLabel: `Obtain ${id}`, label: id,
    status: 'available', sources: [], blockers: [], record, ...extras });
  const tasks = [make('member', {}, { equipmentName: 'Fixture members tool' }),
    make('free', { Items: ['Fixture free tool'] }), make('unknown', { Items: ['Fixture unknown tool'] }),
    make('members-alias', { Items: ['MembersTool[+]'] }), make('mixed-alias', { Items: ['MixedTool[+]'] }),
    make('mixed-count', { Items: ['MixedTool[+]x2'] })];
  const definitions = { equipment, codeItems: { itemsPlus: { 'MembersTool[+]': ['Fixture members tool'],
    'MixedTool[+]': ['Fixture members tool', 'Fixture free tool'] } } };
  const free = selectPresentedTasks({ tasks }, state(), 'a', definitions);
  assert.deepEqual(free.tasks.map(row => row.id), ['free', 'unknown', 'mixed-alias']);
  assert.match(free.suppressed.member.join(' '), /membership/i);
  assert.equal(selectPresentedTasks({ tasks }, state(false), 'a', definitions).tasks.length, tasks.length);
});

test('specialist equipment requirements expand aliases without rejecting a usable free or unknown choice', () => {
  const equipment = { 'Fixture members tool': { members: true }, 'Fixture free tool': { members: false } };
  const make = (id, items, priority) => ({ id, category: 'Extra', label: id, status: 'available', blockers: [],
    record: { Category: ['BIS Skilling'], Set: 'Fixture tool set', Items: items, Priority: priority } });
  const tasks = [make('members-only', ['MembersTool[+]'], 0), make('mixed', ['MixedTool[+]'], 1), make('unknown', ['UnknownTool[+]'], 2)];
  const definitions = { equipment, codeItems: { itemsPlus: { 'MembersTool[+]': ['Fixture members tool'],
    'MixedTool[+]': ['Fixture members tool', 'Fixture free tool'], 'UnknownTool[+]': ['Fixture unknown tool'] } } };
  const free = evaluateEquipment({ tasks, equipment: [] }, state(), 'a', definitions);
  assert.deepEqual(free.specialist.skilling.sets[0].best.map(row => row.id), ['mixed']);
  assert.deepEqual(free.specialist.skilling.sets[0].alternatives.map(row => row.id), ['unknown']);
  const unrestricted = evaluateEquipment({ tasks, equipment: [] }, state(false), 'a', definitions);
  assert.deepEqual(unrestricted.specialist.skilling.sets[0].best.map(row => row.id), ['members-only']);
});
