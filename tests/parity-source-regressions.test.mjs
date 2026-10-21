import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

// Pure evaluations of isolated definitions: no save store or server is opened.
const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const member = (overrides = {}) => ({ id: 'a', unlocked: ['1'], completedTasks: [], ...overrides });
const state = (overrides = {}) => ({ rules: { 'content.f2p': true }, members: [member(overrides)] });
const definitions = (challenges, extras = {}) => ({ chunks: { '1': {} }, challenges, codeItems: {}, sections: {}, walkableChunksF2P: ['1'], ...extras });
const row = (result, category, label) => result.tasks.find(task => task.id === taskId(category, label));

test('Slayer output channel accepts shop gauntlets while explicit prerequisite source constraints remain enforced', () => {
  const label = 'Slay a ~|gelatinous abomination|~';
  const recipe = reference.challenges.Slayer[label];
  const engine = createTaskEngine(definitions({ Slayer: {
    [label]: recipe,
    NonShop: { ...recipe, NonShop: true },
    WrongShop: { ...recipe, AllowedSources: ['Other equipment shop'] },
    CorrectShop: { ...recipe, AllowedSources: ['Slayer Equipment'] },
    InputChannel: { Items: ['Spiked gauntlets'], Source: 'drop' },
  } }, { chunks: { '1': { Shop: { 'Slayer Equipment': true }, Monster: { 'Gelatinous abomination': true } } },
    shopItems: { 'Slayer Equipment': { 'Spiked gauntlets': true } } }));
  const result = engine.evaluate(state({ taskRules: { 'Wield Crafted Items': false } }), 'a');
  assert.equal(row(result, 'Slayer', label).status, 'available');
  assert.equal(row(result, 'Slayer', label).obligation, true);
  assert.equal(row(result, 'Slayer', 'CorrectShop').status, 'available');
  for (const name of ['NonShop', 'WrongShop', 'InputChannel']) assert.equal(row(result, 'Slayer', name).status, 'blocked', name);
  assert.ok(result.items.find(item => item.name === recipe.Output).sources.some(source => source.sourceKind === 'drop'));
});

test('all six Prayer incense and urn recipes accept own crafted inputs with crafted wielding disabled', () => {
  const labels = ['Craft ~|impious incense sticks|~', 'Craft ~|impious oak incense sticks|~',
    'Craft ~|impious willow incense sticks|~', 'Craft ~|accursed maple incense sticks|~',
    'Complete an ~|impious urn|~', 'Complete an ~|accursed urn|~'];
  const prayer = Object.fromEntries(labels.map(label => [label, reference.challenges.Prayer[label]]));
  const inputs = labels.map(label => prayer[label].Items[0].replace(/\*/g, ''));
  const crafting = Object.fromEntries(inputs.map((item, index) => [`Producer ${index}`, { Output: item, Primary: true, Level: 1 }]));
  const engine = createTaskEngine(definitions({ Prayer: prayer, Crafting: crafting }, {
    chunks: { '1': { Spawn: { 'Impious ashes': 1, 'Accursed ashes': 1, 'Air rune': 1 } } },
  }));
  const result = engine.evaluate(state({ primaryOverrides: { Crafting: true, Firemaking: true },
    taskRules: { 'Wield Crafted Items': false, 'Primary Spawns': false } }), 'a');
  for (const label of labels) {
    assert.equal(row(result, 'Prayer', label).status, 'available', label);
    assert.equal(row(result, 'Prayer', label).obligation, true, label);
  }
  // Accepting a consumable does not turn a starred secondary input into a
  // primary training source. Urn activation remains a secondary method.
  assert.equal(row(result, 'Prayer', labels[4]).primaryMethod, false);
  assert.equal(row(result, 'Prayer', labels[5]).primaryMethod, false);
});

test('Prayer recipe fix preserves crafted combat equipment and training restrictions', () => {
  const engine = createTaskEngine(definitions({ Crafting: { Produce: { Output: 'Synthetic weapon' } },
    Prayer: { Train: { Items: ['Synthetic weapon'], Primary: true }, WithOutput: { Items: ['Synthetic weapon'], Primary: true, Output: 'Synthetic prayer loot' } },
    Attack: { Wield: { Items: ['Synthetic weapon'], Primary: true, Output: 'Synthetic combat loot' } },
    Summoning: { Train: { Items: ['Synthetic weapon'], Primary: true } },
  }, { equipment: { 'Synthetic weapon': { slot: 'main hand weapon', tier: 1, requirements: {} } } }));
  const blocked = engine.evaluate(state({ taskRules: { 'Wield Crafted Items': false } }), 'a');
  for (const [category, label] of [['Prayer', 'Train'], ['Attack', 'Wield'], ['Summoning', 'Train']]) {
    assert.equal(row(blocked, category, label).status, 'blocked');
    assert.equal(blocked.training[category].primary, false);
  }
  assert.equal(blocked.equipment.length, 0);
  assert.equal(row(blocked, 'Prayer', 'WithOutput').status, 'blocked');
  assert.equal(blocked.items.some(item => item.name === 'Synthetic prayer loot' || item.name === 'Synthetic combat loot'), false);
  const allowed = engine.evaluate(state({ taskRules: { 'Wield Crafted Items': true } }), 'a');
  for (const [category, label] of [['Prayer', 'Train'], ['Attack', 'Wield'], ['Summoning', 'Train']]) assert.equal(row(allowed, category, label).status, 'available');
});

