import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, exportBackup, importBackup, validateState, previewRestore } from '../app/core/state.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { evaluateEquipment, buildCurrentBiS } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const equipment = {
  'Rune pickaxe': { slot: 'main hand weapon', class: 'melee', tier: 1, ability_damage: 10, accuracy: 20, requirements: { Attack: 1 } },
  'Better weapon': { slot: 'main hand weapon', class: 'melee', tier: 2, ability_damage: 20, accuracy: 40 },
  'High weapon': { slot: '2h weapon', class: 'melee', tier: 80, ability_damage: 800, accuracy: 1600, requirements: { Attack: 80 } },
  'Members weapon': { slot: '2h weapon', class: 'melee', tier: 1, ability_damage: 10, accuracy: 20, members: true },
};
const definitions = { chunks: { '100': {} }, challenges: { Mining: { 'Use pickaxe': { Items: ['Rune pickaxe'], Level: 1 } } }, equipment };
const group = () => createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['100'] }, { id: 'reed', name: 'Reed' }]);
const command = (equipmentName = 'Rune pickaxe', obtained = true) => ({ type: 'set-obtained-equipment', memberId: 'actor1', equipmentName, obtained });

test('hand records validate, persist in backups, guard revisions and support removal and Undo', () => {
  const initial = group(); delete initial.members[0].obtainedEquipment;
  assert.deepEqual(validateState(initial).members[0].obtainedEquipment, []);
  const saved = applyValidatedCommand(validateState(initial), command(), { expectedRevision: 0 });
  assert.deepEqual(saved.members[0].obtainedEquipment, ['Rune pickaxe']);
  assert.deepEqual(saved.members[1].obtainedEquipment, []);
  assert.deepEqual(saved.members[0].completedTasks, []);
  assert.deepEqual(importBackup(exportBackup(saved)).members, saved.members);
  assert.deepEqual(previewRestore(group(), saved).members[0].obtainedEquipment.added, ['Rune pickaxe']);
  const duplicate = applyCommand(saved, command());
  assert.deepEqual(duplicate.members[0].obtainedEquipment, ['Rune pickaxe']);
  assert.throws(() => applyCommand(saved, command(), { expectedRevision: 0 }), /Revision conflict/);
  assert.throws(() => applyCommand(saved, { ...command(), obtained: 'yes' }), /boolean/);
  assert.throws(() => applyCommand(saved, { ...command(), equipmentName: '' }), /nonempty/);
  assert.throws(() => validateState({ ...saved, members: [{ ...saved.members[0], obtainedEquipment: ['Rune pickaxe', 'Rune pickaxe'] }, saved.members[1]] }), /duplicate/);
  const removed = applyCommand(saved, command('Rune pickaxe', false));
  assert.deepEqual(removed.members[0].obtainedEquipment, []);
  assert.deepEqual(applyCommand(removed, { type: 'undo' }).members[0].obtainedEquipment, ['Rune pickaxe']);
  assert.deepEqual(applyCommand(saved, { type: 'undo' }).members[0].obtainedEquipment, []);
  assert.equal(describeHistoryEvent(saved.history[0], { memberName: () => 'Player' }), 'Recorded Rune pickaxe as obtained for Player');
  assert.match(describeHistoryEvent(removed.history.at(-1), { memberName: () => 'Player' }), /Removed the hand-added obtain record for Rune pickaxe for Player/);
});

test('both gameplay fingerprints change when personal equipment evidence changes', () => {
  const initial = group(), saved = applyCommand(initial, command());
  for (const fingerprint of [createGameplayFingerprint(), createTaskReuseFingerprint()]) assert.notEqual(fingerprint(initial), fingerprint(saved));
});

test('personal obtain records supply item requirements without a source or task completion, and retain equip gates', () => {
  const engine = createTaskEngine(definitions), saved = group();
  saved.members[0].obtainedEquipment = Object.keys(equipment);
  const before = structuredClone(saved), result = engine.evaluate(saved, 'actor1');
  assert.deepEqual(result.equipment.map(row => row.name).sort(), ['Better weapon', 'Rune pickaxe']);
  const task = result.tasks.find(row => row.rawLabel === 'Use pickaxe');
  assert.equal(task.status, 'available'); assert.equal(task.personalCompleted, false);
  const item = result.items.find(row => row.name === 'Rune pickaxe');
  assert.deepEqual(item.sources[0].provenance, ['manual']);
  assert.ok(!engine.evaluate(saved, 'reed').items.some(row => row.name === 'Rune pickaxe'));
  assert.deepEqual(saved, before);
  const planning = evaluateEquipment(result, saved, 'actor1', definitions);
  const bis = buildCurrentBiS(result, planning, saved, 'actor1', definitions);
  assert.ok(bis.owned.recordedObtained.every(row => row.addedByHand));
  assert.ok(bis.owned.recordedObtained.some(row => row.name === 'Members weapon'), 'excluded hand records remain available for removal');
  assert.ok(bis.owned.recordedBest.coverage.excludedRecordedItems.some(row => row.name === 'Members weapon'));
  assert.equal(bis.owned.recordedBest.loadouts.find(row => row.style === 'Melee').best.mainHand, 'Better weapon');
  assert.equal(bis.owned.known, false); assert.deepEqual(bis.owned.items, []);
});

