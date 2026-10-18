import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { evaluateTransportRoutes } from '../app/core/transport-access.mjs';
import { personalTeleportRows, ONE_WAY_REASON } from '../app/core/teleport-returns.mjs';
import { evaluateRollPool, createRuleRegistry, teleportRollCandidates, builtInRules } from '../app/core/rules.mjs';
import { configureAutomaticTransport } from '../app/core/automatic-transport.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import { createTeleportReturnCache } from '../app/core/teleport-return-cache.mjs';

// Synthetic positions in the active public grid, with familiar route labels.
const island = String(SURFACE_GRID.startId), lumbridge = String(SURFACE_GRID.startId + 4 * SURFACE_GRID.stride),
  burthorpe = String(SURFACE_GRID.startId + 8 * SURFACE_GRID.stride), foot = String(SURFACE_GRID.startId + SURFACE_GRID.stride);
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false, lodestones: [] };
const requirements = extra => ({ levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [], ...extra });
function fixture() {
  const ids = [island, lumbridge, burthorpe, foot];
  const definitions = { chunks: Object.fromEntries(ids.map(id => [id, {}])),
    sections: Object.fromEntries(ids.map(id => [id, { '0': [] }])), walkableChunks: ids, walkableChunksF2P: ids, codeItems: {},
    challenges: { Extra: { 'Use workbench': { Objects: ['Workbench'] } } } };
  definitions.chunks[lumbridge].Object = { Workbench: true };
  const catalogue = { stations: ids.map(chunkId => ({ id: chunkId, name: chunkId, chunkId, plane: 0, mapId: 28,
    x: (Number(chunkId) >> 8) * 64 + 1, y: (Number(chunkId) & 255) * 64 + 1, coordinateEvidence: 'synthetic' })),
    routes: [lumbridge, burthorpe].map(to => stone(to, 'default')) };
  const world = buildWorld(definitions, options); world.transportRoutes = catalogue;
  const state = createGroupState([{ id: 'explorer', name: 'Explorer', unlocked: [island] }, { id: 'partner', name: 'Partner', unlocked: [lumbridge] }]);
  Object.assign(state.rules, { 'content.f2p': false, 'travel.automatic': true, 'access.transport': true, 'roll.teleports': true,
    'roll.teleportScope': 'personal', 'roll.adjacent': false });
  configureAutomaticTransport(world, { engine: { evaluate: (input, memberId) => ({ items: [], training: {},
    access: { bases: input.members.find(row => row.id === memberId).unlocked, sections: [] } }) } });
  const rows = (memberId = 'explorer') => {
    const result = evaluateTransportRoutes(world, state, memberId, { transportRoutes: catalogue });
    assert.deepEqual(result, evaluateTransportRoutes(world, state, memberId, { transportRoutes: catalogue, returnProofCache: false }),
      'Memoized and uncached rows agree, including every reason and planning field');
    assert.equal(JSON.stringify(result), JSON.stringify(evaluateTransportRoutes(world, state, memberId,
      { transportRoutes: catalogue, returnProofCache: false })), 'The serialized rows are byte-identical');
    return result;
  };
  const registry = createRuleRegistry([
    ...['content.f2p', 'travel.automatic', 'access.transport'].map(id => ({ id, type: 'boolean', default: false })),
    { id: 'roll.teleports', type: 'boolean', default: true, candidates: teleportRollCandidates },
    { id: 'roll.teleportScope', type: 'enum', default: 'personal', options: ['personal', 'group'] },
  ].filter(row => !builtInRules.some(rule => rule.id === row.id)));
  const pool = (memberId = 'explorer') => evaluateRollPool(world, state, memberId, registry).eligible.map(row => row.id);
  return { world, state, definitions, catalogue, rows, pool };
}
function stone(to, activation = 'touch') {
  return { id: `stone-${to}`, name: `${to === lumbridge ? 'Lumbridge' : to === burthorpe ? 'Burthorpe' : 'Home'} lodestone`,
    from: null, to, kind: 'lodestone', f2p: true, members: false, automatic: { activation },
    requirements: requirements({ confirmations: [`lodestone-${to}-activated`] }) };
}
function home(f) {
  f.catalogue.routes.push(stone(island));
  f.state.members[0].transportFacts = { confirmations: { [`lodestone-${island}-activated`]: true } };
}

