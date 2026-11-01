import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { unknownDropEstimate, unknownDropContext, addUnknownDropWarnings } from '../app/tasks/unknown-drop-warnings.mjs';
import { UNKNOWN_DROP_RULE } from '../app/data/settings.mjs';
import { taskRuleDefinitions, taskRuleValueError } from '../app/data/settings.mjs';
import { taskRuleDefault } from '../app/tasks/rule-defaults.mjs';
import { buildRulesSections, rulesCatalogue, taskRuleValue, ruleEnabled } from '../app/web/rules-model.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';

const state = rules => ({ rules: {}, taskRules: rules, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const fixture = rate => ({ chunks: { 100: { Monster: { Rat: true } } }, drops: { Rat: { Gem: { 1: rate } } },
  challenges: { Crafting: { Use: { Items: ['Gem'], Output: 'Polished gem', Primary: true }, Finish: { Items: ['Polished gem'] } } } });
const use = result => result.tasks.find(row => row.rawLabel === 'Use');
for (const [rate, kills] of [['Rare', 384], ['rare', 384], ['Very rare', 3000], ['Very Rare', 3000]]) {
  test(`unknown ${rate} remains included and warns through a recipe`, () => {
    const d = fixture(rate), doc = state({ 'Rare Drop': false, 'Rare Drop Amount': '1', 'Every Drop': true });
    const before = JSON.stringify(doc), result = createTaskEngine(d).evaluate(doc, 'm');
    assert.equal(use(result).status, 'available');
    assert.equal(use(result).unknownDropKills, kills);
    assert.equal(use(result).unknownDropWarning, `Drop rate unknown (the wiki says rare). Move on after about ${kills.toLocaleString('en-US')} kills.`);
    assert.ok(use(result).explanation.endsWith(use(result).unknownDropWarning));
    assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropKills, kills);
    const source = result.items.find(row => row.name === 'Gem').sources[0];
    assert.equal(source.probability, null); assert.equal(source.unknownRate, true);
    const collections = createCollectionEngine(d).evaluate(doc, 'm', result);
    assert.equal(collections.tasks.find(row => row.item === 'Gem').unknownDropKills, kills);
    assert.equal(JSON.stringify(doc), before);
  });
}
for (const alternative of ['numeric', 'shop', 'spawn', 'recipe']) test(`${alternative} route removes direct, downstream and collection warnings`, () => {
  const d = fixture('Rare');
  if (alternative === 'numeric') { d.chunks[100].Monster.Other = true; d.drops.Other = { Gem: { 1: '1/1000000' } }; }
  if (alternative === 'shop') { d.chunks[100].Shop = { Store: true }; d.shopItems = { Store: { Gem: true } }; }
  if (alternative === 'spawn') d.chunks[100].Spawn = { Gem: 1 };
  if (alternative === 'recipe') d.challenges.Crafting.Other = { Output: 'Gem', Primary: true };
  const doc = state({ 'Every Drop': true }), result = createTaskEngine(d).evaluate(doc, 'm');
  assert.ok(result.items.find(item => item.name === 'Gem').sources.length >= 2);
  assert.ok(result.tasks.every(row => !row.unknownDropWarning));
  assert.ok(createCollectionEngine(d).evaluate(doc, 'm', result).tasks.every(row => !row.unknownDropWarning));
});
for (const rate of ['Common', 'Uncommon', 'Varies', 'Random', 'Once', 'Unknown', '', '1/128', '1/1000']) test(`${JSON.stringify(rate)} gets no warning`, () => {
  const result = createTaskEngine(fixture(rate)).evaluate(state({}), 'm');
  assert.equal(use(result).status, 'available'); assert.equal(use(result).unknownDropWarning, undefined);
});
test('nested rates compose only for guidance and keep threshold equality unchanged', () => {
  const d = fixture('1/2'); d.drops.Rat = { Cache: { 1: '1/2' } };
  d.codeItems = { dropTables: { Cache: { Gem: 'Rare@1' } } };
  for (const inclusive of [false, true]) {
    const result = createTaskEngine(d).evaluate(state({ 'Rare Drop': false, 'Rare Drop Amount': '256', 'Rare Drop Inclusive': inclusive }), 'm');
    assert.equal(use(result).status, 'available'); assert.equal(use(result).unknownDropKills, 768);
  }
  for (const inclusive of [false, true]) {
    const result = createTaskEngine(fixture('1/128')).evaluate(state({ 'Rare Drop': false, 'Rare Drop Amount': '128', 'Rare Drop Inclusive': inclusive }), 'm');
    assert.equal(use(result).status === 'available', inclusive); assert.equal(use(result).unknownDropWarning, undefined);
  }
  assert.equal(unknownDropEstimate({ rawRate: 'Uncommon × Rare', probability: null }), 4096);
  assert.equal(unknownDropEstimate({ rawRate: 'Random × Rare', probability: null }), 0);
});
test('cycles do not create a free route; a rooted alternative does', () => {
  const d = fixture('Rare'); d.challenges.Crafting.Loop = { Items: ['Polished gem'], Output: 'Gem', Primary: true };
  const result = createTaskEngine(d).evaluate(state({ 'Multi Step Processing': true }), 'm');
  assert.equal(use(result).unknownDropKills, 384);
  const rows = [{ id: 'loop', category: 'Crafting', rawLabel: 'Loop', record: { Items: ['Gem'] } }];
  const items = [{ name: 'Gem', sources: [{ kind: 'task', taskId: 'loop' }, { kind: 'drop', rawRate: 'Rare', probability: null }] }];
  const context = unknownDropContext({ tasks: rows, items });
  assert.equal(context.item('Gem'), 128);
  items[0].sources.push({ kind: 'spawn' });
  assert.equal(unknownDropContext({ tasks: rows, items }).item('Gem'), 0);
});
test('item aliases, counted alternatives and required ingredients keep their own reliance', () => {
  const d = fixture('Rare'); d.chunks[100].Spawn = { Other: 1 };
  d.codeItems = { itemsPlus: { 'Choice[+]': ['Gem', 'Other'] } };
  d.challenges.Crafting.Use.Items = ['Choice[+]'];
  let result = createTaskEngine(d).evaluate(state({}), 'm'); assert.equal(use(result).unknownDropWarning, undefined);
  d.challenges.Crafting.Use.Items = ['Choice[+]x2'];
  result = createTaskEngine(d).evaluate(state({}), 'm'); assert.equal(use(result).unknownDropKills, 384);
  d.challenges.Crafting.Use.Items = ['Gem', 'Other'];
  result = createTaskEngine(d).evaluate(state({}), 'm'); assert.equal(use(result).unknownDropKills, 384);
});
test('equipment warnings use all item routes and preserve goal IDs', () => {
  const d = fixture('Very rare'); d.equipment = { Gem: { slot: 'head', class: 'melee', tier: 1, armour: 10 } };
  const doc = state({}), result = createTaskEngine(d).evaluate(doc, 'm');
  const gear = evaluateEquipment(result, doc, 'm', d);
  assert.ok(gear.catalogue.length); assert.ok(gear.catalogue.every(row => row.unknownDropKills === 3000));
});
test('setting is adjacent, independent, validated, personal and automatic by default', () => {
  const definition = taskRuleDefinitions.find(row => row.id === UNKNOWN_DROP_RULE);
  assert.equal(definition.default, 3); assert.equal(taskRuleDefault(UNKNOWN_DROP_RULE), 3);
  const doc = createGroupState([{ id: 'm', name: 'Player', unlocked: ['100'] }]);
  assert.equal(taskRuleValue(doc, 'm', definition).value, 3);
  const rows = buildRulesSections(rulesCatalogue, doc).flatMap(section => section.rules);
  const rare = rows.findIndex(row => row.id === 'Rare Drop');
  assert.ok(rows.findIndex(row => row.id === UNKNOWN_DROP_RULE) > rare);
  assert.equal(rows.find(row => row.id === UNKNOWN_DROP_RULE).parent, 'Rare Drop Amount');
  assert.equal(ruleEnabled(definition, { 'Rare Drop': false }, taskRuleDefinitions), true);
  for (const value of [0, -1, 1.5, 'banana', true, Infinity]) assert.ok(taskRuleValueError(UNKNOWN_DROP_RULE, value));
  for (const value of [1, 3, '4']) assert.equal(taskRuleValueError(UNKNOWN_DROP_RULE, value), null);
  const saved = applyCommand(doc, { type: 'set-task-rule', memberId: 'm', ruleId: UNKNOWN_DROP_RULE, value: 4 });
  assert.equal(taskRuleValue(saved, 'm', definition).value, 4);
  assert.equal(createTaskEngine(fixture('Rare')).evaluate(saved, 'm').tasks.find(row => row.rawLabel === 'Use').unknownDropKills, 512);
  const fallback = createTaskEngine(fixture('Rare')).evaluate(state({ [UNKNOWN_DROP_RULE]: 'invalid' }), 'm');
  assert.equal(use(fallback).unknownDropKills, 384);
});
test('warning annotation is idempotent and uses the easiest rare route', () => {
  const rows = [{ id: 't', explanation: 'Available.' }], context = { task: () => 128 };
  addUnknownDropWarnings(rows, context); addUnknownDropWarnings(rows, context);
  assert.equal(rows[0].explanation.match(/Drop rate unknown/g).length, 1);
  const d = fixture('Very rare'); d.chunks[100].Monster.Other = true; d.drops.Other = { Gem: { 1: 'Rare' } };
  assert.equal(use(createTaskEngine(d).evaluate(state({}), 'm')).unknownDropKills, 384);
});

test('a numeric route for a downstream product removes only its warning', () => {
  const d = fixture('Rare'); d.chunks[100].Spawn = { 'Polished gem': 1 };
  const result = createTaskEngine(d).evaluate(state({}), 'm');
  assert.equal(use(result).unknownDropKills, 384);
  assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropWarning, undefined);
});
test('unestimated and common alternatives suppress a rare-only warning', () => {
  for (const rate of ['Common', 'Uncommon', 'Random', 'Once']) {
    const d = fixture('Rare'); d.drops.Rat.Gem[2] = rate;
    const result = createTaskEngine(d).evaluate(state({}), 'm');
    assert.equal(use(result).unknownDropWarning, undefined);
  }
});
test('invalid imported setting uses the default and explicit personal setting wins', () => {
  const doc = state({ [UNKNOWN_DROP_RULE]: 4 }); doc.members[0].taskRules = { [UNKNOWN_DROP_RULE]: 2 };
  assert.equal(use(createTaskEngine(fixture('Rare')).evaluate(doc, 'm')).unknownDropKills, 256);
  for (const raw of ['0x10', ' ', true, 0, -1, 1.5]) {
    assert.equal(use(createTaskEngine(fixture('Rare')).evaluate(state({ [UNKNOWN_DROP_RULE]: raw }), 'm')).unknownDropKills, 384);
  }
});

