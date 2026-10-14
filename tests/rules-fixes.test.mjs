import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { evaluateRollPool } from '../app/core/rules.mjs';
import { predictChunk } from '../app/core/planning.mjs';
import { buildAccessIndex, calculateAccess, collectBaseItemSources } from '../app/tasks/access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { selectEquipmentRecommendations } from '../app/tasks/presentation.mjs';
import { taskRuleDefinitions, taskRuleValueError, taskRuleCutoff } from '../app/data/settings.mjs';

const now = '2026-10-07T12:00:00.000Z';
const state = taskRules => ({ rules: {}, taskRules, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const weapon = { slot: '2h weapon', class: 'melee', tier: 1, ability_damage: 10, accuracy: 20, speed: 3, is_consumable: true };
const fixture = rate => ({ chunks: { 100: { Monster: { Rat: true } } }, drops: { Rat: { Gem: { 1: rate } } }, equipment: { Gem: weapon },
  challenges: { Crafting: { Polish: { Level: 1, Primary: true, Items: ['Gem*'] }, Search: { Primary: true, Output: 'Cache' } } },
  skillItems: { Crafting: { Cache: { Shard: { 1: rate } } } } });
const has = (result, item) => result.items.some(row => row.name === item);
function primaryPanels(probability, rules, extra = {}) {
  const doc = state(rules), source = { kind: 'drop', probability, ...extra };
  const activity = buildActivityInfo({ tasks: [{ id: 'method', category: 'Crafting', status: 'available', primary: true, record: { Items: ['Gem*'] } }],
    training: { Crafting: {} }, items: [{ name: 'Gem', sources: [source] }] }, doc, 'm');
  const equipment = evaluateEquipment({ equipment: [{ name: 'Gem', sources: [source] }], access: {} }, state({ ...rules, 'Consumable Primary BiS': true }), 'm', { equipment: { Gem: weapon } });
  return [activity.skills[0].primaryMethods.length > 0, equipment.tasks.length > 0];
}


test('A: a partner unlock during a pending offer preserves acceptance and personal ownership', () => {
  const ids = ['100', '200', '300'], world = { chunks: new Map(ids.map(id => [id, {}])), neighbors: new Map(), walkable: new Set(ids), f2p: new Set(ids), surface: new Set(ids) };
  let doc = createGroupState([{ id: 'm', name: 'Player', unlocked: ['100'], selected: ['200', '300'] }, { id: 'r', name: 'Reed' }]);
  doc = applyCommand(doc, { type: 'roll', memberId: 'm', count: 2 }, { world, now, random: () => 0 });
  doc = applyCommand(doc, { type: 'set-chunk', memberId: 'r', chunkId: '200', status: 'unlocked' }, { world, now });
  assert.deepEqual(doc.members[0].pendingRoll, ['200', '300']);
  doc = applyCommand(doc, { type: 'unlock-selection', memberId: 'm', chunkId: '200' }, { world, now });
  assert(doc.members.every(member => member.unlocked.includes('200')));
});


for (const inclusive of [false, true]) for (const [rate, position] of [['1/17', -1], ['1/16', 0], ['1/15', 1]]) {
  test(`B: rare cutoff ${rate}, inclusive=${inclusive}, agrees across access, collection and skill outputs`, () => {
    const rules = { 'Rare Drop': false, 'Rare Drop Amount': '16', 'Rare Drop Inclusive': inclusive, 'Every Drop': true, 'All Droptables': true };
    const d = fixture(rate), doc = state(rules), allowed = position > 0 || position === 0 && inclusive;
    const access = collectBaseItemSources(d, calculateAccess(buildAccessIndex(d), doc, 'm'), { rules });
    assert.equal(access.items.has('Gem'), allowed);
    const result = createTaskEngine(d).evaluate(doc, 'm');
    assert.equal(has(result, 'Gem'), allowed); assert.equal(has(result, 'Shard'), allowed);
    const collections = createCollectionEngine(d).evaluate(doc, 'm', { ...result, items: [{ name: 'Gem', sources: [{ kind: 'drop', source: 'Rat', probability: 1 / Number(rate.split('/')[1]) }] }] });
    assert.equal(collections.tasks.some(row => row.item === 'Gem'), allowed);
  });
  test(`B: primary cutoff ${rate}, inclusive=${inclusive}, agrees across engine, Activity Info and equipment`, () => {
    const rules = { 'Secondary Primary Amount': '16', 'Secondary Primary Inclusive': inclusive }, expected = position > 0 || position === 0 && inclusive;
    const result = createTaskEngine(fixture(rate)).evaluate(state(rules), 'm');
    assert.equal(result.tasks.find(row => row.rawLabel === 'Polish').primaryMethod, expected);
    assert.deepEqual(primaryPanels(1 / Number(rate.split('/')[1]), rules), [expected, expected]);
  });
}

test('B: bare decimal amounts and the include-everything zero sentinel agree in every consumer', () => {
  for (const amount of ['0.5', '2.5', '0']) {
    const rules = { 'Rare Drop': false, 'Rare Drop Amount': amount, 'Secondary Primary Amount': amount, 'Every Drop': true }, d = fixture('1/2'), doc = state(rules), expected = amount !== '0.5';
    assert.equal(collectBaseItemSources(d, calculateAccess(buildAccessIndex(d), doc, 'm'), { rules }).items.has('Gem'), expected);
    const result = createTaskEngine(d).evaluate(doc, 'm'); assert.equal(has(result, 'Gem'), expected); assert.equal(has(result, 'Shard'), expected);
    assert.equal(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.item === 'Gem'), expected);
    assert.deepEqual(primaryPanels(.5, rules), [expected, expected]);
  }
  const result = createTaskEngine(fixture('1/Infinity')).evaluate(state({ 'Rare Drop': false, 'Rare Drop Amount': '0' }), 'm');
  assert(has(result, 'Gem')); assert(has(result, 'Shard'));
});

test('C: one parser normalizes every Q4 rate form and explicitly returns unknown', async () => {
  const { parseDropRate } = await import('../app/tasks/rates.mjs');
  for (const [raw, expected] of [['Always', 1], ['always', 1], ['ALWAYS', 1], ['~1/100', .01], ['1/~100', .01], ['1/1,000', .001], ['20/129280*', 20 / 129280], ['1/Infinity', 0], ['1/65536/640', 1 / 65536 / 640], ['1.5/2.5', .6]]) assert.equal(parseDropRate(raw), expected, raw);
  for (const raw of ['Common', 'Uncommon', 'Rare', 'Very rare', 'Very Rare', 'Random', 'Once', 'Unknown', 'Varies', 'Never', 'Unommon', 'common', 'uncommon', 'rare', '', ' ', '256', 256, null, undefined, '/59256', '~1/x', '1/10-1/20', '1/2 × 1/3', '1//2', '1/0']) assert.equal(parseDropRate(raw), null, String(raw));
});

test('C: Q4 forms have consistent admission and primary outcomes through all source consumers', () => {
  const cases = [['Always', 1], ['always', 1], ['~1/100', .01], ['1/~100', .01], ['1/1,000', .001], ['20/129280*', 20 / 129280], ['1/Infinity', 0], ['1/65536/640', 1 / 65536 / 640],
    ...['Common', 'Uncommon', 'Rare', 'Very rare', 'Very Rare', 'Random', 'Once', 'Unknown', 'Varies', 'Never', 'Unommon', 'common', 'uncommon', 'rare', '', '256', '/59256', '~1/x', '1/10-1/20', '1/2 × 1/3'].map(raw => [raw, null])];
  const rules = { 'Rare Drop': false, 'Rare Drop Amount': '1000', 'Secondary Primary Amount': '16', 'Every Drop': true };
  for (const [raw, probability] of cases) {
    const d = fixture(raw), doc = state(rules), result = createTaskEngine(d).evaluate(doc, 'm'), allowed = probability === null || probability > .001, primary = probability !== null && probability >= 1 / 16;
    const base = collectBaseItemSources(d, calculateAccess(buildAccessIndex(d), doc, 'm'), { rules });
    assert.equal(base.items.has('Gem'), allowed, raw);
    assert.equal(has(result, 'Gem'), allowed, raw); assert.equal(has(result, 'Shard'), allowed, raw);
    if (allowed) assert.equal(result.items.find(row => row.name === 'Gem').sources[0].probability, probability, raw);
    assert.equal(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.item === 'Gem'), allowed, raw);
    assert.deepEqual(primaryPanels(probability, rules), [primary, primary], raw);
  }
});




