import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { evaluateRollPool, createRuleRegistry, builtInRules } from '../app/core/rules.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import { evaluateTransportRoutes as evaluateRoutes, transportBudget, expandTransportReachability, affordableTransportPaths, physicalTransportRoutes } from '../app/core/transport-access.mjs';
import { automaticTravelInputKey } from '../app/core/travel-inputs.mjs';
import { configureAutomaticTransport, deriveAutomaticTransport, releaseAutomaticTransportCaches } from '../app/core/automatic-transport.mjs';

const requirements = extra => ({ levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [], ...extra });
const station = (id, chunkId, section = '0') => ({ id, name: id, chunkId, locationId: `${chunkId}-${section}`,
  x: (Number(chunkId) >> 8) * 64 + 1, y: (Number(chunkId) & 255) * 64 + 1, mapId: 28, plane: 0, coordinateEvidence: 'synthetic coordinate' });
const evaluateTransportRoutes = (world, state, memberId) => evaluateRoutes(world, state, memberId, { transportRoutes: world.transportRoutes });
const route = (id, extra = {}) => ({ id, name: id, from: 'home', to: 'away', kind: 'teleport', members: false, f2p: true,
  requirements: requirements(), ...extra });
const observation = (level, runescapeName = 'exampleGIMab') => ({ level, xp: 1, source: 'runemetrics', runescapeName });
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, metadataCorrections: false, equipmentCorrections: false,
  retainedTaskCorrections: false, cacheShops: false, lodestones: [] };
function fixture({ items = [], training = { Magic: { level: 99 }, Woodcutting: { level: 57 } } } = {}) {
  const definitions = { chunks: { '12853': { Spawn: { 'Air rune': 1, 'Fire rune': 1 } }, '13108': { Spawn: { 'Law rune': 1 } }, '11569': { Object: { Anvil: true } } },
    sections: { '12853': { '0': [] }, '13108': { '0': [] }, '11569': { '0': [] } },
    walkableChunks: ['12853', '13108', '11569'], walkableChunksF2P: ['12853', '13108', '11569'],
    challenges: { Extra: { Anvil: { Objects: ['Anvil'] } } }, codeItems: {} };
  const world = buildWorld(definitions, options);
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12853'] }, { id: 'player2', name: 'Player 2', unlocked: ['11569'] }]);
  state.rules['travel.automatic'] = true; state.rules['access.transport'] = true;
  const catalogue = { stations: [station('home', '12853'), station('away', '13108'), station('partner', '11569')], routes: [] };
  world.transportRoutes = catalogue;
  let calls = 0;
  const baseline = { training, access: { bases: ['12853'], sections: [] }, items };
  configureAutomaticTransport(world, { definitions, engine: { evaluate(input, memberId, options) {
    calls++; assert.equal(input.rules['travel.automatic'], false); assert.equal(input.rules['access.transport'], false);
    assert.deepEqual(options, { reuseEligibility: false }, 'Transport owns the baseline cache');
    assert.equal(memberId, 'player1'); return baseline;
  } } });
  return { definitions, world, state, catalogue, baseline, calls: () => calls };
}
const supply = (name, kind = 'drop', extra = {}) => ({ name, sources: [{ kind, location: '12853', ...extra }] });

const spell = () => route('spell--varrock', { from: null, consumable: true, automatic: { type: 'standard-spell' }, requirements: requirements({
  levels: { Magic: 25 }, items: [{ name: 'Air rune', quantity: 3 }, { name: 'Fire rune', quantity: 1 }, { name: 'Law rune', quantity: 1 }],
  conditions: ['standard-spellbook-active', 'teleport-origin-permitted'], confirmations: ['teleport-runes-or-valid-substitution-available'] }) });

test('synced levels are personal and authoritative; absent or mismatched observations use marked training estimates', () => {
  const f = fixture(); f.catalogue.routes = [route('canoe', { from: 'home', kind: 'canoe', requirements: requirements({ levels: { Woodcutting: 42 } }) })];
  let row = evaluateTransportRoutes(f.world, f.state, 'player1')[0]; assert.equal(row.available, true, JSON.stringify(row)); assert.equal(row.estimated, true);
  f.state.members[0].skillProgress = { Woodcutting: observation(12) };
  row = evaluateTransportRoutes(f.world, f.state, 'player1')[0]; assert.equal(row.available, false); assert.equal(row.estimated, false);
  f.state.members[0].transportFacts = { levels: { Woodcutting: 99 } };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, false, 'Manual level cannot replace synced personal level in automatic mode');
  delete f.state.members[0].transportFacts;
  f.state.members[0].skillProgress.Woodcutting.runescapeName = 'twosamplegim';
  row = evaluateTransportRoutes(f.world, f.state, 'player1')[0]; assert.equal(row.available, true); assert.equal(row.estimated, true);
});