test('cached results preserve source restrictions in downstream guidance', () => {
  const d = fixture('Rare'); d.chunks[100].Monster.Other = true; d.drops.Other = { Gem: { 1: '1/2' } };
  d.challenges.Crafting.Use.AllowedSources = ['Rat'];
  d.equipment = { 'Polished gem': { slot: 'head', class: 'melee', tier: 1, armour: 10 } };
  const engine = createTaskEngine(d), doc = state({ [UNKNOWN_DROP_RULE]: 4, 'Wield Crafted Items': true });
  for (let pass = 0; pass < 2; pass++) {
    const result = engine.evaluate(doc, 'm');
    assert.equal(use(result).unknownDropKills, 512);
    const gear = evaluateEquipment(result, doc, 'm', d);
    assert.ok(gear.catalogue.length); assert.ok(gear.catalogue.every(row => row.unknownDropKills === 512));
  }
});

test('task rewards carry their producing task reliance until received', () => {
  const rows = [{ id: 'q', category: 'Quest', rawLabel: 'Q', record: { Items: ['Gem'] } }];
  const items = [{ name: 'Gem', sources: [{ kind: 'drop', rawRate: 'Rare', probability: null }] },
    { name: 'Medal', sources: [{ kind: 'reward', taskId: 'q' }] }];
  assert.equal(unknownDropContext({ tasks: rows, items }).item('Medal'), 128);
  rows[0].personalCompleted = true;
  assert.equal(unknownDropContext({ tasks: rows, items }).item('Medal'), 0);
});
test('equipment with Wield Crafted Items off ignores recipe alternatives', () => {
  const rows = [{ id: 'craft', category: 'Crafting', rawLabel: 'Craft', record: {} }];
  const items = [{ name: 'Ring', sources: [{ kind: 'task', taskId: 'craft', category: 'Crafting' }, { kind: 'drop', rawRate: 'Very rare', probability: null }] }];
  const context = unknownDropContext({ tasks: rows, items });
  assert.equal(context.item('Ring'), 0); assert.equal(context.wield('Ring'), 1000);
  const off = addUnknownDropWarnings([{ equipmentName: 'Ring' }], context, { 'Wield Crafted Items': false });
  assert.equal(off[0].unknownDropKills, 3000);
  const on = addUnknownDropWarnings([{ equipmentName: 'Ring' }], context, { 'Wield Crafted Items': true });
  assert.equal(on[0].unknownDropWarning, undefined);
  assert.equal(addUnknownDropWarnings([{ item: 'Ring' }], context, {})[0].unknownDropWarning, undefined);
});
test('counted task prerequisite aliases keep their required count', () => {
  const rows = [{ id: 'a', category: 'Crafting', rawLabel: 'A', status: 'available', record: {} },
    { id: 'b', category: 'Crafting', rawLabel: 'B', status: 'available', record: { Items: ['Gem'] } },
    { id: 't', category: 'Crafting', rawLabel: 'T', record: { Tasks: { 'Any[+]x2': 'Crafting' } } },
    { id: 'u', category: 'Crafting', rawLabel: 'U', record: { Tasks: { 'Any[+]': 'Crafting' } } }];
  const items = [{ name: 'Gem', sources: [{ kind: 'drop', rawRate: 'Rare', probability: null }] }];
  const context = unknownDropContext({ tasks: rows, items }, { codeItems: { tasksPlus: { 'Any[+]': ['A', 'B'] } } });
  assert.equal(context.task('t'), 128); assert.equal(context.task('u'), 0);
});

