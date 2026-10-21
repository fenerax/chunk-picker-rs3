import test from 'node:test';
import assert from 'node:assert/strict';
import { planTraining, trainingMethodBlockers } from '../app/tasks/training-planner.mjs';
import { buildTrainingAvailability, createTrainingSourceIndex, trainingProgress } from '../app/tasks/training-availability.mjs';
import { xpForLevel } from '../app/core/experience.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { lookupMiningRate as lookupRate } from '../app/training/mining-rates.mjs';
import miningRateCatalogue from '../app/data/training/mining-rates.v1.json' with { type: 'json' };
const lookupMiningRate = options => lookupRate(options, miningRateCatalogue);
import { lookupWoodcuttingRate as lookupWoodcutting } from '../app/training/woodcutting-rates.mjs';
import woodcuttingRateCatalogue from '../app/data/training/woodcutting-rates.v1.json' with { type: 'json' };
const woodcuttingRate = options => lookupWoodcutting(options, woodcuttingRateCatalogue);
const woodcuttingAvailability = extras => ({ members: false, access: { objects: ['Willow'] }, items: ['Bronze hatchet'], ...extras });

test('Woodcutting integrates exact XP at every level and upgrades the assumed hatchet', () => {
  const currentXp = xpForLevel(29) + 20;
  const route = planTraining('Woodcutting', 29, 33, woodcuttingAvailability({ currentXp }), 'best-xp').recommendation;
  let hours = 0, logs = 0;
  for (let level = 29; level < 33; level++) {
    const rate = woodcuttingRate({ treeId: 'willow', woodcuttingLevel: level });
    const gap = xpForLevel(level + 1) - (level === 29 ? currentXp : xpForLevel(level));
    hours += gap / rate.xpPerHour; logs += gap / 67.5;
  }
  assert.equal(route.complete, true);
  assert.ok(Math.abs(route.hours - hours) < 1e-12);
  assert.deepEqual(route.segments.map(segment => segment.woodcutting.hatchetId), ['black', 'mithril']);
  assert.ok(Math.abs(route.segments.reduce((sum, segment) => sum + segment.logsProduced, 0) - logs) < 1e-8);
  for (const segment of route.segments) {
    assert.equal(segment.actions, null);
    assert.equal(segment.xpPerAction, 67.5);
    assert.ok(Math.abs(segment.outputs[0].totalQuantity - segment.logsProduced) < 1e-8);
    assert.ok(Math.abs(segment.netGp - segment.logsProduced * 1023) < 1e-6);
  }
  assert.ok(route.segments.at(-1).xpPerHourEnd > route.segments.at(-1).xpPerHourStart);
  const bronze = planTraining('Woodcutting', 29, 33, woodcuttingAvailability({ currentXp, woodcuttingHatchet: 'bronze' }), 'best-xp');
  assert.equal(bronze.recommendation.segments.length, 1);
  assert.ok(bronze.recommendation.hours > route.hours);
});

test('Woodcutting tool requirements fail closed and cap110 retains its curve', () => {
  assert.throws(() => planTraining('Woodcutting', 20, 21, woodcuttingAvailability({ woodcuttingHatchet: 'dragon' })), /hatchet/);
  assert.throws(() => planTraining('Woodcutting', null, 21, { woodcuttingHatchet: 'dragon' }), /hatchet/);
  assert.throws(() => planTraining('Woodcutting', 20, 21, woodcuttingAvailability({ woodcuttingHatchet: 'rune' }), 'best-xp'), /Rune hatchet requires Woodcutting 50.*Best for my level/);
  const high = planTraining('Woodcutting', 109, 110, woodcuttingAvailability(), 'best-xp');
  assert.equal(high.recommendation.complete, true);
  assert.equal(high.recommendation.segments[0].woodcutting.hatchetId, 'rune');
  assert.deepEqual(planTraining('Smithing', 10, 11, availability()), planTraining('Smithing', 10, 11, availability({ woodcuttingHatchet: 'rune' })));
});

const miningAvailability = extras => ({ members: false, access: { objects: ['Copper rock'] },
  items: ['Bronze pickaxe', 'Iron pickaxe'], skills: { Strength: 40 }, ...extras });

