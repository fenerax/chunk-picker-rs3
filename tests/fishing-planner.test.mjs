import test from 'node:test';
import assert from 'node:assert/strict';
import { planTraining } from '../app/tasks/training-planner.mjs';
import { xpForLevel } from '../app/core/experience.mjs';
import { lookupFishingRate } from '../app/training/fishing-rates.mjs';
import rates from '../app/data/training/fishing-rates.v1.json' with { type: 'json' };
import catalogue from '../app/data/training/methods.f2p.json' with { type: 'json' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const rate = (methodId, fishingLevel) => lookupFishingRate({ methodId, fishingLevel }, rates);
const availability = extra => ({ members: false, access: { objects: ['Fishing spot (lure, bait)'] }, items: ['Fly fishing rod', 'Feather'], ...extra });

test('Fishing sums exact XP gaps level by level and accumulates each mixed species and feathers', () => {
  const currentXp = xpForLevel(30) + 123;
  const plan = planTraining('Fishing', 30, 34, availability({ currentXp }), 'best-xp');
  const route = plan.recommendation, segment = route.segments[0];
  assert.equal(route.complete, true); assert.equal(route.segments.length, 1);
  assert.equal(segment.actions, null); assert.equal(segment.methodId, 'fishing.fly-mixed');
  let hours = 0, fish = 0; const catches = new Map();
  for (let level = 30; level < 34; level++) {
    const r = rate('fly-fishing', level), gap = xpForLevel(level + 1) - (level === 30 ? currentXp : xpForLevel(level));
    const time = gap / r.xpPerHour; hours += time; fish += time * r.fishPerHour;
    for (const species of r.species) catches.set(species.item, (catches.get(species.item) ?? 0) + species.fishPerHour * time);
  }
  close(route.hours, hours); close(segment.fishProduced, fish);
  close(segment.inputs[0].totalQuantity, fish);
  for (const output of segment.outputs) close(output.totalQuantity, catches.get(output.item));
  for (const species of segment.species) close(species.fishProduced, catches.get(species.item));
  close(segment.xpEarned, xpForLevel(34) - currentXp);
  close(segment.xpPerHourStart, rate('fly-fishing', 30).xpPerHour);
  close(segment.xpPerHourEnd, rate('fly-fishing', 33).xpPerHour);
  assert.equal(segment.netGp, null);
});

test('Fishing unlocks salmon and swordfish at the correct levels and never reports dropped stock', () => {
  const fly = planTraining('Fishing', 29, 31, availability(), 'best-xp').recommendation;
  assert.deepEqual(fly.segments.map(segment => segment.species.map(fish => fish.id)), [['trout'], ['salmon', 'trout']]);
  assert.equal(fly.segments[0].outputs.length, 0);
  assert.ok(fly.segments[0].inputs[0].totalQuantity > 0);
  const harpoon = planTraining('Fishing', 49, 51, { members: false, access: { objects: ['Fishing spot (cage, harpoon)'] }, items: ['Harpoon'] }, 'best-xp').recommendation;
  assert.equal(harpoon.complete, true);
  assert.deepEqual(harpoon.segments.map(segment => segment.species.map(fish => fish.id)), [['tuna'], ['swordfish', 'tuna']]);
  assert.ok(harpoon.segments.every(segment => segment.fishing.attemptTicks === 5));
});

test('every Fishing method uses its curve; missing bait remains blocked and level cap99 remains enforced', () => {
  for (const method of catalogue.methods.filter(row => row.skill === 'Fishing')) {
    const one = { ...catalogue, methods: [method] };
    const start = Math.max(1, method.level);
    const names = method.requirements.filter(row => row.kind === 'object').map(row => row.name);
    const items = method.requirements.filter(row => row.kind === 'item').map(row => row.name);
    const plan = planTraining('Fishing', start, start + 1, { catalogue: one, access: { objects: names }, items }, 'best-xp');
    assert.equal(plan.recommendation.complete, true, method.id);
    close(plan.availableMethods[0].xpPerHour, rate(method.fishingCurve.methodId, start).xpPerHour);
    close(plan.availableMethods[0].fishPerHour, rate(method.fishingCurve.methodId, start).fishPerHour);
  }
  const blocked = planTraining('Fishing', 30, 31, availability({ items: ['Fly fishing rod'] }), 'best-xp');
  assert.equal(blocked.recommendation.complete, false);
  assert.ok(blocked.lockedMethods.some(method => method.blockers.some(row => row.name === 'Feather')));
  assert.equal(planTraining('Fishing', 98, 99, availability(), 'best-xp').recommendation.complete, true);
  assert.equal(planTraining('Fishing', 98, 100, availability()).issues[0].code, 'skill-cap');
});

test('locked mixed-species output is known zero until its unlock, then accumulates separately', () => {
  for (const [id, start, locked] of [['fishing.small-net', 14, 'Raw anchovies'], ['fishing.sea-bait', 9, 'Raw herring']]) {
    const method = catalogue.methods.find(row => row.id === id);
    const one = { ...catalogue, methods: [method] };
    const route = planTraining('Fishing', start, start + 2, { catalogue: one,
      access: { objects: method.requirements.filter(row => row.kind === 'object').map(row => row.name) },
      items: method.requirements.filter(row => row.kind === 'item').map(row => row.name) }, 'best-xp').recommendation;
    assert.equal(route.complete, true); assert.equal(route.segments.length, 2);
    assert.equal(route.segments[0].outputs.find(row => row.item === locked).totalQuantity, 0);
    assert.ok(route.segments[1].outputs.find(row => row.item === locked).totalQuantity > 0);
  }
});
