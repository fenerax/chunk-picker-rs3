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

test('explicit damage and accuracy tiers beat raw item tier and definitions are immutable', () => {
  const data = { 'Misleading tier': weapon(90, '2h weapon', 'melee', { damage_tier: 45, accuracy_tier: 45 }), 'Real strength': weapon(80) };
  const before = JSON.stringify(data);
  const result = run(data);
  assert.equal(result.loadouts[0].best.mainHand, 'Real strength');
  assert.deepEqual(result.tasks.map(row => row.equipmentName), ['Real strength']);
  assert.equal(result.tasks[0].id, equipmentTaskIdentity('Real strength', data['Real strength']).id);
  assert.equal(JSON.stringify(data), before);
  assert.match(result.tasks[0].explanation, /Attack 80 \(reachable training\)/);
});

test('special, passive and reachable augmentation bonuses participate in weapon selection', () => {
  assert.deepEqual(equipmentPower(weapon(80, 'off-hand weapon', 'melee', { damage_tier: 85, accuracy_tier: 90, has_spec: true, has_passive: true, can_augment: true }), { offhand: true, augmentation: true }), { damage: 85, accuracy: 90, bonus: 8.5 });
  const result = run({ 'Tier 80': weapon(80), 'Tier 78 passive': weapon(78, '2h weapon', 'melee', { has_passive: true }) });
  assert.equal(result.loadouts[0].best.mainHand, 'Tier 78 passive');
});

test('ranged weapons require reachable compatible ammo, whose damage caps the weapon', () => {
  const equipment = { 'Big bow': weapon(90, '2h weapon', 'ranged'), 'Good bow': weapon(80, '2h weapon', 'ranged'), 'Bad arrows': { slot: 'ammo', class: 'ranged', tier: 1, damage_tier: 1, ability_damage: 10, is_consumable: true }, 'Good arrows': { slot: 'ammo', class: 'ranged', tier: 80, ability_damage: 800, is_consumable: true } };
  const tools = { ammoTools: { 'BadArrow[+]': { 'Big bow': true }, 'GoodArrow[+]': { 'Good bow': true } }, itemsPlus: { 'BadArrow[+]': ['Bad arrows'], 'GoodArrow[+]': ['Good arrows'] } };
  const result = run(equipment, tools);
  const best = result.loadouts.find(row => row.style === 'Ranged').best;
  assert.equal(best.mainHand, 'Good bow');
  assert.equal(best.ammunition, 'Good arrows');
  assert.deepEqual(best.items, ['Good bow', 'Good arrows']);
  const missing = run(equipment, tools, {}, ['Big bow', 'Good bow']);
  assert.equal(missing.loadouts.length, 0);
  assert.ok(missing.diagnostics.some(row => row.kind === 'unavailable-ammunition'));
});

test('dual wield uses one shared ammo item and cannot pair incompatible ranged ammunition', () => {
  const equipment = { Bow: weapon(60, '2h weapon', 'ranged'), Main: weapon(60, 'main hand weapon', 'ranged'), Off: weapon(99, 'off-hand weapon', 'ranged'), Arrow: { slot: 'ammo', class: 'ranged', tier: 60, ability_damage: 500 }, Bolt: { slot: 'ammo', class: 'ranged', tier: 99, ability_damage: 900 } };
  const tools = { ammoTools: { Arrow: { Bow: true, Main: true }, Bolt: { Off: true } } };
  const result = run(equipment, tools, { 'Show Best in Slot 1H and 2H': true });
  const ranged = result.loadouts.find(row => row.style === 'Ranged');
  assert.equal(ranged.best.mode, 'two-handed');
  assert.equal(ranged.selected[1].mode, 'one-handed');
  assert.ok(!result.tasks.some(row => row.equipmentName === 'Off'));
  const shared = run(equipment, { ammoTools: { Arrow: { Bow: true, Main: true, Off: true } } });
  // Shared 60-damage arrows cap the off-hand, so dual-wield only ties the bow and the tie goes to the 2h.
  const sharedRanged = shared.loadouts.find(row => row.style === 'Ranged');
  assert.equal(sharedRanged.best.mode, 'two-handed');
  assert.equal(sharedRanged.tradeoffs.find(row => row.mode === 'dual-wield').components.damage, 60);
});

