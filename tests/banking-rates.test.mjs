import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateBankingRates, boxCapacity, ORE_BOX_TIERS, WOOD_BOX_TIERS} from '../app/training/banking-rates.mjs';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const mining = overrides => calculateBankingRates({skill: 'Mining', level: 60, xpPerHour: 10000,
  resources: [{id: 'iron', item: 'Iron ore', perHour: 1000}], route: {kind: 'bank', tileSteps: 100}, ...overrides});

test('walking includes both legs and independently scales Mining XP and ore', () => {
  const result = mining();
  close(result.bank.travelSeconds, 120);
  close(result.bank.gatheringSeconds, 100.8);
  close(result.bank.cycleSeconds, 223.8);
  close(result.bank.xpPerHour, 10000 * 100.8 / 223.8);
  close(result.bank.resourcesPerHour, 1000 * 100.8 / 223.8);
  assert.equal(result.bank.resources[0].item, 'Iron ore');
  close(result.bank.resources[0].perHour, result.bank.resourcesPerHour);
  assert.equal(result.drop.xpPerHour, 10000);
  assert.equal(result.drop.resourcesPerHour, 1000);
  assert.equal(result.drop.retainedResourcesPerHour, 0);
  assert.equal(result.running, null);
});

test('each ore type gets its own capacity while mixed excess shares backpack slots', () => {
  const equal = mining({level: 1, resources: [{id: 'copper', perHour: 500}, {id: 'tin', perHour: 500}], settings: {oreBox: 'bronze'}});
  assert.equal(equal.inventory.backpackSlots, 27);
  close(equal.inventory.capacity, 227);
  assert.deepEqual(equal.inventory.boxCapacityByResource, {copper: 100, tin: 100});
  assert.equal(equal.inventory.boxFillsPerTrip, 8);
  const mixed = mining({level: 1, resources: [{id: 'copper', perHour: 900}, {id: 'tin', perHour: 100}], settings: {oreBox: 'bronze'}});
  // Copper's 100 box slots + 27 backpack slots fill after 508 seconds,
  // while tin has only gathered 14.111 items and leaves most of its box unused.
  close(mixed.bank.gatheringSeconds, 508);
  close(mixed.inventory.capacity, 127 + 508 / 36);
  const noBox = mining({resources: [{id: 'copper', perHour: 500}, {id: 'tin', perHour: 500}]});
  assert.equal(noBox.inventory.capacity, 28);
});

test('ore tiers include lower tiers and apply per-material milestones, excluding achievement capacity', () => {
  for (const [id, tier, milestone] of [
    ['copper', 'bronze', 7], ['tin', 'bronze', 7], ['iron', 'iron', 18], ['coal', 'steel', 29],
    ['mithril', 'mithril', 37], ['adamantite', 'adamant', 41], ['luminite', 'adamant', 41], ['runite', 'rune', 55],
  ]) {
    assert.equal(boxCapacity({skill: 'Mining', level: milestone - 1, resourceId: id, oreBox: tier}), 100);
    assert.equal(boxCapacity({skill: 'Mining', level: milestone, resourceId: id, oreBox: tier}), 120);
    assert.equal(boxCapacity({skill: 'Mining', level: 110, resourceId: id, oreBox: 'rune'}), 120);
    const previous = ORE_BOX_TIERS[ORE_BOX_TIERS.indexOf(tier) - 1];
    assert.equal(boxCapacity({skill: 'Mining', level: 110, resourceId: id, oreBox: previous}), 0);
  }
  assert.equal(boxCapacity({skill: 'Mining', level: 110, resourceId: 'silver', oreBox: 'rune'}), 100);
  assert.equal(boxCapacity({skill: 'Mining', level: 110, resourceId: 'gold', oreBox: 'rune'}), 100);
});

test('wood box capacity uses owned tier and Woodcutting milestones; acadia never stores yew', () => {
  for (const [index, id] of ['normal', 'oak', 'willow', 'teak', 'maple', 'acadia'].entries()) {
    const woodBox = WOOD_BOX_TIERS[index + 1], base = 70 + index * 10;
    assert.equal(boxCapacity({skill: 'Woodcutting', level: 1, resourceId: id, woodBox}), base);
    assert.equal(boxCapacity({skill: 'Woodcutting', level: 4, resourceId: id, woodBox}), base);
    assert.equal(boxCapacity({skill: 'Woodcutting', level: 5, resourceId: id, woodBox}), base + 10);
    assert.equal(boxCapacity({skill: 'Woodcutting', level: 14, resourceId: id, woodBox}), base + 10);
    assert.equal(boxCapacity({skill: 'Woodcutting', level: 15, resourceId: id, woodBox}), base + 20);
  }
  assert.equal(boxCapacity({skill: 'Woodcutting', level: 75, resourceId: 'acadia', woodBox: 'acadia'}), 200);
  assert.equal(boxCapacity({skill: 'Woodcutting', level: 105, resourceId: 'acadia', woodBox: 'acadia'}), 230);
  assert.equal(boxCapacity({skill: 'Woodcutting', level: 110, resourceId: 'acadia', woodBox: 'acadia'}), 230);
  assert.equal(boxCapacity({skill: 'Woodcutting', level: 75, resourceId: 'yew', woodBox: 'acadia'}), 0);
  const yew = calculateBankingRates({skill: 'Woodcutting', level: 75, xpPerHour: 1000,
    resources: [{id: 'yew', perHour: 100}], route: {kind: 'deposit', tileSteps: 10}, settings: {woodBox: 'acadia'}});
  assert.equal(yew.inventory.capacity, 27);
  assert.equal(yew.inventory.boxFillsPerTrip, 0);
});

