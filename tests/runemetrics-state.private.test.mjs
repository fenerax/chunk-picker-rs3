import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup, previewRestore } from '../app/core/state.mjs';
import { validateRuneScapeName, sameRuneScapeName, validateRuneMetricsTimestamp } from '../app/core/game-progress.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

const fetchedAt = '2026-10-07T17:00:00.000Z';
const now = () => '2026-10-07T18:00:00.000Z';
const quest = { id: 'quest:cooks-assistant', label: "Cook's Assistant", category: 'Quest' };
function group() {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }, { id: 'other', name: 'Other' }]);
  state.tasks = [quest, { id: 'skill:cook', label: 'Cook food', category: 'Cooking' }];
  return state;
}
function batch(extra = {}) {
  return { type: 'apply-runemetrics', memberId: 'player1', runescapeName: 'exampleGIMab', fetchedAt,
    skills: [{ skill: 'Cooking', level: 30, xp: 13400.5 }], quests: [{ taskId: quest.id, title: quest.label }], ...extra };
}
function apply(state, command) { return applyCommand(state, command, { now, expectedRevision: state.revision }); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('RuneScape bindings default only for the duo and old backups normalize without mutation', () => {
  const state = group();
  assert.equal(state.members[0].runescapeName, 'exampleGIMab');
  assert.equal(state.members[1].runescapeName, 'twosamplegim');
  assert.equal(Object.hasOwn(state.members[2], 'runescapeName'), false);
  const old = structuredClone(state);
  delete old.members[0].runescapeName; delete old.members[1].runescapeName;
  const before = JSON.stringify(old);
  assert.deepEqual(validateState(freeze(old)), state);
  assert.deepEqual(importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: old }), state);
  assert.equal(JSON.stringify(old), before);
  const custom = createGroupState([{ id: 'player1', name: 'Player 1', runescapeName: ' Custom_name ' }]);
  assert.equal(custom.members[0].runescapeName, 'Custom_name');
});

test('one RuneMetrics batch records personal provenance without changing declarations, challenge checks or partner', () => {
  const state = group();
  Object.assign(state.members[0], { passiveLevels: { Cooking: 2 }, maxLevels: { Cooking: 80 }, primaryOverrides: { Cooking: false },
    taskStatus: { [quest.id]: { challengeCompleted: false, favorite: true } }, teleports: [{ id: 'home', label: 'Home', destination: '100', available: true, consumable: false }] });
  const before = structuredClone(state), result = apply(freeze(state), batch({ runescapeName: ' EXAMPLEgimab ' }));
  const provenance = { source: 'runemetrics', fetchedAt, runescapeName: 'exampleGIMab' };
  assert.deepEqual(result.members[0].skillProgress, { Cooking: { level: 30, xp: 13400.5, ...provenance } });
  assert.deepEqual(result.members[0].questProgress, { [quest.id]: { title: quest.label, ...provenance } });
  assert.deepEqual(result.members[0].runeMetricsSync, provenance);
  assert.deepEqual(result.members[0].completedTasks, [quest.id]);
  for (const field of ['passiveLevels', 'maxLevels', 'primaryOverrides', 'taskStatus', 'teleports']) assert.deepEqual(result.members[0][field], before.members[0][field]);
  assert.deepEqual(result.members.slice(1), before.members.slice(1));
  assert.equal(result.revision, 1); assert.equal(result.history.length, 1);
  assert.equal(result.history[0].command.runescapeName, 'exampleGIMab');
  assert.deepEqual(state, before);
});

test('RuneMetrics facts merge, round trip and sparse undo restore previous values and optional absence', () => {
  const state = group(); state.members[0].completedTasks = [quest.id];
  const first = apply(state, batch()), later = '2026-10-07T17:30:00Z';
  const second = apply(first, batch({ fetchedAt: later, skills: [{ skill: 'Cooking', level: 40, xp: 37224 }, { skill: 'Crafting', level: 10, xp: 1200 }], quests: [] }));
  assert.deepEqual(importBackup(JSON.stringify(exportBackup(second))), second);
  assert.deepEqual(second.members[0].questProgress, first.members[0].questProgress);
  const preview = previewRestore(second, first);
  assert.deepEqual(preview.members[0].skillProgress.changed, ['Cooking']);
  assert.deepEqual(preview.members[0].skillProgress.removed, ['Crafting']);
  assert.equal(preview.members[0].runeMetricsSync.changed, true);
  const undoSecond = apply(importBackup(exportBackup(second)), { type: 'undo' });
  assert.deepEqual(undoSecond.members, first.members);
  const undoFirst = apply(undoSecond, { type: 'undo' });
  assert.deepEqual(undoFirst.members, state.members, 'Existing manual completion survives removal of observed provenance');
  assert.equal(Object.hasOwn(undoFirst.members[0], 'skillProgress'), false);
  assert.equal(Object.hasOwn(undoFirst.members[0], 'questProgress'), false);
  assert.equal(Object.hasOwn(undoFirst.members[0], 'runeMetricsSync'), false);
  assert.deepEqual(importBackup(exportBackup(undoFirst)), undoFirst);
});

