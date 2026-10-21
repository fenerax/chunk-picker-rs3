import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld } from '../app/data/world.mjs';
import { builtInRules, createRuleRegistry, evaluateRollPool, taskCompletion, challengeCompletion, reachableSections, sampleRoll } from '../app/core/rules.mjs';

// Both providers use this branch for geometry-only neighbours, with different enum labels.
const geometricMode = createRuleRegistry().get('roll.neighborMode').options.find(value => value === 'frontier' || value === 'geometric');
function fixture() {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  return {
    world: {
      chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])),
      neighbors: new Map([['a', ['b', 'c', 'd', 'd', 'f', 'g', 'h']], ['b', ['a', 'e']]]),
      walkable: new Set(ids.filter(id => id !== 'g')),
      f2p: new Set(ids.filter(id => id !== 'f')),
    },
    state: {
      schemaVersion: 1, revision: 0, rules: { 'roll.neighborMode': geometricMode },
      members: [
        { id: 'actor1', name: 'Player', sourceMapId: 'bbb', unlocked: ['a'], selected: ['h'], pendingRoll: [], blacklisted: ['d'], completedTasks: [], teleports: [{ id: 'home', label: 'Home', destination: 'i', available: true, consumable: false }] },
        { id: 'reed', name: 'Reed', sourceMapId: 'aaa', unlocked: ['b'], selected: [], blacklisted: ['c'], completedTasks: ['quest'], teleports: [{ id: 'far', label: 'Far', destination: 'e', available: true, consumable: false }] },
      ],
      tasks: [{ id: 'quest', label: 'Personal quest', category: 'quest' }], history: [],
    },
  };
}
const ids = entries => entries.map(entry => entry.id);


test('automatic neighbors fail closed when topology is absent and overrides cannot invent a boundary', () => {
  const { world, state } = fixture();
  state.rules = {};
  state.members[0].selected = [];
  state.members[0].teleports = [];
  state.members[0].sectionOverrides = { 'c-0': true };
  assert.deepEqual(evaluateRollPool(world, state, 'actor1').eligible, []);
});



test('personal adjacency includes partner-owned chunks regardless of shared task access', () => {
  const { world, state } = fixture();
  state.rules['access.shared'] = false;
  assert.ok(ids(evaluateRollPool(world, state, 'actor1').eligible).includes('b'));
  state.rules['access.shared'] = true;
  assert.ok(ids(evaluateRollPool(world, state, 'actor1').eligible).includes('b'));
});


test('accessible mode gates geometric neighbors with section edges and terminates cyclic topology', () => {
  const chunkIds = ['10', '11', '12', '13', '14', '15'];
  const world = { chunks: new Map(chunkIds.map(id => [id, { id }])), neighbors: new Map([['10', ['12', '13', '14', '15']]]), walkable: new Set(['10', '11']), f2p: new Set(chunkIds), sectionTopology: new Map([
    ['10', new Map([['0', ['11']], ['1', ['10-2']], ['2', ['10-1']]])],
    ['11', new Map([['1', ['10-2']]])],
    ['12', new Map([['0', ['10-1']]])],
    ['13', new Map([['1', ['11']]])],
    ['15', new Map([['1', ['11-1']]])],
  ]) };
  const state = { rules: { 'roll.neighborMode': 'accessible' }, members: [{ id: 'p', unlocked: ['10'], selected: [], pendingRoll: [], blacklisted: [], teleports: [] }, { id: 'q', unlocked: ['11'], selected: [], blacklisted: [], teleports: [], sectionOverrides: { '10-1': true } }] };
  assert.deepEqual(reachableSections(world, state, 'p'), []);
  assert.deepEqual(ids(evaluateRollPool(world, state, 'p').eligible), [], 'a bare split base does not bypass unreachable sections');
  state.members[0].sectionOverrides = { '10-1': true };
  assert.deepEqual(reachableSections(world, state, 'p'), ['10-1', '10-2']);
  assert.deepEqual(ids(evaluateRollPool(world, state, 'p').eligible), ['12'], 'shared reachable sections do not widen personal roll origins');
  state.members[0].sectionOverrides['10-2'] = false;
  state.members[0].sectionOverrides['13-1'] = false;
  assert.deepEqual(reachableSections(world, state, 'p'), ['10-1']);
  assert.deepEqual(ids(evaluateRollPool(world, state, 'p').eligible), ['12']);
  state.members[0].sectionOverrides = { '10-0': true };
  assert.deepEqual(reachableSections(world, state, 'p'), [], 'section0 never expands');
  assert.deepEqual(ids(evaluateRollPool(world, state, 'p').eligible), []);
  world.f2p.delete('13');
  assert.deepEqual(evaluateRollPool(world, state, 'p').eligible, [], 'F2P still applies in accessible mode despite walkable bypass');
});