test('dual wield weighting and shield/1H/2H toggles preserve reviewable tradeoffs', () => {
  const equipment = { 'Two hand': weapon(70), Main: weapon(80, 'main hand weapon'), Off: weapon(80, 'off-hand weapon'), Shield: { slot: 'off-hand', class: 'melee', tier: 80, armour: 300, lp: 200 } };
  const result = run(equipment);
  assert.equal(result.loadouts[0].best.mode, 'dual-wield');
  assert.equal(result.loadouts[0].best.score, 148);
  assert.ok(result.loadouts[0].tradeoffs.some(row => row.mode === 'shield' && row.defence.armour === 300));
  assert.ok(!result.tasks.some(row => row.equipmentName === 'Shield'));
  const expanded = run(equipment, {}, { 'Show Best in Slot 1H and 2H': true, 'Show Best in Slot Shield': true });
  assert.deepEqual(new Set(expanded.tasks.map(row => row.equipmentName)), new Set(Object.keys(equipment)));
  assert.equal(expanded.loadouts[0].selected.length, 3);
});

test('engine eligible equipment is the sole source of obtainable goals and backlog selects the next item', () => {
  const equipment = { Best: weapon(90), Second: weapon(80) };
  assert.equal(run(equipment, {}, {}, ['Second']).loadouts[0].best.mainHand, 'Second');
  const saved = state();
  saved.members[0].taskStatus = { [taskId('BiS', 'Obtain a ~|best|~')]: { backlogged: true } };
  const result = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })), access: {} }, saved, 'a', { equipment });
  assert.equal(result.loadouts[0].best.mainHand, 'Second');
  assert.ok(buildEquipmentCatalogue({ equipment }).some(row => row.aliases.includes(legacyTaskId('BiS', 'Obtain a ~|best|~'))));
});

test('charge upkeep and completion scope remain distinct from score and personal equipment facts', () => {
  const equipment = { Best: weapon(90, '2h weapon', 'melee', { charges: 50000 }) };
  const saved = state();
  saved.members.push({ id: 'b', completedTasks: [taskId('BiS', 'Obtain a ~|best|~')] });
  const result = evaluateEquipment({ equipment: [{ name: 'Best', sources: [] }], access: {} }, saved, 'a', { equipment });
  assert.equal(result.tasks[0].personalCompleted, false);
  assert.equal(result.tasks[0].challengeSatisfied, true);
  assert.equal(result.tasks[0].maintenance.charges, 50000);
  assert.match(result.tasks[0].explanation, /upkeep is not subtracted/);
});


test('ordinary and coupled goals are combined once per stable item ID', () => {
  const equipment = { Ring: { slot: 'ring', class: 'all', melee_damage: 5, prayer: 1 }, Sword: weapon(50) };
  const result = run(equipment);
  assert.ok(result.tasks.some(row => row.equipmentName === 'Ring'));
  assert.ok(result.tasks.some(row => row.equipmentName === 'Sword'));
  assert.equal(new Set(result.tasks.map(row => row.id)).size, result.tasks.length);
  assert.ok(!result.diagnostics.some(row => /Coupled weapon/.test(row.detail ?? '')));
});

