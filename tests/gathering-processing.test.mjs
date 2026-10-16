import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGatheringProcessing as calculate, PROCESSING_SOURCES, COOKING_RECIPES, FLETCHING_RECIPES } from '../app/training/gathering-processing.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const logs = {skill: 'Woodcutting', resources: [{id: 'normal', perHour: 600}], xpPerHour: 15000,
  mode: 'fletch-drop', fletchingLevel: 10, batchSize: 20};
const fish = {skill: 'Fishing', resources: [{id: 'trout', perHour: 600}], xpPerHour: 30000,
  mode: 'cook-drop', cookingLevel: 15, confirmedCookingFacility: 'range', batchSize: 20};

test('one complete log batch shares the hour between gathering, processing and handling', () => {
  const result = calculate(logs);
  // 20 logs at 600/hour take 120 seconds; fletch 36s, drop 12s, interface 1.2s.
  close(result.gatheringSeconds, 120);
  close(result.processingSeconds, 36);
  close(result.droppingSeconds, 12);
  close(result.interfaceSeconds, 1.2);
  close(result.cycleSeconds, 169.2);
  close(result.gatheringFraction, 120 / 169.2);
  close(result.xpPerHour, 15000 * 120 / 169.2);
  close(result.resourcesPerHour, 600 * 120 / 169.2);
  close(result.processingXpPerHour.Fletching, 600 * 7.5 * 120 / 169.2);
  assert.equal(result.processedResources[0].recipeId, 'normal-longbow');
  assert.equal(result.retained, false);
  assert.equal(result.status, 'estimated');
});

test('unknown burn data preserves honest Cooking bounds and known processing time', () => {
  const result = calculate(fish);
  close(result.processingSeconds, 48);
  close(result.cycleSeconds, 181.2);
  close(result.xpPerHour, 30000 * 120 / 181.2);
  assert.equal(result.status, 'bounded');
  assert.equal(result.reasonCode, 'missing-burn-data');
  assert.equal(result.processingXpPerHour.Cooking, null);
  close(result.processingXpBoundsPerHour.Cooking.min, 0);
  close(result.processingXpBoundsPerHour.Cooking.max, 600 * 70 * 120 / 181.2);
  assert.equal(result.processedResources[0].successChance, null);
  assert.ok(result.assumptions.some(row => row.includes('Burnt food stacks')));
});

test('a supplied success scenario changes only Cooking XP, including zero and one', () => {
  const unknown = calculate(fish);
  for (const chance of [0, .5, .75, .9, 1]) {
    const result = calculate({...fish, cookingSuccessChance: chance});
    assert.equal(result.status, 'estimated');
    close(result.gatheringFraction, unknown.gatheringFraction);
    close(result.processingXpPerHour.Cooking, unknown.processingXpBoundsPerHour.Cooking.max * chance);
    close(result.processingXpBoundsPerHour.Cooking.min, result.processingXpBoundsPerHour.Cooking.max);
    assert.equal(result.processedResources[0].successSource, 'user-scenario');
    assert.ok(result.assumptions.some(row => row.includes('user scenarios')));
  }
});

test('published conservative no-burn level establishes success without guessed endpoints', () => {
  assert.equal(calculate({...fish, cookingLevel: 49}).processingXpPerHour.Cooking, null);
  const result = calculate({...fish, cookingLevel: 50});
  close(result.processingXpPerHour.Cooking, result.resourcesPerHour * 70);
  assert.equal(result.processedResources[0].successSource, 'published-no-burn-level');
  // Explicit scenarios remain scenarios, even when inconsistent with the no-burn level.
  assert.equal(calculate({...fish, cookingLevel: 50, cookingSuccessChance: .5}).processedResources[0].successSource, 'user-scenario');
});