test('completed prerequisites need no new drop but additional recipe supplies do', () => {
  const d = fixture('Rare'); d.challenges.Crafting.Finish = { Tasks: { Use: 'Crafting' } };
  const engine = createTaskEngine(d), doc = state({});
  doc.members[0].completedTasks = [engine.catalogue.find(row => row.rawLabel === 'Use').id];
  const result = engine.evaluate(doc, 'm');
  assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropWarning, undefined);
  assert.equal(unknownDropContext(result, d).item('Polished gem'), 128);
});

test('unavailable task alias alternatives cannot hide a reachable rare prerequisite', () => {
  const d = fixture('Rare');
  d.chunks[200] = {};
  d.codeItems = { tasksPlus: { 'Routes[+]': ['Costly', 'Free'] } };
  d.challenges.Crafting.Costly = { Items: ['Gem'] };
  d.challenges.Crafting.Free = { Chunks: ['200'] };
  d.challenges.Crafting.Use.Items = [];
  d.challenges.Crafting.Use.Tasks = { 'Routes[+]': 'Crafting' };
  const engine = createTaskEngine(d), doc = state({});
  const result = engine.evaluate(doc, 'm');
  assert.equal(result.tasks.find(row => row.rawLabel === 'Free').status, 'blocked');
  assert.equal(result.tasks.find(row => row.rawLabel === 'Costly').status, 'available');
  assert.equal(use(result).status, 'available');
  assert.equal(use(result).unknownDropKills, 384);
  assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropKills, 384);
  doc.members[0].completedTasks = [engine.catalogue.find(row => row.rawLabel === 'Free').id];
  assert.equal(use(engine.evaluate(doc, 'm')).unknownDropWarning, undefined);
});

