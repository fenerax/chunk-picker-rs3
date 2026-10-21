import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld } from '../app/data/world.mjs';
import { cacheEntryPolicies, cacheEntryKinds } from '../app/data/cache-entry-policy.mjs';
import { createRuleRegistry, evaluateRollPool, reachableSections, partnerConnections } from '../app/core/rules.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { surfaceReachability } from '../app/core/cache-surface.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import surfaceCorrections from '../app/data/cache-surface-corrections.2026-10-08.v1.json' with { type: 'json' };

const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const world = buildWorld(definitions, { dataset: selectedDataset });
const stateFor = (selected = []) => createGroupState([{ id: 'player1', name: 'Player 1', selected }]);

test('every cache-world walkable surface region has a witnessed external edge or a typed entry', () => {
  for (const base of world.surface) {
    const policy = world.cacheWalking.eligibility.get(base);
    assert.equal(world.walkable.has(base), policy.eligible, base);
    assert.equal(policy.eligible, policy.walking.length > 0 || policy.entries.length > 0, base);
    for (const witness of policy.walking) {
      assert.ok(witness.portals > 0);
      assert.ok(witness.witness.every(Number.isFinite));
      assert.ok(world.cacheWalking.components.has(witness.component));
      assert.ok(world.cacheWalking.components.has(witness.neighbor));
      assert.ok(world.neighbors.get(base).includes(witness.neighbor.split('-')[0]));
    }
    for (const entry of policy.entries) {
      assert.ok(cacheEntryKinds.has(entry.kind));
      assert.ok(entry.evidence);
    }
    if (!policy.eligible) {
      assert.equal(world.f2p.has(base), false, base);
      assert.equal(world.componentMembership.has(base), false, base);
    }
  }
});

test('isolated floors and ship decks do not qualify, and missing coverage stays explicit', () => {
  for (const base of ['10301', '10540', '7727', '8244', '15430']) {
    assert.equal(world.walkable.has(base), false, base);
    assert.ok(world.cacheWalking.blockedRegions.has(base));
  }
  assert.equal(world.cacheWalking.eligibility.get('10301').reason, 'isolated-components-without-entry');
  assert.ok(world.cacheWalking.components.get('10301-1000001').tiles > 0, 'geometry remains available for diagnostics');
  assert.equal(world.cacheWalking.eligibility.get('10540').reason, 'empty-plane-0-without-entry');
  assert.equal(world.cacheWalking.eligibility.get('8244').reason, 'unknown-surface-coverage-without-entry');
  assert.ok(world.cacheWalking.topology.get('8244').get('0').length, 'retained resource compatibility is separate from roll qualification');
  assert.ok(world.walkable.has('12080'), 'two tiles with witnessed edges qualify without an area threshold');
});

test('documented boats, portals, quest routes and lodestones preserve real isolated destinations without inventing walking', () => {
  for (const entry of cacheEntryPolicies) {
    const base = entry.location.split('-')[0], policy = world.cacheWalking.eligibility.get(base);
    assert.equal(world.walkable.has(base), true, `${base}: ${entry.detail}`);
    assert.ok(policy.entries.includes(entry));
    assert.equal(policy.walking.length, 0, base);
    assert.ok([...world.cacheWalking.topology.get(base).values()].every(edges => !edges.length), base);
    assert.match(entry.evidence, /^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/);
  }
  assert.ok(world.cacheWalking.entryEvidence.get('9770').some(entry => entry.kind === 'lodestone'));
});

test('owned no-entry regions cannot seed walking, adjacent rolls or partner routes through retained topology', () => {
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['8244'] }, { id: 'partner', name: 'Partner', unlocked: ['8500'] }]);
  state.rules = { 'content.f2p': false, 'roll.neighborMode': 'accessible', 'roll.teleports': false };
  state.members[0].sectionOverrides = { '8244-0': true };
  const before = structuredClone(state);
  assert.ok(world.cacheWalking.topology.get('8244').get('0').length, 'legacy resource topology remains available');
  assert.deepEqual([...surfaceReachability(world, new Set(['8244']), { '8244-0': true }, { seeds: ['8244-0'] })], []);
  assert.deepEqual(reachableSections(world, state, 'player1'), []);
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
  const connections = partnerConnections(world, state, 'player1');
  assert.equal(connections.byChunk['8500'].connected, false);
  assert.equal(connections.byChunk['8500'].out, null);
  assert.deepEqual(state, before, 'ownership and explicit overrides survive exclusion');
});

