import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { buildAccessIndex, calculateAccess, collectBaseItemSources, baseItemSourceView, copyAccess } from '../app/tasks/access.mjs';
import { SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guide-rules.mjs';
import { datasetCapabilities } from '../app/datasets.mjs';

const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const fixture = (challenges, spawn = {}, extra = {}) => ({ chunks: { '1': { Spawn: spawn } }, sections: {},
  walkableChunksF2P: ['1'], challenges, codeItems: {}, ...extra });
const saved = (rules = {}, member = {}) => ({ rules: { 'content.f2p': false }, taskRules: { 'Highest Level': false, 'Multi Step Processing': false, ...rules },
  members: [{ id: 'a', unlocked: ['1'], completedTasks: [], primaryOverrides: { Crafting: true, Magic: true, Smithing: true, Cooking: true, Fletching: true }, ...member }] });
const row = (result, category, name) => result.tasks.find(task => task.id === taskId(category, name));
const output = (result, name) => result.items.find(item => item.name === name);
const recipe = (level, inputs, outputName, extra = {}) => ({ Level: level, Items: inputs, Output: outputName, Primary: true, ...extra });
const producer = 'Craft a ~|diamond amulet (unstrung)|~', string = 'String a ~|diamond amulet|~', enchant = 'Cast ~|Lvl-4 Enchant|~ on a diamond amulet';
function diamond(spawn = {}) {
  return fixture({ Crafting: {
    'Craft a ~|diamond ring|~': reference.challenges.Crafting['Craft a ~|diamond ring|~'],
    'Craft a ~|diamond necklace|~': reference.challenges.Crafting['Craft a ~|diamond necklace|~'],
    [producer]: reference.challenges.Crafting[producer], [string]: reference.challenges.Crafting[string],
    'Independent frontier': recipe(57, ['Separate material'], 'Separate product', { Primary: false }),
  }, Magic: { [enchant]: reference.challenges.Magic[enchant] } }, {
    Diamond: 1, 'Gold bar': 1, 'Ball of wool': 1, 'Cosmic rune': 1, 'Earth rune': 1, 'Separate material': 1, ...spawn,
  }, { chunks: { '1': { Object: { Furnace: true }, Spawn: {
    Diamond: 1, 'Gold bar': 1, 'Ball of wool': 1, 'Cosmic rune': 1, 'Earth rune': 1, 'Separate material': 1, ...spawn,
  } } }, codeItems: { objectsPlus: { 'CraftingFurnace[+]': ['Furnace'] }, itemsPlus: { 'Earth rune[+]': ['Earth rune'] } } });
}

test('diamond String 0009a4 and Enchant 0015ae cannot borrow excluded unstrung producer 0009a3', () => {
  const data = diamond(), state = saved(), before = structuredClone(state), engine = createTaskEngine(data), result = engine.evaluate(state, 'a', { ownItemQueries: ['Diamond amulet (unstrung)'] });
  const unstrung = row(result, 'Crafting', producer);
  assert.equal(unstrung.id, 'rs3:task:0009a3');
  assert.equal(unstrung.status, 'available');
  assert.equal(unstrung.sourceEligible, false);
  assert.equal(output(result, 'Diamond necklace')?.sources.length, 1, 'level 56 is below independent level 57 frontier');
  assert.equal(output(result, 'Diamond amulet (unstrung)'), undefined);
  assert.deepEqual(result.ownItemOrigins, []);
  for (const [category, name, id] of [['Crafting', string, 'rs3:task:0009a4'], ['Magic', enchant, 'rs3:task:0015ae']]) {
    const task = row(result, category, name);
    assert.equal(task.id, id); assert.equal(task.status, 'blocked');
    assert.ok(task.blockers.some(blocker => blocker.kind === 'items'));
    assert.ok(!selectPresentedTasks(result, state, 'a', data).tasks.some(task => task.id === id));
  }
  assert.equal(output(result, 'Amulet of power'), undefined);
  assert.deepEqual(state, before);
  assert.ok(result.metrics.processingPasses < 8);
});

test('an independently supplied unstrung diamond amulet preserves legitimate String and Enchant chain', () => {
  const data = diamond({ 'Diamond amulet (unstrung)': 1 }), state = saved(), result = createTaskEngine(data).evaluate(state, 'a');
  assert.equal(row(result, 'Crafting', string).status, 'available');
  assert.equal(row(result, 'Magic', enchant).status, 'available');
  assert.ok(output(result, 'Amulet of power').sources.some(source => source.taskId === 'rs3:task:0015ae' && source.own));
  assert.ok(output(result, 'Diamond amulet (unstrung)').sources.some(source => source.kind === 'spawn'));
});

test('Highest Level admits the real declared diamond producer and its downstream outputs', () => {
  const result = createTaskEngine(diamond()).evaluate(saved({ 'Highest Level': true }), 'a');
  for (const [category, name] of [['Crafting', producer], ['Crafting', string], ['Magic', enchant]]) {
    assert.equal(row(result, category, name).status, 'available');
    assert.notEqual(row(result, category, name).sourceEligible, false);
  }
  assert.ok(output(result, 'Amulet of power'));
});

test('input winner union preserves a higher Ore recipe with an independent unopposed Gem input', () => {
  const data = fixture({ Smithing: { Low: recipe(10, ['Ore', 'Fuel'], 'Low bar'), High: recipe(50, ['Ore', 'Gem'], 'High bar') } }, { Ore: 1, Fuel: 1, Gem: 1 });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.notEqual(row(result, 'Smithing', 'High').sourceEligible, false);
  assert.ok(output(result, 'High bar'));
});

test('excluded producer supplies cannot seed primary training, equipment, exact task access or XP', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low material'), High: recipe(50, ['Ore'], 'Weapon', { XpReward: { Fletching: 10000 } }) },
    Fletching: { Train: recipe(1, ['Weapon*'], 'Further output'), Higher: { Level: 2 } },
    Nonskill: { Cave: { UnlocksArea: true, Tasks: { High: 'Crafting' } } },
  }, { Ore: 1 }, { equipment: { Weapon: { slot: 'body', requirements: {} } } });
  const state = saved({ 'Wield Crafted Items': true }, { primaryOverrides: { Crafting: true } });
  const result = createTaskEngine(data).evaluate(state, 'a');
  assert.equal(row(result, 'Crafting', 'High').status, 'available');
  assert.equal(row(result, 'Crafting', 'High').sourceEligible, false);
  assert.equal(result.training.Fletching.primary, false);
  assert.equal(result.training.Fletching.passiveLevel, 1);
  assert.equal(row(result, 'Fletching', 'Train').status, 'blocked');
  assert.equal(result.equipment.length, 0);
  assert.equal(row(result, 'Nonskill', 'Cave').status, 'blocked');
  assert.ok(!result.access.areas.includes('Cave'));
});

