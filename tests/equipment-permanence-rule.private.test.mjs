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

test('Non-permanent BiS is an implemented boolean default beside the other BiS controls', () => {
  const definition = taskRuleDefinitions.find(row => row.id === ruleId);
  assert.equal(definition.type, 'boolean');
  assert.equal(definition.default, true);
  assert.equal(definition.category, 'Visible Tasks');
  assert.equal(definition.parent, 'Show Best in Slot Tasks');
  assert.match(definition.description, /^Include equipment that degrades to dust, runs out or is temporary in Best in Slot tasks/);
  assert.match(definition.description, /Repairable or rechargeable.*ammunition/);
  assert.equal(taskRuleDefinitions[taskRuleDefinitions.findIndex(row => row.id === 'Consumable Primary BiS') + 1].id, ruleId);
  assert.equal(taskRuleBehavior(ruleId).status, 'implemented-scope');
  assert.equal(taskRuleValueError(ruleId, true), null);
  assert.equal(taskRuleValueError(ruleId, false), null);
  assert.match(taskRuleValueError(ruleId, 'false'), /boolean/);
});

test('disabled rule promotes permanent weapons and armour across specialists, paths and generated goals', () => {
  const saved = state({ [ruleId]: false, 'Show Best in Slot Defensive Tasks': true, 'Show Best in Slot Weight Tasks': true });
  const before = JSON.stringify({ input, saved, definitions });
  const planning = run(saved);
  assert.equal(melee(planning).mainHand, 'Rune spear');
  for (const style of ['Melee', 'Prayer', 'Melee Tank', 'Weight Reducing']) {
    assert.equal(planning.recommendations.find(row => row.style === style && row.slot === 'head').equipment.name, 'Rune full helm');
  }
  assert.ok(planning.specialist.upgradePaths.some(path => path.kind === 'loadout' && path.steps.some(step => step.items.includes('Adamant spear'))));
  assert.ok(planning.specialist.upgradePaths.some(path => path.kind === 'slot' && path.steps.some(step => step.items.includes('Adamant full helm'))));
  assert.doesNotMatch(JSON.stringify(planning), /Corrupt dragon/);
  assert.equal(JSON.stringify({ input, saved, definitions }), before);
  const ordinary = selectEquipmentRecommendations(input, { [ruleId]: false }, definitions);
  assert.equal(ordinary.recommendations.find(row => row.style === 'Melee').equipment.name, 'Rune full helm');
  assert.doesNotMatch(JSON.stringify(ordinary), /Corrupt dragon/);
  // Potential identities survive the runtime policy for completion/migration lookup.
  assert.ok(buildEquipmentCatalogue(definitions).some(row => row.id === equipmentTaskIdentity('Corrupt dragon spear', equipment['Corrupt dragon spear']).id));
});

test('excluded equipment cannot remain in tied alternatives or loadout tradeoffs', () => {
  const data = { equipment: { 'Corrupt dragon spear': weapon(50), 'Rune spear': weapon(50), 'Adamant spear': weapon(40), 'Corrupt dragon helm': helmet(50), 'Rune full helm': helmet(50) } };
  const result = { ...input, equipment: Object.entries(data.equipment).map(([name, raw]) => ({ name, slot: raw.slot, sources: [] })) };
  const enabledPlanning = run(state(), result, data);
  assert.ok(enabledPlanning.recommendations.find(row => row.style === 'Melee' && row.slot === 'head').alternatives.includes('Rune full helm'));
  const planning = run(state({ [ruleId]: false }), result, data);
  assert.equal(melee(planning).mainHand, 'Rune spear');
  const excludedIds = ['Corrupt dragon spear', 'Corrupt dragon helm'].map(name => equipmentTaskIdentity(name, data.equipment[name]).id);
  for (const id of excludedIds) assert.ok(!JSON.stringify(planning.alternatives).includes(id));
  assert.doesNotMatch(JSON.stringify(planning), /Corrupt dragon/);
});