test('backup validation rejects forged source, fact shape, bad skill and non-quest provenance', () => {
  const state = apply(group(), batch());
  const mutations = [
    value => { value.members[0].skillProgress.Cooking.source = 'manual'; },
    value => { value.members[0].skillProgress.Cooking.level = 121; },
    value => { value.members[0].skillProgress.Unknown = value.members[0].skillProgress.Cooking; },
    value => { value.members[0].questProgress['skill:cook'] = value.members[0].questProgress[quest.id]; },
    value => { value.members[0].runeMetricsSync.extra = true; },
    value => { value.members[0].questProgress[quest.id].fetchedAt = '2026-10-07'; },
    value => { value.history[0].undo.memberChanges[0].changes.find(patch => patch.path[0] === 'skillProgress' && patch.kind === 'value').after.value.source = 'manual'; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(state); mutate(invalid); assert.throws(() => validateState(invalid), TypeError); }
});

function observedState(engine, skills) {
  const state = group();
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.members[0].unlocked = ['100']; state.members[1].unlocked = ['100'];
  state.rules['content.f2p'] = false;
  return apply(state, batch({ skills, quests: [] }));
}
function row(result, category, label) { return result.tasks.find(task => task.id === taskId(category, label)); }

test('engine uses personal observed skill levels independently of manual controls and challenge flags', () => {
  const engine = createTaskEngine({ chunks: { 100: {} }, challenges: { Crafting: { Ten: { Level: 10 }, Twenty: { Level: 20 } } } });
  const state = observedState(engine, [{ skill: 'Crafting', level: 15, xp: 2411 }]);
  state.members[0].passiveLevels = { Crafting: 4 }; state.members[0].primaryOverrides = { Crafting: false };
  state.members[0].taskStatus = { [taskId('Crafting', 'Twenty')]: { challengeCompleted: true } };
  const before = JSON.stringify(state), result = engine.evaluate(state, 'player1');
  assert.equal(result.training.Crafting.level, 15); assert.equal(result.training.Crafting.observedLevel, 15);
  assert.equal(result.training.Crafting.observedXp, 2411); assert.equal(result.training.Crafting.passiveOverride, 4);
  assert.equal(result.training.Crafting.primary, false); assert.equal(result.training.Crafting.manualPrimary, false);
  assert.equal(row(result, 'Crafting', 'Ten').status, 'available');
  assert.equal(row(result, 'Crafting', 'Ten').personalCompleted, false);
  assert.equal(row(result, 'Crafting', 'Twenty').status, 'blocked');
  assert.equal(row(result, 'Crafting', 'Twenty').challengeSatisfied, true);
  assert.equal(engine.evaluate(state, 'player2').training.Crafting.level, 1);
  assert.equal(JSON.stringify(state), before);
  state.members[0].passiveLevels.Crafting = 18;
  assert.equal(engine.evaluate(state, 'player1').training.Crafting.level, 18);
  state.members[0].completedTasks.push(taskId('Crafting', 'Twenty'));
  assert.equal(engine.evaluate(state, 'player1').training.Crafting.level, 20);
});

test('engine clamps observed capability to F2P and manual caps while preserving real account facts', () => {
  const engine = createTaskEngine({ chunks: { 100: {} }, challenges: { Slayer: { Ten: { Level: 10 } } } });
  const state = observedState(engine, [{ skill: 'Slayer', level: 80, xp: 1986068 }]);
  state.rules['content.f2p'] = true;
  let result = engine.evaluate(state, 'player1');
  assert.equal(result.training.Slayer.level, 5); assert.equal(result.training.Slayer.observedLevel, 80);
  assert.equal(result.training.Slayer.observedCapabilityLevel, 5); assert.equal(row(result, 'Slayer', 'Ten').status, 'blocked');
  state.rules['content.f2p'] = false; state.members[0].maxLevels = { Slayer: 7 };
  result = engine.evaluate(state, 'player1');
  assert.equal(result.training.Slayer.level, 7); assert.equal(result.training.Slayer.observedLevel, 80);
  assert.equal(state.members[0].skillProgress.Slayer.level, 80);
  state.members[0].runescapeName = 'Different';
  assert.equal(engine.evaluate(state, 'player1').training.Slayer.level, 1);
  state.members[0].runescapeName = 'EXAMPLEGIMAB';
  assert.equal(engine.evaluate(state, 'player1').training.Slayer.level, 7);
});

test('observed Slayer level feeds initial source gates and refreshes after a later target releases a lock', () => {
  const engine = createTaskEngine({ chunks: { 100: { Connect: { Cave: { Tasks: { 'Open cave': 'Nonskill' } } }, Monster: { Beast: 1 } }, Cave: { Connect: { 100: true }, Monster: { Bat: 1 } } },
    slayerMonsters: { Beast: 10, Bat: 1 }, codeItems: { slayerTasks: { Bats: { Bat: true } } },
    drops: { Beast: { Fang: { 1: 'Always' } } }, challenges: { Nonskill: { 'Open cave': { Chunks: ['100'] } }, Extra: { Use: { Items: ['Fang'] } }, Slayer: { Fifteen: { Level: 15 } } } });
  const state = observedState(engine, [{ skill: 'Slayer', level: 20, xp: 4470 }]);
  state.members[0].maxLevels = { Slayer: 15 };
  let result = engine.evaluate(state, 'player1');
  assert.equal(result.training.Slayer.level, 15); assert(result.access.monsters.includes('Beast'));
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
  state.members[0].slayerLock = { level: 5, monster: 'Missing' };
  result = engine.evaluate(state, 'player1');
  assert.equal(result.training.Slayer.level, 5); assert.equal(result.training.Slayer.observedLevel, 20);
  assert(!result.access.monsters.includes('Beast')); assert.equal(result.effectiveSlayerLock.level, 5);
  state.members[0].slayerLock.monster = 'Bats';
  const before = JSON.stringify(state);
  result = engine.evaluate(state, 'player1');
  assert.equal(result.effectiveSlayerLock, null); assert.equal(result.slayerLockRelease.kind, 'target');
  assert.equal(result.training.Slayer.level, 15); assert.equal(result.training.Slayer.observedLevel, 20);
  assert(result.access.monsters.includes('Beast')); assert.equal(row(result, 'Slayer', 'Fifteen').status, 'available');
  assert.equal(JSON.stringify(state), before);
});