test('reachable sections retain legacy manual numeric-key fallback without rewriting raw records', () => {
  const world = { sectionTopology: new Map([['10', new Map([['1', []], ['2', ['10-1']]])]]) };
  const state = { rules: {}, members: [{ id: 'p', sourceMapId: 'map', unlocked: ['10'] }], legacy: { maps: { map: { chunkinfo: { manualSections: { '*fb*_10': { '*fb*_1': true } } } } } } };
  const before = structuredClone(state);
  assert.deepEqual(reachableSections(world, state, 'p'), ['10-1', '10-2']);
  assert.deepEqual(state, before);
  state.members[0].sectionOverrides = { '10-1': false };
  assert.deepEqual(reachableSections(world, state, 'p'), []);
});








test('task any/all/personal rules preserve each member’s actual completion', () => {
  const { state } = fixture();
  const before = structuredClone(state);
  assert.deepEqual(taskCompletion(state, 'quest', 'actor1'), { personal: false, group: true, completedBy: ['reed'], requiredBy: ['actor1', 'reed'] });
  assert.equal(taskCompletion(state, 'quest', 'reed').personal, true);
  assert.deepEqual(state, before);
  state.rules['tasks.completion'] = 'all';
  assert.equal(taskCompletion(state, 'quest', 'actor1').group, false);
  state.members[0].completedTasks.push('quest');
  assert.equal(taskCompletion(state, 'quest', 'actor1').group, true);
  state.members[0].completedTasks = [];
  state.rules['tasks.completion'] = 'personal';
  assert.deepEqual(taskCompletion(state, 'quest', 'actor1'), { personal: false, group: false, completedBy: ['reed'], requiredBy: ['actor1'] });
  assert.equal(taskCompletion(state, 'quest', 'reed').group, true);
  assert.throws(() => taskCompletion(state, 'missing', 'actor1'), /Unknown task/);
});

test('challenge completion computes duo satisfaction independently of personal game completion', () => {
  const { state } = fixture();
  state.members[0].taskStatus = { quest: { challengeCompleted: true } };
  assert.deepEqual(challengeCompletion(state, 'quest', 'reed'), { personal: false, group: true, completedBy: ['actor1'], requiredBy: ['actor1', 'reed'] });
  assert.deepEqual(taskCompletion(state, 'quest', 'actor1').completedBy, ['reed']);
  state.rules['tasks.completion'] = 'all';
  assert.equal(challengeCompletion(state, 'quest', 'reed').group, false);
  state.members[1].taskStatus = { quest: { challengeCompleted: true } };
  assert.equal(challengeCompletion(state, 'quest', 'reed').group, true);
  state.rules['tasks.completion'] = 'personal';
  assert.equal(challengeCompletion(state, 'quest', 'reed').personal, true);
});



test('custom hooks cannot mutate state, member, world, accessible or stored collection values', () => {
  const mutations = [
    ({ state }) => state.members.push({ id: 'intruder' }),
    ({ state }) => state.members.reverse(),
    ({ member }) => member.unlocked.push('i'),
    ({ member }) => { member.teleports[0].available = false; },
    ({ world }) => world.chunks.set('intruder', { id: 'intruder' }),
    ({ world }) => world.neighbors.clear(),
    ({ world }) => world.walkable.add('intruder'),
    ({ world }) => world.f2p.delete('a'),
    ({ accessible }) => accessible.add('i'),
    ({ world }) => world.neighbors.get('a').reverse(),
    ({ world }) => { world.chunks.get('a').name = 'Changed'; },
    ({ world }) => world.chunks.forEach((value, key, map) => map.set('intruder', value)),
    ({ world }) => world.walkable.forEach((value, key, set) => set.add('intruder')),
    ({ world }) => world.chunks.valueOf().set('intruder', {}),
    ({ world }) => { world.walkable = new Set(); },
  ];
  for (const mutation of mutations) {
    for (const kind of ['candidates', 'exclude']) {
      const { world, state } = fixture();
      const beforeWorld = structuredClone(world);
      const beforeState = structuredClone(state);
      const registry = createRuleRegistry([{ id: 'house.mutate', type: 'boolean', default: true, [kind]: context => { mutation(context); return kind === 'candidates' ? [] : null; } }]);
      assert.throws(() => evaluateRollPool(world, state, 'actor1', registry), TypeError);
      assert.deepEqual(world, beforeWorld);
      assert.deepEqual(state, beforeState);
    }
  }
});

