import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { predictChunk } from '../app/core/planning.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { estimateChunk, estimateDrop, estimateItemDrop, estimateSkill, trainingCatalogue, xpForLevel } from '../app/tasks/time-estimates.mjs';

const settings = { deathThresholdHours: 1000, defaultSecondsPerKill: 60, monsterSecondsPerKill: {} };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-12, `${actual} ≠ ${expected}`);
const drop = (source, probability, extras = {}) => ({ kind: 'drop', source, probability, ...extras });
const row = (id, extras = {}) => ({ id, label: id, rawLabel: id, record: {}, status: 'available', obligation: true, ...extras });
const result = tasks => ({ tasks, items: [], access: { bases: [], objects: [] } });
const state = () => createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'] }, { id: 'player2', name: 'Player 2', unlocked: ['12851'] }]);
const candidateEstimate = (rows, items = [], before = [], current = state()) => estimateChunk(current, 'player1', '12849', {
  baseline: result(before), prediction: { state: current, result: { ...result(rows), items }, delta: {} },
});

test('death threshold is strictly greater than unrounded hours', () => {
  const duty = row('gem', { item: 'Gem', record: { Label: 'Every Drop' } });
  assert.equal(candidateEstimate([duty], [{ name: 'Gem', sources: [drop('Imp', 1 / 60000)] }]).death, false);
  assert.equal(candidateEstimate([duty], [{ name: 'Gem', sources: [drop('Imp', 1 / 60001)] }]).death, true);
});

test('a chunk reports its slowest obligation rather than sum of independent duties', () => {
  const duties = ['A', 'B'].map(item => row(item, { item, record: { Label: 'Every Drop' } }));
  const value = candidateEstimate(duties, [{ name: 'A', sources: [drop('Imp', 1 / 40000)] }, { name: 'B', sources: [drop('Rat', 1 / 50000)] }]);
  close(value.hours, 50000 / 60); assert.equal(value.slowest.item, 'B'); assert.equal(value.death, false); assert.equal(value.breakdown.length, 2);
});

test('same-item Every Drop alternatives are one obligation and use connected partner drop capability', () => {
  const first = row('imp-gem', { item: 'Gem', collectionSource: 'Imp', record: { Label: 'Every Drop' } });
  const second = row('rat-gem', { item: 'Gem', collectionSource: 'Rat', record: { Label: 'Every Drop' } });
  const value = candidateEstimate([first, second], [{ name: 'Gem', sources: [drop('Imp', 1e-8, { own: true }), drop('Rat', 0.5, { own: false })] }]);
  assert.equal(value.breakdown.length, 1); assert.equal(value.slowest.source.source, 'Rat'); assert.equal(value.death, false);
  const alreadyOwed = candidateEstimate([first, second], [{ name: 'Gem', sources: [drop('Imp', 1e-8), drop('Rat', 0.5)] }], [first]);
  assert.equal(alreadyOwed.breakdown.length, 0, 'a new source for the same item is not a new obligation');
});

test('monster-specific All Droptables retain source and quantity restrictions', () => {
  const duty = row('imp-gem', { item: 'Gem', quantity: '1', collectionSource: 'Imp', record: { Label: 'All Droptables' }, sources: [drop('Imp', 1e-8, { quantity: '1' })] });
  const value = candidateEstimate([duty], [{ name: 'Gem', sources: [drop('Rat', 1), drop('Imp', 1e-8, { quantity: '1' })] }]);
  assert.equal(value.slowest.source.source, 'Imp'); assert.equal(value.death, true);
});

function logTraining({ oakOnly = false, partnerWillow = false } = {}) {
  const included = trainingCatalogue.methods.filter(method => oakOnly ? method.id === 'woodcutting.oak' || method.id === 'fletching.oak.longbow'
    : method.id === 'woodcutting.normal' || method.id === 'fletching.normal.shortbow' || method.id === 'fletching.normal.longbow'
      || partnerWillow && (method.id === 'woodcutting.willow' || method.id === 'fletching.willow.longbow'));
  const tasks = included.map(method => row(method.id, { category: method.skill, level: method.level, rawLabel: method.matches[0], primaryMethod: true,
    obligation: partnerWillow && method.id.includes('willow') ? false : true }));
  const items = included.filter(method => method.output).map(method => ({ name: method.output, sources: [{ kind: 'task', taskId: method.id, own: !partnerWillow || !method.id.includes('willow') }] }));
  return { ...result(tasks), items };
}