test('personal completion admits a producer without treating a challenge check as supplies', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], 'High') }, Magic: { Use: recipe(1, ['High', 'Rune'], 'End') } }, { Ore: 1, Rune: 1 });
  const high = taskId('Crafting', 'High');
  const checked = createTaskEngine(data).evaluate(saved({}, { taskStatus: { [high]: { challengeCompleted: true } } }), 'a');
  assert.equal(output(checked, 'High'), undefined);
  const completed = createTaskEngine(data).evaluate(saved({}, { completedTasks: [high] }), 'a');
  assert.notEqual(row(completed, 'Crafting', 'High').sourceEligible, false);
  assert.ok(output(completed, 'High'));
  assert.equal(row(completed, 'Magic', 'Use').status, 'available');
});

test('Multi Step Processing distinguishes virtual losing output from ordinary Highest Level output', () => {
  const data = fixture({ Smithing: { Low: recipe(10, ['Ore'], 'Low'), High: recipe(70, ['Ore'], 'High') },
    Crafting: { Use: recipe(5, ['High', 'Fuel'], 'End') } }, { Ore: 1, Fuel: 1 });
  const engine = createTaskEngine(data);
  const multi = engine.evaluate(saved({ 'Multi Step Processing': true }), 'a');
  assert.equal(row(multi, 'Smithing', 'High').sourceEligible, false);
  assert.equal(output(multi, 'High').sources[0].processingMode, 'multi');
  assert.equal(row(multi, 'Crafting', 'Use').status, 'blocked', 'virtual source producer level 70 cannot prove consumer level 5');
  const ordinary = engine.evaluate(saved({ 'Multi Step Processing': true, 'Highest Level': true }), 'a');
  assert.equal(output(ordinary, 'High').sources[0].processingMode, undefined);
  assert.equal(row(ordinary, 'Crafting', 'Use').status, 'available');
  const independent = structuredClone(data); independent.chunks['1'].Spawn.High = 1;
  assert.equal(row(createTaskEngine(independent).evaluate(saved({ 'Multi Step Processing': true }), 'a'), 'Crafting', 'Use').status, 'available');
});

test('tools and Magic rune tools do not independently retain a competing recipe', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore', 'Tool'], 'High') },
    Magic: { Low: recipe(1, ['Rune'], 'Low spell'), High: recipe(50, ['Rune', 'Staff'], 'High spell') } },
  { Ore: 1, Tool: 1, Rune: 1, Staff: 1 }, { codeItems: { tools: { Tool: true }, magicTools: { Staff: true } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(output(result, 'High'), undefined);
  assert.equal(output(result, 'High spell'), undefined);
});

test('ManualNonProcessing and NoXp independent supply exceptions retain their stage meanings', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'), Manual: recipe(50, ['Ore'], 'Manual', { ManualNonProcessing: true }),
    NoXp: recipe(1, ['Fuel'], 'Independent', { NoXp: true }), AllowMulti: recipe(1, ['Other'], 'Allowed', { AllowMulti: true }) } },
  { Ore: 1, Fuel: 1, Independent: 1, Other: 1 });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.ok(output(result, 'Manual'));
  assert.equal(row(result, 'Crafting', 'NoXp').sourceEligible, false);
  assert.ok(output(result, 'Independent').sources.every(source => source.kind === 'spawn'));
  assert.ok(output(result, 'Allowed'));
});

test('Not Processing does not inherit a same-skill frontier through processing-only input', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'), Independent: recipe(10, ['Fuel'], 'Root'),
    NotProcess: recipe(2, ['Low'], 'Leak', { 'Not Processing': true }) } }, { Ore: 1, Fuel: 1 });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Crafting', 'NotProcess').status, 'available');
  assert.equal(row(result, 'Crafting', 'NotProcess').sourceEligible, false);
  assert.equal(output(result, 'Leak'), undefined);
});

test('a redundant NoXp route cannot raise the source frontier before being discarded', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(30, ['Ore'], 'Leak'),
    NoXpRoot: recipe(50, ['Gem'], 'Independent', { NoXp: true }) } }, { Ore: 1, Gem: 1, Independent: 1 });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Crafting', 'NoXpRoot').sourceEligible, false);
  assert.equal(row(result, 'Crafting', 'High').sourceEligible, false);
  assert.equal(output(result, 'Leak'), undefined);
});

test('virtual multistep outputs cannot bootstrap boost eligibility or presentation ranking', () => {
  const data = fixture({ Smithing: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], 'Synthboost') },
    Crafting: { Target: recipe(30, ['Fuel'], 'Leak', { Primary: false }) } }, { Ore: 1, Fuel: 1 },
  { codeItems: { boostItems: { Crafting: { Synthboost: 20 } } } });
  const state = saved({ 'Multi Step Processing': true, Boosting: true }, { primaryOverrides: { Smithing: true }, passiveLevels: { Crafting: 10 } });
  const result = createTaskEngine(data).evaluate(state, 'a');
  assert.equal(output(result, 'Synthboost').sources[0].processingMode, 'multi');
  assert.equal(row(result, 'Crafting', 'Target').status, 'blocked');
  assert.equal(output(result, 'Leak'), undefined);
  assert.equal(selectPresentedTasks(result, state, 'a', data).effectiveLevels[taskId('Crafting', 'Target')], 30);
});