test('members desert restart: default stones cannot travel, roll, list as available or open partner tasks', () => {
  const f = fixture(); f.state.members[0].selected = [lumbridge]; f.state.members[0].selected = [];
  assert.ok(f.rows().every(row => !row.available && !row.rollAvailable && row.reason === ONE_WAY_REASON));
  assert.deepEqual(f.pool(), []);
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  const before = engine.evaluate(f.state, 'explorer');
  assert.equal(before.access.objects.includes('Workbench'), false);
  home(f);
  const after = engine.evaluate(f.state, 'explorer');
  assert.equal(after.access.objects.includes('Workbench'), true);
  assert.equal(before.tasks.filter(row => row.status === 'available').length, 0);
  assert.equal(after.tasks.filter(row => row.status === 'available').length, 1);
});

test('an activated owned home enables the other activated stones; disabling it closes them again', () => {
  const f = fixture(); home(f);
  assert.ok(f.rows().every(row => row.available && row.rollAvailable));
  assert.ok(f.pool().includes(lumbridge)); assert.ok(f.pool().includes(burthorpe));
  f.state.members[0].teleportOverrides = { [`stone-${island}`]: false };
  assert.ok(f.rows().every(row => !row.available));
});

test('an activated lodestone reachable on foot supplies a way home without owning its landing', () => {
  const f = fixture();
  f.world.sectionTopology.get(island).set('0', [foot]);
  f.world.sectionTopology.get(foot).set('0', [island]);
  f.world.neighbors.set(island, [foot]); f.world.neighbors.set(foot, [island]);
  f.catalogue.routes.push(stone(foot));
  f.state.members[0].transportFacts = { confirmations: { [`lodestone-${foot}-activated`]: true } };
  assert.ok(f.rows().every(row => row.available));
  f.definitions.sections[island]['0'] = [foot]; f.definitions.sections[foot]['0'] = [island];
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  const access = engine.evaluate(f.state, 'explorer').access;
  assert.ok(access.objects.includes('Workbench'), 'The same home anchor supplies task return journeys');
  assert.ok(!access.bases.includes(foot), 'A return landing never opens an unowned area');
});

test('a return transport from the landing works, but an outward-only boat does not', () => {
  const f = fixture();
  const boat = { id: 'boat', name: 'Return boat', from: lumbridge, to: island, kind: 'boat', f2p: true, members: false, requirements: requirements() };
  f.catalogue.routes.push(boat);
  assert.equal(f.rows()[0].available, true);
  [boat.from, boat.to] = [boat.to, boat.from];
  assert.equal(f.rows()[0].available, false);
});

test('confirmed home teleports enable stones and custom outbound teleports; remote teleports cannot self-prove a return', () => {
  const f = fixture();
  const member = f.state.members[0];
  member.teleports = [{ id: 'away', destination: burthorpe, available: true, consumable: false }];
  assert.equal(personalTeleportRows(f.world, f.state, member.id)[0].available, false);
  member.teleports.push({ id: 'home', destination: island, available: true, consumable: false });
  assert.ok(f.rows().every(row => row.available));
  assert.ok(personalTeleportRows(f.world, f.state, member.id).every(row => row.available));
  member.teleports[1].available = false;
  assert.ok(f.rows().every(row => !row.available));
});

test('home activation belongs to the member; group teleport roll scope retains its existing sharing semantics', () => {
  const f = fixture(); home(f);
  f.state.members[1].unlocked = [foot];
  assert.ok(f.rows('explorer').every(row => row.available));
  assert.ok(f.rows('partner').every(row => !row.available));
  assert.deepEqual(f.pool('partner'), []);
  f.state.rules['roll.teleportScope'] = 'group';
  assert.ok(f.pool('partner').includes(lumbridge));
  assert.ok(f.rows('partner').every(row => !row.available), 'Shared roll options never copy personal capability');
});