test('Mining time integrates each level and assumes the best level-eligible F2P tool', () => {
  const plan = planTraining('Mining', 8, 13, miningAvailability(), 'best-xp');
  const route = plan.recommendation;
  let hours = 0;
  for (let level = 8; level < 13; level++) {
    const rate = lookupMiningRate({ rockId: 'copper', miningLevel: level, strengthLevel: 40, pickaxeId: level < 10 ? 'bronze' : 'iron+1' });
    hours += (xpForLevel(level + 1) - xpForLevel(level)) / rate.xpPerHour;
  }
  assert.ok(Math.abs(route.hours - hours) < 1e-12);
  assert.deepEqual(route.segments.map(segment => segment.mining.pickaxeId), ['bronze', 'iron+1']);
  assert.match(route.segments[1].modelAssumptions.join(' '), /ownership and acquisition are not confirmed/);
  for (const segment of route.segments) {
    assert.equal(segment.actions, null);
    assert.equal(segment.xpPerAction, null);
    assert.equal(segment.outputs[0].totalQuantity, null);
    assert.equal(segment.netGp, null);
    assert.ok(segment.orePerHour > 0 && segment.xpPerOre > 0);
    assert.ok(segment.xpPerHourEnd > segment.xpPerHourStart);
  }
  const bronze = planTraining('Mining', 8, 13, miningAvailability({ miningPickaxe: 'bronze' }), 'best-xp');
  assert.equal(bronze.recommendation.segments.length, 1);
  assert.equal(bronze.recommendation.segments[0].mining.pickaxeId, 'bronze');
  assert.ok(bronze.recommendation.hours > route.hours);
});

test('Mining attention and saved Strength influence rates; unknown Strength is labelled conservative', () => {
  const active = planTraining('Mining', 20, 21, miningAvailability(), 'best-xp');
  const afk = planTraining('Mining', 20, 21, miningAvailability({ miningAttention: 'afk' }), 'best-xp');
  assert.ok(afk.recommendation.hours > active.recommendation.hours);
  const unknown = planTraining('Mining', 20, 21, miningAvailability({ skills: {} }), 'best-xp');
  assert.equal(unknown.recommendation.segments[0].mining.strengthLevel, 1);
  assert.equal(unknown.recommendation.segments[0].mining.strengthSource, 'conservative-default');
  assert.match(unknown.recommendation.segments[0].modelAssumptions.join(' '), /Strength is unknown/);
  assert.ok(unknown.recommendation.hours > active.recommendation.hours);
  assert.throws(() => planTraining('Mining', 20, 21, miningAvailability({ miningPickaxe: 'dragon' })), /pickaxe/);
  assert.throws(() => planTraining('Mining', 20, 21, miningAvailability({ miningAttention: 'perfect' })), /attention/);
  const locked = planTraining('Mining', 20, 21, miningAvailability({ miningPickaxe: 'rune' }), 'best-xp');
  assert.equal(locked.recommendation.status, 'unavailable');
  assert.equal(locked.recommendation.issues[0].code, 'unknown-rate');
  const allowed = planTraining('Mining', 50, 51, miningAvailability({ miningPickaxe: 'rune' }), 'best-xp');
  assert.equal(allowed.recommendation.segments[0].mining.pickaxeId, 'rune');
});

test('Mining partial XP integrates only the remainder and leaves other skills unchanged', () => {
  const currentXp = xpForLevel(15) + 20;
  const plan = planTraining('Mining', 15, 16, miningAvailability({ currentXp }), 'best-xp');
  const rate = lookupMiningRate({ rockId: 'copper', miningLevel: 15, strengthLevel: 40, pickaxeId: 'iron+1' });
  assert.ok(Math.abs(plan.recommendation.hours - (xpForLevel(16) - currentXp) / rate.xpPerHour) < 1e-12);
  assert.deepEqual(planTraining('Smithing', 10, 11, availability()),
    planTraining('Smithing', 10, 11, availability({ miningPickaxe: 'rune', miningAttention: 'afk' })));
});

test('Mining keeps the existing F2P 110 target and Strength 120, with separate expected ore totals', () => {
  const plan = planTraining('Mining', 104, 106, miningAvailability({ access: { objects: ['Runite rock'] }, skills: { Strength: 120 } }), 'best-xp');
  assert.equal(plan.recommendation.complete, true);
  let hours = 0, ore = 0;
  for (const level of [104, 105]) {
    const rate = lookupMiningRate({ rockId: 'runite', miningLevel: level, strengthLevel: 120, pickaxeId: 'rune+3' });
    const duration = (xpForLevel(level + 1) - xpForLevel(level)) / rate.xpPerHour;
    hours += duration; ore += duration * rate.orePerHour;
  }
  const segment = plan.recommendation.segments[0];
  assert.equal(segment.mining.strengthLevel, 120);
  assert.ok(Math.abs(segment.hours - hours) < 1e-12);
  assert.ok(Math.abs(segment.oreProduced - ore) < 1e-8);
  assert.ok(segment.xpPerHourEnd > segment.xpPerHourStart);
  assert.equal(planTraining('Mining', 109, 110, miningAvailability(), 'best-xp').recommendation.complete, true);
});