test('ownership is never inferred; duplicate boxes cannot multiply capacity', () => {
  assert.equal(mining({settings: {obtainableItems: ['Rune ore box']}}).inventory.capacity, 28);
  assert.equal(mining({settings: {oreBox: 'rune', oreBoxCount: 2}}).inventory.capacity, 147);
  assert.equal(mining({settings: {oreBox: ['rune', 'rune']}}), null);
  assert.equal(mining({settings: {oreBox: 'rune', reservedSlots: 1}}).inventory.capacity, 146);
});

test('owned bronze box reserves exactly one backpack slot at the copper milestone', () => {
  const result = mining({level: 7, resources: [{id: 'copper', perHour: 1000}], settings: {oreBox: 'bronze'}});
  assert.equal(result.inventory.backpackSlots, 27);
  assert.equal(result.inventory.boxCapacityByResource.copper, 120);
  assert.equal(result.inventory.capacity, 147);
  assert.equal(result.drop.capacity, 27);
});

test('mixed Fishing reserves one bait stack, not a slot for each species', () => {
  const fish = calculateBankingRates({skill: 'Fishing', level: 50, xpPerHour: 50000,
    resources: [{id: 'trout', perHour: 700}, {id: 'salmon', perHour: 500}], route: {kind: 'bank', tileSteps: 20}});
  assert.equal(fish.inventory.capacity, 27);
  assert.equal(fish.inventory.baitSlot, 1);
  close(fish.bank.gatheringSeconds, 81);
  close(fish.bank.resources[0].perHour / fish.bank.resources[1].perHour, 1.4);
  assert.equal(fish.drop.capacity, 27);
});

test('Stiles retains noted stacks on subsequent trips and rejects unsupported fish', () => {
  const input = {skill: 'Fishing', level: 60, xpPerHour: 30000,
    resources: [{id: 'tuna', perHour: 300}, {id: 'swordfish', perHour: 200}], route: {kind: 'stiles', tileSteps: 50}};
  const result = calculateBankingRates(input);
  assert.equal(result.inventory.noteSlots, 2);
  assert.equal(result.inventory.capacity, 26);
  assert.equal(result.drop.capacity, 28);
  assert.equal(result.bank.retainedResourcesPerHour, result.bank.resourcesPerHour);
  close(result.bank.gatheringSeconds, 26 * 3600 / 500);
  const lobster = calculateBankingRates({...input, resources: [{id: 'lobster', perHour: 300}]});
  assert.equal(lobster.inventory.noteSlots, 1);
  assert.equal(lobster.inventory.capacity, 27);
  assert.equal(calculateBankingRates({...input, resources: [{id: 'trout', perHour: 300}]}).bank, null);
});

test('drop handling is explicit; boxes help retain resources at a handling cost', () => {
  const dropped = mining({settings: {dropSecondsPerItem: .6}});
  close(dropped.drop.cycleSeconds, 100.8 + 16.8);
  close(dropped.drop.gatheringFraction, 6 / 7);
  const boxed = mining({settings: {oreBox: 'rune', boxFillSeconds: 2, boxEmptySeconds: 4, bankSeconds: 5}});
  assert.equal(boxed.inventory.capacity, 147);
  assert.equal(boxed.drop.capacity, 27);
  assert.equal(boxed.drop.resourcesPerHour, 1000);
  assert.equal(boxed.inventory.boxFillsPerTrip, 5);
  assert.equal(boxed.bank.boxHandlingSeconds, 10);
  assert.equal(boxed.bank.destinationSeconds, 9);
  assert.ok(boxed.bank.xpPerHour > mining().bank.xpPerHour);
});