test('virtual multistep ammunition and bones cannot seed innate ranged or prayer training', () => {
  const data = fixture({ Smithing: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], ['Synthetic ammo', 'Synthetic bones']) } },
  { Ore: 1, Bow: 1 }, { chunks: { '1': { Spawn: { Ore: 1, Bow: 1 }, Monster: { Rat: true } } },
    codeItems: { ammoTools: { 'Synthetic ammo': { Bow: 1 } }, rangedItems: { Bow: 1 }, boneItems: ['Synthetic bones'] } });
  const result = createTaskEngine(data).evaluate(saved({ 'Multi Step Processing': true }, { primaryOverrides: { Smithing: true } }), 'a');
  for (const name of ['Synthetic ammo', 'Synthetic bones']) assert.equal(output(result, name).sources[0].processingMode, 'multi');
  assert.equal(result.training.Ranged.primary, false);
  assert.equal(result.training.Prayer.primary, false);
});

test('a skill guide unlock milestone remains a goal without acting as a processing method or frontier', () => {
  const data = fixture({ Cooking: { Low: recipe(1, ['Fish'], 'Low food'), High: recipe(50, ['Fish'], 'High food'),
    Milestone: { Level: 74, Items: ['Fish'], Primary: false, Category: ['Skill guide unlock'] } } }, { Fish: 1 });
  const state = saved(), result = createTaskEngine(data).evaluate(state, 'a');
  assert.ok(selectPresentedTasks(result, state, 'a', data).tasks.some(task => task.rawLabel === 'Milestone'));
  assert.equal(output(result, 'High food'), undefined);
});

test('NoXp suppression also gates exempt producers and ignores virtual alternative sources', () => {
  const data = fixture({ Smithing: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], 'Dup') },
    Crafting: { OrdinaryNoXp: recipe(1, ['Fuel'], 'Dup', { NoXp: true }), ExemptNoXp: { Level: 1, Output: 'Independent', NoXp: true },
      UniqueExemptNoXp: { Level: 1, Output: 'Unique', NoXp: true } } }, { Ore: 1, Fuel: 1, Independent: 1 });
  const result = createTaskEngine(data).evaluate(saved({ 'Multi Step Processing': true }), 'a');
  assert.ok(output(result, 'Dup').sources.some(source => source.taskId === taskId('Crafting', 'OrdinaryNoXp') && source.processingMode !== 'multi'));
  assert.equal(row(result, 'Crafting', 'ExemptNoXp').sourceEligible, false);
  assert.ok(output(result, 'Independent').sources.every(source => source.kind === 'spawn'));
  assert.ok(output(result, 'Unique').sources.some(source => source.taskId === taskId('Crafting', 'UniqueExemptNoXp')));
});

