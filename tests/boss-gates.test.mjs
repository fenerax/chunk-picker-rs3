import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bossGates } from '../app/data/boss-gates.mjs';
import { validateBossGates, evaluateBossGate, evaluateBossGates, closedBossMonsters, bossGateById, bossGearCatalogue, bestBossGear } from '../app/tasks/boss-gates.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const clock = () => '2026-10-25T12:00:00.000Z';
const gate = (fields = {}) => ({ id: 'test-boss', boss: 'Test boss', monsters: ['Test boss'], tier: 60, ...fields });
const item = (slot, kind, tier) => ({ slot, class: kind, tier, requirements: {} });
// The group's best gear by style, as the engine hands it to a gate.
const gearFrom = (equipment, names = Object.keys(equipment)) => bestBossGear(bossGearCatalogue(equipment), name => names.includes(name));
const meleeSet = tier => ({ [`Sword ${tier}`]: item('2h weapon', 'melee', tier), [`Body ${tier}`]: item('torso', 'melee', tier), [`Legs ${tier}`]: item('legs', 'melee', tier) });
const fullGear = gearFrom(Object.fromEntries(['melee', 'ranged', 'magic', 'necromancy'].flatMap(kind => [
  [`${kind} weapon`, item('main hand weapon', kind, 99)], [`${kind} body`, item('torso', kind, 99)], [`${kind} legs`, item('legs', kind, 99)]])));

test('the shipped boss gates are valid and name monsters the picker knows', () => {
  assert.equal(validateBossGates(bossGates), bossGates);
  const data = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const known = new Set(Object.keys(data.drops ?? {}));
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.Monster && typeof value.Monster === 'object') for (const name of Object.keys(value.Monster)) known.add(name);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(data.chunks);
  // Legiones has no monster record yet; its gate waits for the data.
  const missing = bossGates.flatMap(entry => entry.monsters).filter(name => !known.has(name) && name !== 'Legiones');
  assert.deepEqual(missing, []);
});

test('gate validation refuses malformed entries', () => {
  for (const bad of [
    [gate({ id: 'Bad Id' })],
    [gate(), gate()],
    [gate(), gate({ id: 'other' })],
    [gate({ monsters: [] })],
    [gate({ locked: 'solo' })],
    [gate({ tier: 0 })],
    [gate({ tier: undefined, styles: ['Ranged'] })],
    [gate({ styles: ['Cooking!'] })],
    [gate({ levels: { Prayer: 200 } })],
    [gate({ tier: undefined })],
    [gate({ notes: 'text' })],
    [gate({ gear: true })],
    [gate({ gear: { weapon: 0 } })],
    [gate({ gear: { shield: 60 } })],
    [gate({ gear: {} })],
    [gate({ tier: undefined, levels: { Prayer: 1 }, gear: false })],
    [gate({ styles: ['Prayer'] })],
  ]) assert.throws(() => validateBossGates(bad), /Boss gate/);
});

test('a tier needs Defence and one listed style, and missing levels count as not met', () => {
  const plain = gate();
  assert.equal(evaluateBossGate(plain, {}, {}, fullGear).open, false);
  assert.equal(evaluateBossGate(plain, {}, {}, fullGear).reason, 'Locked until 60 Defence and 60 Attack, Ranged, Magic or Necromancy and the group can get a tier-60 weapon, body and legs in one style (Defence not synced; Attack, Ranged, Magic or Necromancy not synced).');
  assert.equal(evaluateBossGate(plain, { Defence: 60, Magic: 59, Necromancy: 60 }, {}, fullGear).open, true);
  const low = evaluateBossGate(plain, { Defence: 58, Necromancy: 99 }, {}, fullGear);
  assert.equal(low.open, false);
  assert.deepEqual(low.missing, ['Defence 58/60']);
  const ranged = gate({ styles: ['Ranged'], levels: { Prayer: 43 } });
  assert.equal(evaluateBossGate(ranged, { Defence: 60, Attack: 99 }, {}, fullGear).open, false);
  assert.equal(evaluateBossGate(ranged, { Defence: 60, Ranged: 60, Prayer: 42 }, {}, fullGear).open, false);
  const met = evaluateBossGate(ranged, { Defence: 60, Ranged: 60, Prayer: 43 }, {}, fullGear);
  assert.equal(met.open, true); assert.equal(met.openedBy, 'levels');
  assert.equal(met.reason, 'Met: 60 Defence, 60 Ranged, 43 Prayer and the group can get tier gear (ranged: ranged weapon, ranged body, ranged legs).');
});

