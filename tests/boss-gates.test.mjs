import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bossGates } from '../app/data/boss-gates.mjs';
import { validateBossGates, evaluateBossGate, evaluateBossGates, closedBossMonsters, bossGateById } from '../app/tasks/boss-gates.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const clock = () => '2026-10-25T12:00:00.000Z';
const gate = (fields = {}) => ({ id: 'test-boss', boss: 'Test boss', monsters: ['Test boss'], tier: 60, ...fields });

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
  ]) assert.throws(() => validateBossGates(bad), /Boss gate/);
});

test('a tier needs Defence and one listed style, and missing levels count as not met', () => {
  const plain = gate();
  assert.equal(evaluateBossGate(plain, {}).open, false);
  assert.match(evaluateBossGate(plain, {}).reason, /Locked until 60 Defence and 60 Attack, Ranged, Magic or Necromancy \(Defence not synced; Attack, Ranged, Magic or Necromancy not synced\)\./);
  assert.equal(evaluateBossGate(plain, { Defence: 60, Magic: 59, Necromancy: 60 }).open, true);
  assert.equal(evaluateBossGate(plain, { Defence: 59, Necromancy: 99 }).open, false);
  assert.match(evaluateBossGate(plain, { Defence: 59, Necromancy: 99 }).reason, /60 Defence \(have 59\)/);
  const ranged = gate({ styles: ['Ranged'], levels: { Prayer: 43 } });
  assert.equal(evaluateBossGate(ranged, { Defence: 60, Attack: 99 }).open, false);
  assert.equal(evaluateBossGate(ranged, { Defence: 60, Ranged: 60, Prayer: 42 }).open, false);
  const met = evaluateBossGate(ranged, { Defence: 60, Ranged: 60, Prayer: 43 });
  assert.equal(met.open, true); assert.equal(met.openedBy, 'levels');
  assert.equal(met.reason, 'Met: 60 Defence, 60 Ranged, 43 Prayer.');
});

test('group and hard mode gates open only by hand, and a hand unlock opens any gate', () => {
  const group = gate({ tier: undefined, locked: 'group' });
  assert.equal(evaluateBossGate(group, { Defence: 99, Attack: 99 }).open, false);
  assert.equal(evaluateBossGate(group, {}).reason, 'Locked until group content, unlocked by hand.');
  const manual = evaluateBossGate(group, {}, { 'test-boss': true });
  assert.equal(manual.open, true); assert.equal(manual.openedBy, 'manual');
  assert.equal(evaluateBossGate(gate(), {}, { 'test-boss': true }).openedBy, 'manual');
  assert.equal(evaluateBossGate(gate(), {}, { 'test-boss': 'yes' }).open, false);
  const statuses = evaluateBossGates({ Defence: 1, Attack: 1 }, {}, [gate(), gate({ id: 'open-one', monsters: ['Open one'], tier: 1 })]);
  assert.deepEqual([...closedBossMonsters(statuses).keys()], ['Test boss']);
  assert.equal(bossGateById('telos').boss, 'Telos, the Warden');
  assert.equal(bossGateById('missing'), undefined);
});

const definitions = () => ({
  chunks: { 100: { Monster: { 'Giant mole': 1, Rat: 1 } } },
  drops: { 'Giant mole': { 'Mole claw': { 1: '1/1' } }, Rat: { Bones: { 1: '1/1' } } },
  challenges: { Extra: { 'Use claw': { Items: ['Mole claw'] }, 'Use bones': { Items: ['Bones'] } } },
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
  assert.equal(levelled.bossGates.find(status => status.id === 'giant-mole').openedBy, 'levels');

  const manual = engine.evaluate(doc({ bossUnlocks: { 'giant-mole': true } }), 'm');
  assert.equal(row(manual, 'Use claw').status, 'available');
  const why = explainTask(row(manual, 'Use claw'), { result: manual });
  assert.deepEqual(why.bossGate, { boss: 'Giant Mole', reason: 'Unlocked by hand.' });
  assert.equal(explainTask(row(manual, 'Use bones'), { result: manual }).bossGate, undefined);

  const play = projectPlayResult(locked);
  assert.deepEqual(Object.keys(play.bossGates[0]).sort(), ['boss', 'id', 'monsters', 'open', 'openedBy', 'reason']);
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