const method = (id, level, xpPerHour, gpPerAction, extras = {}) => ({ id, skill: 'Smithing', label: id, level, maxLevel: 99,
  members: false, xpPerAction: 10, xpPerHour, matches: [], requirements: [{ kind: 'object', name: 'Anvil' }],
  inputs: [], outputs: [], economics: { gpPerAction, priceDate: '2026-10-07' }, sourceIds: ['fixture'], ...extras });
const catalogue = { version: 'fixture-v1', methods: [method('cheap', 1, 1000, 0), method('fast', 1, 5000, -100), method('profit', 1, 500, 20), method('upgrade', 10, 10000, -50)], sources: [{ id: 'fixture', url: 'https://runescape.wiki/w/Smithing' }] };
const availability = extras => ({ members: false, access: { bases: ['100'], objects: ['Anvil'] }, items: [], catalogue, ...extras });

test('preferences compare XP, cheap methods and GP; sequences switch at level boundaries', () => {
  const plan = planTraining('Smithing', 1, 12, availability());
  assert.equal(plan.plans['best-xp'].segments[0].methodId, 'fast');
  assert.ok(plan.plans['best-xp'].segments.some(segment => segment.methodId === 'upgrade'));
  assert.ok(plan.plans.balanced.segments.every(segment => segment.methodId === 'cheap'));
  assert.ok(plan.plans['money-making'].segments.every(segment => segment.methodId === 'profit'));
  assert.ok(plan.plans['best-xp'].netGp < 0);
  assert.ok(plan.plans['money-making'].netGp > 0);
  assert.equal(plan.xpNeeded, xpForLevel(12));
  for (const value of Object.values(plan.plans)) assert.ok(value.complete && value.hours > 0 && value.xpRemaining === 0);
});

test('nothing available reports unavailable rather than assuming universal facilities', () => {
  const plan = planTraining('Smithing', 1, 12, availability({ access: { objects: [] } }));
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.plans['best-xp'].hours, null);
  assert.equal(plan.plans['best-xp'].issues[0].code, 'nothing-available');
  assert.equal(plan.lockedMethods.length, 4);
});

test('better methods report the exact missing source chunk and item without using them', () => {
  const data = { ...catalogue, methods: [method('cheap', 1, 1000, 0, { requirements: [] }), method('locked', 1, 9000, 30,
    { requirements: [{ kind: 'object', name: 'Forge' }], inputs: [{ item: 'Iron ore', quantity: 2 }] })] };
  const plan = planTraining('Smithing', 1, 5, availability({ catalogue: data, sourceLocations: {
    'object:Forge': [{ chunkId: '102', label: 'Varrock', locationId: '102-1' }], 'item:Iron ore': [{ chunkId: '103', label: 'Mine', locationId: '103' }],
  } }));
  assert.equal(plan.plans['best-xp'].segments[0].methodId, 'cheap');
  const locked = plan.lockedMethods[0];
  assert.ok(locked.betterFor.includes('best-xp'));
  assert.equal(locked.blockers[0].locations[0].chunkId, '102');
  assert.equal(locked.blockers[1].name, 'Iron ore');
  const open = planTraining('Smithing', 1, 5, availability({ catalogue: data, access: { objects: ['Forge'] }, items: ['Iron ore'] }));
  assert.equal(open.plans['best-xp'].segments[0].methodId, 'locked');
  assert.equal(open.plans['best-xp'].segments[0].inputs[0].totalQuantity, open.plans['best-xp'].segments[0].actions * 2);
});

