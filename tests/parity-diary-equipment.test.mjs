import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';

// Retained upstream records are read-only witnesses. Tests do not load a server,
// private save, asset cache or mutable output directory.
const retained = JSON.parse(fs.readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const diaryName = (tier, title) => `~|Lumbridge Achievements#${tier}|~ ${title}`;
const beginnerName = diaryName('Beginner', 'Complete the Beginner Achievements');
const easyName = diaryName('Easy', 'Complete the Easy Achievements');
const belterName = diaryName('Easy', 'Belter of a Smelter');
const pikeName = diaryName('Easy', 'And It Was THIS Big!');
const row = (category, rawLabel, record, extras = {}) => ({ id: taskId(category, rawLabel, record), category, rawLabel,
  label: rawLabel, record: structuredClone(record), level: record.Level ?? 1, status: 'available', obligation: true, ...extras });
const savedState = (taskRules = {}) => ({ members: [{ id: 'player2', sourceMapId: 'qxb', completedTasks: [], taskRules }], rules: { 'content.f2p': false } });
const diaryResult = (extras = {}) => ({ tasks: [beginnerName, easyName, belterName, pikeName].map(name =>
  row('Diary', name, retained.challenges.Diary[name], name === easyName ? extras : {})), items: [], access: {}, training: {} });
const presented = (input, saved = savedState(), definitions = {}) => selectPresentedTasks(input, saved, 'player2', definitions);

test('QXB Belter of a Smelter and And It Was THIS Big! collapse into a completable Easy tier without losing skill goals', () => {
  const input = diaryResult();
  // These explicit skill rows represent the retained upstream cross-skill
  // requirements; presentation must preserve them when diary duties collapse.
  const smithing = row('Smithing', belterName, { Level: 20 });
  const fishing = row('Fishing', pikeName, { Level: 25 });
  input.tasks.push(smithing, fishing, row('Smithing', 'Lower smelting method', { Level: 10, Primary: true }));
  const before = structuredClone(input), output = presented(input);
  assert.ok(!output.tasks.some(task => [belterName, pikeName].includes(task.rawLabel) && task.category === 'Diary'));
  assert.deepEqual(output.tasks.filter(task => task.category === 'Diary').map(task => task.rawLabel), [beginnerName, easyName]);
  assert.ok(output.tasks.some(task => task.id === smithing.id));
  assert.ok(output.tasks.some(task => task.id === fishing.id));
  assert.equal(output.effectiveLevels[smithing.id], 20);
  assert.equal(output.effectiveLevels[fishing.id], 25);
  assert.deepEqual(input, before, 'eligibility, Skills, sources and checks remain intact');
  for (const name of [belterName, pikeName]) assert.match(output.suppressed[taskId('Diary', name, retained.challenges.Diary[name])].join(' '), /achievement parent/);
});

test('QXB diary children remain when the Easy tier is blocked, backlogged or outside personal obligations', () => {
  for (const extras of [{ status: 'blocked' }, { obligation: false }]) {
    const output = presented(diaryResult(extras));
    for (const name of [belterName, pikeName]) assert.ok(output.tasks.some(task => task.rawLabel === name));
  }
  const saved = savedState();
  saved.members[0].taskStatus = { [taskId('Diary', easyName, retained.challenges.Diary[easyName])]: { backlogged: true } };
  for (const name of [belterName, pikeName]) assert.ok(presented(diaryResult(), saved).tasks.some(task => task.rawLabel === name));
});

test('diary pruning uses explicit same-BaseQuest dependencies, expands aliases and protects ManualShow tiers', () => {
  const parent = row('Diary', 'Parent', { BaseQuest: 'Family', ManualShow: true,
    Tasks: { 'Children[+]x2--group': 'Diary', Tier: 'Diary', Unrelated: 'Diary' } });
  const child = row('Diary', 'Child', { BaseQuest: 'Family', Skills: { Magic: 59 } });
  const tier = row('Diary', 'Tier', { BaseQuest: 'Family', ManualShow: true });
  const unrelated = row('Diary', 'Unrelated', { BaseQuest: 'Other' });
  const unreferenced = row('Diary', 'Not referenced', { BaseQuest: 'Family' });
  const input = { tasks: [parent, child, tier, unrelated, unreferenced], items: [] };
  const output = presented(input, savedState(), { codeItems: { tasksPlus: { 'Children[+]': ['Child--Diary'] } } });
  assert.deepEqual(output.tasks.map(task => task.rawLabel), ['Parent', 'Tier', 'Unrelated', 'Not referenced']);
  assert.deepEqual(child.record.Skills, { Magic: 59 });
});

test('Show Diary Tasks Any keeps achievable children of incomplete tiers; whole-tier mode hides them', () => {
  const input = diaryResult({ status: 'blocked' });
  const any = presented(input, savedState({ 'Show Diary Tasks Any': true }));
  for (const name of [belterName, pikeName]) assert.ok(any.tasks.some(task => task.rawLabel === name));
  const complete = presented(input, savedState({ 'Show Diary Tasks Complete': true }));
  assert.deepEqual(complete.tasks.map(task => task.rawLabel), [beginnerName]);
  const marker = row('Diary', 'Explicit tier marker', { ManualShow: false });
  assert.deepEqual(presented({ tasks: [marker] }, savedState({ 'Show Diary Tasks Complete': true })).tasks, [marker],
    'the upstream whole-tier toggle recognizes ManualShow property presence');
});

test('QXA and QXB dreadfowl stays possible with secondary supplies but is not an active primary training goal', () => {
  const name = Object.keys(retained.challenges.Summoning).find(label => label.includes('dreadfowl'));
  assert.ok(name);
  const dreadfowl = row('Summoning', name, retained.challenges.Summoning[name], { primary: true, primaryMethod: false });
  // This presentation fixture already declares the recipe available. Preserve
  // its secondary ingredient paths while varying only training declarations.
  const items = dreadfowl.record.Items.map(name => ({ name: name.replace(/\*/g, ''), sources: [{ kind: 'drop', primary: false }] }));
  const input = { tasks: [dreadfowl], items, training: { Summoning: { primary: false, passiveLevel: 4, passiveOverride: null, manualPrimary: false } } };
  const before = structuredClone(input), output = presented(input);
  assert.deepEqual(output.tasks, []);
  assert.match(output.suppressed[dreadfowl.id].join(' '), /primary training route/);
  assert.deepEqual(input, before);
  assert.equal(dreadfowl.status, 'available');
  assert.equal(output.effectiveLevels[dreadfowl.id], 4);
  for (const training of [
    { primary: true }, { primary: false, manualPrimary: true },
    { primary: false, primaryOverride: true }, { primary: false, passiveOverride: 4 },
  ]) assert.deepEqual(presented({ ...input, training: { Summoning: training } }).tasks.map(task => task.id), [dreadfowl.id]);
  assert.deepEqual(presented({ ...input, training: { Summoning: { primary: false, passiveOverride: 3 } } }).tasks, []);
  assert.deepEqual(presented({ ...input, tasks: [{ ...dreadfowl, primaryMethod: true }] }).tasks.map(task => task.id), [dreadfowl.id]);
});

test('suppressing dreadfowl cannot fall back to the non-primary Obtain a bulldog goal on either map', () => {
  const dreadName = Object.keys(retained.challenges.Summoning).find(label => label.includes('dreadfowl'));
  const bulldogName = 'Obtain a ~|bulldog|~';
  const dreadfowl = row('Summoning', dreadName, retained.challenges.Summoning[dreadName], { primary: true, primaryMethod: false });
  const bulldog = row('Summoning', bulldogName, retained.challenges.Summoning[bulldogName], { primary: false, primaryMethod: false });
  const input = { tasks: [dreadfowl, bulldog], items: [], training: { Summoning:
    { primary: false, passiveLevel: 4, passiveOverride: null, manualPrimary: false, primaryOverride: null } } };
  const before = structuredClone(input), output = presented(input);
  assert.deepEqual(output.tasks, []);
  for (const task of input.tasks) {
    assert.match(output.suppressed[task.id].join(' '), /primary training route/);
    assert.equal(task.status, 'available');
  }
  assert.deepEqual(input, before);
  for (const evidence of [{ manualPrimary: true }, { primaryOverride: true }, { passiveOverride: 4 }, { observedCapabilityLevel: 4 }]) {
    assert.deepEqual(presented({ ...input, tasks: [bulldog], training: { Summoning: { ...input.training.Summoning, ...evidence } } }).tasks, [bulldog]);
  }
  assert.deepEqual(presented({ ...input, training: { Summoning: { ...input.training.Summoning, observedCapabilityLevel: 3 } } }).tasks, []);
});

const equipmentResult = (names, extraDefinitions = {}, taskRules = {}) => {
  const equipment = Object.fromEntries(names.map(name => [name, retained.equipment[name]]));
  Object.assign(equipment, extraDefinitions);
  const input = { equipment: Object.keys(equipment).map(name => ({ name, slot: equipment[name].slot, sources: [{ kind: 'shop', name: 'Fixture shop' }] })), access: {}, training: {} };
  const before = structuredClone(input);
  const output = evaluateEquipment(input, savedState(taskRules), 'player2', { equipment });
  assert.deepEqual(input, before);
  return output;
};

test('QXB zero-Prayer Blue dragonhide, Mystic, Rune kite and Rune square shields never become Prayer obtain goals', () => {
  const shields = ['Blue dragonhide shield', 'Mystic shield', 'Rune kiteshield', 'Rune square shield'];
  const output = equipmentResult(['Rune mace', ...shields], {}, { 'Show Best in Slot Shield': true });
  const prayer = output.loadouts.find(loadout => loadout.style === 'Prayer');
  assert.equal(prayer.best.score, 4);
  assert.deepEqual(prayer.best.items, ['Rune mace']);
  assert.ok(output.tasks.find(task => task.equipmentName === 'Rune mace').equipmentGoals.includes('Prayer BiS main hand weapon'));
  assert.ok(!output.recommendations.some(rec => rec.style === 'Prayer' && shields.includes(rec.equipment.name)));
  for (const task of output.catalogue.filter(task => shields.includes(task.equipmentName))) {
    assert.ok(task.equipmentGoals.every(goal => !goal.startsWith('Prayer ')));
  }
});

test('Blue dragonhide shield keeps legitimate Ranged and tank goals after zero-Prayer exclusion', () => {
  const output = equipmentResult(['Rune mace', 'Rune crossbow', 'Blue dragonhide shield'], {},
    { 'Show Best in Slot Shield': true, 'Show Best in Slot Defensive Tasks': true });
  const shield = output.tasks.find(task => task.equipmentName === 'Blue dragonhide shield');
  assert.ok(shield.equipmentGoals.includes('Ranged BiS off-hand'));
  assert.ok(shield.equipmentGoals.some(goal => goal.startsWith('Ranged Tank ')));
  assert.ok(shield.equipmentGoals.every(goal => !goal.startsWith('Prayer ')));
});

test('positive-Prayer shields remain Prayer goals while zero-Prayer ammunition stays a compatibility component', () => {
  const output = equipmentResult(['Rune mace'], {
    'Blessed fixture shield': { class: 'all', slot: 'off-hand', prayer: 2, armour: 100 },
    'Zero fixture shield': { class: 'all', slot: 'off-hand', prayer: 0, armour: 1000 },
  }, { 'Show Best in Slot Shield': true });
  assert.equal(output.loadouts.find(loadout => loadout.style === 'Prayer').best.score, 6);
  assert.ok(output.tasks.find(task => task.equipmentName === 'Blessed fixture shield').equipmentGoals.includes('Prayer BiS off-hand'));
  assert.ok(!output.catalogue.some(task => task.equipmentName === 'Zero fixture shield' && task.equipmentGoals.some(goal => goal.startsWith('Prayer '))));
  const equipment = {
    'Blessed fixture bow': { slot: '2h weapon', class: 'ranged', tier: 50, ability_damage: 480, accuracy: 850, prayer: 3 },
    'Fixture arrows': { slot: 'ammo', class: 'ranged', tier: 50, ability_damage: 480, prayer: 0 },
  };
  const ammo = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, slot: equipment[name].slot, sources: [] })) }, savedState(), 'player2',
    { equipment, codeItems: { ammoTools: { 'Fixture arrows': { 'Blessed fixture bow': true } } } });
  const prayer = ammo.loadouts.find(loadout => loadout.style === 'Prayer');
  assert.ok(prayer.best.items.includes('Fixture arrows'));
  assert.equal(prayer.best.taskIds.length, 1);
  const arrows = ammo.tasks.find(task => task.equipmentName === 'Fixture arrows');
  assert.ok(arrows.equipmentGoals.includes('Ranged BiS ammo'));
  assert.ok(arrows.equipmentGoals.every(goal => !goal.startsWith('Prayer ')));
  assert.ok(!ammo.recommendations.some(rec => rec.style === 'Prayer' && rec.slot === 'ammo'));
});