test('prayer weapon loadout combines both hands, independently of damage tier', () => {
  const equipment = { 'Prayer mace': weapon(40, 'main hand weapon', 'melee', { prayer: 6 }), 'Prayer book': weapon(1, 'off-hand weapon', 'magic', { prayer: 5 }), 'Prayer staff': weapon(80, '2h weapon', 'magic', { prayer: 10 }) };
  const result = run(equipment);
  const prayer = result.loadouts.find(row => row.style === 'Prayer').best;
  assert.equal(prayer.score, 11);
  assert.deepEqual(prayer.items, ['Prayer mace', 'Prayer book']);
  assert.ok(result.tasks.find(row => row.equipmentName === 'Prayer book').equipmentGoals.includes('Prayer BiS off-hand weapon'));
  assert.ok(!run(equipment, {}, { 'Show Best in Slot Prayer Tasks': false }).loadouts.some(row => row.style === 'Prayer'));
});

test('engine-eligible Necromancy trial weapons are ranked in free-to-play mode', () => {
  const equipment = { Guard: weapon(10, 'main hand weapon', 'necromancy', { requirements: { Necromancy: 10 } }), Lantern: weapon(10, 'off-hand weapon', 'necromancy', { requirements: { Necromancy: 10 } }) };
  const saved = state(); saved.rules['content.f2p'] = true;
  const result = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) }, saved, 'a', { equipment });
  assert.equal(result.loadouts.find(row => row.style === 'Necromancy').best.mode, 'dual-wield');
  assert.deepEqual(result.tasks.map(row => row.equipmentName), ['Guard', 'Lantern']);
});

test('equal offhands remain alternatives for their own slot without replacing the main hand', () => {
  const result = run({ Main: weapon(80, 'main hand weapon'), 'Off A': weapon(80, 'off-hand weapon'), 'Off B': weapon(80, 'off-hand weapon') });
  const main = result.tasks.find(row => row.equipmentName === 'Main');
  const off = result.tasks.find(row => row.equipmentName === 'Off A');
  assert.deepEqual(result.alternatives[main.id], []);
  assert.deepEqual(result.alternatives[off.id], [equipmentTaskIdentity('Off B').id]);
  assert.ok(result.catalogue.some(row => row.equipmentName === 'Off B'));
  assert.ok(!result.tasks.some(row => row.equipmentName === 'Off B'));
});

test('converted gameplay uses cleared authored rules instead of resurrecting legacy profile flags', () => {
  const equipment = { Sword: weapon(50) };
  const saved = state(); saved.members[0].sourceMapId = 'map';
  saved.legacy = { maps: { map: { rules: { 'Show Best in Slot Tasks': false } } } };
  const input = { equipment: [{ name: 'Sword', sources: [] }] };
  assert.deepEqual(evaluateEquipment(input, saved, 'a', { equipment }).tasks, []);
  saved.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'map' }] };
  const result = evaluateEquipment(input, saved, 'a', { equipment });
  assert.equal(result.tasks[0].equipmentName, 'Sword');
});

test('converted gameplay clearing backlog and unchecking completion stay cleared', () => {
  const equipment = { Best: weapon(90), Second: weapon(80) };
  const saved = state(); saved.members[0].sourceMapId = 'map';
  const rawLabel = 'Obtain a ~|best|~', id = taskId('BiS', rawLabel);
  saved.legacy = { maps: { map: { chunkinfo: { backlog: { BiS: { [rawLabel]: '' } }, checkedChallenges: { BiS: { [rawLabel]: true } }, completedChallenges: { BiS: { [rawLabel]: true } } } } } };
  const input = { equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) };
  assert.equal(evaluateEquipment(input, saved, 'a', { equipment }).loadouts[0].best.mainHand, 'Second');
  saved.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'map' }] };
  saved.members[0].taskStatus = { [id]: { challengeCompleted: false } };
  const result = evaluateEquipment(input, saved, 'a', { equipment });
  assert.equal(result.loadouts[0].best.mainHand, 'Best');
  assert.equal(result.tasks.find(row => row.equipmentName === 'Best').challengeSatisfied, false);
  assert.equal(result.tasks.find(row => row.equipmentName === 'Best').personalCompleted, false);
});