test('quest potential, challenge satisfaction and another character sync do not prove a personal quest', () => {
  const f = fixture();
  f.state.members[0].teleports = [{ id: 'fixture-home', destination: '12853', available: true, consumable: false }]; f.catalogue.routes = [route('quest-route', { requirements: requirements({ quests: ['Quest A'] }) })];
  f.state.tasks = [{ id: 'quest-a', label: 'Quest A', category: 'Quest' }];
  f.state.members[1].completedTasks = ['quest-a']; f.state.members[0].taskStatus = { 'quest-a': { challengeCompleted: true } };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, false);
  f.state.members[0].completedTasks = ['quest-a']; f.state.members[0].questProgress = { 'quest-a': { title: 'Quest A', source: 'runemetrics', runescapeName: 'twosamplegim' } };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, false);
  f.state.members[0].questProgress['quest-a'].runescapeName = 'exampleGIMab';
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, true);
});

test('renewable reachable runes make standard spells available only with consumable rule enabled', () => {
  const f = fixture({ items: [supply('Air rune', 'shop'), supply('Fire rune', 'spawn'), supply('Law rune')] });
  f.state.members[0].teleports = [{ id: 'fixture-home', destination: '12853', available: true, consumable: false }];
  f.catalogue.routes = [spell()]; f.state.members[0].skillProgress = { Magic: observation(25) };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, false);
  f.state.rules['roll.consumableTeleports'] = true;
  const row = evaluateTransportRoutes(f.world, f.state, 'player1')[0];
  assert.equal(row.available, true); assert.equal(row.group, 'spells'); assert.equal(row.destination, '13108'); assert.equal(row.estimated, false);
  assert.ok(transportBudget(f.state, 'player1', undefined, f.world)['items:Law rune'] >= 2);
});

test('automatic baselines follow the current guide variant when shared indexes switch on and back off', () => {
  const f = fixture(); f.definitions.chunks['12853'].Object = { Workbench: 1 };
  f.catalogue.routes = [route('token-ferry', { from: 'home', to: 'partner', kind: 'ferry', bidirectional: true,
    requirements: requirements({ items: ['Token'] }) })];
  const guide = { schemaVersion: 1, version: 'fixture', skills: [], entries: [{ id: 'entry', skill: 'Crafting', level: 1, members: false }],
    generatedTasks: [{ category: 'Crafting', label: 'Token producer', record: { PickerId: 'rs3:task:skill-guide:token', Level: 1,
      Primary: true, Objects: ['Workbench'], Output: 'Token' }, entryIds: ['entry'], selectorEvidence: { kind: 'object', selector: 'Workbench' } }] };
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue, skillGuideCatalogue: guide });
  assert.equal(engine.evaluate(f.state, 'player1').access.objects.includes('Anvil'), false);
  f.state.rules['tasks.cache-skill-guide'] = true;
  assert.equal(engine.evaluate(f.state, 'player1').access.objects.includes('Anvil'), true);
  f.state.rules['tasks.cache-skill-guide'] = false;
  assert.equal(engine.evaluate(f.state, 'player1').access.objects.includes('Anvil'), false);
});

test('the real task engine cannot self-prove runes through its teleport destination or unlock resources for a roll', () => {
  const f = fixture();
  f.state.members[0].teleports = [{ id: 'fixture-home', destination: '12853', available: true, consumable: false }]; f.state.members[0].skillProgress = { Magic: observation(25) }; f.state.rules['roll.consumableTeleports'] = true;
  f.catalogue.routes = [spell()];
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  f.state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine });
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, false, 'Law rune exists only in locked destination');
  assert.equal(engine.evaluate(f.state, 'player1').items.some(item => item.name === 'Law rune'), false);
  f.definitions.chunks['12853'].Spawn['Law rune'] = 1;
  const reachableEngine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine: reachableEngine });
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].available, true);
  assert.ok(evaluateRollPool(f.world, f.state, 'player1').eligible.some(row => row.id === '13108'));
  assert.equal(reachableEngine.evaluate(f.state, 'player1').tasks.find(row => row.id === taskId('Extra', 'Anvil')).obligation, false);
  assert.deepEqual(f.state.members[0].unlocked, ['12853']);
});

