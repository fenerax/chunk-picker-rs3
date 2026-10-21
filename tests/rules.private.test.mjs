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
      sectionTopology: new Map(ids.map(id => [id, new Map([['0', []]])])),
      neighbors: new Map([['a', ['b', 'c', 'd', 'd', 'f', 'g', 'h']], ['b', ['a', 'e']]]),
      walkable: new Set(ids.filter(id => id !== 'g')),
      f2p: new Set(ids.filter(id => id !== 'f')),
    },
    state: {
      schemaVersion: 1, revision: 0, rules: { 'roll.neighborMode': geometricMode },
      members: [
        { id: 'player1', name: 'Player 1', sourceMapId: 'qxa', unlocked: ['a'], selected: ['h'], pendingRoll: [], blacklisted: ['d'], completedTasks: [], teleports: [{ id: 'home', label: 'Home', destination: 'i', available: true, consumable: false }, { id: 'fixture-return', destination: 'a', available: true, consumable: false }] },
        { id: 'player2', name: 'Player 2', sourceMapId: 'qxb', unlocked: ['b'], selected: [], blacklisted: ['c'], completedTasks: ['quest'], teleports: [{ id: 'far', label: 'Far', destination: 'e', available: true, consumable: false }, { id: 'fixture-return', destination: 'b', available: true, consumable: false }] },
      ],
      tasks: [{ id: 'quest', label: 'Personal quest', category: 'quest' }], history: [],
    },
  };
}
const ids = entries => entries.map(entry => entry.id);

test('Temple of Amascut requires its recorded entry boundary, a personal teleport, or a manual selection', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const member = id => ({ id, unlocked: [], selected: [], pendingRoll: [], blacklisted: [], teleports: [], sectionOverrides: {} });
  const state = { rules: { 'content.f2p': false }, members: [member('player1'), member('player2')] };
  state.members[0].unlocked = ['12336'];
  state.members[1].unlocked = ['12593'];
  const templeEligible = owner => ids(evaluateRollPool(world, state, owner).eligible).includes('12592');
  assert.equal(createRuleRegistry().defaults['roll.neighborMode'], 'accessible');
  assert.ok(world.neighbors.get('12336').includes('12592'));
  assert.ok(world.neighbors.get('12593').includes('12592'));
  assert.ok(world.walkable.has('12592'), 'terrain flags alone cannot establish entry');
  assert.equal(world.f2p.has('12592'), false);
  const before = structuredClone(state);
  assert.equal(templeEligible('player1'), false);
  assert.equal(templeEligible('player2'), false);
  assert.deepEqual(state, before);

  state.members[0].teleports.push({ id: 'temple', destination: '12592', available: false, consumable: false });
  assert.equal(templeEligible('player1'), false);
  state.members[0].teleports[0].available = true;
  state.members[0].teleports.push({ id: 'fixture-home', destination: '12336', available: true, consumable: false });
  assert.equal(templeEligible('player1'), true);
  assert.equal(templeEligible('player2'), false, 'shared unlock access does not share personal teleports');
  assert.ok(!evaluateRollPool(world, state, 'player1').accessible.includes('12592'));
  state.members[0].teleports[0].available = false;
  state.members[0].selected.push('12592');
  assert.equal(templeEligible('player1'), true);
  assert.equal(templeEligible('player2'), false);
  state.members[0].selected = [];

  state.members[1].unlocked.push('12848');
  assert.equal(templeEligible('player1'), false, 'the partner entry does not widen a personal roll pool');
  state.members[0].unlocked.push('12848');
  assert.equal(templeEligible('player1'), true, 'the personal Kalphite Hive entry is now unlocked');
  assert.equal(templeEligible('player2'), true);
  state.members[0].sectionOverrides['12848-0'] = false;
  assert.equal(templeEligible('player1'), false, 'a personal source-boundary block prevents entry');
  assert.equal(templeEligible('player2'), true);
  delete state.members[0].sectionOverrides['12848-0'];
  state.members[0].sectionOverrides['12592-0'] = false;
  assert.equal(templeEligible('player1'), false, 'a blocked destination section prevents automatic entry');
  delete state.members[0].sectionOverrides['12592-0'];
  assert.equal(templeEligible('player1'), true);

  state.members[1].unlocked = ['12593'];
  state.rules['roll.neighborMode'] = 'frontier';
  assert.equal(templeEligible('player1'), true, 'explicit geometric house rule remains available');
});

test('shared access unions unlocks while ownership and teleport destinations stay locked', () => {
  const { world, state } = fixture();
  const before = structuredClone(state);
  const pool = evaluateRollPool(world, state, 'player1');
  assert.deepEqual(pool.accessible, ['a', 'b']);
  assert.deepEqual(ids(pool.eligible), ['b', 'c', 'h', 'i']);
  assert.ok(pool.eligible.find(entry => entry.id === 'i').reasons.some(reason => reason.ruleId === 'roll.teleports'));
  assert.ok(!pool.accessible.includes('i'));
  assert.deepEqual(state, before);
});