test('current BiS separates shared geography, group satisfaction and personal obtained facts', () => {
  const definitions = { equipment: { Sword: weapon(50) } };
  const saved = { members: [{ id: 'actor1', sourceMapId: 'bbb', unlocked: ['12342'], completedTasks: [taskId('BiS', 'Obtain a ~|sword|~')] }, { id: 'reed', sourceMapId: 'aaa', unlocked: [], completedTasks: [] }], rules: { 'access.shared': true, 'tasks.completion': 'any' }, legacy: { maps: { aaa: { chunkinfo: { manualEquipment: { Sword: true } } } } } };
  const input = { equipment: [{ name: 'Sword', sources: [{ kind: 'drop', source: 'Goblin', location: '12342-1' }] }] };
  const before = structuredClone(saved);
  const planning = evaluateEquipment(input, saved, 'reed', definitions);
  const result = buildCurrentBiS(input, planning, saved, 'reed', definitions, { equipment: [] });
  const goal = result.obtainable.recommendations[0];
  assert.equal(goal.sourceAccess.personalAccess, false);
  assert.deepEqual(goal.sourceAccess.sharedLocations, [{ location: '12342-1', memberIds: ['actor1'] }]);
  assert.equal(goal.challenge.personalCompleted, false);
  assert.equal(goal.challenge.challengeSatisfied, true);
  assert.equal(goal.challenge.duplicateGrindRequired, false);
  assert.deepEqual(goal.challenge.satisfiedBy, ['actor1']);
  assert.deepEqual(result.owned.items, []);
  assert.deepEqual(result.owned.recordedObtained, []);
  assert.equal(result.owned.known, false);
  assert.match(result.importedSelections[0].meaning, /ownership unconfirmed/);
  const personal = buildCurrentBiS(input, planning, saved, 'actor1', definitions, input);
  assert.equal(personal.owned.recordedObtained[0].name, 'Sword');
  assert.match(personal.owned.recordedObtained[0].evidence, /current possession.*unconfirmed/);
  assert.deepEqual(saved, before);
});

test('challenge-only completion never becomes owned gear and completion scopes retain obligations', () => {
  const definitions = { equipment: { Sword: weapon(50) } }, id = taskId('BiS', 'Obtain a ~|sword|~');
  const saved = { members: [{ id: 'a', completedTasks: [], taskStatus: { [id]: { challengeCompleted: true } } }, { id: 'b', completedTasks: [] }], rules: { 'tasks.completion': 'all' } };
  const input = { equipment: [{ name: 'Sword', sources: [] }] };
  const planning = evaluateEquipment(input, saved, 'a', definitions);
  let result = buildCurrentBiS(input, planning, saved, 'a', definitions);
  assert.deepEqual(result.owned.recordedObtained, []);
  assert.equal(result.obtainable.recommendations[0].challenge.duplicateGrindRequired, false);
  assert.equal(result.obtainable.recommendations[0].challenge.groupRequirementPending, true);
  saved.rules['tasks.completion'] = 'personal';
  result = buildCurrentBiS(input, planning, saved, 'b', definitions);
  assert.equal(result.obtainable.recommendations[0].challenge.challengeSatisfied, false);
});

test('zero primary threshold means any positive source chance, not an impossible fraction', () => {
  const definitions = { equipment: { Dart: weapon(50, 'main hand weapon', 'ranged', { is_consumable: true }) } };
  const saved = state({ 'Consumable Primary BiS': true, secondaryPrimaryNum: '1/0' });
  const result = evaluateEquipment({ equipment: [{ name: 'Dart', sources: [{ kind: 'drop', probability: 1 / 10000 }] }] }, saved, 'a', definitions);
  assert.ok(result.tasks.some(row => row.equipmentName === 'Dart'));
});

