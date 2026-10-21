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

test('A: personal roll origins and ownership stay separate from shared task access and predictions', () => {
  const ids = ['100', '200', '300'], world = { chunks: new Map(ids.map(id => [id, {}])), neighbors: new Map([['100', ['100', '200']], ['200', ['300']]]),
    walkable: new Set(ids), f2p: new Set(ids), surface: new Set(ids), sectionTopology: new Map(ids.map((id, index) => [id, new Map([['0', index ? [ids[index - 1]] : []]])])) };
  const doc = createGroupState([{ id: 'm', name: 'Player 1', unlocked: ['100'] }, { id: 'r', name: 'Player 2', unlocked: ['200'] }]);
  doc.members[0].teleports = [{ id: 'out', label: 'Out', destination: '200', available: true, consumable: false }, { id: 'back', label: 'Home', destination: '100', available: true, consumable: false }];
  const definitions = { chunks: { 100: {}, 200: { Spawn: { Gem: 1 } }, 300: {} }, challenges: {} }, engine = createTaskEngine(definitions);
  for (const mode of ['frontier', 'accessible']) {
    doc.rules['roll.neighborMode'] = mode;
    const pool = evaluateRollPool(world, doc, 'm');
    assert(pool.eligible.some(row => row.id === '200'), mode);
    assert(!pool.eligible.some(row => row.id === '300'), mode);
    assert(!pool.eligible.some(row => row.id === '100'), mode);
    assert(has(engine.evaluate(doc, 'm'), 'Gem'));
    const predicted = predictChunk(doc, 'm', '200', { world, engine });
    assert(predicted.state.members[0].unlocked.includes('200'));
  }
  doc.rules['roll.neighborMode'] = 'manual';
  doc.members[0].unlocked = []; doc.members[0].selected = ['100'];
  const generated = applyCommand(doc, { type: 'roll', memberId: 'm', count: 1 }, { world, now, random: () => 0 });
  assert(generated.members[0].selected.includes('200'));
  doc.members[0].unlocked = ['100']; doc.members[0].selected = [];
  const random = applyCommand(doc, { type: 'random-start', memberId: 'm', count: 1 }, { world, now, random: () => 0 });
  assert(random.members[0].unlocked.includes('200'));
});

test('B: inclusive options have defaults, boolean validation and denominator amount semantics', () => {
  for (const [id, value] of [['Rare Drop Inclusive', false], ['Secondary Primary Inclusive', true]]) {
    const definition = taskRuleDefinitions.find(row => row.id === id);
    assert.equal(definition?.default, value); assert.equal(definition?.type, 'boolean');
    assert.equal(taskRuleValueError(id, value), null); assert.match(taskRuleValueError(id, 'true'), /boolean/);
  }
  for (const [amount, expected] of [['2.5', .4], ['0.5', 2], ['1/2', .5]]) {
    const parts = taskRuleCutoff(amount).split('/').map(Number); assert.equal(parts[0] / parts[1], expected);
  }
});

test('B: present invalid aliases use defaults across consumers rather than lower-precedence amounts', () => {
  for (const invalid of [null, false, 'banana']) {
    const rules = { secondaryPrimaryNum: invalid, 'Secondary Primary Amount': '16', rareDropNum: invalid, 'Rare Drop Amount': '16', 'Rare Drop': false, 'Every Drop': true };
    const d = fixture('1/16'), doc = state(rules), result = createTaskEngine(d).evaluate(doc, 'm');
    assert(has(result, 'Gem'));
    assert.equal(result.tasks.find(row => row.rawLabel === 'Polish').primaryMethod, false);
    assert.deepEqual(primaryPanels(1 / 16, rules), [false, false]);
    assert(collectBaseItemSources(d, calculateAccess(buildAccessIndex(d), doc, 'm'), { rules }).items.has('Gem'));
    assert(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.item === 'Gem'));
  }
});

test('D: rate-bearing Farming outputs retain the Farming Primary gate in engine and Activity Info', () => {
  const d = { chunks: { 100: {} }, challenges: { Farming: { Grow: { Primary: true, Output: 'Cache' } }, Crafting: { Use: { Primary: true, Items: ['Gem*'] } } }, skillItems: { Farming: { Cache: { Gem: { 1: 'Always' } } } } };
  const doc = state({ 'Farming Primary': false }), result = createTaskEngine(d).evaluate(doc, 'm');
  assert.equal(result.training.Crafting.primary, false);
  const activity = buildActivityInfo({ ...result, tasks: result.tasks.map(row => ({ ...row, primaryMethod: undefined })) }, doc, 'm');
  assert.equal(activity.skills.find(row => row.skill === 'Crafting').primaryMethods.length, 0);
});

