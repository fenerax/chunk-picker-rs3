import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { EARLY_TRAVEL_UNLOCKS_RULE as early, travelRewardKind, nexusDestinationClauses } from '../app/data/travel-reward-gates.mjs';
import { taskRuleDefault } from '../app/tasks/rule-defaults.mjs';
import { taskRuleDefinitions, taskRuleValueError, taskRuleBehavior } from '../app/data/settings.mjs';
import { rulesCatalogue, buildRulesSections, taskRuleValue, planTaskRuleChange } from '../app/web/rules-model.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';

const balloon = 'Unlock the ~|balloon transport system|~ route to the Crafting Guild';
const flight = 'Use the ~|Balloon transport system|~ to travel to the Crafting Guild';
const attune = 'Unlock the ability to attune the ~|Max Guild portal|~ to the Ranch out of Time';
const nexus = 'Unlock all teleports in a ~|portal nexus|~';
const upgrades = 'Unlock all three ~|dwarf multicannon|~ upgrades';
const gold = "(Artisans' Workshop) Obtain the ~|gold dwarf multicannon|~";
const royale = "(Artisans' Workshop) Obtain the ~|royale cannon|~";
const kit = '(Senntisten) Obtain a ~|dwarf multicannon upgrade kit|~';
const build = 'Construct a ~|test furniture|~';
const plan = '(Furniture Plans) Unlock ~|furniture plans: Test furniture|~';
const extra = { Category: ['Permanent Unlockables'] };
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false,
  cacheShops: false, retainedTaskCorrections: false, retainedUnsupportedCorrections: false };
function fixture() {
  return { chunks: {
    100: { Shop: { Rewards: true }, Spawn: { Material: true, 'Furniture plans: Test furniture': true,
      'Dwarf multicannon upgrade kit': true } },
    200: {}, 300: {}, 11060: { NPC: { Auguste: true } }, 9011: {}, 14659: {},
  }, shopItems: { Rewards: { 'Gold dwarf multicannon': true, 'Royale cannon': true } }, challenges: { Extra: {
    [balloon]: { ...extra, Chunks: ['200'], Tasks: { [flight]: 'Firemaking' } },
    [attune]: { ...extra, Shops: ['Rewards'] }, [nexus]: { ...extra },
    [upgrades]: { ...extra, Shops: ['Rewards'] },
    [gold]: { Items: ['Gold dwarf multicannon'] }, [royale]: { Items: ['Royale cannon'] },
    [kit]: { Items: ['Dwarf multicannon upgrade kit'] }, [plan]: { Items: ['Furniture plans: Test furniture'] },
    'Unlock an unmapped portal': { ...extra, Shops: ['Rewards'] },
    'Unlock the ability to make ~|ancient teleport tablets|~': { ...extra, Shops: ['Rewards'] },
  }, Firemaking: { [flight]: { Chunks: ['200'], NPCs: ['Auguste'], Items: ['Material'], Level: 30 } },
  Construction: { [build]: { Items: ['Material', 'Furniture plans: Test furniture'], Objects: ['Furniture workbench'], Level: 58 } },
  Magic: { 'Cast ~|Varrock Teleport|~': { Chunks: ['200'] }, 'Cast ~|Falador Teleport|~': { Chunks: ['300'] },
    'Cast ~|Mazcab Teleport|~': {} }, Ranged: {} }, codeItems: { tasksPlus: {} } };
}
const state = (chunks = ['100'], earlyValue, other = {}) => ({ rules: { 'content.f2p': false, 'access.shared': false },
  members: [{ id: 'a', unlocked: chunks, completedTasks: [], taskRules: earlyValue === undefined ? {} : { [early]: earlyValue },
    passiveLevels: { Firemaking: 30, Construction: 58 }, ...other }] });
const row = (result, name, category = 'Extra') => result.tasks.find(task => task.id === taskId(category, name));
const run = (data, saved) => createTaskEngine(data, options).evaluate(saved, 'a');
const waits = task => task.blockers.some(b => b.kind === 'useful-unlock' && b.detail.startsWith('Waiting until'));

test('the rule defaults off, has plain UI text and survives command/backup round trips', () => {
  const def = taskRuleDefinitions.find(rule => rule.id === early);
  assert.equal(def.default, false); assert.equal(taskRuleDefault(early), false);
  assert.equal(def.label, early);
  assert.equal(def.description, 'Travel and reward unlocks can be chunk tasks before you can use them');
  assert.equal(taskRuleValueError(early, 'true') !== null, true);
  assert.equal(taskRuleBehavior(early).status, 'implemented-scope');
  let saved = createGroupState([{ id: 'a', name: 'Fixture' }]);
  const ui = buildRulesSections(rulesCatalogue, saved).flatMap(section => section.rules).find(rule => rule.id === early);
  assert.equal(ui.depth, 0); assert.equal(ui.parent, undefined); assert.ok(ui.explanation);
  assert.equal(taskRuleValue(saved, 'a', def).value, false);
  saved = applyCommand(saved, planTaskRuleChange(saved, ['a'], def, true).commands[0], { expectedRevision: saved.revision });
  saved = importBackup(exportBackup(saved));
  assert.equal(taskRuleValue(saved, 'a', def).value, true);
});

