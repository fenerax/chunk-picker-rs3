import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../app/data/world.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';
import { configureAutomaticTransport } from '../app/core/automatic-transport.mjs';
import { evaluateTransportRoutes } from '../app/core/transport-access.mjs';
import { builtInRules, createRuleRegistry, evaluateRollPool, reachableSections, teleportRollCandidates } from '../app/core/rules.mjs';

const registry = createRuleRegistry([
  ...['content.f2p', 'travel.automatic', 'access.transport'].map(id => ({ id, type: 'boolean', default: false })),
  { id: 'roll.teleports', type: 'boolean', default: true, candidates: teleportRollCandidates },
].filter(row => !builtInRules.some(rule => rule.id === row.id)));
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, retainedTaskCorrections: false, lodestones: [] };

// A genuine global route and a personal return exercise automatic roll evidence
// without inferring the destination section from a bare chunk ID.
test('automatic teleport preserves its nonzero section in candidates and roll evidence', () => {
  const home = String(SURFACE_GRID.startId), away = String(SURFACE_GRID.startId + 4 * SURFACE_GRID.stride);
  const definitions = { chunks: { [home]: {}, [away]: {} }, sections: { [home]: { '0': [] }, [away]: { '7': [] } },
    walkableChunks: [home, away], walkableChunksF2P: [home, away], challenges: {} };
  const world = buildWorld(definitions, options);
  world.transportRoutes = { stations: [{ id: 'away', chunkId: away, locationId: `${away}-7`, plane: 0, mapId: 28,
    x: (Number(away) >> 8) * 64 + 1, y: (Number(away) & 255) * 64 + 1, coordinateEvidence: 'synthetic' }],
  routes: [{ id: 'fixture-teleport', name: 'Fixture teleport',
    kind: 'teleport', from: null, to: 'away', f2p: true, members: false, consumable: false,
    requirements: { levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [] } }] };
  configureAutomaticTransport(world, { definitions, engine: { evaluate: () => ({
    training: {}, items: [], access: { bases: [home], sections: [] },
  }) } });
  const state = { rules: { 'content.f2p': false, 'travel.automatic': true, 'access.transport': false,
    'roll.adjacent': false, 'roll.selected': false, 'roll.teleports': true, 'roll.teleportScope': 'personal' },
  members: [{ id: 'a', name: 'Player A', unlocked: [home], completedTasks: [],
    transportFacts: { confirmations: { 'fixture-teleport': true } },
    teleports: [{ id: 'fixture-home', destination: home, available: true, consumable: false }] }] };
  const before = structuredClone(state);
  const route = evaluateTransportRoutes(world, state, 'a', { transportRoutes: world.transportRoutes })
    .find(row => row.id === 'fixture-teleport');
  assert.equal(route.available, true, JSON.stringify(route));
  assert.equal(route.to, `${away}-7`);
  const candidates = teleportRollCandidates({ value: true, world, state, member: state.members[0], settings: registry.resolve(state.rules) });
  assert.deepEqual(candidates.filter(row => row.id === away).map(row => row.destinationSection), ['7']);
  const pool = evaluateRollPool(world, state, 'a', registry);
  assert.deepEqual(pool.eligible.map(row => row.id), [away], JSON.stringify(pool));
  assert.deepEqual(pool.eligible[0].reasons.filter(row => row.ruleId === 'roll.teleports').map(row => row.destinationSection), ['7']);
  assert.deepEqual(state, before);
});

test('a missing source section zero cannot borrow a reachable sibling for walking rolls', () => {
  const ids = ['100', '200', '300'];
  const world = { chunks: new Map(ids.map(id => [id, { id }])), walkable: new Set(ids), f2p: new Set(ids),
    neighbors: new Map([['100', ['200', '300']], ['200', ['100']], ['300', ['100']]]),
    sectionTopology: new Map([
      ['100', new Map([['1', []]])],
      ['200', new Map([['1', ['100-0']]])],
      ['300', new Map([['1', ['100-1']]])],
    ]) };
  const state = { rules: { 'content.f2p': false, 'roll.neighborMode': 'accessible', 'travel.automatic': false },
    members: [{ id: 'a', name: 'Player A', unlocked: ['100'], completedTasks: [], sectionOverrides: { '100-1': true } }] };
  assert.deepEqual(reachableSections(world, state, 'a'), ['100-1']);
  assert.deepEqual(evaluateRollPool(world, state, 'a', registry).eligible.map(row => row.id), ['300']);
  // The same distinction must hold inside already owned geography.
  state.members[0].unlocked.push('200', '300');
  assert.deepEqual(reachableSections(world, state, 'a'), ['100-1', '300-1']);
});