test('task and manual evidence deduplicate; removing a hand record preserves explicit task evidence', () => {
  const saved = group(), identity = equipmentTaskIdentity('Rune pickaxe', equipment['Rune pickaxe']);
  saved.tasks = [{ id: identity.id, label: identity.label, category: 'BiS' }];
  saved.members[0].completedTasks = [identity.id]; saved.members[0].obtainedEquipment = ['Rune pickaxe'];
  const engine = createTaskEngine(definitions);
  const inspect = state => {
    const result = engine.evaluate(state, 'actor1');
    return buildCurrentBiS(result, evaluateEquipment(result, state, 'actor1', definitions), state, 'actor1', definitions);
  };
  const bis = inspect(saved);
  assert.equal(bis.owned.recordedObtained.length, 1);
  assert.deepEqual(bis.owned.recordedObtained[0].provenance, ['task', 'manual']);
  const removed = applyCommand(saved, command('Rune pickaxe', false));
  assert.deepEqual(inspect(removed).owned.recordedObtained[0].provenance, ['task']);
  assert.ok(engine.evaluate(removed, 'actor1').items.some(row => row.name === 'Rune pickaxe'));
});

test('manual gear supplies ordinary and coupled upgrade starts; challenge-only ticks do not', () => {
  const saved = group(); saved.members[0].obtainedEquipment = ['Rune pickaxe'];
  const result = { equipment: Object.entries(equipment).slice(0, 2).map(([name, data]) => ({ name, data, sources: [{ kind: 'shop' }] })) };
  const planning = evaluateEquipment(result, saved, 'actor1', definitions);
  assert.ok(planning.specialist.upgradePaths.some(row => row.kind === 'loadout' && row.recordedStart?.includes('Rune pickaxe')));
  saved.members[0].obtainedEquipment = []; saved.members[0].taskStatus = { [equipmentTaskIdentity('Rune pickaxe', equipment['Rune pickaxe']).id]: { challengeCompleted: true } };
  assert.equal(buildCurrentBiS(result, evaluateEquipment(result, saved, 'actor1', definitions), saved, 'actor1', definitions).owned.recordedObtained.length, 0);
  const armour = { 'Recorded boots': { slot: 'feet', class: 'melee', armour: 1, tier: 1 }, 'Better boots': { slot: 'feet', class: 'melee', armour: 2, tier: 2 } };
  saved.members[0].obtainedEquipment = ['Recorded boots'];
  const ordinary = evaluateEquipment({ equipment: Object.keys(armour).map(name => ({ name, sources: [] })) }, saved, 'actor1', { equipment: armour });
  assert.ok(ordinary.specialist.upgradePaths.some(row => row.kind === 'slot' && row.recordedStart === 'Recorded boots'));
});

test('recorded-best specialist gear includes hand evidence like a personally completed Obtain task', () => {
  const saved = group(), identity = equipmentTaskIdentity('Rune pickaxe', equipment['Rune pickaxe']);
  const task = { id: identity.id, label: identity.label, equipmentName: 'Rune pickaxe', category: 'BiS', status: 'available', record: { Category: ['BIS Skilling'], Set: 'Pickaxes', Priority: 1 } };
  const result = { equipment: [{ name: 'Rune pickaxe', data: equipment['Rune pickaxe'], sources: [] }], tasks: [task] };
  const inspect = () => buildCurrentBiS(result, evaluateEquipment(result, saved, 'actor1', definitions), saved, 'actor1', definitions).owned.recordedBest.specialist.skilling.sets;
  saved.members[0].obtainedEquipment = ['Rune pickaxe'];
  const manual = inspect(); assert.equal(manual[0].best[0].id, task.id);
  saved.members[0].obtainedEquipment = []; saved.members[0].completedTasks = [task.id];
  assert.deepEqual(inspect(), manual);
});

test('task and hand records supply the same coupled bow setup, with ammunition recorded separately', () => {
  const defs = { chunks: { '100': {} }, challenges: {}, equipment: {
    Bow: { slot: '2h weapon', class: 'ranged', tier: 1, ability_damage: 10, accuracy: 20 },
    Arrow: { slot: 'ammo', class: 'ranged', tier: 1, ability_damage: 10 },
  }, codeItems: { ammoTools: { Arrow: { Bow: true } } } };
  const saved = group(), engine = createTaskEngine(defs);
  const inspect = () => { const result = engine.evaluate(saved, 'actor1'); return buildCurrentBiS(result, evaluateEquipment(result, saved, 'actor1', defs), saved, 'actor1', defs).owned.recordedBest.loadouts; };
  saved.members[0].obtainedEquipment = ['Bow']; assert.equal(inspect().length, 0);
  saved.members[0].obtainedEquipment = ['Bow', 'Arrow']; const manual = inspect();
  assert.equal(manual.find(row => row.style === 'Ranged').best.ammunition, 'Arrow');
  saved.members[0].obtainedEquipment = []; saved.members[0].completedTasks = Object.entries(defs.equipment).map(([name, data]) => equipmentTaskIdentity(name, data).id);
  assert.deepEqual(inspect(), manual);
});
