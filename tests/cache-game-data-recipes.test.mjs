import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRecipes, compareRetained, parameterMap } from '../scripts/cache/game-data-recipes.mjs';

const extra = pairs => ({ extra: pairs.map(([prop, intvalue]) => ({ prop, intvalue, stringvalue: null })) });
function fixture() {
  const params = new Map();
  for (let i = 0; i < 10; i++) {
    params.set(2655 + i, { type: { vartype: 33, defaultint: -1 } });
    params.set(2665 + i, { type: { vartype: 0, defaultint: 0 } });
    params.set(2675 + i, { type: { vartype: 73, defaultint: -1 } });
    params.set(2686 + i, { type: { vartype: 1, defaultint: 1 } });
  }
  for (let i = 0; i < 3; i++) params.set(2650 + i, { type: { vartype: 33, defaultint: -1 } });
  params.set(2653, { type: { vartype: 0, defaultint: 1 } });
  return { items: new Map(), structs: new Map(), params,
    enums: new Map([[108, { stringArrayValue2: { values: [[11, 'Crafting'], [19, 'Fletching']] } }]]) };
}

test('typed requirement groups stay separate from direct AND inputs and retain flags', () => {
  const f = fixture();
  f.items.set(841, { name: 'Shortbow', ...extra([[2640, 19], [2645, 1], [2655, 50], [2665, 1], [2676, 43672], [2696, 19], [2697, 50]]) });
  f.items.set(50, { name: 'Shortbow (unstrung)' });
  f.items.set(1777, { name: 'Bowstring' });
  f.items.set(53088, { name: 'Fungal bowstring', members: true });
  f.structs.set(43672, extra([[2655, 1777], [2665, 1], [2686, 0], [2656, 53088], [2666, 1], [2687, 0]]));
  const recipe = extractRecipes(f).recipes[0];
  assert.equal(recipe.directInputs.length, 1);
  assert.equal(recipe.requirementGroups[0].inputs.length, 2);
  assert.equal(recipe.requirementGroups[0].inputs[1].item.membersMarked, true);
  assert.equal(recipe.requirementGroups[0].inputs[0].quantityFlag, 0);
  assert.deepEqual(recipe.requirementGroups[0].source, { major: 22, minor: 1364, subid: 24 });
  assert.equal(recipe.xp.value, 5);
  assert.match(recipe.members.activityEligibility, /unverified/);
});

test('same batch output count does not make shaft/headless XP units interchangeable', () => {
  const f = fixture();
  f.items.set(52, { name: 'Shaft', ...extra([[2640, 19], [2645, 1], [2653, 15], [2655, 1511], [2665, 1], [2696, 19], [2697, 50]]) });
  f.items.set(53, { name: 'Headless shaft', ...extra([[2640, 19], [2645, 1], [2653, 15], [2655, 52], [2665, 1], [2696, 19], [2697, 10]]) });
  const recipes = extractRecipes(f).recipes;
  assert.equal(recipes[0].outputQuantity, recipes[1].outputQuantity);
  assert.equal(recipes[0].xp.value, 5);
  assert.equal(recipes[1].xp.value, 1);
  assert.match(recipes[0].xp.unit, /per normal log/);
  assert.match(recipes[1].xp.unit, /per headless shaft/);
  assert.match(recipes[1].directInputs[0].quantityUnit, /unverified/);
});

test('unvalidated products and changed calibrated XP keep raw integers without normalized XP', () => {
  const f = fixture();
  f.items.set(999999, { name: 'Unknown', ...extra([[2640, 11], [2645, 2], [2696, 11], [2697, 123]]) });
  f.items.set(1059, { name: 'Leather gloves', ...extra([[2640, 11], [2645, 1], [2696, 11], [2697, 140]]) });
  const recipes = extractRecipes(f).recipes;
  assert.ok(recipes.every(r => r.xp === null));
  assert.deepEqual(recipes.map(r => r.rawXp.value), [123, 140]);
});

test('missing struct is explicit and incorrect reference type fails closed', () => {
  const f = fixture();
  f.items.set(1, { name: 'Candidate', ...extra([[2640, 11], [2645, 1], [2675, 43233]]) });
  assert.deepEqual(extractRecipes(f).unresolved, [{ itemId: 1, structId: 43233 }]);
  f.params.get(2675).type.vartype = 33;
  assert.throws(() => extractRecipes(f), /expected type 73/);
});

test('retained aggregate/alias outputs are not guessed into exact output joins', () => {
  const f = fixture();
  f.items.set(1059, { name: 'Leather gloves', ...extra([[2640, 11], [2645, 1]]) });
  const r = compareRetained(extractRecipes(f).recipes, { challenges: { Crafting: {
    individual: { Output: 'Leather gloves', Items: ['Leather*'], Level: 1 },
    aggregate: { Output: 'Soft leather armour', Items: ['Leather*'], Level: 1 },
  } } });
  assert.equal(r.taskCount, 2);
  assert.equal(r.withOutputSkillMatch, 1);
  assert.equal(r.comparisons[1].cacheRecipeIds.length, 0);
});

test('duplicate extras preserve raw order and make final value selection explicit', () => {
  assert.deepEqual(parameterMap(extra([[2645, 1], [2645, 5]])).duplicates, [2645]);
  assert.equal(parameterMap(extra([[2645, 1], [2645, 5]])).values.get(2645), 5);
});

test('ambiguous output joins expose mixed levels instead of counting one matching level as consensus', () => {
  const f = fixture();
  f.items.set(1, { name: 'Leather gloves', ...extra([[2640, 11], [2645, 1]]) });
  f.items.set(2, { name: 'Leather gloves', ...extra([[2640, 11], [2645, 5]]) });
  const r = compareRetained(extractRecipes(f).recipes, { challenges: { Crafting: {
    task: { Output: 'Leather gloves', Items: ['Leather*'], Level: 1 },
  } } });
  assert.equal(r.matchedLevelAgree, 0);
  assert.equal(r.matchedLevelMixed, 1);
  assert.equal(r.comparisons[0].joinStatus, 'ambiguous');
  assert.equal(r.comparisons[0].levelAgrees, null);
});

test('retained input alias overlap is reported as names without converting consumption or amounts', () => {
  const f = fixture();
  f.items.set(53, { name: 'Headless shaft', ...extra([[2640, 19], [2645, 1], [2655, 52], [2665, 1], [2676, 14981]]) });
  f.items.set(52, { name: 'Shaft' });
  f.items.set(314, { name: 'Feather' });
  f.structs.set(14981, extra([[2655, 314], [2665, 1]]));
  const r = compareRetained(extractRecipes(f).recipes, { codeItems: { itemsPlus: {
    'Shafts[+]': ['Shaft', 'Grenwall spikes'], 'Feathers[+]': ['Feather', 'Blue feather'],
  } }, challenges: { Fletching: { task: { Output: 'Headless shaft', Items: ['Shafts[+]*', 'Feathers[+]*'], Level: 1 } } } });
  assert.equal(r.matchedWithAllRetainedInputNames, 1);
  assert.deepEqual(r.comparisons[0].inputNameComparisons[0].tokens[0].nameOverlap, ['shaft']);
  assert.match(r.comparisons[0].inputNameComparisons[0].interpretation, /no quantities/);
});