test('mixed fish use species XP, one gathering fraction and independent success assumptions', () => {
  const input = {...fish, cookingLevel: 25, resources: [{id: 'trout', perHour: 400}, {id: 'salmon', perHour: 200}],
    xpPerHour: 34000, cookingSuccessChance: {trout: .8, salmon: .6}};
  const result = calculate(input);
  close(result.processingSeconds, 48);
  close(result.interfaceSeconds, 2.4);
  close(result.processingXpPerHour.Cooking, (400 * 70 * .8 + 200 * 90 * .6) * result.gatheringFraction);
  for (const row of result.resources) close(row.perHour, input.resources.find(other => row.id === other.id).perHour * result.gatheringFraction);
  const partialUnknown = calculate({...input, cookingSuccessChance: {trout: .8}});
  assert.equal(partialUnknown.processingXpPerHour.Cooking, null);
  close(partialUnknown.processingXpBoundsPerHour.Cooking.min, 400 * 70 * .8 * result.gatheringFraction);
  close(partialUnknown.processingXpBoundsPerHour.Cooking.max, (400 * 70 * .8 + 200 * 90) * result.gatheringFraction);
});

test('unconfirmed facilities and missing personal level never quietly return drop rates', () => {
  for (const confirmedCookingFacility of [undefined, false, 'unknown', 'bonfire', {kind: 'fire'}]) {
    const result = calculate({...fish, confirmedCookingFacility});
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reasonCode, 'missing-facility');
    assert.equal(result.xpPerHour, null);
    assert.equal(result.gatheringFraction, null);
  }
  assert.equal(calculate({...fish, cookingLevel: undefined}).reasonCode, 'missing-level');
  assert.equal(calculate({...fish, confirmedCookingFacility: true}).status, 'bounded');
  assert.equal(calculate({...fish, skill: 'Mining'}).reasonCode, 'unsupported-skill');
});

test('personal recipe level gates apply and mixed eligible catches explicitly drop locked fish raw', () => {
  assert.equal(calculate({...fish, cookingLevel: 14}).reasonCode, 'level-required');
  const result = calculate({...fish, resources: [{id: 'trout', perHour: 400}, {id: 'salmon', perHour: 200}], cookingSuccessChance: 1});
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.skippedResources, [{id: 'salmon', reasonCode: 'level-required'}]);
  close(result.processingSeconds, 20 * (400 / 600) * 2.4);
  close(result.processingXpPerHour.Cooking, 400 * 70 * result.gatheringFraction);
  assert.equal(result.resources.length, 2);
  assert.equal(result.retained, false);
});

test('current F2P recipe tiers include teak and acadia, and exclude yew processing', () => {
  const forLog = (id, fletchingLevel, members = false) => calculate({...logs, resources: [{id, perHour: 600}], fletchingLevel, members});
  assert.equal(forLog('oak', 9).reasonCode, 'level-required');
  assert.equal(forLog('oak', 10).processedResources[0].recipeId, 'oak-shortbow');
  assert.equal(forLog('willow', 20).processedResources[0].xpPerInput, 16.5);
  assert.equal(forLog('maple', 45).processedResources[0].xpPerInput, 46);
  assert.equal(forLog('acadia', 50).processedResources[0].xpPerInput, 50);
  assert.equal(forLog('acadia', 55).processedResources[0].xpPerInput, 58.3);
  assert.equal(forLog('teak', 29).reasonCode, 'level-required');
  assert.equal(forLog('teak', 30).processedResources[0].recipeId, 'teak-shafts');
  assert.equal(forLog('teak', 33).processedResources[0].recipeId, 'teak-stock');
  assert.equal(forLog('yew', 110).reasonCode, 'members-required');
  assert.equal(forLog('yew', 69, true).reasonCode, 'level-required');
  assert.equal(forLog('yew', 70, true).processedResources[0].xpPerInput, 75);
  assert.equal(forLog('yew', 75, true).processedResources[0].xpPerInput, 80);
});