test('recorded best gear ranks only explicit focused-member obtain records', () => {
  const definitions = { equipment: { Known: weapon(40), Possible: weapon(80), 'Other member': weapon(90), 'Challenge only': weapon(99), Unavailable: weapon(70) } };
  const saved = state();
  const identity = name => taskId('BiS', `Obtain${name === 'Other member' || name === 'Unavailable' ? ' an ' : ' a '}~|${name.toLowerCase()}|~`);
  saved.members[0].completedTasks = [identity('Known'), identity('Unavailable')];
  saved.members[0].taskStatus = { [identity('Challenge only')]: { challengeCompleted: true } };
  saved.members.push({ id: 'b', completedTasks: [identity('Other member')] });
  const input = { equipment: ['Known', 'Possible', 'Other member', 'Challenge only'].map(name => ({ name, sources: [{ kind: 'shop', source: 'Shop' }] })) };
  const before = structuredClone(saved);
  const view = buildCurrentBiS(input, evaluateEquipment(input, saved, 'a', definitions), saved, 'a', definitions, input);
  assert.equal(view.obtainable.loadouts[0].best.mainHand, 'Challenge only');
  assert.equal(view.owned.recordedBest.loadouts[0].best.mainHand, 'Known');
  assert.deepEqual(new Set(view.owned.recordedBest.recommendations.map(row => row.equipment.name)), new Set(['Known']));
  assert.equal(view.owned.recordedBest.recommendations[0].challenge.personalCompleted, true);
  assert.deepEqual(view.owned.recordedBest.coverage.excludedRecordedItems.map(item => item.name), ['Unavailable']);
  assert.match(view.owned.recordedBest.coverage.scope, /current possession.*unconfirmed/);
  assert.equal(view.owned.known, false);
  assert.deepEqual(saved, before);
});

test('recorded weapon ranking never borrows unrecorded ammunition', () => {
  const definitions = { equipment: { Bow: weapon(60, '2h weapon', 'ranged'), Arrows: { slot: 'ammo', class: 'ranged', tier: 60, ability_damage: 500 } }, codeItems: { ammoTools: { Arrows: { Bow: true } } } };
  const saved = state(); saved.members[0].completedTasks = [taskId('BiS', 'Obtain a ~|bow|~')];
  const input = { equipment: Object.keys(definitions.equipment).map(name => ({ name, sources: [{ kind: 'shop', source: 'Shop' }] })) };
  let view = buildCurrentBiS(input, evaluateEquipment(input, saved, 'a', definitions), saved, 'a', definitions, input);
  assert.ok(view.obtainable.loadouts.some(row => row.style === 'Ranged'));
  assert.equal(view.owned.recordedBest.loadouts.length, 0);
  assert.ok(view.owned.recordedBest.diagnostics.some(row => row.kind === 'unavailable-ammunition'));
  saved.members[0].completedTasks.push(taskId('BiS', 'Obtain ~|arrows|~'));
  view = buildCurrentBiS(input, evaluateEquipment(input, saved, 'a', definitions), saved, 'a', definitions, input);
  assert.deepEqual(view.owned.recordedBest.loadouts[0].best.items, ['Bow', 'Arrows']);
});

test('tank armour prioritizes armour then life points and couples defensive hands', () => {
  const equipment = { Power: { slot: 'head', class: 'melee', melee_damage: 50, armour: 100, lp: 1000 }, Tank: { slot: 'head', class: 'melee', melee_damage: 0, armour: 110, lp: 20 }, 'Tank tie': { slot: 'head', class: 'melee', armour: 110, lp: 20 }, Main: weapon(20, 'main hand weapon', 'melee', { armour: 10, lp: 0 }), Shield: { slot: 'off-hand', class: 'melee', armour: 200, lp: 0 }, Twohand: weapon(50, '2h weapon', 'melee', { armour: 50, lp: 0 }) };
  const result = run(equipment, {}, { 'Show Best in Slot Defensive Tasks': true });
  const tank = result.specialist.tank.recommendations.find(row => row.style === 'Melee Tank' && row.slot === 'head');
  assert.equal(tank.equipment.name, 'Tank');
  assert.deepEqual(tank.score, [110, 20]);
  assert.deepEqual(tank.alternatives, ['Tank tie']);
  const hands = result.specialist.tank.loadouts.find(row => row.style === 'Melee Tank').best;
  assert.equal(hands.mode, 'shield');
  assert.deepEqual(hands.items, ['Main', 'Shield']);
  assert.equal(hands.score, 210);
  assert.ok(result.tasks.find(row => row.equipmentName === 'Shield').equipmentGoals.some(goal => /Melee Tank/.test(goal)));
  assert.equal(run(equipment).specialist.tank.recommendations.length, 0);
});