test('frontier promotion requires literal selected task prerequisites while input winners may resolve aliases', () => {
  const data = fixture({ Crafting: { Low: recipe(1, ['Ore'], 'Low'),
    AliasHigh: recipe(10, ['Ore'], 'Alias output', { Tasks: { 'Methods[+]': 'Magic' } }),
    LiteralHigh: recipe(10, ['Ore'], 'Literal output', { Tasks: { Route: 'Magic' } }),
    AliasWinner: recipe(10, ['Unique'], 'Winner output', { Tasks: { 'Methods[+]': 'Magic' } }),
    Independent: recipe(20, ['Fuel'], 'Frontier') }, Magic: { Route: { Level: 1, Primary: true } } },
  { Ore: 1, Unique: 1, Fuel: 1 }, { codeItems: { tasksPlus: { 'Methods[+]': ['Route'] } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Crafting', 'AliasHigh').status, 'available');
  assert.equal(row(result, 'Crafting', 'AliasHigh').sourceEligible, false);
  assert.equal(output(result, 'Alias output'), undefined);
  assert.ok(output(result, 'Literal output'));
  assert.ok(output(result, 'Winner output'));
});

test('a raw personal level raises the effective frontier without bypassing the exact promotion prerequisite', () => {
  const data = fixture({ Magic: { Low: recipe(55, ['Rune'], 'Low spell', { Primary: true }),
    AliasSpell: recipe(59, ['Rune'], 'Alias spell', { Tasks: { 'Weapons[+]': 'Magic' } }),
    LiteralSpell: recipe(59, ['Rune'], 'Literal spell', { Tasks: { Weapon: 'Magic' } }),
    Weapon: { Level: 1, Primary: false } } }, { Rune: 1, Boost: 1 },
  { codeItems: { boostItems: { Magic: { Boost: 5 } }, tasksPlus: { 'Weapons[+]': ['Weapon'] } } });
  const result = createTaskEngine(data).evaluate(saved({ Boosting: true }, { passiveLevels: { Magic: 55 } }), 'a');
  assert.equal(row(result, 'Magic', 'AliasSpell').status, 'available');
  assert.equal(output(result, 'Alias spell'), undefined);
  assert.ok(output(result, 'Literal spell'), 'effective level54 is under raw personal frontier55');
});

test('a possible producer behind an unmet output gate does not prove queried own inventory', () => {
  const data = fixture({ Crafting: { Produce: recipe(1, ['Ore'], 'Product') }, Quest: { Gate: { Chunks: ['2'] } } },
    { Ore: 1 }, { taskUnlocks: { Items: { Product: [{ Gate: 'Quest' }] } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a', { ownItemQueries: ['Product'] });
  assert.equal(row(result, 'Crafting', 'Produce').status, 'available');
  assert.equal(output(result, 'Product'), undefined);
  assert.deepEqual(result.ownItemOrigins, []);
  const independentlySupplied = structuredClone(data);
  // Restrict the producer route specifically; an unqualified item gate also
  // correctly restricts spawns and shops in collectBaseItemSources.
  independentlySupplied.taskUnlocks.Items = { 'Product^Produce': [{ Gate: 'Quest' }] };
  independentlySupplied.chunks['1'].Spawn.Product = 1;
  const supplied = createTaskEngine(independentlySupplied).evaluate(saved(), 'a', { ownItemQueries: ['Product'] });
  assert.deepEqual(supplied.ownItemOrigins, ['Product']);
  assert.ok(output(supplied, 'Product').sources.every(source => source.kind === 'spawn' && source.own));
});

test('starred nonskill gathering source names preserve the black sheep cloth chain as independent roots', () => {
  const names = ['Spin a ~|ball of black wool|~', 'Weave a ~|strip of black cloth|~', 'Craft a piece of ~|wizard equipment#black|~'];
  const crafting = Object.fromEntries(names.map(name => [name, reference.challenges.Crafting[name]]));
  assert.ok(names.every(name => crafting[name]), 'named retained recipes exist');
  const data = fixture({ Nonskill: { 'Sheer black sheep*': reference.challenges.Nonskill['Sheer black sheep*'] }, Crafting: crafting },
    { Thread: 1 }, { chunks: { '1': { NPC: { 'Sheep (black)': true }, Object: { 'Spinning wheel': true, Loom: true }, Spawn: { Thread: 1 } } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  for (const name of names) assert.equal(row(result, 'Crafting', name).status, 'available', name);
  assert.ok(output(result, 'Ball of black wool'));
  assert.ok(output(result, 'Strip of black cloth'));
  assert.ok(output(result, 'Black wizard equipment'));
});

test('staged source replay reuses invariant access and resources and finalizes once', () => {
  const data = fixture({ Crafting: { First: recipe(1, ['Raw'], 'Middle'), Second: recipe(1, ['Middle'], 'End') },
    Magic: { Finish: recipe(1, ['End'], 'Final') } }, { Raw: 1 });
  const result = createTaskEngine(data).evaluate(saved({ 'Multi Step Processing': true }), 'a', { ownItemQueries: ['Final'] });
  assert.ok(result.metrics.processingPasses >= 4, 'separate admissions traverse the chain');
  assert.equal(result.metrics.processingAccessEvaluations, 1, 'unchanged observed task gates reuse raw access');
  assert.equal(result.metrics.processingBaseCollections, 1, 'unchanged resource view reuses base collection');
  assert.equal(result.metrics.processingFinalizations, 1, 'explanations/equipment are projected only for the stable pass');
  assert.ok(result.metrics.processingIncrementalPasses >= 3, 'ordinary growth reuses its capability closure');
  assert.deepEqual(result.ownItemOrigins, ['Final']);
  assert.ok(output(result, 'Final').sources.every(source => source.own));
});

test('NoXp source oscillation still fails closed without retaining cached disputed supplies', () => {
  const data = fixture({ Crafting: { A: { Level: 1, Output: 'Shared', NoXp: true },
    B: { Level: 1, Output: 'Shared', NoXp: true } }, Magic: { Use: recipe(1, ['Shared'], 'Leaked') } });
  const result = createTaskEngine(data).evaluate(saved(), 'a', { ownItemQueries: ['Shared', 'Leaked'] });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.kind === 'processing-source-cycle'));
  assert.equal(output(result, 'Shared'), undefined);
  assert.equal(output(result, 'Leaked'), undefined);
  assert.deepEqual(result.ownItemOrigins, []);
  assert.equal(row(result, 'Magic', 'Use').status, 'blocked');
  assert.equal(result.metrics.processingFinalizations, 1);
});

test('replay caches do not cross evaluations or mutate prior output when admission mode changes', () => {
  const data = fixture({ Smithing: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], 'High') },
    Crafting: { Use: recipe(50, ['High', 'Fuel'], 'End') } }, { Ore: 1, Fuel: 1 });
  const engine = createTaskEngine(data), initialState = saved({ 'Multi Step Processing': true });
  const initial = engine.evaluate(initialState, 'a', { ownItemQueries: ['End'] });
  const snapshot = structuredClone(initial);
  const changedState = saved({ 'Highest Level': true, 'Multi Step Processing': true });
  const changed = engine.evaluate(changedState, 'a', { ownItemQueries: ['End'] });
  const fresh = createTaskEngine(data).evaluate(changedState, 'a', { ownItemQueries: ['End'] });
  const comparable = result => { const copy = structuredClone(result); delete copy.metrics.elapsedMs; return copy; };
  assert.deepEqual(comparable(changed), comparable(fresh));
  assert.deepEqual(initial, snapshot);
  assert.equal(output(initial, 'High').sources[0].processingMode, 'multi');
  assert.equal(output(changed, 'High').sources[0].processingMode, undefined);
  assert.deepEqual(changed.ownItemOrigins, ['End']);
});

test('growth discovery preserves fresh-pass source order and Slayer release provenance', () => {
  const data = fixture({ Crafting: {
    B: recipe(2, ['Raw'], 'Dup', { Primary: false }),
    A: recipe(1, ['Raw', 'Gem'], ['Dup', 'Boost'], { Primary: false }),
  }, Slayer: { Contract: { Level: 1, Primary: true } } }, { Raw: 1, Gem: 1 }, {
    chunks: { '1': { Spawn: { Raw: 1, Gem: 1 }, Monster: { Beast: true } } },
    codeItems: { boostItems: { Crafting: { Boost: 1 } }, slayerTasks: { Beasts: { Beast: true } } },
    slayerMonsters: { Beast: 1 }, taskUnlocks: { Monsters: { Beast: { '1': [{ B: 'Crafting' }] } } },
  });
  const result = createTaskEngine(data).evaluate(saved({ Boosting: true }, {
    passiveLevels: { Crafting: 1 }, slayerLock: { level: 5, monster: 'Beasts' },
  }), 'a');
  assert.deepEqual(output(result, 'Dup').sources.map(source => source.taskId), [taskId('Crafting', 'B'), taskId('Crafting', 'A')],
    'the later admitted earlier catalogue task still publishes first in the final fresh closure');
  assert.ok(result.metrics.processingIncrementalPasses >= 2);
  assert.deepEqual(result.slayerLockRelease, { kind: 'target', name: 'Beast', assignment: 'Beasts' });
});

test('base source memo views distinguish private spawn quantities with equal aggregate resources', () => {
  const data = quantities => fixture({}, {}, { chunks: { '1': { Spawn: { Raw: quantities[0] } },
    '2': { Spawn: { Raw: quantities[1] } } }, walkableChunksF2P: ['1', '2'] });
  const state = saved({}, { unlocked: ['1', '2'] });
  const access = quantities => calculateAccess(buildAccessIndex(data(quantities), { cacheWalking: false }), state, 'a');
  const first = access([1, 3]), second = access([3, 1]);
  assert.deepEqual([...first.spawns], [...second.spawns]);
  assert.deepEqual([...first.locations], [...second.locations]);
  assert.notEqual(baseItemSourceView(first), baseItemSourceView(second));
  assert.equal(baseItemSourceView(first), baseItemSourceView(copyAccess(first)));
  assert.deepEqual(collectBaseItemSources(data([1, 3]), first, { rules: { F2P: false } }).sources.get('Raw').map(source => source.quantity), [1, 3]);
  assert.deepEqual(collectBaseItemSources(data([3, 1]), second, { rules: { F2P: false } }).sources.get('Raw').map(source => source.quantity), [3, 1]);
});

test('cached drop expansion rechecks admission and Legends gates with exact diagnostic ordering', () => {
  const data = fixture({}, {}, { chunks: { '1': { Monster: { Beast: true } } },
    drops: { Beast: { Table: { '1': 'Always' } } },
    taskUnlocks: { Items: { Product: [{ Gate: 'Quest' }] } },
    codeItems: { dropTables: { Table: { Product: { '1': 'Always' }, BrokenDropTable: { '1': 'Always' },
      'GemDropTableLegends+': { '1': 'Always' }, Loop: { '1': 'Always' } },
      'GemDropTableLegends+': { Gem: { '1': 'Always' } }, Loop: { Loop: { '1': 'Always' } } } },
  });
  const access = calculateAccess(buildAccessIndex(data, { cacheWalking: false }), saved(), 'a');
  const expansionCache = new Map(), legend = "Quest\u0000~|Legends' Quest|~ Complete the quest";
  for (const gates of [[], ['Quest\u0000Gate', legend], [legend], ['Quest\u0000Gate', legend]]) {
    const options = { rules: { F2P: false }, validTasks: new Set(gates) };
    const expected = collectBaseItemSources(data, access, options);
    const actual = collectBaseItemSources(data, access, { ...options, expansionCache });
    assert.deepEqual(actual, expected);
    if (actual.sources.has('Product')) actual.sources.get('Product')[0].own = true;
  }
  assert.equal(expansionCache.size, 1);
  assert.equal([...expansionCache.values()][0].length, 2, 'only Legends expansion truth changes table traversal');
});

test('fresh-selector validation falls back when an omitted Set competitor changes promotion eligibility', () => {
  const data = fixture({ Magic: { Low: recipe(1, ['Rune'], 'Low'),
    High: recipe(10, ['Rune'], 'Excluded', { Tasks: { B: 'Extra' } }),
    Frontier: recipe(20, ['Fuel'], 'Independent', { Primary: false }) },
    Extra: { A: { Set: 'Route', Priority: 1 }, B: { Set: 'Route', Priority: 2 } },
  }, { Rune: 1, Fuel: 1 });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Magic', 'High').status, 'available');
  assert.equal(row(result, 'Magic', 'High').sourceEligible, false);
  assert.equal(output(result, 'Excluded'), undefined);
  assert.equal(result.metrics.processingFallbacks, 1);
  assert.ok(row(result, 'Extra', 'B').blockers.some(blocker => blocker.kind === 'outclassed'));
});

test('cached producer publication reopens an output when its exact task gate becomes valid', () => {
  const data = fixture({ Crafting: { Produce: recipe(1, ['Raw'], 'Product'),
    MakeKey: recipe(1, ['Fuel'], 'Key') }, Quest: { Gate: { Items: ['Key'] } } }, { Raw: 1, Fuel: 1 },
  { taskUnlocks: { Items: { 'Product^Produce': [{ Gate: 'Quest' }] } } });
  const result = createTaskEngine(data).evaluate(saved(), 'a', { ownItemQueries: ['Product'] });
  assert.equal(row(result, 'Quest', 'Gate').status, 'available');
  assert.deepEqual(result.ownItemOrigins, ['Product']);
  assert.ok(output(result, 'Product').sources.some(source => source.taskId === taskId('Crafting', 'Produce') && source.own));
  assert.equal(result.metrics.processingAccessEvaluations, 1, 'output gate changes do not invalidate raw access');
});

test('recursive retained access reobserves a section gate opened by a newly admitted producer', () => {
  const data = fixture({ Crafting: { 'Make key': recipe(1, ['Raw'], 'Key') },
    Nonskill: { 'Open retained section': { Items: ['Key'] } } }, {}, {
    chunks: { '1': { Spawn: { Raw: 1 } }, '13361': { Sections: {
      0: { Connect: { '13361-1': { Tasks: { 'Open retained section': 'Nonskill' } } } },
      1: { Object: { 'Retained ore': 1 } },
    } } }, sections: { '13361': { 0: [], 1: [] } },
  });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false,
    cacheWalking: true, cacheResources: false, cacheArchaeology: false, lodestones: [] });
  const input = saved({}, { unlocked: ['1', '13361'], sectionOverrides: { '13361-0': true } });
  const result = engine.evaluate(input, 'a');
  assert.equal(row(result, 'Nonskill', 'Open retained section').status, 'available');
  assert.ok(result.access.objects.includes('Retained ore'));
  assert.ok(result.access.diagnostics.some(value => value.code === 'unresolved-selector-retained-access'
    && value.location === '13361-1'), 'The unresolved numeric selector uses the retained gate proof.');
  assert.ok(result.metrics.processingPasses >= 2);
  input.members[0].taskStatus = { [taskId('Crafting', 'Make key')]: { backlogged: true } };
  const blocked = engine.evaluate(input, 'a');
  assert.equal(row(blocked, 'Nonskill', 'Open retained section').status, 'blocked');
  assert.ok(!blocked.access.objects.includes('Retained ore'));
  assert.ok(result.access.objects.includes('Retained ore'), 'Later replay does not mutate retained output.');
});

test('raw access reuses its independent retained view when only a source gate changes', () => {
  const data = fixture({ Crafting: { 'Make key': recipe(1, ['Raw'], 'Key') },
    Quest: { 'Open source': { Items: ['Key'] } } }, { Raw: 1, Fruit: 1 },
  { taskUnlocks: { Spawns: { Fruit: { '1': { 'Open source': 'Quest' } } } } });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false,
    cacheWalking: true, cacheResources: false, cacheArchaeology: false, lodestones: [] });
  const result = engine.evaluate(saved(), 'a');
  assert.equal(row(result, 'Quest', 'Open source').status, 'available');
  assert.ok(output(result, 'Fruit'));
  assert.equal(result.metrics.processingAccessEvaluations, 2);
  assert.equal(result.metrics.processingRawAccessEvaluations, 4,
    'Two source collectors share one walking calculation and one retained calculation.');
});

