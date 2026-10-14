import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { collectBaseItemSources } from '../app/tasks/access.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guide-rules.mjs';
import { datasetCapabilities } from '../app/datasets.mjs';

const state = () => ({ rules: { 'content.f2p': false }, taskRules: {}, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const options = overlay => ({ metadataCorrections: false, equipmentCorrections: false, skillGuideCorrectionOverlay: overlay,
  skillGuideCatalogue: { metadataCorrections: [], generatedTasks: [] } });

test('mixed literal and table drops retain source evidence and reevaluate admission on cached collections', () => {
  const definitions = {
    drops: { Imp: { Coin: { 2: '1/4' }, LootDropTable: { 1: '1/2' }, MissingDropTable: { 1: '1/3' } } },
    codeItems: { dropTables: { LootDropTable: { Coin: '1/5@3', Token: '1/1' } } },
    taskUnlocks: { Items: { Token: { Open: 'Nonskill' } } },
  };
  const access = { bases: new Set(['100']), sections: new Set(), areas: new Set(), spawns: new Map(),
    shops: new Set(), monsters: new Set(['Imp']), objects: new Set(), locations: new Map([['Monster:Imp', ['100']]]) };
  const expansionCache = new Map(), rules = { F2P: false };
  for (const validTasks of [new Set(), new Set(['Nonskill\u0000Open'])]) {
    const cached = collectBaseItemSources(definitions, access, { rules, validTasks, expansionCache });
    assert.deepEqual(cached, collectBaseItemSources(definitions, access, { rules, validTasks }));
    assert.equal(cached.items.has('Token'), validTasks.size > 0);
    assert.deepEqual(cached.sources.get('Coin').map(source => [source.quantity, source.rate, source.tables]),
      [['2', '1/4', undefined], ['3', '1/2 × 1/5', ['LootDropTable']]]);
    assert(cached.diagnostics.some(row => row.code === 'missing-drop-table' && row.table === 'MissingDropTable'));
    for (const source of cached.sources.get('Coin')) {
      assert.equal(source.own, undefined);
      source.own = true;
    }
  }
  assert.equal(expansionCache.size, 1, 'only the traversed table needs an expansion plan');
});

test('static blockers keep exact explanations and pass/check counters when personal rules change', () => {
  const definitions = { chunks: { 100: { Connect: { Cave: true } }, Cave: {} }, challenges: {
    Extra: { Consume: { Items: ['Key'] }, MemberOnly: { 'Not F2P': true, Items: ['Key'] },
      SkillerOnly: { 'Not Skiller': true, Items: ['Key'] }, RuleOnly: { Category: ['Fixture rule'], Items: ['Key'] }, Backlog: { Items: ['Key'] } },
    Nonskill: { Cave: { UnlocksArea: true, Mystery: true, 'Not F2P': true, Category: ['Fixture rule'], Tasks: { Missing: 'Quest' } },
      'Make key': { Output: 'Key' } },
  } };
  const input = state(), caveId = taskId('Nonskill', 'Cave'), backlogId = taskId('Extra', 'Backlog');
  input.rules['content.f2p'] = true;
  input.taskRules = { Skiller: true, 'Fixture rule': false };
  input.members[0].taskStatus = { [caveId]: { backlogged: true }, [backlogId]: { backlogged: true } };
  input.members[0].areaOverrides = { Cave: false };
  const engine = createTaskEngine(definitions, options(value => value)), snapshot = structuredClone({ definitions, input });
  const blocked = engine.evaluate(input, 'm');
  assert.deepEqual(blocked.tasks.find(row => row.id === caveId).blockers, [
    { kind: 'unsupported', detail: 'Some task requirements are not yet supported: Mystery.' },
    { kind: 'unsupported', detail: 'Unknown task reference Missing (Quest).' },
    { kind: 'membership', detail: 'This activity requires membership.' },
    { kind: 'rule', detail: 'Turned off in Rules: Fixture rule.' },
    { kind: 'backlog', detail: 'This task is backlogged by the current member.' },
    { kind: 'access', detail: 'Cave is manually blocked by the current member.' },
  ]);
  assert.equal(blocked.metrics.passes, 3);
  assert.equal(blocked.metrics.accessPasses, 3);
  assert.equal(blocked.metrics.checks, 23);
  assert.equal(blocked.metrics.dependencyChecks, 0);
  assert.deepEqual({ definitions, input }, snapshot);
  input.rules['content.f2p'] = false;
  input.taskRules = { Skiller: false, 'Fixture rule': true };
  input.members[0].taskStatus[caveId].backlogged = false;
  input.members[0].taskStatus[backlogId].backlogged = false;
  const enabled = engine.evaluate(input, 'm');
  for (const row of enabled.tasks.filter(row => row.category === 'Extra')) assert.equal(row.status, 'available', row.label);
  assert.deepEqual(enabled.tasks.find(row => row.id === caveId).blockers, [
    { kind: 'unsupported', detail: 'Some task requirements are not yet supported: Mystery.' },
    { kind: 'unsupported', detail: 'Unknown task reference Missing (Quest).' },
    { kind: 'access', detail: 'Cave is manually blocked by the current member.' },
  ]);
  assert.equal(enabled.metrics.passes, 3);
  assert.equal(enabled.metrics.accessPasses, 3);
  assert.equal(enabled.metrics.checks, 15);
  assert.equal(enabled.metrics.dependencyChecks, 0);
});

test('prepare compiles only the selected variant and preserves the initial catalogue and calculations', () => {
  let corrections = 0;
  const definitions = { chunks: { 100: {} }, challenges: { Extra: { Consume: { Items: ['Token'] } } } };
  const overlay = value => {
    corrections++;
    return { ...value, challenges: { ...value.challenges, Nonskill: { Gift: { Output: 'Token' } } } };
  };
  const engine = createTaskEngine(definitions, options(overlay)), catalogue = engine.catalogue, input = state();
  assert.equal(engine.prepare(Object.freeze({ [SKILL_GUIDE_CORRECTIONS_RULE]: true })), undefined);
  assert.equal(corrections, 1);
  assert.equal(engine.catalogue, catalogue);
  assert.equal(engine.evaluate(input, 'm').tasks.find(row => row.label === 'Consume').status, 'blocked');
  input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
  const result = engine.evaluate(input, 'm');
  assert.equal(result.tasks.find(row => row.label === 'Consume').status, 'available');
  assert.equal(corrections, 1);
  assert.equal(engine.catalogue, catalogue);
  const fresh = createTaskEngine(definitions, options(overlay)).evaluate(input, 'm');
  delete result.metrics.elapsedMs; delete fresh.metrics.elapsedMs;
  assert.deepEqual(result, fresh);
  assert.deepEqual(definitions, { chunks: { 100: {} }, challenges: { Extra: { Consume: { Items: ['Token'] } } } });
  for (const forced of [false, true]) {
    const forcedEngine = createTaskEngine(definitions, { ...options(overlay), skillGuideCorrections: forced });
    const calls = corrections, originalCatalogue = forcedEngine.catalogue;
    forcedEngine.prepare({ [SKILL_GUIDE_CORRECTIONS_RULE]: !forced });
    assert.equal(corrections, calls);
    assert.equal(forcedEngine.catalogue, originalCatalogue);
    assert.equal(forcedEngine.evaluate(state(), 'm').tasks.find(row => row.label === 'Consume').status, forced ? 'available' : 'blocked');
  }
});

test('prepare respects forced flags and strict saved booleans for generated guide tasks', () => {
  const definitions = { chunks: { 100: { Object: { Bench: 1 } } }, challenges: { Extra: { Consume: { Items: ['Token'] } } } };
  const catalogue = { metadataCorrections: [], entries: [{ id: 'fixture', skill: 'Crafting', level: 1, members: false }],
    generatedTasks: [{ category: 'Crafting', label: 'Generate token', entryIds: ['fixture'], selectorEvidence: { kind: 'object', selector: 'Bench' },
      record: { PickerId: 'rs3:task:skill-guide:prepare-fixture', Level: 1, Objects: ['Bench'], Output: 'Token' } }] };
  for (const forced of [undefined, false, true]) {
    const engine = createTaskEngine(definitions, { ...options(value => value), skillGuideCatalogue: catalogue,
      ...(forced === undefined ? {} : { skillGuideTasks: forced, skillGuideCorrections: false }) });
    const originalCatalogue = engine.catalogue, input = state();
    for (const saved of [true, false, 'true']) {
      input.rules[SKILL_GUIDE_TASKS_RULE] = saved;
      engine.prepare(input.rules);
      assert.equal(engine.catalogue, originalCatalogue);
      const result = engine.evaluate(input, 'm'), expected = forced ?? saved === true;
      assert.equal(result.tasks.some(row => row.label === 'Generate token'), expected);
      assert.equal(result.tasks.find(row => row.label === 'Consume').status, expected ? 'available' : 'blocked');
    }
  }
});

test('a newly satisfied source gate outside access does not repeat raw access collection', () => {
  let reachableGateReads = 0;
  const treeLocations = { get 100() { reachableGateReads++; return true; } };
  const definitions = { chunks: { 100: { Object: { Tree: 1 } }, 200: { Object: { Ore: 1 } } },
    challenges: { Extra: { Consume: { Items: ['Key'] } }, Nonskill: { 'Make key': { Output: 'Key' } } },
    taskUnlocks: { Objects: { Tree: treeLocations, Ore: { 200: { 'Make key': 'Nonskill' } } } } };
  const engine = createTaskEngine(definitions, options(value => value));
  reachableGateReads = 0;
  const result = engine.evaluate(state(), 'm');
  assert.equal(result.metrics.passes, 3);
  assert.equal(result.metrics.accessPasses, 3);
  assert.equal(reachableGateReads, 2); // One direct admission and one task-source scan.
  assert(result.access.objects.includes('Tree'));
  assert(!result.access.objects.includes('Ore'));
  assert.equal(result.tasks.find(row => row.label === 'Consume').status, 'available');
});

test('short-circuit gate tracing begins observing later requirements when an earlier gate opens', () => {
  const definitions = { chunks: { 100: { Object: { Tree: 1 } } }, challenges: {
    Extra: { Chop: { Objects: ['Tree'] } },
    Nonskill: { First: { Items: ['Key'] }, Second: {}, 'Make key': { Output: 'Key' } },
  }, taskUnlocks: { Objects: { Tree: { 100: [{ First: 'Nonskill' }, { Second: 'Nonskill' }] } } } };
  const input = state(), snapshot = structuredClone({ definitions, input });
  const result = createTaskEngine(definitions, options(value => value)).evaluate(input, 'm');
  assert(result.access.objects.includes('Tree'));
  assert.equal(result.tasks.find(row => row.label === 'Chop').status, 'available');
  assert(!result.access.diagnostics.some(row => row.code === 'task-required' && ['First', 'Second'].includes(row.task)));
  assert.deepEqual({ definitions, input }, snapshot);
});

test('observed gates are reevaluated after personal completion is added or removed', () => {
  const definitions = { chunks: { 100: { Connect: { Cave: { Tasks: { Open: 'Nonskill' } } } }, Cave: { Spawn: { Coin: 7 } } },
    challenges: { Nonskill: { Open: { Items: ['Missing key'] } } } };
  const engine = createTaskEngine(definitions, options(value => value)), input = state();
  assert(!engine.evaluate(input, 'm').access.areas.includes('Cave'));
  input.members[0].completedTasks = [taskId('Nonskill', 'Open')];
  const open = engine.evaluate(input, 'm');
  assert(open.access.areas.includes('Cave'));
  assert.equal(open.items.find(row => row.name === 'Coin').sources[0].quantity, 7);
  input.members[0].completedTasks = [];
  assert(!engine.evaluate(input, 'm').access.areas.includes('Cave'));
});

test('completion scopes preserve false canonical flags and separate partner completion', () => {
  const definitions = { chunks: { 100: {} }, challenges: { Extra: { Goal: {} } } }, id = taskId('Extra', 'Goal');
  const engine = createTaskEngine(definitions, options(value => value)), input = state();
  input.members[0].taskStatus = { [id]: { challengeCompleted: false } };
  input.members.push({ id: 'r', unlocked: [], completedTasks: [id] });
  for (const [scope, expected] of [['personal', false], ['any', true], ['all', false]]) {
    input.rules['tasks.completion'] = scope;
    assert.equal(engine.evaluate(input, 'm').tasks.find(row => row.id === id).challengeSatisfied, expected);
  }
  input.members[0].completedTasks = [id];
  assert.equal(engine.evaluate(input, 'm').tasks.find(row => row.id === id).challengeSatisfied, true);
});

test('fixed-point access follows newly satisfied connection, implicit area, source and telegrab gates', () => {
  const definitions = { chunks: {
    100: { Object: { Tree: 1 }, Spawn: { Coin: 7 }, Connect: { Cave: { Tasks: { Open: 'Quest' } }, Room: true } },
    Cave: { Object: { Ore: 1 } }, Room: { Object: { Chest: 1 } },
  }, challenges: {
    Quest: { Open: { Items: ['Key'] } },
    Extra: { Loot: { Items: ['Gem'] }, Forge: { Objects: ['Anvil'] } },
    Nonskill: { Room: { UnlocksArea: true, Items: ['Key'] }, 'Make key': { Output: 'Key' },
      'Build anvil': { Chunks: ['100'], 'Output Object': 'Anvil' } },
  }, taskUnlocks: { Objects: { Tree: { 100: [{ Open: 'Quest' }] } } },
  codeItems: { telegrabSpawns: { Gem: { 100: { Open: 'Quest' } } } } };
  const input = state(), snapshot = structuredClone({ definitions, input });
  const result = createTaskEngine(definitions, options(value => value)).evaluate(input, 'm');
  for (const name of ['Tree', 'Ore', 'Chest', 'Anvil']) assert(result.access.objects.includes(name), name);
  for (const name of ['Loot', 'Forge']) assert.equal(result.tasks.find(row => row.id === taskId('Extra', name)).status, 'available');
  assert.equal(result.items.find(row => row.name === 'Coin').sources.find(source => source.kind === 'spawn').quantity, 7);
  assert(result.access.areas.includes('Cave'));
  assert(result.access.areas.includes('Room'));
  assert.deepEqual({ definitions, input }, snapshot);
});

test('custom correction variants keep changed chunk contents independent', () => {
  const definitions = { chunks: { 100: { Object: { Tree: 1 } } }, challenges: { Extra: {} } };
  const engine = createTaskEngine(definitions, options(value => ({ ...value, chunks: { ...value.chunks,
    100: { ...value.chunks[100], Object: { ...value.chunks[100].Object, Ore: 1 } } } })));
  const input = state(), snapshot = structuredClone({ definitions, input });
  assert(!engine.evaluate(input, 'm').access.objects.includes('Ore'));
  input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
  assert(engine.evaluate(input, 'm').access.objects.includes('Ore'));
  input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false;
  assert(!engine.evaluate(input, 'm').access.objects.includes('Ore'));
  delete input.rules[SKILL_GUIDE_CORRECTIONS_RULE];
  assert.deepEqual({ definitions, input }, snapshot);
});

test('custom correction variants keep changed source and Nonskill area gates independent', () => {
  const definitions = { chunks: { 100: { Object: { Tree: 1 }, Connect: { Cave: true } }, Cave: { Object: { Ore: 1 } } },
    challenges: { Extra: {} }, taskUnlocks: { Objects: { Tree: { 100: false } } } };
  for (const [overlay, check] of [
    [value => ({ ...value, taskUnlocks: { Objects: { Tree: { 100: true } } } }), result => assert(result.access.objects.includes('Tree'))],
    [value => ({ ...value, challenges: { ...value.challenges, Nonskill: { Cave: { UnlocksArea: true, Items: ['Missing key'] } } } }),
      result => assert(!result.access.areas.includes('Cave'))],
  ]) {
    const engine = createTaskEngine(definitions, options(overlay)), input = state();
    const ordinary = engine.evaluate(input, 'm');
    assert(!ordinary.access.objects.includes('Tree'));
    assert(ordinary.access.areas.includes('Cave'));
    input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
    check(engine.evaluate(input, 'm'));
    input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false;
    const restored = engine.evaluate(input, 'm');
    assert(!restored.access.objects.includes('Tree'));
    assert(restored.access.areas.includes('Cave'));
  }
});

