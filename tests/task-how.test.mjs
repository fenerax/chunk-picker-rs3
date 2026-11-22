import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { duoFixture } from './fixtures/partner.mjs';
import { createHowCache } from '../app/tasks/how-cache.mjs';
import { pathDefinitions, pathState, caveDefinitions, caveState } from './task-how-fixture.mjs';
const id = taskId('Extra', 'Defeat a cave bug');
const labels = proof => Object.values(proof.nodes).map(node => node.label).join('\n');
function graph(proof) {
  const visit = (id, path = new Set()) => {
    assert.ok(proof.nodes[id], id); assert.ok(!path.has(id), 'no cycles');
    for (const child of proof.nodes[id].allOf) visit(child, new Set([...path, id]));
  }; visit(proof.root);
}
test('swamp witness binds the approach, rope and selected light source without Agility', t => {
  const engine = createTaskEngine(caveDefinitions()), state = caveState();
  const before = engine.evaluate(state, 'one'), start = performance.now();
  const proof = engine.how(state, 'one', id), elapsed = performance.now() - start;
  t.diagnostic(`cave proof: ${Buffer.byteLength(JSON.stringify(proof))} bytes, ${elapsed.toFixed(2)} ms`);
  assert.equal(proof.availability, 'available', JSON.stringify(proof));
  assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
  assert.match(labels(proof), /Swamp entrance/); assert.ok(Object.values(proof.nodes).some(node => node.subjectId === '12593'));
  assert.match(labels(proof), /Obtain Rope from/); assert.match(labels(proof), /Obtain Candle from/);
  assert.doesNotMatch(labels(proof), /Lost Tribe|Agility/); graph(proof);
  const after = engine.evaluate(state, 'one');
  assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.training, before.training);
  assert.ok(!JSON.stringify(after).includes('howProof')); assert.ok(!('nodes' in after));
});
test('cellar witness shows both quest steps and the actual startable Agility method', () => {
  const engine = createTaskEngine(caveDefinitions()), proof = engine.how(caveState(['12850']), 'one', id);
  assert.equal(proof.availability, 'available'); assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
  assert.match(labels(proof), /Lost Tribe step 2/); assert.match(labels(proof), /Lost Tribe step 1/);
  assert.match(labels(proof), /Balance on the training log is reachable/);
  assert.ok(proof.assumptions.length >= 3); graph(proof);
});
test('circular quest and training never manufacture a successful proof', () => {
  const engine = createTaskEngine(caveDefinitions({ circular: true }));
  const proof = engine.how(caveState(['12850']), 'one', id);
  assert.notEqual(proof.availability, 'available'); assert.equal(proof.proofStatus, 'partial');
  assert.ok(proof.gaps.length); graph(proof);
});
test('cave-only rope or light cannot bootstrap cave access', () => {
  for (const item of ['Rope', 'Candle']) {
    const defs = caveDefinitions(); delete defs.chunks['12593'].Spawn[item]; defs.chunks['Swamp cave'].Spawn = { [item]: 1 };
    defs.taskUnlocks.Spawns = { [item]: { 'Swamp cave': { 'Obtain a light source': 'Nonskill' } } };
    const proof = createTaskEngine(defs).how(caveState(), 'one', id);
    assert.notEqual(proof.availability, 'available'); assert.equal(proof.proofStatus, 'partial');
  }
});
test('caps return partial with typed budget gaps and valid bounded graphs', () => {
  const engine = createTaskEngine(caveDefinitions());
  for (const limits of [{ nodes: 5 }, { depth: 3 }, { bytes: 1024 }, { captureNodes: 2 }, { replayMs: 0 }]) {
    const proof = engine.how(caveState(), 'one', id, { limits });
    assert.equal(proof.proofStatus, 'partial'); assert.ok(proof.gaps.some(gap => gap.kind === 'budget'), JSON.stringify(proof));
    if (limits.nodes) assert.ok(Object.keys(proof.nodes).length <= limits.nodes);
    if (limits.bytes) assert.ok(Buffer.byteLength(JSON.stringify(proof)) <= limits.bytes);
    graph(proof);
  }
});
test('one witness per OR; xN dependencies keep distinct canonical subjects', () => {
  const definitions = { chunks: { '100': {} }, challenges: { Quest: { A: {}, B: {}, C: {} }, Extra: { Goal: { Tasks: { 'Choices[+]x2': 'Quest' } } } }, codeItems: { tasksPlus: { 'Choices[+]': ['A', 'A--duplicate', 'B', 'C'] } } };
  const proof = createTaskEngine(definitions).how(caveState(['100']), 'one', taskId('Extra', 'Goal'));
  assert.equal(proof.proofStatus, 'complete');
  const selected = Object.values(proof.nodes).filter(node => node.kind === 'task' && node.subjectId !== taskId('Extra', 'Goal'));
  assert.equal(selected.length, 2);
  assert.equal(new Set(selected.map(node => node.subjectId)).size, 2);
  assert.deepEqual(selected.map(node => node.subjectId).sort(), [taskId('Quest', 'A'), taskId('Quest', 'B')]);
  assert.ok(!selected.some(node => node.subjectId === taskId('Quest', 'C')), 'How intentionally chooses only a sufficient route');
  graph(proof);
});
test('unsupported subjects and points are honest gaps, separate proof cache is bounded and copies values', () => {
  const defs = { chunks: { '100': {} }, challenges: { Extra: { Goal: { TotalLevelNeeded: 1 } } } };
  const engine = createTaskEngine(defs);
  assert.ok(engine.how(caveState(['100']), 'one', taskId('Extra', 'Goal')).gaps.some(gap => gap.kind === 'points'));
  assert.ok(engine.how(caveState(['100']), 'one', 'generated:x').gaps.some(gap => gap.kind === 'unsupported-subject'));
  const cache = createHowCache({ entries: 1 }); cache.set('a', { value: 1 }); cache.get('a').value = 2; assert.equal(cache.get('a').value, 1);
  cache.set('b', { value: 3 }); assert.equal(cache.get('a'), undefined);
});
test('item gates and completion roots retain their earlier evidence', () => {
  const defs = caveDefinitions();
  defs.challenges.Quest['Acquire permission'] = {};
  defs.taskUnlocks.Items = { Rope: { 'Acquire permission': 'Quest' } };
  const engine = createTaskEngine(defs), state = caveState();
  state.members[0].completedTasks = [taskId('Quest', 'Acquire permission')];
  const proof = engine.how(state, 'one', id);
  assert.equal(proof.proofStatus, 'complete');
  assert.match(labels(proof), /You recorded completing Acquire permission/);
  for (const node of Object.values(proof.nodes)) for (const child of node.allOf) {
    assert.ok(proof.nodes[child].admissionOrder < node.admissionOrder, `${node.label} needs earlier evidence`);
  }
});
test('an item-source location cannot bind an entrance permission', () => {
  const defs = caveDefinitions(); delete defs.challenges.Nonskill['Swamp entrance'].Chunks;
  const proof = createTaskEngine(defs).how(caveState(), 'one', id);
  assert.equal(proof.availability, 'available'); assert.ok(proof.gaps.some(gap => gap.kind === 'unbound-entrance'));
});
test('an ungated interior uses its walking entry instead of an unbound permission', () => {
  const defs = { chunks: { '100': { Nickname: 'Garden' }, Basement: { Connect: { '100': true }, Spawn: { Candle: 1 } } },
    challenges: { Nonskill: { Basement: { UnlocksArea: true } }, Extra: { Goal: { Items: ['Candle'] } } } };
  const engine = createTaskEngine(defs), state = caveState(['100']);
  for (const id of [taskId('Extra', 'Goal'), taskId('Nonskill', 'Basement')]) {
    const proof = engine.how(state, 'one', id);
    assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
    assert.match(labels(proof), /Get into Basement from Garden/); graph(proof);
  }
  const unreachable = engine.how(caveState([]), 'one', taskId('Nonskill', 'Basement'));
  assert.equal(unreachable.proofStatus, 'partial');
  assert.ok(unreachable.gaps.some(gap => ['unbound-entrance', 'task-unavailable'].includes(gap.kind))); graph(unreachable);
});
test('decision parity covers both routes, circular and unavailable supplies', () => {
  for (const circular of [false, true]) for (const unlocked of [['12593'], ['12850'], []]) {
    const engine = createTaskEngine(caveDefinitions({ circular })), state = caveState(unlocked);
    const result = engine.evaluate(state, 'one');
    assert.equal(engine.how(state, 'one', id).availability, result.tasks.find(task => task.id === id).status);
  }
});