test('split source collection matches standalone access and preserves private spawn provenance', () => {
  const data = fixture({}, {}, { chunks: { '1': { Spawn: { Raw: 2, Fruit: 3 }, NPC: { Guide: 1 }, Monster: { Beast: 1 }, Shop: { Store: 1 } },
    '2': { Spawn: { Raw: 5 }, Object: { Furnace: 1 } } }, taskUnlocks: { Spawns: { Fruit: { '1': { Gate: 'Quest' } } } } });
  const input = saved({}, { unlocked: ['1', '2'] }), index = buildAccessIndex(data, { cacheWalking: false });
  for (const gates of [[], ['Quest\u0000Gate'], []]) {
    const options = { validTasks: new Set(gates) };
    const expected = calculateAccess(index, input, 'a', options);
    const actual = calculateAccess(index, input, 'a', { ...options,
      resolveAccess: (reference, current, owner, settings) => calculateAccess(reference, current, owner, settings) });
    assert.deepEqual(actual, expected);
    assert.equal(baseItemSourceView(actual), baseItemSourceView(expected));
    assert.deepEqual(collectBaseItemSources(data, actual), collectBaseItemSources(data, expected));
  }
});

test('a Monster alias in a spatial field reopens after Slayer training without raw access changes', () => {
  const data = fixture({ Extra: { Observe: { NPCs: ['Monster[+]'] } },
    Crafting: { 'Make key': recipe(1, ['Raw'], 'Key') },
    Slayer: { Contract: { Level: 1, Items: ['Key'], Primary: true } } }, {}, {
    chunks: { '1': { Spawn: { Raw: 1 }, Monster: { Beast: 1 } } }, slayerMonsters: { Beast: 50 },
  });
  const result = createTaskEngine(data).evaluate(saved(), 'a');
  assert.equal(row(result, 'Extra', 'Observe').status, 'available');
  assert.ok(result.access.monsters.includes('Beast'));
  assert.equal(result.metrics.processingAccessEvaluations, 1);
});