test('balloon unlocks need Entrana, not the destination; early removes only the new origin gate', () => {
  const data = fixture(), engine = createTaskEngine(data, options), original = JSON.stringify(data);
  const fromOrigin = state(['100', '11060']);
  assert.equal(row(engine.evaluate(fromOrigin, 'a'), balloon).status, 'available');
  fromOrigin.members[0].taskRules[early] = true;
  assert.equal(row(engine.evaluate(fromOrigin, 'a'), balloon).status, 'available');
  const destinationOnly = state(['100', '200']);
  data.chunks[100].NPC = { Auguste: true };
  const otherEngine = createTaskEngine(data, options);
  assert.equal(row(otherEngine.evaluate(destinationOnly, 'a'), balloon).status, 'blocked');
  assert.equal(waits(row(otherEngine.evaluate(destinationOnly, 'a'), balloon)), true);
  destinationOnly.members[0].taskRules[early] = true;
  assert.equal(row(otherEngine.evaluate(destinationOnly, 'a'), balloon).status, 'available');
  destinationOnly.members[0].unlocked = ['100'];
  assert.equal(row(otherEngine.evaluate(destinationOnly, 'a'), balloon).status, 'available');
  // Compilation must not rewrite input records or other members' rules.
  delete data.chunks[100].NPC; assert.equal(JSON.stringify(data), original);
  assert.equal(row(engine.evaluate(state(['100', '11060']), 'a'), flight, 'Firemaking').status, 'blocked');
});

test('first-flight supplies, Firemaking level and origin NPC remain hard requirements', () => {
  for (const missing of ['supply', 'level', 'npc']) {
    const data = fixture(), saved = state(['100', '11060']);
    if (missing === 'supply') delete data.chunks[100].Spawn.Material;
    if (missing === 'npc') delete data.chunks[11060].NPC;
    if (missing === 'level') saved.members[0].passiveLevels.Firemaking = 1;
    assert.equal(row(run(data, saved), balloon).status, 'blocked', missing);
  }
});

test('a member can opt in without changing another member or bypassing other requirements', () => {
  const data = fixture(), saved = state(['100', '200'], true);
  data.chunks[100].NPC = { Auguste: true };
  saved.members.push({ ...structuredClone(saved.members[0]), id: 'b', taskRules: {} });
  const engine = createTaskEngine(data, options);
  assert.equal(row(engine.evaluate(saved, 'a'), balloon).status, 'available');
  assert.equal(row(engine.evaluate(saved, 'b'), balloon).status, 'blocked');
  assert.equal(row(engine.evaluate(state(), 'a'), 'Unlock an unmapped portal').status, 'available');
  assert.equal(row(engine.evaluate(state(), 'a'), 'Unlock the ability to make ~|ancient teleport tablets|~').status, 'available');
});

test('early conversion rewards are independent of the Permanent Unlockables category', () => {
  const data = fixture(), engine = createTaskEngine(data, options), saved = state(['100'], true);
  saved.members[0].taskRules['Permanent Unlockables'] = false;
  assert.equal(row(engine.evaluate(saved, 'a'), gold).status, 'available');
});

test('Max Guild attunement opens with either mapped endpoint; early only removes the new gate', () => {
  const engine = createTaskEngine(fixture(), options);
  assert.equal(waits(row(engine.evaluate(state(), 'a'), attune)), true);
  for (const chunk of ['9011', '14659']) assert.equal(row(engine.evaluate(state(['100', chunk]), 'a'), attune).status, 'available');
  assert.equal(row(engine.evaluate(state(['100'], true), 'a'), attune).status, 'available');
  assert.equal(row(engine.evaluate(state(['9011'], true), 'a'), attune).status, 'blocked');
});

test('the all-destinations nexus objective waits for every mapped destination, ignoring unknown ones', () => {
  const data = fixture(), engine = createTaskEngine(data, options);
  assert.equal(nexusDestinationClauses(data).length, 2);
  assert.equal(waits(row(engine.evaluate(state(['100', '200']), 'a'), nexus)), true);
  assert.equal(row(engine.evaluate(state(['100', '200', '300']), 'a'), nexus).status, 'available');
  assert.equal(row(engine.evaluate(state(['100'], true), 'a'), nexus).status, 'available');
  delete data.challenges.Magic;
  assert.equal(row(run(data, state()), nexus).status, 'available');
});