test('account-bound observed levels explain skills without a training-cap assumption', () => {
  const state = caveState();
  state.members[0].skillProgress = { Agility: { source: 'game-plugin', memberId: 'one', level: 13, xp: 2000 } };
  const definitions = { chunks: { '12593': {} }, challenges: { Quest: { Goal: { Skills: { Agility: 13 } } } } };
  const engine = createTaskEngine(definitions), id = taskId('Quest', 'Goal');
  const proof = engine.how(state, 'one', id);
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /recorded Agility level is 13/); assert.deepEqual(proof.assumptions, []);
  state.members[0].skillProgress.Agility.memberId = 'other';
  assert.notEqual(engine.how(state, 'one', id).availability, 'available');
});
test('fewest dependent steps wins over lexical order across successful task and item alternatives', () => {
  const defs = { chunks: { '12593': { Spawn: { Rope: 1 } } }, challenges: {
    Quest: { 'A costly route': { Items: ['Rope'], Tasks: { Permission: 'Quest' } }, 'Z simple route': {}, Permission: {} },
    Extra: { Goal: { Tasks: { 'Routes[+]': 'Quest' }, Items: ['Supplies[+]'] } },
    Crafting: { 'Make complicated supply': { Items: ['Rope'], Output: 'A supply' } },
  }, codeItems: { tasksPlus: { 'Routes[+]': ['A costly route', 'Z simple route'] }, itemsPlus: { 'Supplies[+]': ['A supply', 'Rope'] } } };
  const proof = createTaskEngine(defs).how(caveState(), 'one', taskId('Extra', 'Goal'));
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /Z simple route/);
  assert.doesNotMatch(labels(proof), /A costly route|Make complicated supply/); graph(proof);
});
test('both successful cave entrances choose the simpler swamp witness', () => {
  const proof = createTaskEngine(caveDefinitions()).how(caveState(['12593', '12850']), 'one', id);
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /Swamp entrance/);
  assert.doesNotMatch(labels(proof), /Lost Tribe|Agility|Cellar entrance/);
});
test('a depth gap stops sibling expansion while retaining an explicit omitted-step gap', () => {
  const defs = { chunks: { '12593': {} }, challenges: { Extra: { Goal: { Tasks: { First: 'Quest', Second: 'Quest' } } },
    Quest: { First: { Chunks: ['12593'] }, Second: {} } } };
  const proof = createTaskEngine(defs).how(caveState(), 'one', taskId('Extra', 'Goal'), { limits: { depth: 2 } });
  assert.equal(proof.proofStatus, 'partial'); assert.equal(proof.gaps.filter(gap => gap.kind === 'budget').length, 1);
  assert.doesNotMatch(labels(proof), /Do Second/); graph(proof);
});
test('a cheaper independent alternative admitted after the consumer replaces its first witness', () => {
  const spawn = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Supply ${index}`, 1]));
  const defs = { chunks: { '12593': { Spawn: spawn } }, challenges: {
    Extra: { Goal: { Tasks: { 'Routes[+]': 'Quest' } } },
    Quest: { 'A costly route': { Items: Object.keys(spawn) }, 'Z simple route': { Tasks: { 'Late permission': 'Quest' } },
      'Late permission': { Tasks: { Permission: 'Quest' } }, Permission: {} },
  }, codeItems: { tasksPlus: { 'Routes[+]': ['A costly route', 'Z simple route'] } } };
  const proof = createTaskEngine(defs).how(caveState(), 'one', taskId('Extra', 'Goal'));
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /Z simple route/); assert.doesNotMatch(labels(proof), /A costly route/);
  assert.ok(Object.values(proof.nodes).some(node => node.firstAdmissionOrder)); graph(proof);
  for (const node of Object.values(proof.nodes)) for (const child of node.allOf) assert.ok(proof.nodes[child].admissionOrder < node.admissionOrder);
});
test('a final-set circular shortcut cannot replace an independent witness', () => {
  const defs = { chunks: { '12593': {} }, challenges: { Quest: { Goal: { Tasks: { 'Routes[+]': 'Quest' } },
    'A circular shortcut': { Tasks: { Goal: 'Quest' } }, 'Z independent route': { Chunks: ['12593'] } } },
    codeItems: { tasksPlus: { 'Routes[+]': ['A circular shortcut', 'Z independent route'] } } };
  const proof = createTaskEngine(defs).how(caveState(), 'one', taskId('Quest', 'Goal'));
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /Z independent route/); assert.doesNotMatch(labels(proof), /A circular shortcut/); graph(proof);
});
test('a later simpler entrance rebinds the cave location to the same selected witness', () => {
  const defs = caveDefinitions(), tasks = defs.challenges.Nonskill;
  tasks['Swamp entrance'].Tasks = { 'Late permission': 'Quest' };
  defs.challenges.Nonskill = { 'Cellar entrance': tasks['Cellar entrance'], 'Swamp cave': tasks['Swamp cave'],
    'Swamp entrance': tasks['Swamp entrance'], 'Obtain a light source': tasks['Obtain a light source'] };
  defs.challenges.Quest['Late permission'] = { Tasks: { Permission: 'Quest' } }; defs.challenges.Quest.Permission = {};
  const proof = createTaskEngine(defs).how(caveState(['12593', '12850']), 'one', id);
  assert.equal(proof.proofStatus, 'complete'); assert.match(labels(proof), /Swamp entrance/);
  assert.doesNotMatch(labels(proof), /Lost Tribe|Cellar entrance|from Lumbridge cellar/); graph(proof);
});

test('historical personal producers keep supply without inventing partner ownership or current access', () => {
  for (const shared of [false, true]) {
    const engine = createTaskEngine(pathDefinitions()), state = pathState();
    state.rules['access.shared'] = shared;
    if (shared) state.members.push({ id: 'two', unlocked: ['400'], completedTasks: [] });
    const input = structuredClone(state), before = engine.evaluate(state, 'one');
    const proof = engine.how(state, 'one', taskId('Extra', 'Use historical supply'));
    assert.equal(proof.availability, 'available'); assert.equal(proof.proofStatus, 'partial');
    assert.deepEqual(proof.gaps.map(gap => gap.kind), ['historical-source-access']);
    assert.equal(proof.gaps[0].detail, 'This supply comes from a recorded completion; its current production access is not established.');
    assert.ok(Object.values(proof.nodes).some(node => node.rule === 'recorded-completion' && node.evidenceClass === 'personal'));
    assert.doesNotMatch(labels(proof), /partner access/); graph(proof);
    assert.deepEqual(state, input);
    const after = engine.evaluate(state, 'one');
    // Only evaluation duration is nondeterministic; all gameplay fields compare.
    delete before.metrics.elapsedMs; delete after.metrics.elapsedMs;
    assert.deepEqual(after, before);
  }
});
test('current own and genuine partner producers retain their access evidence', () => {
  const state = pathState(); state.members[0].completedTasks = []; state.members[0].unlocked.push('400');
  const own = createTaskEngine(pathDefinitions()).how(state, 'one', taskId('Extra', 'Use historical supply'));
  assert.equal(own.availability, 'available'); assert.equal(own.proofStatus, 'complete');
  assert.deepEqual(own.gaps, []); graph(own);
  const { state: shared, engine } = duoFixture();
  const partner = engine.how(shared, 'player1', taskId('Extra', 'Own'));
  assert.equal(partner.availability, 'available'); assert.equal(partner.proofStatus, 'partial');
  assert.ok(partner.gaps.some(gap => gap.detail === "This item comes from your partner's map."));
  assert.ok(!partner.gaps.some(gap => gap.kind === 'historical-source-access')); graph(partner);
});
test('personal obtain records remain complete supply roots without current producer access', () => {
  const definitions = pathDefinitions(), state = pathState();
  definitions.equipment = { Token: { slot: 'head', class: 'melee', tier: 1 } };
  state.members[0].completedTasks = []; state.members[0].obtainedEquipment = ['Token'];
  const proof = createTaskEngine(definitions).how(state, 'one', taskId('Extra', 'Use historical supply'));
  assert.equal(proof.availability, 'available'); assert.equal(proof.proofStatus, 'complete');
  assert.match(labels(proof), /You recorded obtaining Token/); assert.deepEqual(proof.gaps, []); graph(proof);
});
test('spatial all, any and count groups export only sufficient distinct selected witnesses', () => {
  const engine = createTaskEngine(pathDefinitions()), state = pathState(), input = structuredClone(state);
  for (const [goal, count] of [['Use both stations', 2], ['Use any station', 1], ['Use two stations', 2]]) {
    const before = engine.evaluate(state, 'one');
    const proof = engine.how(state, 'one', taskId('Extra', goal));
    assert.equal(proof.proofStatus, 'complete');
    const placements = Object.values(proof.nodes).filter(node => node.kind === 'placement');
    assert.equal(placements.length, count); assert.equal(new Set(placements.map(node => node.subjectId)).size, count);
    graph(proof);
    const after = engine.evaluate(state, 'one'); delete before.metrics.elapsedMs; delete after.metrics.elapsedMs;
    assert.deepEqual(after, before); assert.deepEqual(state, input);
  }
});

test('snapshot proofs preserve the complete START payloads for every synthetic row', async () => {
  const { createHash } = await import('node:crypto');
  const canonical = value => JSON.stringify(value, (key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map(name => [name, child[name]])) : child);
  // Public synthetic captures from c185bd7; includes unavailable, circular,
  // later cheaper alternatives, personal completions and historical supplies.
  const cases = [
    [caveDefinitions(), caveState(), '4217584447f524ff1eaaa8bffe969d74cf27c489c09b1974843ad30009d48634'],
    [caveDefinitions(), caveState(['12850']), 'd7e2ef684388ef71bdf9ff2d0860cd0015d3e3f5195906cefdd63fffd36e01aa'],
    [caveDefinitions(), caveState(['12593', '12850']), 'a9dd2b026890131b4a9a1ee9c03694b7acfd2f76bad91bdf64fdbaa325e9d2d1'],
    [caveDefinitions({ circular: true }), caveState(['12850']), 'e0993ff42d992d71095cee63277e03783502103891bfede0537d621c22d62325'],
    [pathDefinitions(), pathState(), '2b327c6715837f771a24d6fc257d1ca6463fad8567bc6a022834fe8ecb9ae384'],
  ];
  for (const [definitions, state, expected] of cases) {
    const engine = createTaskEngine(definitions), baseline = engine.evaluate(state, 'one');
    const proofs = baseline.tasks.filter(row => row.record).map(row => {
      const proof = engine.how(state, 'one', row.id, { baseline });
      assert.deepEqual(proof, engine.how(state, 'one', row.id));
      return proof;
    });
    assert.equal(createHash('sha256').update(canonical(proofs)).digest('hex'), expected);
    const cached = engine.evaluate(state, 'one');
    for (const row of cached.tasks) if (row.record) assert.deepEqual(engine.how(state, 'one', row.id, { baseline: cached }), engine.how(state, 'one', row.id));
  }
});

test('snapshot closure reuse rejects another member, changed inputs and unrecognized results', () => {
  const engine = createTaskEngine(caveDefinitions()), state = caveState(), baseline = engine.evaluate(state, 'one');
  const rebound = { ...state, revision: state.revision + 1 };
  const reboundProof = engine.how(rebound, 'one', id, { baseline });
  assert.deepEqual(reboundProof, engine.how(rebound, 'one', id));
  assert.equal(reboundProof.context.stateRevision, rebound.revision);
  const changed = structuredClone(state); changed.members[0].unlocked = ['12850'];
  for (const current of [changed, { ...changed, revision: 8 }]) {
    assert.deepEqual(engine.how(current, 'one', id, { baseline }), engine.how(current, 'one', id));
  }
  const two = { ...state, members: [...state.members, { id: 'two', unlocked: ['12850'], completedTasks: [] }] };
  const first = engine.evaluate(two, 'one');
  assert.deepEqual(engine.how(two, 'two', id, { baseline: first }), engine.how(two, 'two', id));
  for (const unknown of [structuredClone(baseline), {}, undefined]) {
    assert.deepEqual(engine.how(state, 'one', id, { baseline: unknown }), engine.how(state, 'one', id));
  }
});

test('snapshot replay preserves processing chains, cycle fallback and request budgets', () => {
  for (const cycle of [false, true]) {
    const definitions = { chunks: { '100': { Spawn: { Ore: 1 } } }, challenges: {
      Crafting: cycle ? { A: { Level: 1, Output: 'Shared', NoXp: true }, B: { Level: 1, Output: 'Shared', NoXp: true } }
        : { A: { Level: 1, Primary: true, Items: ['Ore'], Output: 'Shared' }, B: { Level: 2, Primary: true, Items: ['Shared'], Output: 'Final' } },
      Extra: { Goal: { Items: [cycle ? 'Shared' : 'Final'] } },
    } };
    const state = caveState(['100']);
    state.taskRules = { 'Highest Level': false, 'Multi Step Processing': true };
    const engine = createTaskEngine(definitions), baseline = engine.evaluate(state, 'one', { ownItemQueries: ['Final'] });
    if (cycle) assert.ok(baseline.diagnostics.some(value => value.kind === 'processing-source-cycle'));
    for (const row of baseline.tasks) for (const options of [{}, { limits: { nodes: 2 } }, { limits: { replayMs: 0 } }, { cancelled: () => true }]) {
      assert.deepEqual(engine.how(state, 'one', row.id, { ...options, baseline }), engine.how(state, 'one', row.id, options));
    }
  }
});

test('an ordinary processing recipe explains its ingredients and station without a processing gap', () => {
  const definitions = { chunks: { '100': { Spawn: { Clay: 1 }, Object: { Sink: 1 } } }, challenges: {
    Crafting: { Soften: { Level: 1, Items: ['Clay'], Objects: ['Sink'], Output: 'Soft clay', Primary: true } },
  } };
  const engine = createTaskEngine(definitions), state = caveState(['100']);
  const proof = engine.how(state, 'one', taskId('Crafting', 'Soften'));
  assert.equal(proof.availability, 'available');
  assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
  assert.match(labels(proof), /Obtain Clay from/); assert.match(labels(proof), /Find Sink/); graph(proof);
  delete definitions.chunks['100'].Object.Sink;
  assert.notEqual(createTaskEngine(definitions).how(state, 'one', taskId('Crafting', 'Soften')).availability, 'available');
});

test('a downstream item route retains every ordinary processing recipe and input', () => {
  const definitions = { chunks: { '100': { Spawn: { Ore: 1 }, Object: { Furnace: 1, Anvil: 1 } } }, challenges: {
    Smithing: {
      Smelt: { Level: 1, Items: ['Ore'], Objects: ['Furnace'], Output: 'Bar', Primary: true },
      Forge: { Level: 1, Items: ['Bar'], Objects: ['Anvil'], Output: 'Tool', Primary: true },
    }, Extra: { Goal: { Items: ['Tool'] } },
  } };
  const state = caveState(['100']); state.taskRules = { 'Highest Level': false, 'Multi Step Processing': true };
  const engine = createTaskEngine(definitions), before = engine.evaluate(state, 'one');
  const proof = engine.how(state, 'one', taskId('Extra', 'Goal'), { baseline: before });
  assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
  for (const name of ['Ore', 'Bar', 'Tool', 'Furnace', 'Anvil', 'Smelt', 'Forge']) assert.ok(labels(proof).includes(name), name);
  graph(proof); assert.deepEqual(engine.evaluate(state, 'one').tasks, before.tasks);
  delete definitions.chunks['100'].Spawn.Ore;
  assert.notEqual(createTaskEngine(definitions).how(state, 'one', taskId('Extra', 'Goal')).availability, 'available');
});

test('a doable recipe excluded from supplies gets a goal proof without publishing its output', () => {
  const definitions = { chunks: { '100': { Spawn: { Ore: 1, Token: 1 } } }, challenges: {
    Crafting: { Convert: { Level: 1, Items: ['Ore'], Output: 'Token', NoXp: true } },
    Extra: { Goal: { Items: ['Token'], AllowedSources: ['Convert'] } },
  } };
  const engine = createTaskEngine(definitions), state = caveState(['100']);
  const before = engine.evaluate(state, 'one'), id = taskId('Crafting', 'Convert');
  assert.equal(before.tasks.find(row => row.id === id).sourceEligible, false);
  for (const options of [{}, { baseline: before }]) {
    const proof = engine.how(state, 'one', id, options);
    assert.equal(proof.availability, 'available');
    assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
    assert.match(labels(proof), /Obtain Ore from/); graph(proof);
  }
  assert.notEqual(engine.how(state, 'one', taskId('Extra', 'Goal')).availability, 'available');
  assert.deepEqual(engine.evaluate(state, 'one').tasks, before.tasks);
});

test('conditional multistep supplies still report their unproved processing selection', () => {
  const definitions = { chunks: { '100': { Spawn: { Ore: 1, Fuel: 1 }, Object: { Anvil: 1 } } }, challenges: {
    Smithing: {
      Low: { Level: 1, Items: ['Ore'], Output: 'Low', Primary: true },
      High: { Level: 5, Items: ['Ore'], Output: 'High', Primary: true },
    }, Crafting: { Use: { Level: 5, Items: ['High', 'Fuel'], Output: 'End', Primary: true } },
  } };
  const state = caveState(['100']); state.taskRules = { 'Highest Level': false, 'Multi Step Processing': true };
  state.members[0].skillProgress = { Crafting: { source: 'game-plugin', memberId: 'one', level: 5, xp: 400 } };
  const proof = createTaskEngine(definitions).how(state, 'one', taskId('Crafting', 'Use'));
  assert.equal(proof.availability, 'available');
  assert.equal(proof.proofStatus, 'partial');
  assert.ok(proof.gaps.some(gap => gap.kind === 'processing')); graph(proof);
});

test('sectioned owned base chunks resolve to reached sections without hiding resource-only gaps', async () => {
  const definitions = {
    chunks: {
      100: { Nickname: 'Castle', Sections: { 1: { Object: { Fountain: 1 } } } },
      200: { Nickname: 'Meadow' },
    },
    sections: { 100: { 1: ['200'] } },
    challenges: { Extra: { 'Visit castle': { Chunks: ['100'] } } },
  };
  const goal = taskId('Extra', 'Visit castle');
  const engine = createTaskEngine(definitions), state = caveState(['100', '200']);
  const proof = engine.how(state, 'one', goal);
  assert.equal(proof.availability, 'available');
  assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
  assert.match(labels(proof), /Castle/); graph(proof);

  const { createHowCapture } = await import('../app/tasks/how-proof.mjs');
  const taskRecord = { id: goal, key: 'Extra\0Visit castle', category: 'Extra', rawLabel: 'Visit castle', label: 'Visit castle',
    record: { Chunks: ['100'] }, requirements: [{ field: 'Chunks', token: '100', clean: '100', displayLabel: '100', count: 1 }],
    needs: [], dependencies: [], completedDependencies: [], personalAlternatives: [], sourceLocations: [], tags: [] };
  const capture = createHowCapture({ state: caveState(['100']), memberId: 'one', definitions, byKey: new Map([[taskRecord.key, taskRecord]]), completedTask: () => false });
  capture.location('100-1', { resourceOnly: true });
  capture.task(taskRecord, { available: () => true, ownLocation: () => true, access: { locations: new Map(), entranceSources: new Map() }, valid: new Set(), levels: {}, passive: {}, observed: {}, controls: { passiveLevels: {}, primaryOverrides: {} }, caps: {}, anyAchievements: false, rules: {}, monsterGate: () => null });
  const resourceOnly = capture.finish(goal, { tasks: [{ id: goal, status: 'available' }] });
  assert.equal(resourceOnly.proofStatus, 'partial');
  assert.deepEqual(resourceOnly.gaps.map(gap => gap.kind), ['resource-only-access']); graph(resourceOnly);
});

test('policy-only UnlocksArea interiors keep their walking entry in members mode and stay gated in F2P', () => {
  const definitions = {
    chunks: {
      100: { Nickname: 'Garden' },
      Vault: { Connect: { 100: true }, Spawn: { Relic: 1 } },
    },
    challenges: {
      Nonskill: { Vault: { UnlocksArea: true, 'Not F2P': true, Category: 'Dungeon' } },
      Extra: { Goal: { Items: ['Relic'] } },
    },
  };
  const engine = createTaskEngine(definitions);
  const membersState = caveState(['100']); membersState.rules['content.f2p'] = false;
  for (const target of [taskId('Extra', 'Goal'), taskId('Nonskill', 'Vault')]) {
    const proof = engine.how(membersState, 'one', target);
    assert.equal(proof.availability, 'available');
    assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
    assert.match(labels(proof), /Get into Vault from Garden/); graph(proof);
  }
  const f2pState = caveState(['100']); f2pState.rules['content.f2p'] = true;
  for (const target of [taskId('Extra', 'Goal'), taskId('Nonskill', 'Vault')]) {
    assert.notEqual(engine.how(f2pState, 'one', target).availability, 'available');
  }
  const unreachable = caveState([]); unreachable.rules['content.f2p'] = false;
  assert.notEqual(engine.how(unreachable, 'one', taskId('Nonskill', 'Vault')).proofStatus, 'complete');
});

test('multi-alternative area unlocks bind whichever admitted entrance matches Connect', () => {
  const definitions = {
    chunks: {
      100: { Nickname: 'West field', Spawn: { Torch: 1 } },
      101: { Nickname: 'East field' },
      Cavern: { Connect: { 101: true }, Object: { Crystal: 1 } },
    },
    challenges: {
      Nonskill: { Cavern: { UnlocksArea: true, Chunks: ['Approaches[+]'], Items: ['Torch'] } },
      Extra: { Goal: { Objects: ['Crystal'] } },
    },
    codeItems: { chunksPlus: { 'Approaches[+]': ['100', '101'] } },
  };
  const engine = createTaskEngine(definitions), state = caveState(['100', '101']);
  for (const target of [taskId('Extra', 'Goal'), taskId('Nonskill', 'Cavern')]) {
    const proof = engine.how(state, 'one', target);
    assert.equal(proof.availability, 'available');
    assert.equal(proof.proofStatus, 'complete', JSON.stringify(proof.gaps));
    assert.match(labels(proof), /Get into Cavern from East field/);
    assert.ok(Object.values(proof.nodes).some(node => node.subjectId === '101'));
    graph(proof);
  }
});

test('Output Object producers prove dependent object requirements and preserve non-own access gaps', async () => {
  const { createGroupState } = await import('../app/core/state.mjs');
  const makeDefs = () => ({
    chunks: {
      12850: { Nickname: 'Camp', Spawn: { Logs: 1, 'Raw meat': 1 } },
      12851: { Nickname: 'Woods', Spawn: { Logs: 1 } },
    },
    sections: { 12850: { 0: ['12851'] }, 12851: { 0: ['12850'] } },
    walkableChunks: ['12850', '12851'],
    walkableChunksF2P: ['12850', '12851'],
    challenges: {
      Firemaking: { 'Light logs': { Level: 1, Items: ['Logs'], 'Output Object': ['Player fire'], Primary: true } },
      Cooking: { 'Cook meat': { Level: 1, Items: ['Raw meat'], Objects: ['Player fire'] } },
    },
  });
  const cook = taskId('Cooking', 'Cook meat'), light = taskId('Firemaking', 'Light logs');
  const engine = createTaskEngine(makeDefs()), state = caveState(['12850']);
  const before = engine.evaluate(state, 'one');
  const own = engine.how(state, 'one', cook);
  assert.equal(own.availability, 'available');
  assert.equal(own.proofStatus, 'complete', JSON.stringify(own.gaps));
  assert.match(labels(own), /Create Player fire via Light logs/);
  assert.ok(!own.gaps.length); graph(own);
  assert.deepEqual(engine.evaluate(state, 'one').tasks, before.tasks);

  const historicalDefs = makeDefs(); delete historicalDefs.chunks['12850'].Spawn.Logs;
  const historicalState = caveState(['12850']); historicalState.members[0].completedTasks = [light];
  const historical = createTaskEngine(historicalDefs).how(historicalState, 'one', cook);
  assert.equal(historical.availability, 'available');
  assert.equal(historical.proofStatus, 'partial');
  assert.ok(historical.gaps.some(gap => gap.kind === 'historical-source-access'), JSON.stringify(historical.gaps));
  assert.ok(!historical.gaps.some(gap => gap.kind === 'unsupported-kind')); graph(historical);

  const duoDefs = makeDefs(); delete duoDefs.chunks['12850'].Spawn.Logs;
  const duoState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12850'] }, { id: 'two', name: 'Two', unlocked: ['12851'] }]);
  const partner = createTaskEngine(duoDefs).how(duoState, 'one', cook);
  assert.equal(partner.availability, 'available');
  assert.equal(partner.proofStatus, 'partial');
  assert.ok(partner.gaps.some(gap => gap.kind === 'partner-duo' && gap.detail === "This object comes from your partner's map."), JSON.stringify(partner.gaps));
  assert.ok(!partner.gaps.some(gap => gap.kind === 'unsupported-kind')); graph(partner);
});

test('innate melee, Ranged, Prayer and Combat training seeds prove real witnesses and preserve gate and partner gaps', async () => {
  const { createGroupState } = await import('../app/core/state.mjs');
  const makeDefs = () => ({
    walkableChunks: ['12850', '12851'],
    walkableChunksF2P: ['12850', '12851'],
    sections: { 12850: { 0: ['12851'] }, 12851: { 0: ['12850'] } },
    chunks: {
      12850: { Nickname: 'Meadow', Monster: { Goblin: 1 }, Spawn: { Shortbow: 1, 'Bronze arrow': 1 } },
      12851: { Nickname: 'Ruins', Monster: { Skeleton: 1 } },
    },
    drops: { Goblin: { Bones: { 1: 'Always' } } },
    codeItems: {
      boneItems: ['Bones'],
      itemsPlus: { 'AnyArrow[+]': ['Bronze arrow'] },
      ammoTools: { 'AnyArrow[+]': { Shortbow: true, 'Willow shortbow': true }, 'No ammo': { Chargebow: true } },
      rangedItems: { Shortbow: 1, 'Willow shortbow': 20, Chargebow: 1 },
    },
    challenges: {
      Quest: {
        'Need Attack': { Skills: { Attack: 20 } },
        'Need Ranged': { Skills: { Ranged: 30 } },
        'Need Prayer': { Skills: { Prayer: 43 } },
        'Need Combat': { Skills: { Combat: 40 } },
      },
    },
  });
  const engine = createTaskEngine(makeDefs());
  const state = caveState(['12850']);
  const before = engine.evaluate(state, 'one');
  for (const [name, expected] of [
    ['Need Attack', [/monster combat is reachable/, /Find Goblin at Meadow/]],
    ['Need Ranged', [/ranged combat is reachable/, /Obtain Shortbow/, /Obtain Bronze arrow/, /Find Goblin at Meadow/]],
    ['Need Prayer', [/a bone or ash source is reachable/, /Obtain Bones from Goblin/]],
    ['Need Combat', [/combat training is reachable/, /Find Goblin at Meadow/]],
  ]) {
    const proof = engine.how(state, 'one', taskId('Quest', name), { baseline: before });
    assert.equal(proof.availability, 'available', name);
    assert.equal(proof.proofStatus, 'complete', `${name}: ${JSON.stringify(proof.gaps)}`);
    for (const pattern of expected) assert.match(labels(proof), pattern, name);
    assert.ok(!proof.gaps.some(gap => gap.kind === 'unsupported-training-seed'), name);
    graph(proof);
  }
  assert.deepEqual(engine.evaluate(state, 'one').tasks, before.tasks);

  // Ranged weapon requiring Ranged > 1 uses recorded passive level without cycling.
  const highBowDefs = makeDefs();
  delete highBowDefs.chunks['12850'].Spawn.Shortbow;
  highBowDefs.chunks['12850'].Spawn['Willow shortbow'] = 1;
  const highBowState = caveState(['12850']);
  highBowState.members[0].skillProgress = { Ranged: { source: 'game-plugin', memberId: 'one', level: 20, xp: 4500 } };
  const highBowProof = createTaskEngine(highBowDefs).how(highBowState, 'one', taskId('Quest', 'Need Ranged'));
  assert.equal(highBowProof.proofStatus, 'complete', JSON.stringify(highBowProof.gaps));
  assert.match(labels(highBowProof), /Willow shortbow/);
  assert.match(labels(highBowProof), /recorded Ranged level is 20/);
  graph(highBowProof);

  // Slayer-level monsters prove cleanly (level 1 needs no Slayer step; higher levels require Slayer skill evidence or report boosts).
  const gatedDefs = makeDefs();
  gatedDefs.slayerMonsters = { Goblin: 1 };
  const gatedEngine = createTaskEngine(gatedDefs);
  for (const name of ['Need Attack', 'Need Prayer']) {
    const gatedProof = gatedEngine.how(caveState(['12850']), 'one', taskId('Quest', name));
    assert.equal(gatedProof.availability, 'available', name);
    assert.equal(gatedProof.proofStatus, 'complete', `${name}: ${JSON.stringify(gatedProof.gaps)}`);
    graph(gatedProof);
  }
  const gatedRangedDefs = makeDefs();
  delete gatedRangedDefs.chunks['12850'].Spawn;
  gatedRangedDefs.chunks['12850'].Monster.Rat = 1;
  gatedRangedDefs.drops.Goblin.Chargebow = { 1: 'Always' };
  gatedRangedDefs.slayerMonsters = { Goblin: 1 };
  const gatedRangedProof = createTaskEngine(gatedRangedDefs).how(caveState(['12850']), 'one', taskId('Quest', 'Need Ranged'));
  assert.equal(gatedRangedProof.availability, 'available');
  assert.equal(gatedRangedProof.proofStatus, 'complete', JSON.stringify(gatedRangedProof.gaps));
  graph(gatedRangedProof);

  const highSlayerDefs = makeDefs();
  highSlayerDefs.slayerMonsters = { Goblin: 50 };
  highSlayerDefs.chunks['12850'].NPC = { Jacquelyn: 1 };
  highSlayerDefs.challenges.Slayer = { 'Receive a slayer assignment from Jacquelyn': { Level: 1, Primary: true, NPCs: ['Jacquelyn'] } };
  const highSlayerState = caveState(['12850']);
  highSlayerState.rules['content.f2p'] = false;
  for (const name of ['Need Attack', 'Need Prayer']) {
    const proof = createTaskEngine(highSlayerDefs).how(highSlayerState, 'one', taskId('Quest', name));
    assert.equal(proof.availability, 'available', name);
    assert.equal(proof.proofStatus, 'complete', `${name}: ${JSON.stringify(proof.gaps)}`);
    assert.match(labels(proof), /train Slayer to 50/);
    graph(proof);
  }

  const boostedSlayerDefs = makeDefs();
  boostedSlayerDefs.slayerMonsters = { Goblin: 5 };
  boostedSlayerDefs.chunks['12850'].Spawn['Wild pie'] = 1;
  boostedSlayerDefs.codeItems.boostItems = { Slayer: { 'Wild pie': 5 } };
  const boostedSlayerState = caveState(['12850']);
  boostedSlayerState.rules['content.f2p'] = false;
  boostedSlayerState.taskRules = { Boosting: true };
  const boostedSlayerProof = createTaskEngine(boostedSlayerDefs).how(boostedSlayerState, 'one', taskId('Quest', 'Need Attack'));
  assert.equal(boostedSlayerProof.availability, 'available');
  assert.equal(boostedSlayerProof.proofStatus, 'partial');
  assert.ok(boostedSlayerProof.gaps.some(gap => gap.kind === 'boosts'), JSON.stringify(boostedSlayerProof.gaps));
  graph(boostedSlayerProof);

  // Partner-only monster and bones preserve partner-duo gaps; Combat prefers an own Magic seed over partner Attack.
  const duoDefs = makeDefs();
  duoDefs.chunks['12850'] = { Nickname: 'Meadow', Object: { Altar: 1 } };
  duoDefs.chunks['12851'] = { Nickname: 'Ruins', Monster: { Goblin: 1 }, Spawn: { Chargebow: 1 } };
  duoDefs.challenges.Magic = { 'Cast spell': { Level: 1, Objects: ['Altar'], Primary: true } };
  const duoState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12850'] }, { id: 'two', name: 'Two', unlocked: ['12851'] }]);
  const duoEngine = createTaskEngine(duoDefs);
  for (const name of ['Need Attack', 'Need Ranged', 'Need Prayer']) {
    const proof = duoEngine.how(duoState, 'one', taskId('Quest', name));
    assert.equal(proof.availability, 'available', name);
    assert.equal(proof.proofStatus, 'partial', name);
    assert.ok(proof.gaps.some(gap => gap.kind === 'partner-duo'), `${name}: ${JSON.stringify(proof.gaps)}`);
    assert.ok(!proof.gaps.some(gap => gap.kind === 'unsupported-training-seed'), name);
    graph(proof);
  }
  const combatProof = duoEngine.how(duoState, 'one', taskId('Quest', 'Need Combat'));
  assert.equal(combatProof.availability, 'available');
  assert.equal(combatProof.proofStatus, 'complete', JSON.stringify(combatProof.gaps));
  assert.match(labels(combatProof), /Cast spell/);
  graph(combatProof);

  // Manual primary override stays a manual-assumption gap.
  const manualDefs = { chunks: { 12850: { Nickname: 'Meadow' } }, challenges: { Quest: { 'Need Attack': { Skills: { Attack: 20 } } } } };
  const manualState = caveState(['12850']);
  manualState.members[0].primaryOverrides = { Attack: true };
  const manualProof = createTaskEngine(manualDefs).how(manualState, 'one', taskId('Quest', 'Need Attack'));
  assert.equal(manualProof.proofStatus, 'partial');
  assert.ok(manualProof.gaps.some(gap => gap.kind === 'manual-assumption'), JSON.stringify(manualProof.gaps));
  graph(manualProof);
});

test('ClueTier and ConnectsSections prove concrete witnesses while preserving partner and remaining special-requirement gaps', async () => {
  const { createGroupState } = await import('../app/core/state.mjs');
  const defs = {
    walkableChunks: ['12849', '12850', '12851'],
    walkableChunksF2P: ['12849', '12850', '12851'],
    sections: { 12849: { 0: ['12850'] }, 12850: { 0: ['12849', '12851'] }, 12851: { 1: ['12850'], 2: [] } },
    chunks: {
      12849: { Nickname: 'South' },
      12850: { Nickname: 'Meadow', Clue: { easy: 1, medium: 1 }, NPC: { Guide: 1 }, Object: { Bridge: 1 } },
      12851: { Nickname: 'Riverbank', Sections: { 1: {}, 2: { Object: { Chest: 1 } } } },
      Sanctuary: { Connect: { 12850: true } },
    },
    challenges: {
      Nonskill: {
        'Find Guide': { ClueTier: 'easy', ClueType: 'Anagram', NPCs: ['Guide'] },
        '12851-1 to 12851-2': { ConnectsSections: true, Sections: ['12851-1', '12851-2'], Objects: ['Bridge'] },
        'Sanctuary to 12851-2': { ConnectsSections: true, Sections: ['Sanctuary', '12851-2'] },
        'Either requirement': { RequirementAlternatives: [{ Skills: { Agility: 1 } }] },
      },
      Extra: {
        'Open east chest': { Objects: ['Chest'] },
      },
    },
  };
  const state = caveState(['12850', '12851']);
  const engine = createTaskEngine(defs);
  const baseline = engine.evaluate(state, 'one');

  // ClueTier proves its reachable clue location without a special-requirements gap.
  const clueProof = engine.how(state, 'one', taskId('Nonskill', 'Find Guide', defs.challenges.Nonskill['Find Guide']), { baseline });
  assert.equal(clueProof.availability, 'available');
  assert.equal(clueProof.proofStatus, 'complete', JSON.stringify(clueProof.gaps));
  assert.match(labels(clueProof), /Reach an easy clue location at Meadow/);
  assert.match(labels(clueProof), /Find Guide at Meadow/);
  assert.ok(!clueProof.gaps.some(gap => gap.kind === 'special-requirements'));
  graph(clueProof);

  // ConnectsSections proves both section-to-section and area-to-section connectors and downstream access without cycling.
  for (const [cat, label] of [['Nonskill', '12851-1 to 12851-2'], ['Nonskill', 'Sanctuary to 12851-2'], ['Extra', 'Open east chest']]) {
    const proof = engine.how(state, 'one', taskId(cat, label), { baseline });
    assert.equal(proof.availability, 'available', label);
    assert.equal(proof.proofStatus, 'complete', `${label}: ${JSON.stringify(proof.gaps)}`);
    assert.ok(!proof.gaps.some(gap => gap.kind === 'special-requirements'), label);
    graph(proof);
  }
  assert.deepEqual(engine.evaluate(state, 'one').tasks, baseline.tasks);

  // Partner-only clue location and partner-only section base keep honest partner-duo gaps.
  const duoState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12849'] }, { id: 'two', name: 'Two', unlocked: ['12850'] }]);
  const duoClue = engine.how(duoState, 'one', taskId('Nonskill', 'Find Guide', defs.challenges.Nonskill['Find Guide']));
  assert.equal(duoClue.availability, 'available');
  assert.equal(duoClue.proofStatus, 'partial');
  assert.ok(duoClue.gaps.some(gap => gap.kind === 'partner-duo'), JSON.stringify(duoClue.gaps));
  assert.ok(!duoClue.gaps.some(gap => ['special-requirements', 'missing-evidence'].includes(gap.kind)), JSON.stringify(duoClue.gaps));
  graph(duoClue);

  const duoConnState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12849'] }, { id: 'two', name: 'Two', unlocked: ['12850', '12851'] }]);
  const duoConn = engine.how(duoConnState, 'one', taskId('Nonskill', 'Sanctuary to 12851-2'));
  assert.equal(duoConn.availability, 'available');
  assert.equal(duoConn.proofStatus, 'partial');
  assert.ok(duoConn.gaps.some(gap => gap.kind === 'partner-duo'), JSON.stringify(duoConn.gaps));
  assert.ok(!duoConn.gaps.some(gap => ['special-requirements', 'missing-evidence'].includes(gap.kind)), JSON.stringify(duoConn.gaps));
  graph(duoConn);

  // Remaining special requirements (such as RequirementAlternatives) still stay honest gaps.
  const specialProof = engine.how(state, 'one', taskId('Nonskill', 'Either requirement'));
  assert.equal(specialProof.proofStatus, 'partial');
  assert.ok(specialProof.gaps.some(gap => gap.kind === 'special-requirements'), JSON.stringify(specialProof.gaps));
  graph(specialProof);

  // Owned bare numeric base endpoint for a sectioned chunk with no entered section does not emit partner-duo.
  const bareDefs = {
    walkableChunks: ['100', '200'],
    walkableChunksF2P: ['100', '200'],
    sections: { 200: { 1: [], 2: [] } },
    chunks: {
      100: { Nickname: 'Meadow' },
      200: { Nickname: 'Island', Sections: { 1: {}, 2: {} } },
    },
    challenges: {
      Nonskill: { '100 to 200': { ConnectsSections: true, Sections: ['100', '200'] } },
    },
  };
  const bareProof = createTaskEngine(bareDefs).how(caveState(['100', '200']), 'one', taskId('Nonskill', '100 to 200'));
  assert.equal(bareProof.availability, 'available');
  assert.equal(bareProof.proofStatus, 'complete', JSON.stringify(bareProof.gaps));
  assert.ok(!bareProof.gaps.some(gap => gap.kind === 'partner-duo'));
  graph(bareProof);

  // Clue task initially admitted via partner clue upgrades to a later-admitted personal cave clue location.
  const upgradeDefs = {
    walkableChunks: ['12849', '12850'],
    walkableChunksF2P: ['12849', '12850'],
    sections: { 12849: { 0: ['12850'] }, 12850: { 0: ['12849'] } },
    chunks: {
      12849: { Nickname: 'South', NPC: { Guide: 1 } },
      12850: { Nickname: 'North', Clue: { easy: 1 } },
      'Clue Cave': { Connect: { 12849: true }, Clue: { easy: 1 } },
    },
    challenges: {
      Quest: { 'Open cave': { Chunks: ['12849'] } },
      Nonskill: {
        'Clue Cave': { UnlocksArea: true, Chunks: ['12849'], Tasks: { 'Open cave': 'Quest' } },
        'Talk to Guide': { ClueTier: 'easy', ClueType: 'Anagram', NPCs: ['Guide'] },
      },
    },
  };
  const upgradeState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12849'] }, { id: 'two', name: 'Two', unlocked: ['12850'] }]);
  const upgradeProof = createTaskEngine(upgradeDefs).how(upgradeState, 'one', taskId('Nonskill', 'Talk to Guide', upgradeDefs.challenges.Nonskill['Talk to Guide']));
  assert.equal(upgradeProof.availability, 'available');
  assert.equal(upgradeProof.proofStatus, 'complete', JSON.stringify(upgradeProof.gaps));
  assert.match(labels(upgradeProof), /Reach an easy clue location at Clue Cave/);
  assert.ok(!upgradeProof.gaps.some(gap => gap.kind === 'partner-duo'));
  graph(upgradeProof);
});

test('NPC and object placements in connected approaches bind entity-entrance area proofs without weakening unbound guards', () => {
  const defs = {
    chunks: {
      100: { Nickname: 'Meadow', NPC: { 'Tool leprechaun': 1, 'Pale wisp': 1 } },
      101: { Nickname: 'Colony', Connect: { 100: true }, Object: { 'Energy rift': 1 } },
      102: { Nickname: 'Courtyard', NPC: { 'Tool leprechaun': 1 } },
      Vinesweeper: { Connect: { 100: true }, Object: { Rabbit: 1 } },
      Cache: { Connect: { 101: true }, Object: { Memory: 1 } },
      Isolated: { Connect: { 100: true }, Object: { Relic: 1 } },
    },
    challenges: {
      Divination: {
        'Harvest wisp': { Level: 1, Primary: true, NPCs: ['Pale wisp'] },
        'Enter cache': { Level: 35, Objects: ['Energy rift'] },
      },
      Nonskill: {
        Vinesweeper: { UnlocksArea: true, NPCs: ['Tool leprechaun'] },
        Cache: { UnlocksArea: true, Tasks: { 'Enter cache': 'Divination' } },
        Isolated: { UnlocksArea: true, Skills: { Divination: 10 } },
      },
      Hunter: { 'Feed rabbit': { Level: 1, Primary: true, Objects: ['Rabbit'] } },
      Extra: {
        'Catch bunny': { Skills: { Hunter: 10 } },
        'Deposit memory': { Objects: ['Memory'] },
        'Touch relic': { Objects: ['Relic'] },
      },
    },
  };
  const engine = createTaskEngine(defs);
  const state = caveState(['100', '101', '102']);

  // Direct NPC placement in connected approach binds Vinesweeper (including as a Hunter training seed).
  const vineProof = engine.how(state, 'one', taskId('Extra', 'Catch bunny'));
  assert.equal(vineProof.availability, 'available');
  assert.equal(vineProof.proofStatus, 'complete', JSON.stringify(vineProof.gaps));
  assert.match(labels(vineProof), /Enter Vinesweeper via Tool leprechaun at Meadow/);
  assert.ok(Object.values(vineProof.nodes).some(node => node.rule === 'entity-entrance' && node.viaEntity === 'Tool leprechaun'));
  graph(vineProof);

  // Indirect Object placement through a prerequisite task binds Cache, not the Divination training seed's NPC.
  const cacheProof = engine.how(state, 'one', taskId('Extra', 'Deposit memory'));
  assert.equal(cacheProof.availability, 'available');
  assert.equal(cacheProof.proofStatus, 'complete', JSON.stringify(cacheProof.gaps));
  assert.match(labels(cacheProof), /Enter Cache via Energy rift at Colony/);
  assert.ok(Object.values(cacheProof.nodes).some(node => node.rule === 'entity-entrance' && node.viaEntity === 'Energy rift'));
  graph(cacheProof);

  // Skill training seed NPCs (Pale wisp in Meadow) cannot bind an area whose permission only lists Skills.
  const isolatedProof = engine.how(state, 'one', taskId('Extra', 'Touch relic'));
  assert.equal(isolatedProof.availability, 'available');
  assert.equal(isolatedProof.proofStatus, 'partial');
  assert.ok(isolatedProof.gaps.some(gap => gap.kind === 'unbound-entrance'), JSON.stringify(isolatedProof.gaps));
  graph(isolatedProof);

  // Rederivation fallback: if a cheaper non-connected NPC placement (Courtyard) exists alongside a connected one (Colony),
  // the proof still binds the connected placement and includes it as a witness.
  const fallbackDefs = {
    chunks: {
      100: { Nickname: 'Meadow' },
      101: { Nickname: 'Colony', Connect: { 100: true }, NPC: { Guide: 1 } },
      102: { Nickname: 'Courtyard', NPC: { Guide: 1 } },
      Sanctum: { Connect: { 101: true }, Object: { Shrine: 1 } },
    },
    challenges: {
      Nonskill: { Sanctum: { UnlocksArea: true, NPCs: ['Guide'] } },
      Extra: { 'Use shrine': { Objects: ['Shrine'] } },
    },
  };
  const fallbackProof = createTaskEngine(fallbackDefs).how(caveState(['100', '101', '102']), 'one', taskId('Extra', 'Use shrine'));
  assert.equal(fallbackProof.availability, 'available');
  assert.equal(fallbackProof.proofStatus, 'complete', JSON.stringify(fallbackProof.gaps));
  assert.match(labels(fallbackProof), /Enter Sanctum via Guide at Colony/);
  assert.ok(Object.values(fallbackProof.nodes).some(node => node.kind === 'placement' && node.subjectId === 'Guide' && node.location === '101'));
  graph(fallbackProof);
});

test('Slayer tasks, XP-reward passive levels, and Slayer unlock gates prove concrete witnesses', () => {
  const defs = {
    chunks: {
      100: {
        Nickname: 'Meadow',
        NPC: { Jacquelyn: 1, Kuradal: 1, Morvran: 1, 'Portmaster Kags': 1 },
        Shop: { 'Slayer Rewards': 1 },
        Monster: { Gargoyle: 1, 'Ice strykewyrm': 1 },
        Spawn: { 'Black mask (10)': 1, Earmuffs: 1, 'Face mask': 1, 'Nose peg': 1, 'Spiny helmet': 1 },
      },
    },
    slayerMonsters: { Gargoyle: 75, 'Ice strykewyrm': 93 },
    challenges: {
      Quest: {
        'Intro quest': { Chunks: ['100'], XpReward: { Crafting: 500 } },
        'Bonus quest': { Chunks: ['100'], XpReward: { Crafting: 1000 } },
        'Smoking Kills Complete the quest': { Chunks: ['100'] },
        "Plague's End Complete the quest": { Chunks: ['100'] },
        'The Jack of Spades 3': { Chunks: ['100'] },
      },
      Slayer: {
        'Receive a slayer assignment from Jacquelyn': { Level: 1, Primary: true, NPCs: ['Jacquelyn'] },
        'Receive a slayer assignment from Kuradal': { Level: 75, NPCs: ['Kuradal'], Tasks: { 'Intro quest': 'Quest' } },
      },
      Extra: {
        'Need XP Crafting': { Skills: { Crafting: 10 } },
        'Kill a gargoyle': { Monsters: ['Gargoyle'] },
        'Learn how to deliver killing blows quicker from a Slayer Master': { Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'] },
        'Learn how to craft a slayer helmet': { Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'], Tasks: { 'Smoking Kills Complete the quest': 'Quest' } },
        "Unlock the use of ferocious rings in Morvran's dungeon": { Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'] },
        'Learn how to how to move souls in the Sunken Pyramid': { Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'] },
        'Learn how to how to attach a bonecrusher to your tool belt': { Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'] },
      },
    },
  };
  const engine = createTaskEngine(defs, { cacheWalking: false, retainedTaskCorrections: false });
  const baseState = () => {
    const s = caveState(['100']);
    s.rules['content.f2p'] = false;
    s.members[0].completedTasks = [taskId('Quest', 'Intro quest')];
    return s;
  };

  // Slayer tasks prove cleanly without slayer-assignments gap; quest prerequisites require personal completion.
  const slayerProof = engine.how(baseState(), 'one', taskId('Slayer', 'Receive a slayer assignment from Kuradal'));
  assert.equal(slayerProof.availability, 'available');
  assert.equal(slayerProof.proofStatus, 'complete', JSON.stringify(slayerProof.gaps));
  assert.match(labels(slayerProof), /recorded completing Intro quest/);
  assert.match(labels(slayerProof), /train Slayer to 75/);
  graph(slayerProof);

  // XP rewards sum concrete contributing quests to prove passive skill levels.
  const xpProof = engine.how(baseState(), 'one', taskId('Extra', 'Need XP Crafting'));
  assert.equal(xpProof.availability, 'available');
  assert.equal(xpProof.proofStatus, 'complete', JSON.stringify(xpProof.gaps));
  assert.ok(Object.values(xpProof.nodes).some(node => node.rule === 'xp-rewards' && node.skill === 'Crafting' && node.required === 10));
  assert.match(labels(xpProof), /Intro quest/);
  assert.match(labels(xpProof), /Bonus quest/);
  graph(xpProof);

  // Slayer-level monster requirements prove Slayer skill level.
  const gargoyleProof = engine.how(baseState(), 'one', taskId('Extra', 'Kill a gargoyle'));
  assert.equal(gargoyleProof.availability, 'available');
  assert.equal(gargoyleProof.proofStatus, 'complete', JSON.stringify(gargoyleProof.gaps));
  assert.match(labels(gargoyleProof), /train Slayer to 75/);
  graph(gargoyleProof);

  // Slayer unlock gates prove monsters, item alternatives (charged black mask), area entrances, and Future Slayer unlocks bypass.
  for (const [name, pattern] of [
    ['Learn how to deliver killing blows quicker from a Slayer Master', /Find Gargoyle at Meadow/],
    ['Learn how to craft a slayer helmet', /Black mask \(10\)/],
    ["Unlock the use of ferocious rings in Morvran's dungeon", /Find Morvran at Meadow/],
    ['Learn how to how to move souls in the Sunken Pyramid', /train Slayer to 99/],
  ]) {
    const proof = engine.how(baseState(), 'one', taskId('Extra', name));
    assert.equal(proof.availability, 'available', name);
    assert.equal(proof.proofStatus, 'complete', `${name}: ${JSON.stringify(proof.gaps)}`);
    assert.match(labels(proof), pattern, name);
    graph(proof);
  }

  const bypassState = baseState();
  bypassState.taskRules = { 'Future Slayer unlocks': true };
  const bypassProof = engine.how(bypassState, 'one', taskId('Extra', 'Learn how to how to attach a bonecrusher to your tool belt'));
  assert.equal(bypassProof.availability, 'available');
  assert.equal(bypassProof.proofStatus, 'complete', JSON.stringify(bypassProof.gaps));
  assert.ok(Object.values(bypassProof.nodes).some(node => node.rule === 'slayer-unlock-bypass'));
  graph(bypassProof);

  // Slayer lock records personal Slayer level without falling back to xp-contributors.
  const lockDefs = {
    chunks: { 100: { Nickname: 'Meadow', Monster: { Gargoyle: 1 } } },
    slayerMonsters: { Gargoyle: 75 },
    challenges: { Extra: { 'Kill a gargoyle': { Monsters: ['Gargoyle'] } } },
  };
  const lockState = caveState(['100']);
  lockState.rules['content.f2p'] = false;
  lockState.members[0].slayerLock = { level: 75, monster: 'Abyssal demons' };
  const lockProof = createTaskEngine(lockDefs, { cacheWalking: false, retainedTaskCorrections: false })
    .how(lockState, 'one', taskId('Extra', 'Kill a gargoyle'));
  assert.equal(lockProof.availability, 'available');
  assert.equal(lockProof.proofStatus, 'complete', JSON.stringify(lockProof.gaps));
  assert.ok(Object.values(lockProof.nodes).some(node => node.rule === 'slayer-lock-level'));
  graph(lockProof);

  // Slayer tasks with an alternative Quest dependency only cite a personally completed quest, never an uncompleted available one.
  const altQuestDefs = {
    chunks: { 100: { Nickname: 'Meadow', NPC: { Kuradal: 1 } } },
    codeItems: { tasksPlus: { 'AnyQuest[+]': ['Quest A', 'Quest B'] } },
    challenges: {
      Quest: { 'Quest A': { Chunks: ['100'] }, 'Quest B': { Chunks: ['100'] } },
      Slayer: { 'Receive a slayer assignment from Kuradal': { Level: 1, NPCs: ['Kuradal'], Tasks: { 'AnyQuest[+]': 'Quest' } } },
    },
  };
  const altQuestState = caveState(['100']);
  altQuestState.rules['content.f2p'] = false;
  altQuestState.members[0].completedTasks = [taskId('Quest', 'Quest B')];
  const altQuestProof = createTaskEngine(altQuestDefs, { cacheWalking: false, retainedTaskCorrections: false })
    .how(altQuestState, 'one', taskId('Slayer', 'Receive a slayer assignment from Kuradal'));
  assert.equal(altQuestProof.availability, 'available');
  assert.equal(altQuestProof.proofStatus, 'complete', JSON.stringify(altQuestProof.gaps));
  assert.match(labels(altQuestProof), /recorded completing Quest B/);
  assert.doesNotMatch(labels(altQuestProof), /Quest A/);
  graph(altQuestProof);
});