test('running carries energy across complete cycles and does not reset full each trip', () => {
  const result = mining({resources: [{id: 'iron', perHour: 28000}], settings: {travelMode: 'run', bankSeconds: 0,
    energy: {initialPercent: 100, drainPercentPerRunTick: 1, regenPercentPerSecond: 0}}});
  assert.equal(result.running.energy.firstCycle.travelSeconds, 60);
  assert.equal(result.running.energy.firstCycle.endEnergyPercent, 0);
  assert.equal(result.running.travelSeconds, 120);
  assert.equal(result.running.energy.startEnergyPercent, 0);
  assert.equal(result.running.runSteps, 0);
  close(result.running.xpPerHour, result.bank.xpPerHour);
  assert.equal(result.running.energy.converged, true);
});

test('gathering recovery can sustain running; partial recovery is carried rather than discarded', () => {
  const energy = {initialPercent: 0, drainPercentPerRunTick: 1, regenPercentPerSecond: 1};
  const slow = mining({resources: [{id: 'iron', perHour: 280}], settings: {travelMode: 'run', bankSeconds: 0, energy}});
  assert.equal(slow.running.travelSeconds, 60);
  assert.equal(slow.running.energy.firstCycle.startEnergyPercent, 0);
  assert.equal(slow.running.energy.firstCycle.endEnergyPercent, 0);
  assert.ok(slow.running.xpPerHour > slow.bank.xpPerHour);
  const fast = mining({resources: [{id: 'iron', perHour: 28000}], settings: {travelMode: 'run', bankSeconds: 0,
    energy: {...energy, initialPercent: 100, regenPercentPerSecond: .1}}});
  assert.ok(fast.running.travelSeconds > 60);
  assert.ok(fast.running.travelSeconds < 120);
  assert.ok(fast.running.energy.endEnergyPercent > 0);
  assert.ok(fast.running.energy.endEnergyPercent < 100);
  assert.ok(fast.assumptions.some(row => row.includes('never reset')));
});

test('destination/box handling recovers energy and odd-length legs count whole ticks', () => {
  const result = mining({route: {kind: 'bank', tileSteps: 3}, settings: {travelMode: 'run', bankSeconds: 0,
    energy: {initialPercent: 100, drainPercentPerRunTick: .7, regenPercentPerSecond: 1}}});
  close(result.running.travelSeconds, 2.4);
  close(result.bank.travelSeconds, 3.6);
  const handled = mining({resources: [{id: 'iron', perHour: 28000}], settings: {travelMode: 'run', bankSeconds: 100,
    energy: {initialPercent: 0, drainPercentPerRunTick: 1, regenPercentPerSecond: 1}}});
  assert.ok(handled.running.energy.firstCycle.runSteps >= 100);
});

test('no verified route still supplies drop; zero-distance route retains bank handling', () => {
  const missing = mining({route: null});
  assert.equal(missing.bank, null);
  assert.equal(missing.drop.xpPerHour, 10000);
  const adjacent = mining({route: {kind: 'deposit', tileSteps: 0}});
  assert.equal(adjacent.bank.travelSeconds, 0);
  assert.equal(adjacent.bank.handlingSeconds, 3);
  assert.ok(adjacent.bank.xpPerHour < adjacent.drop.xpPerHour);
});

test('malformed inputs fail closed rather than returning infinite or fabricated rates', () => {
  for (const patch of [
    {xpPerHour: Infinity}, {xpPerHour: NaN}, {xpPerHour: -1}, {xpPerHour: '100'},
    {skill: 'Cooking'}, {level: 0}, {level: 111}, {level: 1.5}, {resources: []},
    {resources: [{id: 'iron', perHour: 0}]}, {resources: [{id: 'iron', perHour: Infinity}]},
    {resources: [{id: 'iron', perHour: -1}]}, {resources: [{id: 'iron', perHour: 10}, {id: 'iron', perHour: 20}]},
    {route: {kind: 'bank', tileSteps: -1}}, {route: {kind: 'bank', tileSteps: .5}},
    {route: {kind: 'teleport', tileSteps: 1}}, {settings: []}, {settings: {backpackSlots: 29}},
    {settings: {reservedSlots: 28}}, {settings: {bankSeconds: -1}}, {settings: {oreBox: 'auto'}},
    {settings: {dropSecondsPerItem: 1e308}}, {resources: [{id: 'iron', perHour: 1e-320}]},
    {settings: {oreBox: 'rune', boxFillSeconds: 1e308}},
    {settings: {travelMode: 'run'}}, {settings: {travelMode: 'run', energy: {initialPercent: 100, drainPercentPerRunTick: 0, regenPercentPerSecond: .8}}},
  ]) assert.equal(mining(patch), null, JSON.stringify(patch));
  assert.equal(calculateBankingRates(null), null);
  assert.equal(calculateBankingRates({}), null);
  assert.equal(boxCapacity({skill: 'Mining', level: 1, resourceId: 'iron', oreBox: 'dragon'}), null);
});