test('group and hard mode gates open only by hand, and a hand unlock opens any gate', () => {
  const group = gate({ tier: undefined, locked: 'group' });
  assert.equal(evaluateBossGate(group, { Defence: 99, Attack: 99 }).open, false);
  assert.equal(evaluateBossGate(group, {}).reason, 'Locked until group content, unlocked by hand.');
  const manual = evaluateBossGate(group, {}, { 'test-boss': true });
  assert.equal(manual.open, true); assert.equal(manual.openedBy, 'manual');
  assert.equal(evaluateBossGate(gate(), {}, { 'test-boss': true }).openedBy, 'manual');
  assert.equal(evaluateBossGate(gate(), {}, { 'test-boss': 'yes' }).open, false);
  const statuses = evaluateBossGates({ Defence: 1, Attack: 1 }, {}, [gate(), gate({ id: 'open-one', monsters: ['Open one'], tier: 1 })], fullGear);
  assert.deepEqual([...closedBossMonsters(statuses).keys()], ['Test boss']);
  assert.equal(bossGateById('telos').boss, 'Telos, the Warden');
  assert.equal(bossGateById('missing'), undefined);
});

test('tier gear needs a weapon, body and legs in one style the gate allows', () => {
  const levels = { Defence: 60, Attack: 60, Ranged: 60, Magic: 60, Necromancy: 60 };
  const equipment = { ...meleeSet(60), 'Bow 60': item('2h weapon', 'ranged', 60), 'Ranged body 60': item('torso', 'ranged', 60), 'Ranged legs 50': item('legs', 'ranged', 50) };
  const check = (fields, names) => evaluateBossGate(gate(fields), levels, {}, gearFrom(equipment, names));

  // Mixed styles do not make a set: a melee weapon with ranged armour.
  const mixed = check({}, ['Sword 60', 'Ranged body 60', 'Ranged legs 50']);
  assert.equal(mixed.open, false);
  assert.deepEqual(mixed.missing, ['needs a tier-60 melee body and legs'], 'Ties name the first style the gate lists');

  const all = check({}, Object.keys(equipment));
  assert.equal(all.open, true);
  assert.deepEqual(all.gear.items, ['Sword 60', 'Body 60', 'Legs 60']);
  assert.equal(all.gear.style, 'melee');

  // A gate naming fewer styles ignores gear in the others.
  const rangedOnly = check({ styles: ['Ranged'] }, Object.keys(equipment));
  assert.equal(rangedOnly.open, false);
  assert.deepEqual(rangedOnly.missing, ['needs tier-60 ranged legs']);
  assert.match(rangedOnly.condition, /tier-60 weapon, body and legs in ranged style$/);
  assert.deepEqual(check({ styles: ['Necromancy'] }, Object.keys(equipment)).missing, ['needs a tier-60 necromancy weapon, body and legs']);
  assert.equal(check({ styles: ['Attack'] }, Object.keys(equipment)).open, true);

  // Any-style armour counts for every style; nothing gettable names no style.
  const hybrid = gearFrom({ ...equipment, 'Hybrid body': item('torso', 'hybrid', 70), 'Hybrid legs': item('legs', 'all', 70) }, ['Bow 60', 'Hybrid body', 'Hybrid legs']);
  assert.equal(evaluateBossGate(gate({ styles: ['Ranged'] }), levels, {}, hybrid).open, true);
  assert.deepEqual(evaluateBossGate(gate(), levels, {}, gearFrom(equipment, [])).missing, ['needs a tier-60 weapon, body and legs in one style']);
  assert.deepEqual(evaluateBossGate(gate(), levels).missing, ['needs a tier-60 weapon, body and legs in one style'], 'Unknown gear counts as not met');
});

test('a missing body or legs names the piece, and the best item per piece wins', () => {
  const levels = { Defence: 60, Attack: 60 };
  const equipment = { ...meleeSet(60), ...meleeSet(50) };
  const without = (...names) => evaluateBossGate(gate(), levels, {}, gearFrom(equipment, Object.keys(equipment).filter(name => !names.includes(name))));
  assert.deepEqual(without('Body 60').missing, ['needs a tier-60 melee body']);
  assert.deepEqual(without('Legs 60').missing, ['needs tier-60 melee legs']);
  assert.deepEqual(without('Body 60', 'Legs 60').missing, ['needs a tier-60 melee body and legs']);
  assert.deepEqual(without('Sword 60').missing, ['needs a tier-60 melee weapon']);
  assert.match(without('Body 60').reason, /^Locked until .*\(needs a tier-60 melee body\)\.$/);
  const best = gearFrom(equipment);
  assert.deepEqual(best.melee.body, { name: 'Body 60', tier: 60 });
  assert.equal(best.ranged.weapon, null);
});