test('membership templates isolate edited public blockers and reevaluate F2P switches', () => {
  const data = fixture({ Extra: { Consume: { Items: ['Member token'] } },
    Magic: { 'Cast ~|Vengeance|~': recipe(1, ['Rune'], 'Product', { Primary: false }) } },
  { 'Member token': 1, Rune: 1 }, { equipment: { 'Member token': { members: true } } });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false });
  const input = saved(); input.rules['content.f2p'] = true;
  const first = engine.evaluate(input, 'a');
  const expected = structuredClone([row(first, 'Extra', 'Consume').blockers, row(first, 'Magic', 'Cast ~|Vengeance|~').blockers]);
  const itemBlocker = row(first, 'Extra', 'Consume').blockers.find(blocker => blocker.code === 'members-only-item');
  itemBlocker.detail = 'Caller edit'; itemBlocker.candidateIds.push('caller-id');
  row(first, 'Magic', 'Cast ~|Vengeance|~').blockers.find(blocker => blocker.code === 'members-only-method').detail = 'Caller edit';
  const second = engine.evaluate(input, 'a');
  assert.deepEqual([row(second, 'Extra', 'Consume').blockers, row(second, 'Magic', 'Cast ~|Vengeance|~').blockers], expected);
  input.rules['content.f2p'] = false;
  const member = engine.evaluate(input, 'a');
  assert.equal(row(member, 'Extra', 'Consume').status, 'available');
  assert.equal(row(member, 'Magic', 'Cast ~|Vengeance|~').status, 'available');
  input.rules['content.f2p'] = true;
  const restored = engine.evaluate(input, 'a');
  assert.deepEqual([row(restored, 'Extra', 'Consume').blockers, row(restored, 'Magic', 'Cast ~|Vengeance|~').blockers], expected);
});

test('compact discovery preserves boosts from possibleAreas and unknown custom fields', () => {
  for (const field of ['possibleAreas', 'unknownCustomField']) {
    const data = fixture({ Crafting: { A: recipe(2, ['Raw'], 'A', { Primary: false }),
      B: recipe(1, ['Raw', 'Gem'], 'B', { Primary: false }) },
      Nonskill: { Cave: { UnlocksArea: true, Items: ['Missing key'] } } }, {}, {
      chunks: { '1': { Spawn: { Raw: 1, Gem: 1 }, Connect: { Cave: true } }, Cave: {} },
      codeItems: { boostItems: { Crafting: { [`Cave~${field}`]: 1 } } },
    });
    const result = createTaskEngine(data, { cacheWalking: false }).evaluate(saved({ Boosting: true }), 'a');
    assert.ok(result.access.possibleAreas.includes('Cave'));
    assert.ok(!result.access.areas.includes('Cave'));
    assert.equal(row(result, 'Crafting', 'A').sourceEligible !== false, field === 'possibleAreas');
    assert.equal(result.processing.effectiveLevels[taskId('Crafting', 'A')], field === 'possibleAreas' ? 1 : 2);
    assert.equal(result.metrics.processingFallbacks, 0, 'Compact and full selectors agree on the custom boost field.');
  }
});