test('personal access and manually available personal/group teleports are independent', () => {
  const { world, state } = fixture();
  state.rules = { 'access.shared': false, 'roll.adjacent': false, 'roll.selected': false };
  assert.deepEqual(evaluateRollPool(world, state, 'player1').accessible, ['a']);
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['i']);
  state.rules['roll.teleportScope'] = 'group';
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['b', 'e', 'i']);
  state.members[1].teleports[0].available = false;
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['b', 'i']);
  state.rules['roll.teleports'] = false;
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
});

test('manual neighbor mode rolls only saved selections and available teleports', () => {
  const { world, state } = fixture();
  state.rules['roll.neighborMode'] = 'manual';
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['h', 'i']);
  assert.ok(evaluateRollPool(world, state, 'player1').eligible.every(entry => entry.reasons.every(reason => reason.ruleId !== 'roll.adjacent')));
  state.rules['roll.neighborMode'] = 'unknown';
  assert.throws(() => evaluateRollPool(world, state, 'player1'), /must be one of/);
});

test('consumable teleports are opt-in and do not affect an adjacent route to the same chunk', () => {
  const { world, state } = fixture();
  state.members[0].teleports[0].consumable = true;
  assert.ok(!ids(evaluateRollPool(world, state, 'player1').eligible).includes('i'));
  state.rules['roll.consumableTeleports'] = true;
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('i'));
  state.rules['roll.consumableTeleports'] = false;
  state.members[0].teleports[0].destination = 'c';
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('c'));
});

test('pending roll, target blacklist, unlocked, nonwalkable and F2P exclusions explain every blocker', () => {
  const { world, state } = fixture();
  state.members[0].pendingRoll = ['h']; state.members[0].selected.push('a');
  const pool = evaluateRollPool(world, state, 'player1');
  assert.deepEqual(ids(pool.excluded), ['a', 'd', 'f', 'g', 'h']);
  for (const [id, rule] of [['a', 'state.unlocked'], ['d', 'state.blacklisted'], ['f', 'content.f2p'], ['g', 'roll.walkable'], ['h', 'state.pendingRoll']]) {
    assert.ok(pool.excluded.find(entry => entry.id === id).reasons.some(reason => reason.ruleId === rule));
  }
  assert.ok(ids(pool.eligible).includes('c'), 'Player 2’s personal blacklist must not exclude Player 1’s candidate');
  state.rules['content.f2p'] = false;
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('f'));
  assert.ok(!ids(evaluateRollPool(world, state, 'player1').eligible).includes('g'));
});

test('selected candidates are included even when isolated, personal, and independently configurable', () => {
  const { world, state } = fixture();
  state.rules = { 'roll.adjacent': false, 'roll.teleports': false };
  state.members[0].selected.push('f');
  state.members[0].selected.push('g');
  state.members[1].selected.push('e');
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['f', 'g', 'h']);
  assert.ok(evaluateRollPool(world, state, 'player1').eligible[0].reasons.some(reason => reason.ruleId === 'roll.selected'));
  state.rules['content.f2p'] = false;
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['f', 'g', 'h']);
  state.rules['roll.selected'] = false;
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
});

test('walkable is configurable for derived candidates while F2P stays independent', () => {
  const { world, state } = fixture();
  state.rules['roll.walkable'] = false;
  const pool = evaluateRollPool(world, state, 'player1');
  assert.ok(ids(pool.eligible).includes('g'));
  assert.ok(!ids(pool.eligible).includes('f'));
  state.rules['content.f2p'] = false;
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('f'));
});

test('optional surface crop still excludes selected, teleport and adjacent destinations', () => {
  const { world, state } = fixture();
  world.surface = new Set(['a', 'b', 'd', 'e']);
  const pool = evaluateRollPool(world, state, 'player1');
  for (const id of ['c', 'h', 'i']) {
    assert.ok(pool.excluded.find(entry => entry.id === id).reasons.some(reason => reason.ruleId === 'world.surface'));
  }
  assert.deepEqual(ids(pool.eligible), ['b']);
  delete world.surface;
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('h'));
  world.surface = [];
  assert.throws(() => evaluateRollPool(world, state, 'player1'), /world.surface must be a Set/);
});

test('explicit selected candidates cannot bypass ownership, pending, blacklist, known-world or custom exclusions', () => {
  const { world, state } = fixture();
  state.rules = { 'roll.adjacent': false, 'roll.teleports': false };
  state.members[0].selected = ['a', 'b', 'c', 'd', 'h', 'unknown'];
  state.members[0].pendingRoll = ['h'];
  const registry = createRuleRegistry([{ id: 'house.veto', type: 'boolean', default: true, exclude({ candidateId }) { return candidateId === 'c' ? 'Custom selected veto.' : null; } }]);
  const pool = evaluateRollPool(world, state, 'player1', registry);
  assert.deepEqual(ids(pool.eligible), ['b']);
  for (const [id, blocker] of [['a', 'state.unlocked'], ['c', 'house.veto'], ['d', 'state.blacklisted'], ['h', 'state.pendingRoll'], ['unknown', 'world.known']]) {
    assert.ok(pool.excluded.find(entry => entry.id === id).reasons.some(reason => reason.ruleId === blocker));
  }
});