test('externally supplied retained sections cannot restore a no-entry walking origin', () => {
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['8244'] }, { id: 'partner', name: 'Partner', unlocked: ['8500'] }]);
  state.rules = { 'content.f2p': false };
  const connections = evaluatePartnerConnections(world, state, 'player1', {
    sectionsByMember: { player1: ['8244-0'], partner: ['8500-0'] },
    walkingRoutes: [['8244-0', '8500-0']],
  });
  assert.equal(connections.byChunk['8500'].connected, false);
  assert.equal(connections.byChunk['8500'].out, null);
  assert.deepEqual(connections.reachable, []);
});

test('selected candidates, arbitrary teleport declarations and custom candidate hooks cannot roll no-entry regions', () => {
  const blocked = [...world.cacheWalking.blockedRegions];
  const registry = createRuleRegistry([{ id: 'test.candidates', label: 'Candidates', type: 'boolean', default: true,
    candidates: () => blocked.map(id => ({ id, detail: 'Custom candidate inclusion.' })) }]);
  for (const mode of ['manual', 'frontier', 'accessible']) {
    const state = stateFor(blocked);
    state.rules = { 'roll.neighborMode': mode, 'roll.walkable': false, 'content.f2p': false };
    state.members[0].teleports = [{ id: 'unverified', label: 'Declared island teleport', destination: '10301', available: true, consumable: false }];
    const before = structuredClone(state), pool = evaluateRollPool(world, state, 'player1', registry);
    assert.equal(pool.eligible.length, 0, mode);
    assert.equal(pool.excluded.length, blocked.length, mode);
    assert.ok(pool.excluded.every(entry => entry.reasons.some(reason => reason.ruleId === 'world.entry')));
    assert.deepEqual(state, before, 'saved selections and teleport declarations are preserved');
  }
});

test('rolling only no-entry selections fails before a random draw and leaves saved pending choices untouched', () => {
  const state = stateFor(['10301', '10540']);
  state.rules = { 'content.f2p': false, 'roll.walkable': false, 'roll.neighborMode': 'manual' };
  const before = structuredClone(state);
  assert.throws(() => applyCommand(state, { type: 'roll', memberId: 'player1', count: 1 }, {
    world, random: () => { assert.fail('No random draw for an empty pool'); },
  }), /Roll count must be an integer from 0 through 0/);
  assert.deepEqual(state, before);
  state.members[0].pendingRoll = ['10301'];
  const withPending = structuredClone(state);
  evaluateRollPool(world, state, 'player1');
  assert.deepEqual(state, withPending);
});

test('automatic manual-neighbor selection excludes no-entry regions even with generated walkability filtering disabled', () => {
  const state = stateFor(['12592']);
  state.rules = { 'roll.neighborMode': 'manual', 'roll.walkable': false, 'content.f2p': false };
  // Exercise the guard directly: both candidates are geometrically supplied,
  // but only the independently witnessed destination can be auto-selected.
  const fixtureWorld = { ...world, neighbors: new Map([['12592', ['10301', '12848']]]) };
  const changed = applyCommand(state, { type: 'roll', memberId: 'player1', count: 1 }, {
    world: fixtureWorld, random: () => 0, now: () => '2026-10-08T00:00:00.000Z',
  });
  assert.deepEqual(changed.members[0].unlocked, ['12592']);
  assert.deepEqual(changed.members[0].selected, ['12848']);
  assert.deepEqual(state.members[0].selected, ['12592']);
});