test('selectors require exact sections, known aliases, membership and personal quest completion', () => {
  const value = { ...catalogue.methods[0], requirements: [{ kind: 'chunk', id: '100-1' }, { kind: 'item', name: 'Tool[+]' }, { kind: 'quest', name: 'Quest' }] };
  assert.equal(trainingMethodBlockers(value, availability()).length, 3);
  assert.deepEqual(trainingMethodBlockers(value, availability({ access: { sections: ['100-1'] }, items: ['Hammer'], aliases: { item: { 'Tool[+]': ['Hammer', 'Chisel'] } }, completedQuests: ['Quest'] })), []);
  assert.equal(trainingMethodBlockers({ ...value, members: true, requirements: [] }, availability())[0].kind, 'membership');
  assert.equal(trainingMethodBlockers({ ...value, requirements: [{ anyOf: [{ kind: 'object', name: 'Anvil' }, { kind: 'object', name: 'Forge' }] }] }, availability()).length, 0);
  assert.equal(trainingMethodBlockers({ ...value, requirements: [], requiredSkills: { Mining: 10 } }, availability({ skills: { Mining: 9 } }))[0].kind, 'skill');
  assert.equal(trainingMethodBlockers({ ...value, requirements: [{ kind: 'assignment', name: 'Cow' }] }, availability())[0].kind, 'unsupported-selector');
});

test('partial XP, whole action rounding and selected preference are preserved without mutation', () => {
  const data = availability({ currentXp: xpForLevel(10) + 20 }), before = structuredClone(data);
  const plan = planTraining('Smithing', 10, 11, data, 'best-xp');
  assert.equal(plan.xpNeeded, xpForLevel(11) - xpForLevel(10) - 20);
  assert.equal(plan.recommendation, plan.plans['best-xp']);
  assert.deepEqual(data, before);
  const done = planTraining('Smithing', 10, 9, data);
  assert.equal(done.xpNeeded, 0); assert.equal(done.plans['best-xp'].hours, 0); assert.deepEqual(done.plans.balanced.segments, []);
});

test('unknown level, invalid XP, F2P caps and unsupported Invention are explicit', () => {
  assert.equal(planTraining('Smithing', null, 10, availability()).status, 'unknown-level');
  assert.throws(() => planTraining('Smithing', 10, 11, availability({ currentXp: 0 })), /within the starting level/);
  assert.equal(planTraining('Construction', 1, 21, availability()).issues[0].code, 'skill-cap');
  assert.equal(planTraining('Invention', 1, 5, availability()).status, 'unavailable');
  assert.throws(() => planTraining('Unknown', 1, 10));
  assert.throws(() => planTraining('Smithing', 1, 121));
  assert.equal(planTraining('Cooking', 99, 99, availability({ currentXp: xpForLevel(100) })).xpNeeded, 0);
});

test('unknown rates/economics remain unknown and variable XP actions are not invented', () => {
  const value = method('hourly', 1, 2000, null, { xpPerAction: null, outputs: [{ item: 'Ore', quantity: null }] });
  const plan = planTraining('Smithing', 1, 5, availability({ catalogue: { ...catalogue, methods: [value] } }));
  assert.equal(plan.plans['best-xp'].status, 'partial');
  assert.equal(plan.plans['best-xp'].netGp, null);
  assert.equal(plan.plans.balanced.status, 'unavailable');
  assert.equal(plan.plans['best-xp'].segments[0].actions, null);
  assert.equal(plan.plans['best-xp'].segments[0].outputs[0].totalQuantity, null);
  const unpriced = planTraining('Smithing', 1, 5, availability({ catalogue: { ...catalogue, methods: [{ ...value, xpPerHour: null }] } }));
  assert.equal(unpriced.plans['best-xp'].issues[0].code, 'unknown-rate');
});

test('method range ending before the target produces an incomplete route', () => {
  const data = { ...catalogue, methods: [method('limited', 1, 1000, 0, { maxLevel: 3 })] };
  const plan = planTraining('Smithing', 1, 6, availability({ catalogue: data }));
  assert.equal(plan.plans['best-xp'].status, 'incomplete');
  assert.ok(plan.plans['best-xp'].xpRemaining > 0);
});

test('current account RuneMetrics observation is used; capability declarations and partner levels are not', () => {
  const member = { runescapeName: 'Test', skillProgress: { Smithing: { level: 10, xp: xpForLevel(10) + 10, source: 'runemetrics', runescapeName: 'test', fetchedAt: '2026-10-08T12:00:00Z' } }, passiveLevels: { Mining: 99 } };
  assert.equal(trainingProgress(member, 'Smithing').level, 10);
  assert.equal(trainingProgress(member, 'Mining').level, null);
  assert.equal(trainingProgress({ ...member, runescapeName: 'Other' }, 'Smithing').level, null);
  assert.deepEqual(trainingProgress(member, 'Smithing', 2), { level: 2, xp: null, source: 'manual', fetchedAt: null });
});