test('static scan partition preserves completed blockers, duplicate-ID multi rows and public counters', () => {
  const high = 'rs3:task:fixture-high', done = 'rs3:task:fixture-done';
  const data = fixture({ Extra: { Done: { Mystery: true, Output: 'Declared', PickerId: done },
    Blocked: { Mystery: true, Output: 'Poison', PickerId: high }, Missing: { Items: ['Ghost'] } },
    Smithing: { Low: recipe(1, ['Ore'], 'Low'), High: recipe(50, ['Ore'], 'High', { PickerId: high }) },
    Crafting: { Use: recipe(5, ['High', 'Fuel'], 'End') } }, { Ore: 1, Fuel: 1 });
  const input = saved({ 'Multi Step Processing': true }, { completedTasks: [done] });
  input.rules['content.f2p'] = true;
  const result = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false }).evaluate(input, 'a');
  assert.deepEqual({ passes: result.metrics.passes, checks: result.metrics.checks,
    dependencyChecks: result.metrics.dependencyChecks, accessPasses: result.metrics.accessPasses },
  { passes: 2, checks: 16, dependencyChecks: 0, accessPasses: 2 });
  // H4 2026-10-13: an imported checkmark remains personal progress, but cannot
  // bypass unknown hard metadata to publish supplies or satisfy later recipes.
  assert.equal(output(result, 'Declared'), undefined);
  assert.equal(result.tasks.find(task => task.id === done).status, 'unsupported');
  assert.equal(result.tasks.find(task => task.id === done).personalCompleted, true);
  assert.equal(output(result, 'Poison'), undefined);
  assert.equal(output(result, 'High').sources[0].processingMode, 'multi');
  assert.deepEqual(result.processing.multiTaskIds, [high]);
});

test('colliding internal task keys retain every compiled producer and its source order', () => {
  const first = 'rs3:task:collision-a', second = 'rs3:task:collision-b';
  const data = fixture({ Extra: { 'X\u0000Y': { Items: ['Raw'], Output: 'Shared', PickerId: first } },
    'Extra\u0000X': { Y: { Items: ['Raw'], Output: 'Shared', PickerId: second } } }, { Raw: 1 });
  const result = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false }).evaluate(saved(), 'a');
  assert.deepEqual(output(result, 'Shared').sources.map(source => source.taskId), [first, second]);
  assert.ok(result.tasks.every(task => task.status === 'available'));
});

test('catalogue-only variants defer membership preparation and selected preparation is idempotent', () => {
  let membershipReads = 0;
  const data = fixture({ Extra: { Consume: { Items: ['Member token'] } } }, {}, {
    equipment: { 'Member token': { get members() { membershipReads++; return true; } } },
  });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false,
    skillGuideCatalogue: { metadataCorrections: [], generatedTasks: [] },
    skillGuideCorrectionOverlay: value => ({ ...value, challenges: { ...value.challenges, Nonskill: { Gift: { Output: 'Member token' } } } }) });
  const catalogue = engine.catalogue;
  assert.equal(membershipReads, 0, 'Reading catalogue identities does not prepare membership capability metadata.');
  engine.prepare({ [SKILL_GUIDE_CORRECTIONS_RULE]: true });
  assert.ok(membershipReads > 0);
  const preparedReads = membershipReads;
  engine.prepare({ [SKILL_GUIDE_CORRECTIONS_RULE]: true });
  assert.equal(membershipReads, preparedReads, 'Selected runtime metadata prepares once.');
  const input = saved();
  assert.equal(row(engine.evaluate(input, 'a'), 'Extra', 'Consume').status, 'blocked');
  input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
  assert.equal(row(engine.evaluate(input, 'a'), 'Extra', 'Consume').status, 'available');
  assert.equal(engine.catalogue, catalogue);
});

test('deferred evaluation and new variants retain constructor access policy after environment changes', () => {
  const variable = 'RS3_RESOURCE_CONTENTS', previous = process.env[variable], base = '12339', component = `${base}-1000002`;
  const name = 'Synthetic deferred resource';
  const data = fixture({}, {}, { chunks: { [base]: { Object: {} } }, sections: { [base]: { 0: [] } },
    walkableChunks: [base], walkableChunksF2P: [base] });
  const catalogue = { coverage: [[base, 'decoded']], classes: [{ key: 'synthetic:deferred', name, members: false, level: 1 }],
    placements: [{ id: 'synthetic:deferred', objectId: 42, classKey: 'synthetic:deferred', chunkId: base, components: [component] }],
    mappings: [{ name, classKeys: ['synthetic:deferred'] }] };
  try {
    for (const enabled of [false, true]) {
      process.env[variable] = enabled ? 'game-data' : 'retained';
      const capabilities = datasetCapabilities({ [variable]: process.env[variable] });
      const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false,
        skillGuideCatalogue: { metadataCorrections: [], generatedTasks: [] }, skillGuideCorrectionOverlay: value => value,
        cacheWalking: true, cacheResources: capabilities.cacheResources, cacheArchaeology: false, lodestones: [], resourceCatalogue: catalogue, resourceSelectors: { mappings: catalogue.mappings } });
      const input = saved({}, { unlocked: [base], sectionOverrides: { [component]: true } });
      process.env[variable] = enabled ? 'retained' : 'game-data';
      assert.equal(engine.evaluate(input, 'a').access.objects.includes(name), enabled, 'Deferred constructor variant');
      input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
      engine.prepare(input.rules);
      assert.equal(engine.evaluate(input, 'a').access.objects.includes(name), enabled, 'Prepared new variant');
      input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false;
      assert.equal(engine.evaluate(input, 'a').access.objects.includes(name), enabled, 'Restored constructor variant');
    }
  } finally {
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
  }
});

test('multiple producers sharing nested output tables keep compiled producer and leaf order', () => {
  let nestedReads = 0;
  const tables = { Shared: { Nested: { '1': 'Always' } } };
  Object.defineProperty(tables, 'Nested', { enumerable: true, get() {
    nestedReads++;
    return { Product: { '1': 'Always' }, Shared: false };
  } });
  const data = fixture({ Crafting: { First: recipe(1, ['Raw'], 'Shared'), Second: recipe(1, ['Raw'], 'Shared') } },
    { Raw: 1 }, { skillItems: { Crafting: tables } });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false });
  assert.equal(nestedReads, 1, 'Declared producer expansion traverses the shared table once, including its false cycle edge.');
  engine.prepare({});
  assert.equal(nestedReads, 2, 'Membership expansion traverses the shared root once with its own false-entry policy.');
  const result = engine.evaluate(saved({ 'Highest Level': true }), 'a');
  assert.deepEqual(output(result, 'Product').sources.map(source => source.taskId),
    [taskId('Crafting', 'First'), taskId('Crafting', 'Second')]);
  output(result, 'Product').sources[0].source = 'Caller mutation';
  assert.deepEqual(output(engine.evaluate(saved({ 'Highest Level': true }), 'a'), 'Product').sources.map(source => source.taskId),
    [taskId('Crafting', 'First'), taskId('Crafting', 'Second')]);
});