test('estimated touch activation at home works; special builds, quest gates and membership stay closed', () => {
  const f = fixture(); f.catalogue.routes.push(stone(island));
  assert.ok(f.rows().every(row => row.available));
  f.catalogue.routes.at(-1).automatic.activation = 'build';
  assert.ok(f.rows().every(row => !row.available));
  f.catalogue.routes.at(-1).automatic = { activation: 'quest-completion', activationQuests: ['Home quest'] };
  assert.ok(f.rows().every(row => !row.available));
  f.state.members[0].transportFacts = { quests: { 'Home quest': true } };
  assert.ok(f.rows().every(row => row.available));
  f.catalogue.routes[0].members = true; f.catalogue.routes[0].f2p = false;
  f.state.rules['content.f2p'] = true;
  assert.equal(f.rows()[0].available, false);
});

test('a paid teleport home budgets both casts and cannot lend a free return to another teleport', () => {
  const f = fixture();
  f.catalogue.routes = [
    { ...stone(island), kind: 'teleport', automatic: undefined, requirements: requirements({ fare: { amount: 1, currency: 'tokens' }, confirmations: ['home-ready'] }) },
    { ...stone(lumbridge), kind: 'teleport', automatic: undefined, requirements: requirements({ fare: { amount: 1, currency: 'tokens' }, confirmations: ['away-ready'] }) },
  ];
  f.state.members[0].transportFacts = { confirmations: { 'home-ready': true, 'away-ready': true }, currencies: { tokens: 1 } };
  assert.equal(f.rows()[1].available, false);
  f.state.members[0].transportFacts.currencies.tokens = 2;
  assert.equal(f.rows()[1].available, true);
});

test('reviewed roll-only destinations still need a home and never become exact task origins', () => {
  const f = fixture();
  const station = f.catalogue.stations.find(row => row.id === lumbridge);
  station.coordinateEvidence = { kind: 'wiki-teleport-map', role: 'wiki-teleport-destination-map' };
  f.world.sectionTopology.set(lumbridge, new Map([['1', []], ['2', []]]));
  f.catalogue.routes[0].rollDestination = { chunkId: lumbridge, stationId: station.id, x: station.x, y: station.y, plane: 0, mapId: 28,
    evidence: { kind: 'verified-teleport-destination-chunk', url: 'https://runescape.wiki/w/Lumbridge?oldid=1', revisionId: 1,
      coordinateSha256: 'a'.repeat(64), sourceKind: 'wiki-explicit-teleport-map' } };
  assert.equal(f.rows()[0].rollAvailable, false);
  home(f);
  const row = f.rows()[0];
  assert.equal(row.rollAvailable, true); assert.equal(row.available, false); assert.equal(row.to, null);
  assert.ok(f.pool().includes(lumbridge));
});

test('shared walking territory can connect a personal home route; turning sharing off removes that connection', () => {
  const f = fixture();
  f.world.sectionTopology.get(island).set('0', [lumbridge]);
  f.world.sectionTopology.get(lumbridge).set('0', [island, foot]);
  f.world.sectionTopology.get(foot).set('0', [lumbridge]);
  f.world.neighbors.set(island, [lumbridge]); f.world.neighbors.set(lumbridge, [island, foot]); f.world.neighbors.set(foot, [lumbridge]);
  f.catalogue.routes = [stone(foot, 'default'), stone(burthorpe)];
  f.state.members[0].transportFacts = { confirmations: { [`lodestone-${burthorpe}-activated`]: true } };
  f.state.rules['access.shared'] = true;
  assert.equal(f.rows()[1].available, true);
  f.state.rules['access.shared'] = false;
  assert.equal(f.rows()[1].available, false);
});

test('a one-way local portal needs a return even when personal requirements are overridden', () => {
  const f = fixture();
  f.catalogue.routes = [{ ...stone(lumbridge), kind: 'portal', from: island, automatic: undefined, requirements: requirements() }];
  f.state.members[0].teleportOverrides = { [f.catalogue.routes[0].id]: true };
  assert.equal(f.rows()[0].available, false);
  f.catalogue.routes[0].bidirectional = true;
  assert.equal(f.rows()[0].available, true);
});