test('presentation suppresses stale excluded Obtain rows and Current BiS retains personal records', () => {
  const all = run(), saved = state({ [ruleId]: false });
  const visible = selectPresentedTasks({ ...input, tasks: all.tasks }, saved, 'a', definitions);
  assert.equal(visible.tasks.length, 0);
  assert.ok(Object.values(visible.suppressed).flat().some(reason => /Non-permanent equipment/.test(reason)));
  const obtainedId = equipmentTaskIdentity('Corrupt dragon spear', equipment['Corrupt dragon spear']).id;
  saved.members[0].completedTasks = [obtainedId];
  const view = buildCurrentBiS(input, run(saved), saved, 'a', definitions);
  assert.equal(melee(view.obtainable).mainHand, 'Rune spear');
  assert.ok(view.owned.recordedObtained.some(row => row.name === 'Corrupt dragon spear'));
  assert.equal(view.owned.recordedBest.loadouts.length, 0);
});

test('personal rule overrides global rules and existing commands retain history and undo', () => {
  const inherited = state({ [ruleId]: true });
  inherited.taskRules = { [ruleId]: false };
  inherited.members.push({ id: 'b', completedTasks: [] });
  assert.equal(melee(run(inherited)).mainHand, 'Corrupt dragon spear');
  assert.equal(evaluateEquipment(input, inherited, 'b', definitions).loadouts.find(row => row.style === 'Melee').best.mainHand, 'Rune spear');
  const saved = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  saved.rules['content.f2p'] = false;
  const now = () => '2026-10-08T12:00:00.000Z';
  assert.equal(melee(run(saved)).mainHand, 'Corrupt dragon spear');
  const changed = applyCommand(saved, { type: 'set-task-rule', memberId: 'a', ruleId, value: false }, { now });
  assert.equal(changed.revision, saved.revision + 1);
  assert.equal(changed.history.length, saved.history.length + 1);
  assert.equal(melee(run(changed)).mainHand, 'Rune spear');
  assert.equal(evaluateEquipment(input, changed, 'b', definitions).loadouts.find(row => row.style === 'Melee').best.mainHand, 'Corrupt dragon spear');
  const undone = applyCommand(changed, { type: 'undo' }, { now });
  assert.equal(undone.members[0].taskRules?.[ruleId], undefined);
  assert.equal(melee(run(undone)).mainHand, 'Corrupt dragon spear');
  const reset = applyCommand(changed, { type: 'reset-task-rule', memberId: 'a', ruleId }, { now });
  assert.equal(melee(run(reset)).mainHand, 'Corrupt dragon spear');
  assert.equal(melee(run(applyCommand(reset, { type: 'undo' }, { now }))).mainHand, 'Rune spear');
  assert.throws(() => applyCommand(saved, { type: 'set-task-rule', memberId: 'a', ruleId, value: 'false' }, { now }), /boolean/);
});

test('disabled rule also hides wield/wear skill goals whose every qualifying item is non-permanent', () => {
  const row = (id, label, items, category = 'Attack') => ({ id, label: label.replace(/~\|(.*?)\|~/g, '$1'), rawLabel: label, category, level: 60, obligation: true, status: 'available',
    sources: items.map(item => ({ kind: 'drop', source: 'Fixture', item })), record: { Items: ['CorruptDragonWeapon[+]'] } });
  const tasks = [
    row('corrupt', 'Wield a ~|corrupt dragon weapon|~', ['Corrupt dragon spear', 'Corrupt dragon mace']),
    row('mixed', 'Wield a ~|spear|~', ['Corrupt dragon spear', 'Rune spear'], 'Strength'),
    row('kill', 'Kill a ~|corrupt dragon|~ thing', ['Corrupt dragon spear'], 'Defence'),
  ];
  const ids = rules => selectPresentedTasks({ ...input, tasks }, state(rules), 'a', definitions).tasks.map(task => task.id);
  assert.ok(ids({}).includes('corrupt'), 'shown by default');
  const off = ids({ [ruleId]: false });
  assert.ok(!off.includes('corrupt'), 'hidden when every qualifying item crumbles');
  assert.ok(off.includes('mixed'), 'kept when a permanent item also qualifies');
  assert.ok(off.includes('kill'), 'only wield/wear goals are affected');
});