test('levels met with gear missing stay locked, and gear tiers tune from the data alone', () => {
  const levels = { Defence: 70, Attack: 70 };
  const gear = gearFrom(meleeSet(60));
  const locked = evaluateBossGate(gate({ tier: 70 }), levels, {}, gear);
  assert.equal(locked.open, false);
  assert.equal(locked.checks.every(check => check.met), true);
  assert.deepEqual(locked.missing, ['needs a tier-70 weapon, body and legs in one style']);
  // A lower armour tier, or no gear check at all, is a data change.
  assert.equal(evaluateBossGate(gate({ tier: 70, gear: { weapon: 60, armour: 60 } }), levels, {}, gear).open, true);
  const tuned = gate({ tier: 70, gear: { armour: 60 } });
  assert.match(evaluateBossGate(tuned, levels, {}, gear).condition, /a tier-70 weapon with tier-60 body and legs in one style$/);
  assert.deepEqual(evaluateBossGate(tuned, levels, {}, gear).missing, ['needs a tier-70 melee weapon']);
  assert.equal(evaluateBossGate(tuned, levels, {}, gearFrom({ ...meleeSet(60), 'Sword 70': item('main hand weapon', 'melee', 70) })).open, true);
  assert.equal(evaluateBossGate(gate({ tier: 70, gear: false }), levels).open, true);
  assert.equal(evaluateBossGate(gate({ tier: 70, gear: false }), levels).gear, null);
  assert.equal(evaluateBossGate(gate({ tier: 70 }), levels, { 'test-boss': true }).open, true, 'A hand unlock still opens it');
});

const definitions = () => ({
  chunks: { 100: { Monster: { 'Giant mole': 1, Rat: 1, 'Armoured goblin': 1 } } },
  drops: { 'Giant mole': { 'Mole claw': { 1: '1/1' } }, Rat: { Bones: { 1: '1/1' } },
    'Armoured goblin': Object.fromEntries(Object.keys(meleeSet(40)).map(name => [name, { 1: '1/1' }])) },
  equipment: meleeSet(40),
  challenges: { Extra: { 'Use claw': { Items: ['Mole claw'] }, 'Use bones': { Items: ['Bones'] }, 'Kill mole': { Monsters: ['Giant mole'] } } },
});
const observation = level => ({ level, xp: 1_000_000, source: 'game-plugin', memberId: 'm', fetchedAt: clock() });
const doc = member => ({ rules: { 'Rare Drop': false, 'content.f2p': false }, taskRules: {}, members: [{ id: 'm', unlocked: ['100'], completedTasks: [], ...member }] });
const row = (result, name) => result.tasks.find(task => task.id === taskId('Extra', name));

test('a gated boss keeps its drop tasks back until levels or a hand unlock open it', () => {
  const engine = createTaskEngine(definitions());
  const locked = engine.evaluate(doc({}), 'm');
  assert.equal(row(locked, 'Use claw').status, 'blocked');
  assert.equal(row(locked, 'Use bones').status, 'available', 'Ungated monsters are untouched');
  assert.equal(locked.bossGates.find(status => status.id === 'giant-mole').open, false);
  assert(locked.diagnostics.some(value => value.code === 'boss-gated' && value.source === 'Giant mole' && value.gate === 'giant-mole'));

  const low = engine.evaluate(doc({ skillProgress: { Defence: observation(40), Attack: observation(39) } }), 'm');
  assert.equal(row(low, 'Use claw').status, 'blocked');
  const levelled = engine.evaluate(doc({ skillProgress: { Defence: observation(40), Necromancy: observation(40) } }), 'm');
  assert.equal(row(levelled, 'Use claw').status, 'available');
  assert.deepEqual(levelled.bossGates.find(status => status.id === 'giant-mole').gear.items, ['Sword 40', 'Body 40', 'Legs 40']);
  assert.equal(levelled.bossGates.find(status => status.id === 'giant-mole').openedBy, 'levels');

  const manual = engine.evaluate(doc({ bossUnlocks: { 'giant-mole': true } }), 'm');
  assert.equal(row(manual, 'Use claw').status, 'available');
  const why = explainTask(row(manual, 'Use claw'), { result: manual });
  assert.deepEqual(why.bossGate, { boss: 'Giant Mole', open: true, reason: 'Unlocked by hand.' });
  // A task naming the boss says what its closed gate still needs.
  const waiting = explainTask(row(locked, 'Kill mole'), { result: locked }).bossGate;
  assert.equal(waiting.open, false);
  assert.match(waiting.reason, /^Locked until 40 Defence and 40 Attack, .* \(Defence not synced; .*not synced\)\.$/);
  assert.equal(explainTask(row(manual, 'Use bones'), { result: manual }).bossGate, undefined);

  const play = projectPlayResult(locked);
  assert.deepEqual(Object.keys(play.bossGates[0]).sort(), ['boss', 'condition', 'gearItems', 'id', 'missing', 'monsters', 'open', 'openedBy', 'reason']);
});