test('availability consumes engine access and item results; source index preserves locked section locations', () => {
  const definitions = { chunks: { '100': { Object: { Anvil: true } }, '102': { Nickname: 'Varrock', Sections: { 1: { Object: { Forge: true }, Shop: { Wares: true } } } } }, shopItems: { Wares: { 'Iron ore': true } } };
  const locations = createTrainingSourceIndex(definitions);
  assert.equal(locations['object:Forge'][0].locationId, '102-1');
  assert.equal(locations['item:Iron ore'][0].chunkId, '102');
  assert.equal(locations['chunk:102'][0].locationId, '102-1');
  const state = createGroupState([{ id: 'm', name: 'Fixture' }]);
  const available = buildTrainingAvailability({ access: { objects: ['Anvil'] }, items: [{ name: 'Hammer' }], training: { Smithing: { level: 99 } } }, { state, memberId: 'm', definitions, sourceLocations: locations });
  assert.deepEqual(available.skills, {});
  assert.equal(available.members, false);
  assert.deepEqual(available.items, [{ name: 'Hammer' }]);
});

test('quest steps only satisfy their task selector; whole quest requirements stay locked', () => {
  const state = createGroupState([{ id: 'm', name: 'Fixture' }]);
  const completedStep = { id: 'step', category: 'Quest', label: 'Quest step 1', personalCompleted: true, record: { BaseQuest: 'Quest' } };
  const available = buildTrainingAvailability({ tasks: [completedStep] }, { state, memberId: 'm' });
  assert.ok(!available.completedQuests.includes('Quest'));
  const value = method('quest-method', 1, 1000, 0, { requirements: [{ kind: 'quest', name: 'Quest' }] });
  assert.equal(trainingMethodBlockers(value, available)[0].kind, 'quest');
  assert.deepEqual(trainingMethodBlockers({ ...value, requirements: [{ kind: 'task', name: 'Quest step 1', category: 'Quest' }] }, available), []);
  const whole = buildTrainingAvailability({ tasks: [{ ...completedStep, label: 'Quest', record: { BaseQuest: 'Quest', QuestPoints: 0 } }] }, { state, memberId: 'm' });
  assert.deepEqual(trainingMethodBlockers(value, whole), []);
});

test('per-action economics stay consistent if a redundant hourly estimate is supplied', () => {
  const value = method('coherent', 1, 1000, 1);
  value.economics.gpPerHour = 2000;
  const plan = planTraining('Smithing', 1, 5, availability({ catalogue: { ...catalogue, methods: [value] } }));
  const segment = plan.plans['best-xp'].segments[0];
  assert.equal(segment.gpPerHour, 100);
  assert.ok(Math.abs(segment.netGp / segment.hours - segment.gpPerHour) < 1e-10);
});

test('future methods unlock as the trained skill reaches its own prerequisite', () => {
  const data = { ...catalogue, methods: [method('start', 1, 1000, 0), method('future', 1, 10000, 10, { requiredSkills: { Smithing: 10 } })] };
  const plan = planTraining('Smithing', 1, 11, availability({ catalogue: data, skills: { Smithing: 1 } }));
  assert.deepEqual(plan.plans['best-xp'].segments.map(segment => segment.methodId), ['start', 'future']);
});

test('quest completions from an old named account do not survive through completed task IDs', () => {
  const state = createGroupState([{ id: 'm', name: 'Fixture' }]);
  state.members[0].runescapeName = 'New';
  state.members[0].questProgress = { q: { source: 'runemetrics', runescapeName: 'Old', title: 'Quest' } };
  const result = { tasks: [{ id: 'q', category: 'Quest', label: 'Quest', personalCompleted: true, record: { BaseQuest: 'Quest', QuestPoints: 1 } }] };
  const available = buildTrainingAvailability(result, { state, memberId: 'm' });
  assert.deepEqual(available.completedQuests, []);
  assert.deepEqual(available.completedTasks, []);
});

test('unknown locked economics never promise a better balanced or money-making route', () => {
  const data = { ...catalogue, methods: [method('unknown-price', 1, 9000, null)] };
  const plan = planTraining('Smithing', 1, 5, availability({ catalogue: data, access: { objects: [] } }));
  assert.deepEqual(plan.lockedMethods[0].betterFor, ['best-xp']);
});