test('D: nested skill tables also compose rates in collection goals', () => {
  const d = { chunks: { 100: {} }, challenges: { Thieving: { Loot: { Primary: true, Output: 'Cache' } } }, skillItems: { Thieving: { Cache: { Nested: { 1: '1/2' } }, Nested: { Gem: { 1: '1/3' } } } } };
  for (const amount of ['5', '7']) {
    const doc = state({ 'Rare Drop': false, 'Rare Drop Amount': amount, 'Every Drop': true, 'Every Drop Thieving': true, 'All Droptables': true }), result = createTaskEngine(d).evaluate(doc, 'm');
    const collections = createCollectionEngine(d).evaluate(doc, 'm', result), allowed = amount === '7';
    assert.equal(has(result, 'Gem'), allowed);
    assert.equal(collections.tasks.filter(row => row.item === 'Gem').length, allowed ? 2 : 0);
    if (allowed) assert.equal(collections.tasks.find(row => row.item === 'Gem').sources[0].probability, 1 / 6);
  }
});

test('D: collection root strings and code-table outputs use the same supported rates as the engine', () => {
  for (const codeTable of [false, true]) {
    const d = { chunks: { 100: {} }, challenges: { Thieving: { Loot: { Primary: true, Output: 'Cache' } } },
      ...(codeTable ? { codeItems: { dropTables: { Cache: { Gem: '1/2@1' } } } } : { skillItems: { Thieving: { Cache: { Gem: '1/2@1' } } } }) };
    const doc = state({ 'Every Drop': true, 'Every Drop Thieving': true, 'All Droptables': true }), result = createTaskEngine(d).evaluate(doc, 'm');
    assert(has(result, 'Gem'));
    const collections = createCollectionEngine(d).evaluate(doc, 'm', result);
    assert.equal(collections.tasks.filter(row => row.item === 'Gem').length, 2);
    assert.equal(collections.tasks.find(row => row.item === 'Gem').sources[0].probability, .5);
  }
});