test('weight comparisons require explicit weight and use minimum declared values', () => {
  const equipment = { Heavy: { slot: 'feet', class: 'none', weight: 2, armour: 10 }, Light: { slot: 'feet', class: 'none', weight: -4, armour: 1 }, 'Light tie': { slot: 'feet', class: 'none', weight: -4, armour: 0 }, 'Looks weightless': { slot: 'feet', class: 'none', armour: 500 } };
  const result = run(equipment, {}, { 'Show Best in Slot Weight Tasks': true });
  assert.equal(result.specialist.weight.recommendations[0].equipment.name, 'Light');
  assert.deepEqual(result.specialist.weight.recommendations[0].alternatives, ['Light tie']);
  assert.equal(result.specialist.weight.coverage.declaredWeightRecords, 3);
  const missing = run({ 'Looks light': { slot: 'feet', class: 'none', armour: 100 } }, {}, { 'Show Best in Slot Weight Tasks': true });
  assert.equal(missing.specialist.weight.coverage.supported, false);
  assert.ok(missing.diagnostics.some(row => row.kind === 'missing-equipment-weight-metadata'));
});

test('skilling priorities, relic prerequisites and miscellaneous unlocks retain explicit task evidence', () => {
  const make = (label, record, extras = {}) => ({ id: taskId('Extra', label), category: 'Extra', label, record, status: 'available', blockers: [], ...extras });
  const top = make('Best pickaxe', { Category: ['BIS Skilling'], Set: 'BIS Pickaxe', Priority: 1, Items: ['Top pickaxe'] });
  const tie = make('Equal pickaxe', { Category: ['BIS Skilling'], Set: 'BIS Pickaxe', Priority: 1 }, { status: 'blocked', blockers: [{ kind: 'outclassed' }] });
  const lower = make('Lower pickaxe', { Category: ['BIS Skilling'], Set: 'BIS Pickaxe', Priority: 2 }, { status: 'blocked', blockers: [{ kind: 'outclassed' }] });
  const locked = make('Unavailable pickaxe', { Category: ['BIS Skilling'], Set: 'BIS Pickaxe', Priority: 0 }, { status: 'blocked', blockers: [{ kind: 'items' }] });
  const qol = make('Charming imp', { Category: ['BIS Skilling'], Items: ['Charming imp'] });
  const relic = make('Pouch Protector', { Category: ['BIS Skilling', 'BIS Skilling Relics'], Items: ['Threads of Fate'] }, { status: 'blocked', blockers: [{ kind: 'membership' }] });
  const misc = make('Prayer unlock', { Category: ['Unlock Prayers'] });
  const input = { tasks: [top, tie, lower, locked, qol, relic, misc], equipment: [] }, before = structuredClone(input);
  const result = evaluateEquipment(input, state(), 'a', {});
  const set = result.specialist.skilling.sets[0];
  assert.deepEqual(set.best.map(row => row.id), [top.id, tie.id]);
  assert.deepEqual(set.alternatives.map(row => row.id), [lower.id]);
  assert.deepEqual(set.unavailable.map(row => row.id), [locked.id]);
  assert.equal(result.specialist.skilling.unranked[0].id, qol.id);
  assert.equal(result.specialist.relics.tasks[0].evidenceTaskId, relic.id);
  assert.equal(result.specialist.relics.tasks[0].status, 'blocked');
  assert.equal(result.specialist.misc.tasks[0].id, misc.id);
  const disabled = evaluateEquipment(input, state({ 'BIS Skilling': false }), 'a', {});
  assert.equal(disabled.specialist.skilling.enabled, false);
  assert.deepEqual(disabled.specialist.skilling.sets[0].best.map(row => row.id), [top.id, tie.id]);
  assert.deepEqual(input, before);
});