test('restored invalid pending offers cannot be accepted, randomly chosen or unlocked together', () => {
  const state = stateFor();
  state.members[0].pendingRoll = ['10301', '12848'];
  const before = structuredClone(state);
  for (const command of [
    { type: 'unlock-selection', memberId: 'player1', chunkId: '10301' },
    { type: 'pick-for-me', memberId: 'player1' },
    { type: 'unlock-both', memberId: 'player1' },
  ]) {
    assert.throws(() => applyCommand(state, command, { world,
      random: () => { assert.fail('No random draw for invalid pending offers'); },
      now: () => { assert.fail('No history event for rejected pending offer'); },
    }), /no witnessed walking boundary or known typed entry/);
    assert.deepEqual(state, before);
  }
  const accepted = applyCommand(state, { type: 'unlock-selection', memberId: 'player1', chunkId: '12848' }, {
    world, now: () => '2026-10-08T00:00:00.000Z',
  });
  assert.deepEqual(accepted.members[0].unlocked, ['12848']);
  assert.deepEqual(accepted.members[0].selected, ['10301'], 'invalid alternative remains saved, but cannot roll');
});

test('random-start excludes no-entry regions even when a caller supplies the old broad walkability set', () => {
  const state = stateFor();
  state.rules = { 'content.f2p': false, 'roll.walkable': false };
  const staleWorld = { ...world, walkable: new Set([...world.cacheWalking.blockedRegions, '12848']) };
  assert.throws(() => applyCommand(state, { type: 'random-start', memberId: 'player1', count: 2 }, {
    world: staleWorld, random: () => { assert.fail('Only one entry-qualified destination remains'); },
  }), /Roll count must be an integer from 0 through 1/);
  const changed = applyCommand(state, { type: 'random-start', memberId: 'player1', count: 1 }, {
    world: staleWorld, now: () => '2026-10-08T00:00:00.000Z',
    random: () => 0,
  });
  assert.deepEqual(changed.members[0].unlocked, ['12848']);
  assert.deepEqual(state.members[0].pendingRoll, []);
});

test('audited phantom floors and isolated ocean components cannot create cache components or walking edges', () => {
  assert.equal(world.cacheWalking.components.size, 6744);
  for (const base of surfaceCorrections.invalidRegionIds) {
    assert.ok(world.surface.has(base), 'the known region record survives for saved IDs');
    assert.equal(world.walkable.has(base), false);
    assert.equal(world.cacheWalking.fallback.has(base), false, 'positive invalid floor does not recover retained walking');
    assert.equal(world.cacheWalking.eligibility.get(base).reason, 'phantom-floor-without-surface');
    assert.ok([...world.cacheWalking.components.values()].every(component => component.base !== base));
  }
  for (const raw of surfaceCorrections.nonWalkingComponentIds) {
    const [base, label] = raw.split(':'), id = `${base}-${1000000 + Number(label)}`;
    assert.equal(world.cacheWalking.components.has(id), false);
    assert.ok([...world.cacheWalking.topology.values()].every(parts => [...parts.values()].every(edges => !edges.includes(id))));
    assert.ok([...world.cacheWalking.legacyToComponents.values()].every(ids => !ids.includes(id)));
  }
  assert.equal(world.walkable.has('16433'), false);
  assert.equal(world.f2p.has('16689'), true, 'other valid components retain their free terrain');
  assert.equal(world.walkable.has('19254'), true, 'the six-tile connected western fragment remains walking terrain');
  assert.ok(world.cacheWalking.eligibility.get('19254').walking.some(edge => edge.portals === 6));
});

test('exact copied-cache labels and two evidenced blocked-floor records display without inventing resources or walkability', () => {
  for (const label of surfaceCorrections.regionLabels) {
    assert.equal(world.chunks.get(label.region).name, label.name);
    assert.equal(label.name.includes('<br>'), false);
    const computed = String(Math.floor(label.display.x / 64) * 256 + Math.floor(label.display.y / 64));
    assert.equal(computed, label.region, 'use transformed displayed coordinates rather than guessed raw location');
  }
  assert.equal(world.chunks.get('18229').name, 'Exalted Quarry');
  assert.equal(world.chunks.get('18486').name, 'Divine Fall');
  for (const base of ['18488', '18999']) {
    assert.ok(world.surface.has(base));
    assert.equal(world.chunks.get(base).terrainOnly, true);
    assert.equal(world.walkable.has(base), false);
    assert.equal(world.f2p.has(base), false);
    assert.equal(world.componentMembership.has(base), false);
    assert.equal(Object.hasOwn(definitions.chunks, base), false, 'no authored contents are added');
  }
});