test('teleport candidates still respect blacklist and pending roll exclusions', () => {
  const { world, state } = fixture();
  state.rules['roll.adjacent'] = false;
  state.members[0].pendingRoll = ['h'];
  state.members[0].teleports.push({ id: 'blocked', label: 'Blocked', destination: 'd', available: true, consumable: false });
  state.members[0].teleports.push({ id: 'selected', label: 'Selected', destination: 'h', available: true, consumable: false });
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').eligible), ['i']);
  assert.deepEqual(ids(evaluateRollPool(world, state, 'player1').excluded), ['a', 'd', 'h']);
});

test('custom hooks add and exclude candidates without engine changes, in deterministic priority order', () => {
  const { world, state } = fixture();
  const seen = [];
  const registry = createRuleRegistry([
    { id: 'house.z', type: 'boolean', default: true, priority: 80, candidates({ value }) { seen.push('z'); return value ? [{ id: 'i', detail: 'Event reward.' }, { id: 'i', detail: 'Event reward.' }] : []; } },
    { id: 'house.a', type: 'boolean', default: true, priority: 70, candidates() { seen.push('a'); return [{ id: 'e', detail: 'Event access.' }]; }, exclude({ value, candidateId }) { return value && candidateId === 'i' ? ['Wait for the event.', 'Wait for the event.'] : null; } },
  ]);
  const before = structuredClone(state);
  const pool = evaluateRollPool(world, state, 'player1', registry);
  assert.deepEqual(seen, ['a', 'z']);
  assert.ok(!ids(pool.eligible).includes('i'));
  const reasons = pool.excluded.find(entry => entry.id === 'i').reasons;
  assert.deepEqual(reasons.map(reason => reason.ruleId), ['roll.teleports', 'house.a', 'house.z']);
  assert.equal(reasons.filter(reason => reason.detail === 'Event reward.').length, 1);
  assert.deepEqual(state, before);
  state.rules['house.a'] = false;
  assert.ok(ids(evaluateRollPool(world, state, 'player1', registry).eligible).includes('i'));
});

test('candidate/reason deduplication and output ordering ignore graph and member order', () => {
  const { world, state } = fixture();
  state.members[0].teleports.push({ ...state.members[0].teleports[0] });
  const first = evaluateRollPool(world, state, 'player1');
  assert.equal(first.eligible.find(entry => entry.id === 'i').reasons.length, 1);
  assert.equal(first.excluded.find(entry => entry.id === 'd').reasons.filter(reason => reason.ruleId === 'roll.adjacent').length, 1);
  world.neighbors.set('a', [...world.neighbors.get('a')].reverse());
  state.members.reverse();
  assert.deepEqual(evaluateRollPool(world, state, 'player1'), first);
});

test('registry validates unknown IDs, setting types, enum options, and registration', () => {
  const registry = createRuleRegistry();
  assert.deepEqual(registry.resolve({}), registry.defaults);
  assert.ok(builtInRules.every(definition => Object.isFrozen(definition)));
  assert.throws(() => registry.resolve({ surprise: true }), /Unknown rule setting/);
  assert.throws(() => registry.resolve({ 'access.shared': 'true' }), /must be a boolean/);
  assert.throws(() => registry.resolve({ 'roll.teleportScope': 'shared' }), /must be one of/);
  assert.throws(() => createRuleRegistry([{ id: 'access.shared', type: 'boolean', default: false }]), /Duplicate/);
  assert.throws(() => createRuleRegistry([{ id: 'custom', type: 'boolean', default: 'true' }]), /must be a boolean/);
  assert.throws(() => createRuleRegistry([{ id: 'custom', type: 'enum', default: 'a', options: ['a', 'a'] }]), /unique/);
  assert.throws(() => createRuleRegistry([{ id: 'custom', type: 'boolean', default: true, candidates: 'eval()' }]), /must be a function/);
});

test('clear-selected roll policy is declarative, opt-in, and leaves candidate evaluation unchanged', () => {
  const registry = createRuleRegistry();
  const definition = registry.get('roll.clearSelected');
  assert.equal(definition.type, 'boolean');
  assert.equal(definition.label, 'Empty the hand-added roll pool after each roll');
  assert.equal(registry.defaults['roll.clearSelected'], false);
  assert.equal(definition.candidates, undefined);
  assert.equal(definition.exclude, undefined);
  assert.ok(Object.isFrozen(definition));
  assert.equal(registry.resolve({ 'roll.clearSelected': true })['roll.clearSelected'], true);
  assert.throws(() => registry.resolve({ 'roll.clearSelected': 'true' }), /must be a boolean/);
  const { world, state } = fixture();
  const before = structuredClone(state);
  const normal = evaluateRollPool(world, state, 'player1');
  state.rules['roll.clearSelected'] = true;
  assert.deepEqual(evaluateRollPool(world, state, 'player1'), normal);
  assert.deepEqual(state.members, before.members);
});