test('resource source-key reuse retains rate, quantity, location and table evidence across fresh closures', () => {
  const data = fixture({ Crafting: { Key: recipe(1, ['Raw'], 'Key'), Next: recipe(1, ['Key'], 'Next') } }, {}, {
    chunks: { '1': { Spawn: { Raw: 1 }, Monster: { Beast: true } }, '2': { Monster: { Beast: true } } },
    drops: { Beast: { Token: { 2: '1/4' }, TableA: { 1: '1/2' }, TableB: { 1: '1/2' } } },
    codeItems: { dropTables: { TableA: { Token: '1/5@3' }, TableB: { Token: '1/5@3' } } },
  });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false });
  const input = saved({ 'Multi Step Processing': true }, { unlocked: ['1', '2'] }), first = engine.evaluate(input, 'a');
  const evidence = output(first, 'Token').sources.map(({ quantity, rate, location, tables, own }) => ({ quantity, rate, location, tables, own }));
  assert.deepEqual(evidence, ['1', '2'].flatMap(location => [
    { quantity: '2', rate: '1/4', location, tables: undefined, own: true },
    { quantity: '3', rate: '1/2 × 1/5', location, tables: ['TableA'], own: true },
    { quantity: '3', rate: '1/2 × 1/5', location, tables: ['TableB'], own: true },
  ]));
  assert.ok(first.metrics.processingIncrementalPasses >= 2);
  const expected = structuredClone(output(first, 'Token'));
  Object.assign(output(first, 'Token').sources[0], { quantity: 'Caller edit', source: 'Caller edit', own: false, primary: true });
  assert.deepEqual(output(engine.evaluate(input, 'a'), 'Token'), expected);
});

test('private cached membership evidence cannot be changed through published diagnostics', () => {
  const data = fixture({}, { 'Magic shortbow': 1 }, { chunks: { '1': { Spawn: { 'Magic shortbow': 1 }, Object: { 'Magic tree': true } } },
    objectItems: { 'Magic tree': { Ashes: true } } });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false });
  const input = saved(); input.rules['content.f2p'] = true;
  const first = engine.evaluate(input, 'a'), expected = structuredClone(first.diagnostics);
  assert.ok(first.diagnostics.some(entry => entry.code === 'members-only-item'));
  assert.ok(first.diagnostics.some(entry => entry.code === 'members-only-source'));
  first.diagnostics.forEach(entry => { entry.detail = 'Caller edit'; entry.evidence = 'Caller edit'; });
  assert.deepEqual(engine.evaluate(input, 'a').diagnostics, expected);
});

test('boolean static-guard shortcut still evaluates changing manual area access', () => {
  const data = fixture({ Nonskill: { Cave: { UnlocksArea: true, Output: 'Cave supply' } },
    Extra: { Use: { Items: ['Cave supply'] } } }, {}, {
    chunks: { '1': { Connect: { Cave: true } }, Cave: { Connect: { '1': true } } },
  });
  const engine = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false });
  const input = saved({}, { areaOverrides: { Cave: false } });
  const blocked = engine.evaluate(input, 'a');
  assert.deepEqual(row(blocked, 'Nonskill', 'Cave').blockers, [{ kind: 'access', detail: 'Cave is manually blocked by the current member.' }]);
  assert.equal(output(blocked, 'Cave supply'), undefined);
  input.members[0].areaOverrides.Cave = true;
  const opened = engine.evaluate(input, 'a');
  assert.equal(row(opened, 'Nonskill', 'Cave').status, 'available');
  assert.equal(row(opened, 'Extra', 'Use').status, 'available');
  input.members[0].areaOverrides.Cave = false;
  assert.deepEqual(row(engine.evaluate(input, 'a'), 'Nonskill', 'Cave').blockers, row(blocked, 'Nonskill', 'Cave').blockers);
});

test('item source constraints retain independent witnesses and output-channel exemption', () => {
  const shop = 'Synthetic allowed shop';
  const requirements = { Items: ['Token'], NonShop: true, AllowedSources: [shop], Source: 'shop' };
  const data = fixture({ Extra: { Use: requirements,
    Missing: { ...requirements, Source: 'reward' },
    Producer: { ...requirements, Source: 'reward', Output: 'Product' } } }, {}, {
    chunks: { '1': { Spawn: { Token: 1 }, Shop: { [shop]: true } } }, shopItems: { [shop]: { Token: true } },
  });
  const options = { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false };
  const result = createTaskEngine(data, options).evaluate(saved(), 'a');
  assert.equal(row(result, 'Extra', 'Use').status, 'available', 'Spawn proves NonShop while the allowed shop proves both other constraints.');
  assert.equal(row(result, 'Extra', 'Missing').status, 'blocked');
  assert.equal(row(result, 'Extra', 'Producer').status, 'available', 'Source identifies its output channel when Output is declared.');
  const shopOnly = { ...data, chunks: { '1': { Shop: { [shop]: true } } } };
  assert.equal(row(createTaskEngine(shopOnly, options).evaluate(saved(), 'a'), 'Extra', 'Use').status, 'blocked');
});

test('invocation spatial failure memo invalidates when an NPC source gate opens later in the closure', () => {
  const data = fixture({ Crafting: { Key: recipe(1, ['Raw'], 'Key') },
    Quest: { Open: { Items: ['Key'] } }, Extra: { Observe: { NPCs: ['Guide'], Output: 'Seen guide' } } }, {}, {
    chunks: { '1': { Spawn: { Raw: 1 }, NPC: { Guide: true } } }, taskUnlocks: { NPCs: { Guide: { '1': { Open: 'Quest' } } } },
  });
  const result = createTaskEngine(data, { metadataCorrections: false, equipmentCorrections: false, cacheWalking: false }).evaluate(saved(), 'a');
  assert.equal(row(result, 'Extra', 'Observe').status, 'available');
  assert.ok(result.access.npcs.includes('Guide'));
  assert.ok(output(result, 'Seen guide'));
  assert.ok(result.metrics.processingAccessEvaluations > 1, 'The changed source gate produces a different immutable raw access view.');
});