test('oak-only 99 Fletching prices every log acquisition plus processing', () => {
  const value = estimateSkill('Fletching', 99, logTraining({ oakOnly: true }), { progress: { Fletching: { level: 15 }, Woodcutting: { level: 10 } } });
  assert.equal(value.status, 'estimated'); assert.ok(value.hours > 2000); assert.equal(value.route.length, 1);
  const route = value.route[0]; assert.equal(route.xpPerAction, 14.7); assert.equal(route.actions, 886532);
  close(route.processingSeconds, route.actions * 1.8); close(route.supplySeconds, route.actions * (3600 * 37.5 / 18000 + 2));
  close(value.hours, (route.processingSeconds + route.supplySeconds) / 3600);
  assert.ok(value.assumptions.some(text => text.includes('held constant')));
});

test('reachable connected partner training improves the route without creating partner obligations', () => {
  const personal = estimateSkill('Fletching', 99, logTraining());
  const connected = estimateSkill('Fletching', 99, logTraining({ partnerWillow: true }));
  assert.ok(connected.hours < personal.hours); assert.ok(connected.route.some(segment => segment.viaPartner));
  assert.ok(connected.route.some(segment => segment.supplies.some(source => source.viaPartner)));
  assert.ok(connected.route[0].fromXp === 0, 'normal recipe bootstraps the actual scenario before willow');
});

test('unmapped reachable training methods stay visible as unknown alternatives', () => {
  const data = logTraining(); data.tasks.push(row('mystery', { category: 'Fletching', rawLabel: 'Make a mystery thing', primaryMethod: true }));
  const value = estimateSkill('Fletching', 99, data);
  assert.ok(value.hours > 0); assert.equal(value.status, 'partial'); assert.ok(value.unknown.some(reason => reason.code === 'unmapped-method'));
  assert.equal(estimateSkill('Mining', 99, data).hours, null);
});

test('Firemaking prices sourced bonfire XP/action and leaves line-fire timing unknown', () => {
  const data = logTraining();
  const fireMethods = trainingCatalogue.methods.filter(method => method.skill === 'Firemaking' && method.id.includes('normal'));
  data.tasks.push(...fireMethods.map(method => row(method.id, { category: 'Firemaking', level: method.level, primaryMethod: true, rawLabel: method.matches[0] })));
  const value = estimateSkill('Firemaking', 99, data);
  assert.ok(value.hours > 0); assert.equal(value.status, 'partial');
  assert.ok(value.route.every(segment => segment.methodId === 'firemaking.normal.bonfire'));
  assert.equal(value.route[0].xpPerAction, 50); assert.equal(value.route[0].processingSecondsPerAction, 6.6);
  assert.ok(value.unknown.some(reason => reason.code === 'unpriced-alternative'));
  const lineOnly = { ...data, tasks: data.tasks.filter(task => !task.id.endsWith('bonfire')) };
  assert.equal(estimateSkill('Firemaking', 99, lineOnly).hours, null);
});

test('verified personal completion is a lower bound, partner challenge checks and training ceilings are not XP', () => {
  const data = logTraining({ oakOnly: true });
  data.training = { Fletching: { level: 110, passiveLevel: 99 } };
  data.tasks.push(row('partner99', { category: 'Fletching', level: 99, challengeSatisfied: true, obligation: false, record: { NoBoost: true } }));
  assert.equal(estimateSkill('Fletching', 99, data).startingXp, 0);
  data.tasks.push(row('personal15', { category: 'Fletching', level: 15, personalCompleted: true, record: { NoBoost: true } }),
    row('personalWC10', { category: 'Woodcutting', level: 10, personalCompleted: true, record: { NoBoost: true } }));
  const value = estimateSkill('Fletching', 99, data); assert.equal(value.startingXp, 2411); assert.ok(value.hours > 2000);
});