test('custom read-only Map/Set facades preserve lookups, iteration, instanceof and frozen values', () => {
  const { world, state } = fixture();
  const registry = createRuleRegistry([{ id: 'house.read', type: 'boolean', default: true, candidates(context) {
    assert.ok(context.world.chunks instanceof Map);
    assert.ok(context.accessible instanceof Set);
    assert.equal(context.world.chunks.size, 9);
    assert.equal(context.world.chunks.get('a').name, 'Chunk a');
    assert.ok(Object.isFrozen(context.world.neighbors.get('a')));
    assert.ok(Object.isFrozen(context.state.members));
    assert.equal(context.member, context.state.members.find(member => member.id === 'actor1'));
    assert.deepEqual([...context.accessible], ['a']);
    const keys = [];
    context.world.chunks.forEach((value, key, map) => { assert.equal(map, context.world.chunks); keys.push(key); });
    assert.deepEqual(keys, [...world.chunks.keys()]);
    return [{ id: 'i', detail: 'Read-only lookup succeeded.' }];
  } }]);
  assert.ok(ids(evaluateRollPool(world, state, 'actor1', registry).eligible).includes('i'));
});



test('invalid world, member and hook outputs fail explicitly', () => {
  const { world, state } = fixture();
  assert.throws(() => evaluateRollPool({}, state, 'actor1'), /World needs/);
  assert.throws(() => evaluateRollPool(world, state, 'missing'), /Unknown member/);
  const badCandidate = createRuleRegistry([{ id: 'bad', type: 'boolean', default: true, candidates: () => [{ id: 'c', detail: '' }] }]);
  assert.throws(() => evaluateRollPool(world, state, 'actor1', badCandidate), /reason string/);
  const unknown = createRuleRegistry([{ id: 'unknown', type: 'boolean', default: true, candidates: () => [{ id: 'missing', detail: 'Unknown extension destination.' }] }]);
  assert.ok(evaluateRollPool(world, state, 'actor1', unknown).excluded.find(entry => entry.id === 'missing').reasons.some(reason => reason.ruleId === 'world.known'));
});

test('sampling zero/one/two edges rejects oversize requests before consuming randomness', () => {
  let calls = 0;
  const random = () => { calls++; return 0; };
  const one = [{ id: 'a', reasons: [] }];
  assert.deepEqual(sampleRoll([], 0, random), []);
  assert.deepEqual(sampleRoll(one, 0, random), []);
  assert.throws(() => sampleRoll([], 1, random), RangeError);
  assert.throws(() => sampleRoll(one, 2, random), RangeError);
  assert.equal(calls, 0);
  assert.deepEqual(ids(sampleRoll(one, 1, random)), ['a']);
  assert.equal(calls, 1);
  assert.deepEqual(ids(sampleRoll([{ id: 'a' }, { id: 'b' }], 2, random)), ['a', 'b']);
  for (const size of [-1, 0.5, NaN, Infinity, '1']) assert.throws(() => sampleRoll(one, size), RangeError);
});

test('sampling uses independent unbiased positions, no replacement, and leaves inputs unchanged', () => {
  const input = { eligible: [{ id: 'a', reasons: [{ ruleId: 'test', detail: 'A' }] }, { id: 'b', reasons: [] }, { id: 'c', reasons: [] }] };
  const before = structuredClone(input);
  const draws = [0.9, 0];
  const result = sampleRoll(input, 2, () => draws.shift());
  assert.deepEqual(ids(result), ['c', 'b']);
  assert.equal(new Set(ids(result)).size, 2);
  assert.deepEqual(input, before);
  const copy = sampleRoll(input, 1, () => 0);
  copy[0].reasons[0].detail = 'Changed';
  assert.deepEqual(input, before);
  for (const value of [-0.1, 1, NaN, Infinity, '0.5']) assert.throws(() => sampleRoll(input, 1, () => value), /Random source/);
  assert.throws(() => sampleRoll([{ id: 'a' }, { id: 'a' }], 1), /unique/);
  assert.throws(() => sampleRoll(input, 1, 0), /must be a function/);
});

test('injected uniform values give each candidate every available first/second position', () => {
  const pool = ['a', 'b', 'c'].map(id => ({ id }));
  const pairs = [];
  for (const first of [0, 1 / 3, 2 / 3]) {
    for (const second of [0, 1 / 2]) {
      const draws = [first, second];
      pairs.push(ids(sampleRoll(pool, 2, () => draws.shift())).join(''));
    }
  }
  assert.deepEqual(pairs.sort(), ['ab', 'ac', 'ba', 'bc', 'ca', 'cb']);
});

test('default cryptographic sampling runs in Node and preserves eligible pool', () => {
  const pool = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const before = structuredClone(pool);
  const result = sampleRoll(pool, 4);
  assert.deepEqual(ids(result).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pool, before);
});

test('default crypto rejection sampling discards the uneven tail before choosing a candidate', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const draws = [0xffffffff, 2];
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues(buffer) { calls++; buffer[0] = draws.shift(); return buffer; } } });
    assert.deepEqual(ids(sampleRoll(['a', 'b', 'c'].map(id => ({ id })), 1)), ['c']);
    assert.equal(calls, 2);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