test('D: multiple task-output paths preserve independent probabilities and primary evidence', () => {
  for (const reverse of [false, true]) {
    const paths = [['RareTable', { 1: '1/100' }], ['CommonTable', { 1: 'Always' }]];
    const d = { chunks: { 100: {} }, challenges: { Crafting: { Search: { Primary: true, Output: 'Cache' } }, Fletching: { Use: { Primary: true, Items: ['Gem*'] } } },
      skillItems: { Crafting: { Cache: Object.fromEntries(reverse ? paths.reverse() : paths) } }, codeItems: { dropTables: { RareTable: { Gem: '1/100@1' }, CommonTable: { Gem: '1/2@1' } } } };
    // Cross-skill processing is enabled here so this fixture isolates rates.
    const result = createTaskEngine(d).evaluate(state({ 'Secondary Primary Amount': '16', 'Multi Step Processing': true }), 'm');
    assert.deepEqual(result.items.find(row => row.name === 'Gem').sources.map(row => row.probability).sort((a, b) => a - b), [.0001, .5]);
    assert.equal(result.training.Fletching.primary, true);
  }
});

test('D: nested skill output filters and primary evidence use the composed path', () => {
  const d = { chunks: { 100: {} }, challenges: { Crafting: { Search: { Primary: true, Output: 'Cache', Source: 'drop' } }, Fletching: { Use: { Primary: true, Items: ['Gem*'] } } },
    skillItems: { Crafting: { Cache: { Table: { 1: '1/100' } } } }, codeItems: { dropTables: { Table: { Gem: '1/100@2' } } } };
  const engine = createTaskEngine(d);
  assert(!has(engine.evaluate(state({ 'Rare Drop': false, 'Rare Drop Amount': '1000', 'Multi Step Processing': true }), 'm'), 'Gem'));
  for (const inclusive of [false, true]) {
    const result = engine.evaluate(state({ 'Secondary Primary Amount': '10000', 'Secondary Primary Inclusive': inclusive, 'Multi Step Processing': true }), 'm');
    const source = result.items.find(row => row.name === 'Gem').sources[0];
    assert.equal(source.probability, .0001); assert.equal(source.sourceKind, 'drop'); assert.equal(source.quantity, '2');
    assert.equal(result.training.Fletching.primary, inclusive);
  }
  d.codeItems.dropTables.Table.Gem = 'Very rare@2';
  const result = createTaskEngine(d).evaluate(state({ 'Rare Drop': false, 'Secondary Primary Amount': '0', 'Multi Step Processing': true }), 'm');
  assert(has(result, 'Gem')); assert.equal(result.training.Fletching.primary, false);
  assert.equal(result.items.find(row => row.name === 'Gem').sources[0].probability, null);
});

test('E: Boss removes classified drops while combat, Kill X Boss and collection logs retain their own gates', () => {
  const d = { chunks: { 100: { Monster: { Boss: true }, Shop: { Store: true } } }, codeItems: { bossMonsters: { Boss: true } },
    drops: { Boss: { 'Synthetic tooth': { 1: 'Always' } } }, shopItems: { Store: { 'Synthetic tooth': true } }, challenges: { 'Collection Log': { BossLog: { Items: ['Synthetic tooth'] } } } };
  const doc = state({ Boss: false, 'Kill X': true, 'Kill X Boss': true }), result = createTaskEngine(d).evaluate(doc, 'm');
  assert(result.access.monsters.includes('Boss')); assert.equal(result.training.Attack.primary, true);
  assert(result.items.find(row => row.name === 'Synthetic tooth').sources.every(source => source.kind !== 'drop'));
  assert(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.some(row => row.monster === 'Boss'));
  assert.equal(result.tasks.find(row => row.rawLabel === 'BossLog').status, 'available');
  const description = taskRuleDefinitions.find(row => row.id === 'Boss').description;
  assert.match(description, /boss list/); assert.match(description, /does not stop killing or training/);
});