test('full predictChunk results detect own-map duties with partner territory used only for methods', () => {
  const definitions = { chunks: { '12850': { Object: { Tree: true } }, '12851': { Object: { Willow: true } }, '12849': {} },
    sections: { '12850': { '0': ['12851', '12849'] }, '12851': { '0': ['12850'] }, '12849': { '0': ['12850'] } },
    walkableChunks: ['12849', '12850', '12851'], walkableChunksF2P: ['12849', '12850', '12851'], codeItems: {},
    challenges: { Woodcutting: { 'Cut ~|logs|~': { Level: 1, Primary: true, Objects: ['Tree'], Output: 'Logs' },
      'Cut ~|willow logs|~': { Level: 20, Primary: true, Objects: ['Willow'], Output: 'Willow logs' } },
    Fletching: { 'Fletch a ~|shortbow (unstrung)|~': { Level: 1, Primary: true, Items: ['Logs*'] },
      'Fletch a ~|longbow (unstrung)|~': { Level: 5, Primary: true, Items: ['Logs*'] },
      'Fletch a ~|willow longbow (unstrung)|~': { Level: 25, Primary: true, Items: ['Willow logs*'] },
      'Own level 99 goal': { Level: 99, Chunks: ['12849'] }, 'Partner level 110 goal': { Level: 110, Chunks: ['12851'] } } } };
  const current = state(), engine = createTaskEngine(definitions), world = buildWorld(definitions), baseline = engine.evaluate(current, 'player1');
  const prediction = predictChunk(current, 'player1', '12849', { world, engine });
  const value = estimateChunk(current, 'player1', '12849', { baseline, prediction });
  assert.equal(value.slowest.targetLevel, 99); assert.ok(value.slowest.route.some(segment => segment.viaPartner));
  assert.ok(!value.breakdown.some(entry => entry.taskIds.includes(taskId('Fletching', 'Partner level 110 goal'))));
  const prior = JSON.stringify(current); estimateChunk(current, 'player1', '12849', { baseline, prediction }); assert.equal(JSON.stringify(current), prior);
});

test('a blocked global skill target becomes an added duty when its first method unlocks', () => {
  const definitions = { chunks: { '12850': {}, '12849': { Object: { Tree: true } } }, sections: {},
    walkableChunks: ['12850', '12849'], walkableChunksF2P: ['12850', '12849'], codeItems: {},
    challenges: { Woodcutting: { 'Cut ~|logs|~': { Level: 1, Primary: true, Objects: ['Tree'], Output: 'Logs' } },
      Fletching: { 'Fletch a ~|shortbow (unstrung)|~': { Level: 1, Primary: true, Items: ['Logs*'] },
        'Fletch a ~|longbow (unstrung)|~': { Level: 5, Primary: true, Items: ['Logs*'] }, 'Global level 99 goal': { Level: 99 } } } };
  const current = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'] }]);
  const engine = createTaskEngine(definitions), world = buildWorld(definitions), baseline = engine.evaluate(current, 'player1');
  const prediction = predictChunk(current, 'player1', '12849', { world, engine });
  assert.equal(baseline.tasks.find(task => task.rawLabel === 'Global level 99 goal').status, 'blocked');
  const value = estimateChunk(current, 'player1', '12849', { baseline, prediction });
  assert.equal(value.slowest.targetLevel, 99); assert.ok(value.hours > 1000); assert.equal(value.death, true);
});

test('newly owned unchanged-ID duty is detected on a partner-owned candidate', () => {
  const duty = row('rare', { item: 'Gem', record: { Label: 'Every Drop' } });
  const value = candidateEstimate([duty], [{ name: 'Gem', sources: [drop('Imp', 1e-8)] }], [{ ...duty, obligation: false }]);
  assert.equal(value.breakdown.length, 1); assert.equal(value.death, true);
});
