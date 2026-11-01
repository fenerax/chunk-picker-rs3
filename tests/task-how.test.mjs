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
  assert.equal(Object.values(proof.nodes).filter(node => node.kind === 'task' && node.subjectId !== taskId('Extra', 'Goal')).length, 2); graph(proof);
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
  assert.ok(partner.gaps.some(gap => gap.detail === 'This supply uses partner access.'));
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