test('InsidePOH hard gate and InsidePOH Primary training control are independent and retain level-one starters', () => {
  const clay = 'Construct a ~|clay fireplace|~', rug = 'Construct a ~|shabby blue rug|~';
  const starter = { Category: ['InsidePOH Primary'], Primary: true, Level: 1 };
  const engine = createTaskEngine(definitions({ Construction: {
    Starter: starter, [clay]: reference.challenges.Construction[clay], [rug]: reference.challenges.Construction[rug],
    Higher: { Level: 10 },
  } }, { chunks: { '1': { Object: { 'Furniture workbench': true }, Spawn: { 'Soft clay': 1, 'Bolt of cloth': 1 } } } }));
  for (const primary of [false, true]) {
    const result = engine.evaluate(state({ passiveLevels: { Construction: 3 },
      taskRules: { InsidePOH: false, 'InsidePOH Primary': primary } }), 'a');
    assert.equal(row(result, 'Construction', 'Starter').status, 'available');
    for (const label of [clay, rug]) {
      assert.equal(row(result, 'Construction', label).status, 'blocked');
      assert.ok(row(result, 'Construction', label).blockers.some(blocker => blocker.kind === 'rule' && blocker.detail.includes('InsidePOH')));
    }
  }
  const recipeOnly = engine.evaluate(state({ passiveLevels: { Construction: 3 }, taskRules: { InsidePOH: true, 'InsidePOH Primary': false } }), 'a');
  assert.equal(row(recipeOnly, 'Construction', clay).status, 'available');
  assert.equal(row(recipeOnly, 'Construction', rug).status, 'available');
  assert.equal(recipeOnly.training.Construction.primary, false);
  assert.equal(row(recipeOnly, 'Construction', 'Higher').status, 'blocked');
  const training = engine.evaluate(state({ taskRules: { InsidePOH: true, 'InsidePOH Primary': true } }), 'a');
  assert.equal(training.training.Construction.primary, true);
  assert.equal(row(training, 'Construction', 'Higher').status, 'available');
});

test('dreadfowl is a free level-four trial recipe while secondary charm supplies do not seed training', () => {
  // The pinned cache marks item 12043 free; Summoning training on the wiki
  // explicitly includes dreadfowl in the F2P level-five trial.
  const label = 'Create a ~|dreadfowl pouch|~';
  const engine = createTaskEngine(definitions({ Summoning: {
    [label]: reference.challenges.Summoning[label], AboveTrial: { Level: 6 },
  } }, { chunks: { '1': { Object: { Obelisk: true }, Spawn: { 'Gold charm': 1, 'Raw chicken': 1 }, Shop: { Supplies: true } } },
    shopItems: { Supplies: { Pouch: true, 'Spirit shards': true } } }));
  const result = engine.evaluate(state({ passiveLevels: { Summoning: 4 },
    taskRules: { 'Primary Spawns': false, 'Wield Crafted Items': false } }), 'a');
  assert.equal(row(result, 'Summoning', label).status, 'available');
  assert.equal(row(result, 'Summoning', label).obligation, true);
  assert.equal(row(result, 'Summoning', label).primaryMethod, false);
  assert.equal(result.training.Summoning.primary, false);
  assert.equal(result.training.Summoning.level, 4);
  assert.ok(row(result, 'Summoning', 'AboveTrial').blockers.some(blocker => blocker.kind === 'membership'));
});

test('declared diamond recipe closure strings and enchants reachable free jewellery with explicit training access', () => {
  const producer = 'Craft a ~|diamond amulet (unstrung)|~', string = 'String a ~|diamond amulet|~';
  const enchant = 'Cast ~|Lvl-4 Enchant|~ on a diamond amulet';
  const engine = createTaskEngine(definitions({
    Crafting: { [producer]: reference.challenges.Crafting[producer], [string]: reference.challenges.Crafting[string] },
    Magic: { [enchant]: reference.challenges.Magic[enchant] },
  }, { chunks: { '1': { Object: { Furnace: true }, Spawn: {
    Diamond: 1, 'Gold bar': 1, 'Ball of wool': 1, 'Cosmic rune': 1, 'Earth rune': 1,
  } } }, codeItems: { objectsPlus: { 'CraftingFurnace[+]': ['Furnace'] }, itemsPlus: { 'Earth rune[+]': ['Earth rune'] } },
    equipment: { 'Amulet of power': reference.equipment['Amulet of power'] } }), { equipmentCorrections: true });
  const result = engine.evaluate(state({ primaryOverrides: { Crafting: true, Magic: true },
    taskRules: { 'Wield Crafted Items': false, 'Multi Step Processing': false, 'Highest Level': false, Spells: true } }), 'a');
  for (const [category, label] of [['Crafting', producer], ['Crafting', string], ['Magic', enchant]]) {
    assert.equal(row(result, category, label).status, 'available');
    assert.equal(row(result, category, label).obligation, true);
  }
  for (const [name, category, label] of [['Diamond amulet (unstrung)', 'Crafting', producer],
    ['Diamond amulet', 'Crafting', string], ['Amulet of power', 'Magic', enchant]]) {
    const sources = result.items.find(item => item.name === name).sources;
    assert.equal(sources.length, 1);
    assert.equal(sources[0].taskId, taskId(category, label));
    assert.equal(sources[0].own, true);
  }
  // Production does not grant permission to wield the crafted final amulet.
  assert.equal(result.equipment.some(item => item.name === 'Amulet of power'), false);
});