test('shaft batches drop a single output stack and never retain it for a later inventory', () => {
  const result = calculate({...logs, resources: [{id: 'teak', perHour: 600}], fletchingLevel: 30});
  close(result.processingSeconds, 36);
  close(result.droppingSeconds, .6);
  assert.equal(result.processedResources[0].outputQuantity, 30);
  assert.equal(result.processedResources[0].stackable, true);
  assert.equal(result.retained, false);
  close(result.processingXpPerHour.Fletching, result.resourcesPerHour * 11.2);
});

test('unmodelled species and skill combinations remain explicitly unavailable', () => {
  assert.equal(calculate({...fish, resources: [{id: 'dusk-eel', perHour: 100}]}).reasonCode, 'unsupported-resource');
  assert.equal(calculate({...logs, resources: [{id: 'magic', perHour: 100}], members: true}).reasonCode, 'unsupported-resource');
  assert.equal(calculate({...logs, skill: 'Fishing'}).reasonCode, 'unsupported-skill');
});

test('resource order and splitting independent batches do not create XP or input mutation', () => {
  const input = {...fish, cookingLevel: 99, resources: [{id: 'trout', perHour: 400}, {id: 'salmon', perHour: 200}]};
  const before = structuredClone(input), a = calculate(input), b = calculate({...input, resources: [...input.resources].reverse()});
  assert.deepEqual(input, before);
  close(a.xpPerHour, b.xpPerHour);
  close(a.processingXpPerHour.Cooking, b.processingXpPerHour.Cooking);
  close(a.gatheringSeconds + a.handlingSeconds, a.cycleSeconds);
  assert.ok(a.gatheringFraction > 0 && a.gatheringFraction < 1);
  const noHandling = calculate({...input, dropSecondsPerItem: 0, interfaceSecondsPerBatch: 0});
  assert.ok(noHandling.xpPerHour > a.xpPerHour);
  assert.ok(noHandling.xpPerHour < input.xpPerHour);
});

test('malformed inputs fail closed, including duplicate resources and unbounded assumptions', () => {
  for (const input of [null, [], {}, {...fish, xpPerHour: NaN}, {...fish, xpPerHour: -1},
    {...fish, resources: []}, {...fish, resources: [{id: 'trout', perHour: 0}]},
    {...fish, resources: [{id: 'trout', perHour: Infinity}]},
    {...fish, resources: [{id: 'trout', perHour: 1}, {id: 'trout', perHour: 2}]},
    {...fish, cookingLevel: 100}, {...logs, fletchingLevel: 111}, {...fish, members: 'false'},
    {...fish, batchSize: 29}, {...fish, batchSize: 1.5}, {...fish, dropSecondsPerItem: -1},
    {...fish, interfaceSecondsPerBatch: Infinity}, {...fish, cookingSuccessChance: NaN},
    {...fish, cookingSuccessChance: '0.5'}, {...fish, cookingSuccessChance: {trout: 1.01}},
    {...fish, cookingSuccessChance: []}, {...fish, mode: 'bank'},
    {...fish, resources: [{id: 'trout', perHour: Number.MIN_VALUE}]},
    {...fish, dropSecondsPerItem: Number.MAX_VALUE}]) assert.equal(calculate(input), null);
});

test('pinned numerical evidence identifies exact revisions and immutable catalogue scope', () => {
  assert.equal(COOKING_RECIPES.length, 12);
  assert.equal(PROCESSING_SOURCES.find(row => row.title === 'Fletching').oldid, 37194649);
  assert.equal(PROCESSING_SOURCES.find(row => row.title === 'Shaft').oldid, 37171926);
  for (const row of PROCESSING_SOURCES) {
    assert.ok(row.url.endsWith(`oldid=${row.oldid}`));
    assert.match(row.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(row.timestamp)));
    assert.ok(Object.isFrozen(row));
  }
  assert.ok(FLETCHING_RECIPES.filter(row => row.resourceId === 'yew').every(row => row.members));
});