test('upgrade paths preserve tied score tiers and start at explicit personal obtained gear', () => {
  const equipment = { Low: { slot: 'head', class: 'melee', melee_damage: 1 }, Middle: { slot: 'head', class: 'melee', melee_damage: 2 }, Equal: { slot: 'head', class: 'melee', melee_damage: 2 }, High: { slot: 'head', class: 'melee', melee_damage: 3 } };
  const saved = state(); saved.members[0].completedTasks = [taskId('BiS', 'Obtain a ~|middle|~')];
  const result = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) }, saved, 'a', { equipment });
  const path = result.specialist.upgradePaths.find(row => row.style === 'Melee' && row.slot === 'head');
  assert.equal(path.recordedStart, 'Middle');
  assert.equal(path.steps.length, 2);
  assert.deepEqual(new Set(path.steps[0].items), new Set(['Middle', 'Equal']));
  assert.deepEqual(path.steps[1].items, ['High']);
  assert.ok(result.catalogue.some(row => row.equipmentName === 'Low'));
});

test('recorded specialist goals never inherit another member’s skilling obtain record', () => {
  const id = taskId('Extra', 'Pickaxe goal'), task = { id, category: 'Extra', label: 'Pickaxe goal', status: 'available', blockers: [], record: { Category: ['BIS Skilling'], Set: 'BIS Pickaxe', Priority: 1 } };
  const saved = state(); saved.members.push({ id: 'b', completedTasks: [id] });
  const input = { tasks: [task], equipment: [] }, planning = evaluateEquipment(input, saved, 'a');
  let view = buildCurrentBiS(input, planning, saved, 'a');
  assert.equal(view.obtainable.specialist.skilling.sets.length, 1);
  assert.equal(view.owned.recordedBest.specialist.skilling.sets.length, 0);
  saved.members[0].completedTasks = [id];
  view = buildCurrentBiS(input, planning, saved, 'a');
  assert.equal(view.owned.recordedBest.specialist.skilling.sets[0].best[0].id, id);
});

test('equipment formatted-name correction retains permanent obtain ID and saved evidence', () => {
  const definitions = { equipment: { Sword: weapon(50, '2h weapon', 'melee', { formatted_name: 'misspelled sword' }) } };
  const identity = equipmentTaskIdentity('Sword', definitions.equipment.Sword), saved = state();
  saved.members[0].completedTasks = [legacyTaskId('BiS', identity.rawLabel)];
  saved.members[0].taskStatus = { [legacyTaskId('BiS', identity.rawLabel)]: { favorite: true, note: 'My sword' } };
  const migrated = migrateTaskIdentities(saved, { catalogue: buildEquipmentCatalogue(definitions) }).state;
  definitions.equipment.Sword.formatted_name = 'correct sword';
  const corrected = equipmentTaskIdentity('Sword', definitions.equipment.Sword);
  assert.equal(corrected.id, identity.id); assert.notEqual(corrected.rawLabel, identity.rawLabel);
  const input = { equipment: [{ name: 'Sword', sources: [] }], access: {} };
  const output = evaluateEquipment(input, migrated, 'a', definitions);
  assert.equal(output.tasks[0].personalCompleted, true); assert.equal(output.tasks[0].challengeSatisfied, true);
  assert.deepEqual(migrated.members[0].taskStatus[identity.id], { favorite: true, note: 'My sword' });
  assert.equal(migrated.identityRegistry.aliases[legacyTaskId('BiS', identity.rawLabel)], identity.id);
});