test('virtual processing supplies carry rare reliance only to admitted consumers', () => {
  const d = { chunks: { 100: { Monster: { Rat: true } } }, drops: { Rat: { Ore: { 1: 'Rare' } } },
    challenges: { Smithing: {
      Low: { Level: 1, Items: ['Ore'], Output: 'Low bar', Primary: true },
      High: { Level: 10, Items: ['Ore'], Output: 'High bar', Primary: true },
    }, Crafting: {
      Use: { Level: 20, Items: ['High bar'], Output: 'Product', Primary: true },
      Denied: { Level: 5, Items: ['High bar'] },
      Finish: { Level: 20, Items: ['Product'] },
    } } };
  const doc = state({ 'Multi Step Processing': true, 'Highest Level': false });
  doc.members[0].primaryOverrides = { Crafting: true, Smithing: true };
  const engine = createTaskEngine(d);
  for (let pass = 0; pass < 2; pass++) {
    const result = engine.evaluate(doc, 'm');
    assert.equal(result.items.find(row => row.name === 'High bar').sources[0].processingMode, 'multi');
    assert.equal(use(result).status, 'available');
    assert.equal(use(result).unknownDropKills, 384);
    assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropKills, 384);
    const denied = result.tasks.find(row => row.rawLabel === 'Denied');
    assert.equal(denied.status, 'blocked');
    assert.equal(unknownDropContext(result, d).task(denied.id), Infinity);
    assert.equal(unknownDropContext(result, d).item('High bar'), Infinity, 'virtual output is not ordinary item proof');
  }
});