test('a structured-cloned worker world uses its registered compiled engine for automatic roll facts', () => {
  const f = fixture();
  f.state.members[0].teleports = [{ id: 'fixture-home', destination: '12853', available: true, consumable: false }]; f.definitions.chunks['12853'].Spawn['Law rune'] = 1;
  f.catalogue.routes = [spell()]; f.state.rules['roll.consumableTeleports'] = true;
  f.state.members[0].skillProgress = { Magic: observation(25) };
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  const workerWorld = structuredClone(f.world);
  assert.equal(workerWorld.definitions, undefined, 'Worker cloning drops non-enumerable definitions');
  assert.equal(evaluateTransportRoutes(workerWorld, f.state, 'player1')[0].available, false);
  configureAutomaticTransport(workerWorld, { definitions: f.definitions, engine });
  assert.equal(evaluateTransportRoutes(workerWorld, f.state, 'player1')[0].available, true);
  assert.ok(evaluateRollPool(workerWorld, f.state, 'player1').eligible.some(row => row.id === '13108'));
});

test('reviewed teleport chunk evidence can qualify a roll without proving arrival resources or a round trip', () => {
  const f = fixture({ items: [supply('Air rune'), supply('Fire rune'), supply('Law rune')] });
  f.state.members[0].teleports = [{ id: 'fixture-home', destination: '12853-1000001', available: true, consumable: false }];
  f.state.rules['roll.consumableTeleports'] = true;
  f.state.members[0].skillProgress = { Magic: observation(25) };
  const home = '12853-1000001', away = '13108-1000001';
  f.world.cacheWalking = { provenance: { mapId: 28 }, fallback: new Set(), suppressedRegions: new Set(), eligibility: new Map(), mapping: [],
    components: new Map([[home, { free: true }], [away, { free: true }]]), componentToLegacy: new Map(), legacyToComponents: new Map(),
    topology: new Map([['12853', new Map([['1000001', []]])], ['13108', new Map([['1000001', []]])]]) };
  f.baseline.access = { bases: ['12853'], components: [home], sections: [] };
  const landing = f.catalogue.stations.find(s => s.id === 'away');
  delete landing.locationId;
  landing.coordinateEvidence = { kind: 'cache-typed-coordinate', role: 'exact-teleport-destination' };
  const teleport = spell();
  teleport.rollDestination = { chunkId: landing.chunkId, stationId: landing.id, x: landing.x, y: landing.y, plane: 0, mapId: 28,
    evidence: { kind: 'verified-teleport-destination-chunk', url: 'https://runescape.wiki/w/Varrock_Teleport?oldid=1', revisionId: 1,
      coordinateSha256: '0'.repeat(64), sourceKind: 'cache-typed-teleport-destination' } };
  f.catalogue.routes = [teleport];
  let row = evaluateTransportRoutes(f.world, f.state, 'player1')[0];
  assert.equal(row.available, false); assert.equal(row.rollAvailable, true); assert.equal(row.to, null); assert.equal(row.estimated, false);
  const reached = expandTransportReachability(f.world, f.state, 'player1', new Set([home]), { claimed: new Set(['12853', '13108']), transportRoutes: f.catalogue });
  assert.deepEqual([...reached], [home]);
  f.state.members[0].sectionOverrides = { '13108-1000001': false };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].rollAvailable, false);
  delete f.state.members[0].sectionOverrides; f.world.cacheWalking.suppressedRegions.add('13108');
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].rollAvailable, false);
  f.world.cacheWalking.suppressedRegions.clear();
  const stone = route('stone-roll', { from: null, kind: 'lodestone', automatic: { activation: 'touch' }, rollDestination: teleport.rollDestination,
    requirements: requirements({ confirmations: ['lodestone-away-activated'], conditions: ['teleport-origin-permitted'] }) });
  f.catalogue.routes = [stone]; f.baseline.access.components.push(away);
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine: { evaluate: () => f.baseline } });
  row = evaluateTransportRoutes(f.world, f.state, 'player1')[0];
  assert.equal(row.available, false); assert.equal(row.rollAvailable, true); assert.equal(row.estimated, true); assert.equal(row.activationEstimated, true); assert.equal(row.levelEstimated, false); assert.match(row.rollReason, /activation is estimated/);
  assert.equal(deriveAutomaticTransport(f.world, f.state, 'player1').facts.confirmations['lodestone-away-activated'], undefined);
  const separated = '13108-1000002';
  f.world.cacheWalking.components.set(separated, { free: true });
  f.world.cacheWalking.tileComponents = new Map([[`28:0:${landing.x}:${landing.y}`, separated]]);
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].rollAvailable, false, 'A known arrival in an unentered section cannot use another reached section as activation evidence');
  delete f.world.cacheWalking.tileComponents;
  delete stone.rollDestination;
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'player1')[0].rollAvailable, false);
  f.state.rules['travel.automatic'] = false;
  row = evaluateTransportRoutes(f.world, f.state, 'player1')[0]; assert.equal(row.rollAvailable, false);
});
