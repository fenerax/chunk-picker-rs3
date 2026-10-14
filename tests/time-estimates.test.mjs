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
const state = () => createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12850'] }, { id: 'reed', name: 'Reed', unlocked: ['12851'] }]);
const candidateEstimate = (rows, items = [], before = [], current = state()) => estimateChunk(current, 'actor1', '12849', {
  baseline: result(before), prediction: { state: current, result: { ...result(rows), items }, delta: {} },
});

test('standard XP thresholds use the engine curve', () => {
  assert.equal(xpForLevel(1), 0); assert.equal(xpForLevel(15), 2411); assert.equal(xpForLevel(99), 13034431);
  assert.throws(() => xpForLevel(0)); assert.throws(() => xpForLevel(121));
});

test('drops use composed numeric probability, expected kills and acquisition percentile', () => {
  const value = estimateDrop(1 / 20, 12);
  assert.equal(value.expectedKills, 20); assert.equal(value.kills95, 59);
  close(value.hours, 20 * 12 / 3600); close(value.acquisition95Hours, 59 * 12 / 3600);
  assert.ok(1 - (1 - 1 / 20) ** value.kills95 >= 0.95);
  assert.ok(1 - (1 - 1 / 20) ** (value.kills95 - 1) < 0.95);
});

test('the 95% point remains finite for tiny probabilities and handles guaranteed drops', () => {
  const tiny = estimateDrop(1e-300, 60);
  close(tiny.expectedKills, 1e300); close(tiny.kills95, -Math.log(0.05) * 1e300);
  assert.ok(Number.isFinite(tiny.acquisition95Hours));
  const always = estimateDrop(1, 60); assert.equal(always.kills95, 1); assert.equal(always.expectedKills, 1);
});

test('missing, zero, malformed and outside-range drop rates never become guesses', () => {
  for (const probability of [null, undefined, NaN, 0, -1, 2]) {
    const value = estimateDrop(probability, 60); assert.equal(value.hours, null); assert.equal(value.status, 'unknown');
  }
  assert.equal(estimateDrop(Number.MIN_VALUE, 60).hours, null, 'unrepresentable expectation is explicit unknown');
});

test('choose fastest permitted item source with exact member kill overrides', () => {
  const sources = [drop('Rare fast beast', 1 / 100), drop('Common slow beast', 1 / 2), { kind: 'shop', source: 'Store' }];
  const value = estimateItemDrop('Gem', sources, { ...settings, monsterSecondsPerKill: { 'Rare fast beast': 0.1, 'Common slow beast': 60 } }, { NonShop: true });
  assert.equal(value.source.source, 'Rare fast beast'); close(value.hours, 10 / 3600);
  const restricted = estimateItemDrop('Gem', sources, settings, { AllowedSources: ['Rare fast beast'], Source: 'drop' });
  assert.equal(restricted.source.source, 'Rare fast beast'); assert.equal(restricted.alternatives.length, 1);
});

test('opaque rate labels stay unknown even if the label looks like a rate', () => {
  const value = estimateItemDrop('Gem', [drop('Imp', null, { rate: '1/5', unknownRate: true })], settings);
  assert.equal(value.hours, null); assert.equal(value.unknown[0].code, 'unknown-drop-probability');
  const mixed = estimateItemDrop('Gem', [drop('Imp', null, { unknownRate: true }), drop('Goblin', 0.1)], settings);
  assert.equal(mixed.source.source, 'Goblin'); assert.equal(mixed.status, 'partial'); assert.equal(mixed.unknown.length, 1);
  assert.equal(mixed.unknown[0].source, 'Imp'); assert.match(mixed.unknown[0].detail, /Imp/);
});

test('a numeric source rate wins over a rounded reciprocal display', () => {
  const value = estimateItemDrop('Gem', [drop('Imp', 0.03, { rate: '1/33' })], settings);
  close(value.expectedKills, 1 / 0.03); assert.notEqual(value.expectedKills, 33);
});





test('partner-only rows, completion, backlog and membership deferral have explicit policies', () => {
  const current = state(); current.members[0].taskStatus = { backlog: { backlogged: true } };
  const value = candidateEstimate([
    row('partner', { obligation: false, item: 'Very rare gem' }), row('done', { challengeSatisfied: true, item: 'Gem' }),
    row('personal', { personalCompleted: true, item: 'Gem' }), row('backlog'),
    row('member', { status: 'blocked', blockers: [{ kind: 'membership', detail: 'Members only' }], category: 'Fletching', level: 99 }),
  ], [], [], current);
  assert.deepEqual(value.breakdown.map(entry => entry.id), ['backlog', 'member']);
  assert.ok(value.breakdown.every(entry => entry.status === 'deferred')); assert.equal(value.death, false);
});

test('selected equipment goals only; lower upgrade alternatives do not impose deaths', () => {
  const current = state(), low = row('low', { equipmentName: 'Low helmet' }), high = row('high', { equipmentName: 'High helmet' });
  const after = { ...result([low, high]), items: [{ name: 'Low helmet', sources: [drop('Imp', 1e-9)] }, { name: 'High helmet', sources: [drop('Rat', 1)] }], equipmentPlanning: { obligationIds: ['high'] } };
  const value = estimateChunk(current, 'actor1', '12849', { baseline: { ...result([high]), equipmentPlanning: { obligationIds: ['high'] } }, prediction: { result: after } });
  assert.equal(value.breakdown.length, 0); assert.equal(value.death, false);
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


test('oak-only method cannot bootstrap a level-1 Fletching character', () => {
  const value = estimateSkill('Fletching', 99, logTraining({ oakOnly: true }));
  assert.equal(value.hours, null); assert.equal(value.status, 'unknown');
  assert.ok(value.assumptions.some(text => text.includes('level-1')));
});