test('the group pools gear: one player has the bars and the other the anvil', () => {
  const chunks = ['12341', '12342', '12343'];
  const engine = createTaskEngine({
    chunks: { 12341: { Monster: { 'Giant mole': 1 } }, 12342: { Monster: { 'Armoured goblin': 1 }, Object: { Anvil: 1 } }, 12343: { Monster: { 'Ore goblin': 1 } } },
    walkableChunks: chunks, walkableChunksF2P: chunks,
    drops: { 'Giant mole': { 'Mole claw': { 1: '1/1' } }, 'Armoured goblin': { 'Steel 2h sword': { 1: '1/1' } }, 'Ore goblin': { 'Steel bar': { 1: '1/1' } } },
    equipment: { 'Steel 2h sword': item('2h weapon', 'melee', 40), 'Steel platebody': item('torso', 'melee', 40), 'Steel platelegs': item('legs', 'melee', 40) },
    challenges: { Extra: { 'Use claw': { Items: ['Mole claw'] } },
      Smithing: { 'Smith steel armour': { Objects: ['Anvil'], Items: ['Steel bar'], Output: ['Steel platebody', 'Steel platelegs'], Level: 1, Primary: true } } },
  }, { cacheWalking: false, retainedTaskCorrections: false });
  const levels = id => Object.fromEntries(['Defence', 'Attack'].map(skill => [skill, { ...observation(40), memberId: id }]));
  const teleports = chunks.map(destination => ({ id: `fixture:${destination}`, destination, available: true, consumable: false }));
  const group = shared => ({ rules: { 'Rare Drop': false, 'content.f2p': false, 'access.shared': shared, 'travel.automatic': false, 'access.transport': false }, taskRules: {}, members: [
    { id: 'm', unlocked: ['12341', '12342'], completedTasks: [], skillProgress: levels('m'), teleports },
    { id: 'p', unlocked: ['12343'], completedTasks: [], skillProgress: levels('p'), teleports }] });
  const mole = (shared, id) => engine.evaluate(group(shared), id).bossGates.find(status => status.id === 'giant-mole');

  for (const id of ['m', 'p']) {
    const status = mole(true, id);
    assert.equal(status.open, true, `${id} gets the smithed armour from the pooled bar and anvil`);
    assert.deepEqual(status.gear.items, ['Steel 2h sword', 'Steel platebody', 'Steel platelegs']);
  }
  // Without shared access neither player can make the armour alone.
  const alone = mole(false, 'm');
  assert.equal(alone.open, false);
  assert.deepEqual(alone.missing, ['needs a tier-40 melee body and legs']);
});

test('the unlock-now command saves, relocks, undoes and round-trips a backup', () => {
  const original = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  const unlocked = applyCommand(original, { type: 'set-boss-unlock', memberId: 'actor1', gate: 'telos', unlocked: true }, { now: clock });
  assert.deepEqual(unlocked.members[0].bossUnlocks, { telos: true });
  assert.equal(unlocked.members[1].bossUnlocks, undefined);
  assert.deepEqual(importBackup(exportBackup(unlocked)), unlocked);
  assert.equal(describeHistoryEvent(unlocked.history.at(-1), { members: unlocked.members }).includes('Unlocked Telos, the Warden'), true);
  const relocked = applyCommand(unlocked, { type: 'set-boss-unlock', memberId: 'actor1', gate: 'telos', unlocked: false }, { now: clock });
  assert.deepEqual(relocked.members[0].bossUnlocks, {});
  const undone = applyCommand(relocked, { type: 'undo' }, { now: clock });
  assert.deepEqual(undone.members[0].bossUnlocks, { telos: true });
  for (const command of [
    { type: 'set-boss-unlock', memberId: 'actor1', gate: 'not-a-gate', unlocked: true },
    { type: 'set-boss-unlock', memberId: 'actor1', gate: 'telos', unlocked: 'yes' },
    { type: 'set-boss-unlock', memberId: 'actor1', gate: 'telos', unlocked: true, extra: 1 },
  ]) assert.throws(() => applyCommand(original, command, { now: clock }));
  const stale = structuredClone(original);
  stale.members[0].bossUnlocks = { 'retired-gate': true };
  assert.doesNotThrow(() => validateState(stale), 'A gate removed from the data later does not break the save');
  stale.members[0].bossUnlocks = { telos: false };
  assert.throws(() => validateState(stale), /boss unlock/);
});