test('B/D: mathematically equal composed rates obey both boundary options despite floating-point rounding', () => {
  const d = { chunks: { 100: { Monster: { Rat: true } } }, drops: { Rat: { Table: { 1: '1/10' } } }, codeItems: { dropTables: { Table: { Gem: '1/10@1' } } },
    challenges: { Crafting: { Loot: { Primary: true, Output: 'Cache' }, Use: { Primary: true, Items: ['Gem*'] } } }, skillItems: { Crafting: { Cache: { Table: { 1: '1/10' } } } } };
  for (const inclusive of [false, true]) {
    const rules = { 'Rare Drop': false, 'Rare Drop Amount': '100', 'Rare Drop Inclusive': inclusive, 'Secondary Primary Amount': '100', 'Secondary Primary Inclusive': inclusive, 'Every Drop': true }, doc = state(rules);
    const result = createTaskEngine(d).evaluate(doc, 'm');
    assert.equal(has(result, 'Gem'), inclusive);
    assert.equal(collectBaseItemSources(d, calculateAccess(buildAccessIndex(d), doc, 'm'), { rules }).items.has('Gem'), inclusive);
    assert.equal(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.item === 'Gem'), inclusive);
    assert.deepEqual(primaryPanels((1 / 10) * (1 / 10), rules), [inclusive, inclusive]);
  }
});

test('B/C: ordinary consumable equipment uses the same known and unknown primary-rate policy', () => {
  const d = { equipment: { Ring: { slot: 'ring', class: 'all', armour: 1, is_consumable: true } } };
  for (const inclusive of [false, true]) for (const [probability, primary] of [[1 / 17, false], [1 / 16, inclusive], [1 / 15, true], [null, false]]) {
    const rules = { 'Consumable Primary BiS': true, 'Secondary Primary Amount': '16', 'Secondary Primary Inclusive': inclusive };
    const input = { equipment: [{ name: 'Ring', slot: 'ring', sources: [{ kind: 'drop', probability, ...(probability === null ? { primary: true, unknownRate: true } : {}) }] }], access: {} };
    assert.equal(evaluateEquipment(input, state(rules), 'm', d).tasks.length > 0, primary);
    assert.equal(selectEquipmentRecommendations(input, rules, d).tasks.length > 0, primary);
  }
});

for (const rate of ['Very rare', '/59256', 'Common', '', '256', '~1/x']) test(`C: unknown ${JSON.stringify(rate)} is admitted, marked and never primary`, () => {
  const rules = { 'Rare Drop': false, 'Rare Drop Amount': '1', 'Secondary Primary Amount': '0', 'Every Drop': true }, d = fixture(rate), doc = state(rules);
  const result = createTaskEngine(d).evaluate(doc, 'm');
  for (const item of ['Gem', 'Shard']) {
    const source = result.items.find(row => row.name === item)?.sources[0];
    assert(source); assert.equal(source.probability, null); assert.equal(source.unknownRate, true); assert.equal(source.rawRate, rate);
  }
  assert.equal(result.tasks.find(row => row.rawLabel === 'Polish').primaryMethod, false);
  assert(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.item === 'Gem'));
  assert.deepEqual(primaryPanels(null, rules, { primary: true, unknownRate: true, rawRate: rate }), [false, false]);
});