test('annotation-only task self-links do not block rare warnings or their products', () => {
  const d = fixture('Rare');
  d.challenges.Crafting.Use.Tasks = { Use: 'Crafting' };
  const result = createTaskEngine(d).evaluate(state({}), 'm');
  assert.equal(use(result).status, 'available');
  assert.equal(use(result).unknownDropKills, 384);
  assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropKills, 384);
  assert.equal(unknownDropContext(result, d).item('Polished gem'), 128);
});

test('requirement alternatives leave unconditional item and task rare costs intact', () => {
  for (const personal of [false, true]) for (const prerequisite of [false, true]) {
    const d = fixture('Rare');
    d.challenges.Quest = { 'Example completion': { QuestPoints: 1, BaseQuest: 'Example quest' } };
    const record = d.challenges.Crafting.Use;
    if (prerequisite) {
      d.challenges.Crafting.Costly = { Items: record.Items };
      delete record.Items;
      record.Tasks = { Costly: 'Crafting' };
    }
    if (personal) record.PersonalRequirementAlternatives = [{ quest: 'Example quest' }];
    else record.RequirementAlternatives = [{ Skills: { Crafting: 1 } }, { TotalLevelNeeded: 1 }];
    const engine = createTaskEngine(d), doc = state({});
    doc.members[0].completedTasks = [engine.catalogue.find(row => row.rawLabel === 'Example completion').id];
    const result = engine.evaluate(doc, 'm');
    assert.equal(use(result).status, 'available');
    assert.equal(use(result).unknownDropKills, 384);
    assert.equal(result.tasks.find(row => row.rawLabel === 'Finish').unknownDropKills, 384);
  }
});

test('dialogue payments use AND within clauses and OR between reachable clauses', () => {
  const d = fixture('Rare');
  d.chunks[100].NPC = { Supplier: true };
  d.chunks[100].Spawn = { Token: 1 };
  d.drops.Rat.Badge = { 1: 'Very rare' };
  d.challenges.Nonskill = { Purchase: { NPCs: ['Supplier'], Output: 'Purchased gem',
    DialogueSupply: { mode: 'closure-only', paymentAlternatives: [{ Gem: 2, Token: 1 }, { Coins: 10 }] } } };
  d.challenges.Crafting.Use.Items = ['Purchased gem'];
  d.challenges.Crafting.Use.ManualNonProcessing = true;
  const check = kills => {
    const result = createTaskEngine(d).evaluate(state({}), 'm');
    const purchase = result.tasks.find(row => row.rawLabel === 'Purchase');
    assert.equal(purchase.status, 'available');
    for (const row of [purchase, use(result), result.tasks.find(row => row.rawLabel === 'Finish')]) {
      assert.equal(row.status, 'available');
      assert.equal(row.unknownDropKills, kills);
    }
    assert.equal(unknownDropContext(result, d).item('Purchased gem'), kills === undefined ? 0 : kills / 3);
  };
  check(384);
  d.challenges.Nonskill.Purchase.DialogueSupply.paymentAlternatives = [{ Gem: 2, Badge: 1 }, { Coins: 10 }];
  check(3000);
  d.challenges.Nonskill.Purchase.DialogueSupply.paymentAlternatives.push({ Gem: 2 });
  check(384);
  d.chunks[100].Spawn.Coins = 1;
  check(undefined);
});
