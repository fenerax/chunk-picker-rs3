import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';

const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const names = {
  spin: 'Spin flax into ~|bowstring|~', short: 'Fletch a ~|shortbow (unstrung)|~',
  long: 'Fletch a ~|longbow (unstrung)|~', string: 'String a ~|longbow|~',
  soften: 'Create ~|soft clay|~ with a watersource', bowl: 'Craft a ~|bowl (unfired)|~', fire: 'Fire a ~|bowl|~',
};
const fixture = (challenges, spawn = {}, objects = {}, extra = {}) => ({ chunks: { '1': { Spawn: spawn, Object: objects } },
  sections: {}, walkableChunksF2P: ['1'], challenges, codeItems: reference.codeItems, ...extra });
const retained = (category, labels) => Object.fromEntries(labels.map(label => [label, reference.challenges[category][label]]));
const saved = (rules = {}, member = {}) => ({ rules: { 'content.f2p': true }, taskRules: { 'Highest Level': false, 'Multi Step Processing': true, ...rules },
  members: [{ id: 'a', unlocked: ['1'], completedTasks: [], primaryOverrides: { Crafting: true, Fletching: true, Smithing: true }, ...member }] });
const row = (result, category, label) => result.tasks.find(t => t.id === taskId(category, label));
const item = (result, name) => result.items.find(i => i.name === name);
const ordinary = (result, name) => item(result, name)?.sources.some(s => s.processingMode !== 'multi') ?? false;
const bowFixture = () => fixture({ Crafting: retained('Crafting', [names.spin]),
  Fletching: retained('Fletching', [names.short, names.long, names.string]) }, { Logs: 1, Flax: 1 }, { 'Spinning wheel': true });

test('001031 String longbow cannot use Bowstring to promote its own excluded 001030 producer', () => {
  const data = bowFixture(), state = saved(), before = structuredClone(state), result = createTaskEngine(data).evaluate(state, 'a', { ownItemQueries: ['Longbow'] });
  assert.equal(row(result, 'Fletching', names.long).id, 'rs3:task:001030');
  assert.equal(row(result, 'Fletching', names.string).id, 'rs3:task:001031');
  assert.equal(ordinary(result, 'Bowstring'), true);
  for (const label of [names.long, names.string]) assert.equal(row(result, 'Fletching', label).sourceEligible, false);
  for (const name of ['Longbow (unstrung)', 'Longbow']) {
    assert.equal(ordinary(result, name), false);
    assert.ok(item(result, name).sources.every(s => s.processingMode === 'multi' && !s.primary));
  }
  assert.deepEqual(result.ownItemOrigins, [], 'conditional products are not an ordinary owned supply');
  assert.ok(!selectPresentedTasks(result, state, 'a', data).tasks.some(t => t.id === 'rs3:task:001031'));
  assert.deepEqual(state, before);
});

test('independent intermediate, Highest Level and personal completion preserve legitimate longbow supplies', () => {
  for (const route of ['spawn', 'highest', 'completed']) {
    const data = bowFixture(), state = saved();
    if (route === 'spawn') data.chunks['1'].Spawn['Longbow (unstrung)'] = 1;
    if (route === 'highest') state.taskRules['Highest Level'] = true;
    if (route === 'completed') state.members[0].completedTasks = ['rs3:task:001030'];
    const result = createTaskEngine(data).evaluate(state, 'a', { ownItemQueries: ['Longbow'] });
    assert.equal(ordinary(result, 'Longbow'), true, route);
    assert.deepEqual(result.ownItemOrigins, ['Longbow'], route);
  }
});

test('conditional ingredients cannot borrow another skill frontier or an unrelated allowed-source witness', () => {
  const recipe = (Level, Items, Output, extra = {}) => ({ Level, Items, Output, Primary: true, ...extra });
  const data = fixture({ Smithing: { Low: recipe(1, ['Ore'], 'Low'), 'Make high': recipe(50, ['Ore'], 'High') },
    Nonskill: { 'Make thread': { Output: 'Thread' } },
    Crafting: { Frontier: recipe(80, ['Gem'], 'Frontier'), Use: recipe(50, ['High', 'Thread'], 'End', { AllowedSources: ['Make high', 'Make thread'] }) } },
  { Ore: 1, Gem: 1, Thread: 1, High: 1 });
  const state = saved();
  state.rules['content.f2p'] = false;
  const result = createTaskEngine(data).evaluate(state, 'a', { ownItemQueries: ['End'] });
  assert.equal(row(result, 'Crafting', 'Use').status, 'available');
  assert.equal(row(result, 'Crafting', 'Use').sourceEligible, false);
  assert.equal(ordinary(result, 'End'), false);
  assert.deepEqual(result.ownItemOrigins, []);
});