test('exact component partner journeys retain the foot-reachable home return in F2P and members modes', () => {
  const f = fixture(), component = base => `${base}-1000001`;
  const ids = [island, lumbridge, burthorpe, foot];
  f.world.cacheWalking = { provenance: { mapId: 28 }, fallback: new Set(), mapping: [],
    components: new Map(ids.map(base => [component(base), { free: true }])),
    topology: new Map(ids.map(base => [base, new Map([['1000001', base === island ? [component(foot)] : base === foot ? [component(island)] : []]])])),
    legacyToComponents: new Map(ids.map(base => [`${base}-0`, [component(base)]])),
    componentToLegacy: new Map(ids.map(base => [component(base), [`${base}-0`]])),
    tileComponents: new Map(f.catalogue.stations.map(row => [`28:0:${row.x}:${row.y}`, component(row.chunkId)])) };
  f.catalogue.routes.push(stone(foot, 'default'));
  configureAutomaticTransport(f.world, { engine: { evaluate: (input, memberId) => ({ items: [], training: {}, access: {
    components: input.members.find(row => row.id === memberId).unlocked.map(component), bases: [], sections: [] } }) } });
  for (const f2p of [true, false]) {
    f.state.rules['content.f2p'] = f2p;
    f.rows();
    const connected = evaluatePartnerConnections(f.world, f.state, 'explorer', { transportRoutes: f.catalogue, lodestones: [] });
    assert.equal(connected.byChunk[lumbridge].connected, true);
    assert.ok(!connected.bases.includes(foot));
  }
});

test('return decisions survive unrelated commands and invalidate on journey input mutations', () => {
  const f = fixture(), cache = createTeleportReturnCache();
  let computes = 0;
  const returnProofCache = { evaluate: (world, key, compute) => cache.evaluate(world, key, () => { computes++; return compute(); }) };
  function check(state = f.state, extra = {}) {
    const common = { transportRoutes: f.catalogue, ...extra };
    const result = evaluateTransportRoutes(f.world, state, 'explorer', { ...common, returnProofCache });
    assert.deepEqual(result, evaluateTransportRoutes(f.world, state, 'explorer', { ...common, returnProofCache: false }));
    return result;
  }
  check(); const cold = computes;
  const selected = structuredClone(f.state);
  selected.revision++; selected.members[0].selected = [lumbridge]; selected.members[0].pendingRoll = [burthorpe];
  selected.history.push({ unrelated: true });
  check(selected); assert.equal(computes, cold, 'Selection, revision, pending roll and history reuse the proof across save objects');
  f.catalogue.routes[0].name = 'Renamed lodestone';
  assert.equal(check()[0].name, 'Renamed lodestone');
  assert.equal(computes, cold, 'A cached decision is applied to fresh display rows');
  const mutate = change => {
    cache.clear(f.world); check(); const before = computes;
    change(); check(); assert.ok(computes > before, 'Journey mutation recomputes the proof');
  };
  mutate(() => f.state.members[0].unlocked.push(foot));
  mutate(() => { f.state.members[0].sectionOverrides = { [`${island}-0`]: false }; });
  mutate(() => { f.state.rules['content.f2p'] = true; });
  mutate(() => { f.state.members[0].transportFacts = { currencies: { coins: 3 } }; });
  mutate(() => { f.state.members[0].sectionOverrides = {}; f.catalogue.routes.push(stone(foot)); });
  mutate(() => { f.state.members[0].teleportOverrides = { [`stone-${foot}`]: false }; });
  mutate(() => { f.state.members[0].teleports = [{ id: 'home', destination: island, available: true, consumable: false }]; });
  mutate(() => { f.state.members[0].teleports[0].consumable = true; });
  mutate(() => { f.state.rules['roll.consumableTeleports'] = true; });
  mutate(() => { f.state.rules['access.shared'] = false; });
  const before = computes;
  check(f.state, { transportFactsByMember: { explorer: { currencies: { coins: 4 } } } });
  assert.ok(computes > before, 'Injected facts participate through the effective budget');
});

test('return cache bounds retained decisions and isolates worlds', () => {
  const cache = createTeleportReturnCache({ maxEntries: 2 }), world = {}, other = {};
  let calls = 0;
  const compute = () => [++calls];
  assert.deepEqual(cache.evaluate(world, 'a', compute), [1]);
  cache.evaluate(world, 'b', compute);
  assert.deepEqual(cache.evaluate(world, 'a', compute), [1]);
  cache.evaluate(world, 'c', compute);
  assert.deepEqual(cache.evaluate(world, 'b', compute), [4], 'Least recently used proof is evicted');
  assert.deepEqual(cache.evaluate(other, 'b', compute), [5]);
  cache.clear(world);
  assert.deepEqual(cache.evaluate(world, 'b', compute), [6]);
});