test('cannon shop rewards and conversions wait for a base cannon, while the dropped kit does not', () => {
  const data = fixture(), engine = createTaskEngine(data, options);
  for (const earlyValue of [false, true]) {
    const result = engine.evaluate(state(['100'], earlyValue), 'a');
    for (const name of [gold, royale, upgrades]) assert.equal(row(result, name).status, earlyValue ? 'available' : 'blocked');
    assert.equal(row(result, kit).status, 'available');
  }
  data.chunks[100].Spawn['Dwarf multicannon'] = true;
  const result = run(data, state());
  for (const name of [gold, royale, upgrades]) assert.equal(row(result, name).status, 'available');
});

test('How? reports the usefulness wait as a gap instead of a complete proof', () => {
  const data = fixture(); data.chunks[100].Spawn['Dwarf multicannon'] = true;
  const engine = createTaskEngine(data, options);
  const waiting = engine.how(state(), 'a', taskId('Extra', upgrades));
  assert.equal(waiting.availability, 'available');
  assert.notEqual(waiting.proofStatus, 'complete');
  assert.ok(waiting.gaps.some(gap => gap.kind === 'useful-unlock'), JSON.stringify(waiting.gaps));
  const allowed = engine.how(state(['100'], true), 'a', taskId('Extra', upgrades));
  assert.ok(!allowed.gaps.some(gap => gap.kind === 'useful-unlock'), JSON.stringify(allowed.gaps));
});

test('an available cannon variant counts, but legacy conversion shop stock cannot open its own gate', () => {
  const data = fixture();
  assert.equal(row(run(data, state()), upgrades).status, 'blocked');
  for (const variant of ['Gold dwarf multicannon', 'Royale cannon', 'Dwarven siege engine']) {
    data.chunks[100].Spawn[variant] = true;
    assert.equal(row(run(data, state()), upgrades).status, 'available', variant);
    delete data.chunks[100].Spawn[variant];
  }
});

test('a newly obtainable cannon opens rewards within the item closure', () => {
  const data = fixture();
  data.challenges.Nonskill = { 'Obtain fixture cannon': { Items: ['Material'], Output: 'Dwarf multicannon' } };
  assert.equal(row(run(data, state()), upgrades).status, 'available');
  data.challenges.Nonskill['Obtain fixture cannon'].Items = ['Missing'];
  assert.equal(row(run(data, state()), upgrades).status, 'blocked');
});

test('the existing setup task is alternative cannon evidence, without repairing its legacy parts', () => {
  const data = fixture();
  data.challenges.Ranged['Setup a ~|dwarf multicannon|~'] = { Items: ['Material'] };
  assert.equal(row(run(data, state()), upgrades).status, 'available');
  data.challenges.Ranged['Setup a ~|dwarf multicannon|~'].Items = ['Missing'];
  assert.equal(row(run(data, state()), upgrades).status, 'blocked');
});

test('learning plans is never delayed; build objectives keep level, plan, materials and usable bench requirements', () => {
  for (const earlyValue of [false, true]) for (const missing of ['level', 'plan', 'material', 'bench']) {
    const data = fixture(), saved = state(['100'], earlyValue);
    data.chunks[100].Object = { 'Furniture workbench': true };
    if (missing === 'level') saved.members[0].passiveLevels.Construction = 1;
    if (missing === 'plan') delete data.chunks[100].Spawn['Furniture plans: Test furniture'];
    if (missing === 'material') delete data.chunks[100].Spawn.Material;
    if (missing === 'bench') delete data.chunks[100].Object;
    const result = run(data, saved), task = row(result, build, 'Construction');
    assert.equal(task.status, 'blocked', missing);
    assert.equal(waits(task), !earlyValue, missing);
    if (missing !== 'plan') assert.equal(row(result, plan).status, 'available', missing);
  }
  const data = fixture(); data.chunks[100].Object = { 'Furniture workbench': true };
  assert.equal(row(run(data, state()), build, 'Construction').status, 'available');
});

for (const [bench, max] of [['Wooden workbench', 20], ['Steel framed workbench', 60], ['Reinforced steel framed workbench', 120]]) {
  test(`${bench} only admits furniture within its tier; Rimmington supports every recipe`, () => {
    const data = fixture(); data.chunks[100].Object = { [bench]: true };
    for (const earlyValue of [false, true]) for (const level of [max, Math.min(120, max + 1)]) {
      data.challenges.Construction[build].Level = level;
      const result = run(data, state(['100'], earlyValue, { passiveLevels: { Construction: 120 } }));
      assert.equal(row(result, build, 'Construction').status, level <= max ? 'available' : 'blocked');
    }
    data.chunks[100].Object = { 'Furniture workbench': true };
    assert.equal(row(run(data, state(['100'], false, { passiveLevels: { Construction: 120 } })), build, 'Construction').status, 'available');
  });
}

test('selectors cover the public intended rows and exclude plan learning, the drop kit and use-actions', () => {
  const data = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const counts = {};
  for (const [category, entries] of Object.entries(data.challenges)) for (const [label, record] of Object.entries(entries)) {
    const kind = travelRewardKind(category, label, record);
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
  }
  assert.deepEqual(counts, { furniture: 48, balloon: 4, attunement: 1, cannon: 3, nexus: 1 });
});