test('counted input alternatives need enough ordinary witnesses before publishing a finished product', () => {
  const data = fixture({ Smithing: { Low: { Level: 1, Items: ['Ore'], Output: 'Low', Primary: true },
    High: { Level: 5, Items: ['Ore'], Output: 'Conditional', Primary: true } },
    Crafting: { Use: { Level: 5, Items: ['Parts[+]x2', 'Thread'], Output: 'End', Primary: true } } },
  { Ore: 1, Ordinary: 1, Thread: 1 }, {}, { codeItems: { itemsPlus: { 'Parts[+]': ['Ordinary', 'Conditional'] } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Crafting', 'Use').status, 'available');
  assert.equal(ordinary(result, 'End'), false);
  data.chunks['1'].Spawn.Conditional = 1;
  assert.equal(ordinary(createTaskEngine(data).evaluate(saved(), 'a'), 'End'), true);
});

test('ordinary source selection uses the same unambiguous case-only aliases as requirement parsing', () => {
  const data = fixture({ Crafting: { Use: { Level: 1, Items: ['parts[+]', 'Thread'], Output: 'End', Primary: true } } },
    { Ordinary: 1, Thread: 1 }, {}, { codeItems: { itemsPlus: { 'Parts[+]': ['Ordinary'] } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Crafting', 'Use').status, 'available');
  assert.equal(ordinary(result, 'End'), true);
});

test('Hide Partial Products hides 000851 unfired bowl only under Multi Step Processing while preserving 000852 firing supplies', () => {
  const data = fixture({ Crafting: retained('Crafting', [names.soften, names.bowl, names.fire]) },
    { Clay: 1 }, { Sink: true, "Potter's wheel": true, 'Pottery oven': true });
  for (const multi of [false, true]) {
    const state = saved({ 'Hide Partial Products': true, 'Multi Step Processing': multi }, multi ? {} : { passiveLevels: { Crafting: 8 } });
    const result = createTaskEngine(data).evaluate(state, 'a');
    assert.equal(row(result, 'Crafting', names.bowl).id, 'rs3:task:000851');
    assert.equal(row(result, 'Crafting', names.fire).id, 'rs3:task:000852');
    assert.equal(ordinary(result, 'Bowl (unfired)'), true);
    assert.equal(ordinary(result, 'Bowl'), true);
    const presented = selectPresentedTasks(result, state, 'a', data).tasks;
    // Hide Partial Products is a Multi Step Processing child; Off leaves the bowl as the next Crafting goal.
    assert.equal(presented.some(t => t.id === 'rs3:task:000851'), !multi);
    assert.equal(presented.some(t => t.id === 'rs3:task:000852'), multi);
  }
});

test('ore to bar to equipment needs each ore and both processing facilities', () => {
  const labels = ['Smelt a ~|bronze bar|~', 'Forge ~|bronze|~'];
  const data = fixture({ Smithing: retained('Smithing', labels) }, { 'Copper ore': 1, 'Tin ore': 1 },
    { Furnace: true, Forge: true, Anvil: true }, { skillItems: reference.skillItems });
  assert.equal(ordinary(createTaskEngine(data).evaluate(saved(), 'a'), 'Bronze dagger'), true);
  for (const missing of ['Tin ore', 'Furnace', 'Anvil']) {
    const changed = structuredClone(data);
    delete changed.chunks['1'].Spawn[missing]; delete changed.chunks['1'].Object[missing];
    const result = createTaskEngine(changed).evaluate(saved(), 'a');
    assert.equal(ordinary(result, 'Bronze dagger'), false, missing);
    if (missing === 'Anvil') assert.equal(ordinary(result, 'Bronze bar'), true);
  }
});

test('hide to leather to armour requires the hide and a reachable tanner', () => {
  const data = fixture({ Nonskill: retained('Nonskill', ['Tan leather*']),
    Crafting: retained('Crafting', ['Craft a piece of ~|soft leather armour|~']) }, { Cowhide: 1 }, {},
  { skillItems: reference.skillItems });
  data.chunks['1'].NPC = { Ellis: true };
  assert.equal(ordinary(createTaskEngine(data).evaluate(saved(), 'a'), 'Leather body'), true);
  delete data.chunks['1'].NPC.Ellis;
  assert.equal(ordinary(createTaskEngine(data).evaluate(saved(), 'a'), 'Leather body'), false);
});

test('clay to soft clay to pottery needs water, a wheel and an oven in order', () => {
  const labels = [names.soften, 'Craft a ~|pot (unfired)|~', 'Fire an ~|empty pot|~'];
  const data = fixture({ Crafting: retained('Crafting', labels) }, { Clay: 1 },
    { Sink: true, "Potter's wheel": true, 'Pottery oven': true });
  assert.equal(ordinary(createTaskEngine(data).evaluate(saved(), 'a'), 'Empty pot'), true);
  for (const missing of ['Sink', "Potter's wheel", 'Pottery oven']) {
    const changed = structuredClone(data); delete changed.chunks['1'].Object[missing];
    const result = createTaskEngine(changed).evaluate(saved(), 'a');
    assert.equal(ordinary(result, 'Empty pot'), false, missing);
    if (missing === 'Pottery oven') assert.equal(ordinary(result, 'Pot (unfired)'), true);
  }
});
