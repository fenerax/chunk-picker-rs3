import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld } from '../app/data/world.mjs';
import { componentLocations, createSurfaceEligibility, surfaceReachability, projectLegacySections } from '../app/core/cache-surface.mjs';
import { evaluateRollPool, reachableSections } from '../app/core/rules.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';

const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const world = buildWorld(definitions, { dataset: selectedDataset });
const stateFor = (unlocked, sectionOverrides = {}, rules = {}) => ({ rules,
  members: [{ id: 'player1', unlocked, sectionOverrides, selected: [], pendingRoll: [], blacklisted: [], teleports: [] }] });
const pool = state => evaluateRollPool(world, state, 'player1').eligible;

test('runtime walking edges are reciprocal cache component portals on orthogonal boundaries', () => {
  assert.equal(world.cacheWalking.components.size, 6744);
  for (const [base, sections] of world.cacheWalking.topology) for (const [part, edges] of sections) {
    const to = `${base}-${part}`;
    for (const from of edges) {
      assert.ok(world.neighbors.get(base).includes(from.split('-')[0]));
      if (world.cacheWalking.components.has(to) && world.cacheWalking.components.has(from)) {
        assert.ok(world.cacheWalking.topology.get(from.split('-')[0]).get(from.split('-')[1]).includes(to));
      }
    }
  }
});

test('saved mainland and pier selectors map to opposite cache labels and never join coasts', () => {
  assert.deepEqual(componentLocations(world, '11825-1'), ['11825-1000002']);
  assert.deepEqual(componentLocations(world, '11825-2'), ['11825-1000001']);
  const state = stateFor(['11825', '11569'], { '11825-1': true });
  const before = structuredClone(state), reached = reachableSections(world, state, 'player1');
  assert.ok(reached.includes('11569-2'));
  assert.equal(reached.includes('11569-1'), false);
  assert.equal(pool(state).some(entry => entry.id === '11313'), false);
  assert.deepEqual(state, before);
  state.members[0].sectionOverrides['11825-1'] = false;
  assert.equal(reachableSections(world, state, 'player1').includes('11569-2'), false);
});

test('ambiguous saved seeds remain selectors and cannot fan out into disconnected fragments', () => {
  const record = world.cacheWalking.mapping.find(record => record.method === 'unresolved' && record.candidates.length > 1);
  assert.ok(record);
  assert.deepEqual(componentLocations(world, record.legacy), []);
  const base = record.legacy.split('-')[0];
  const reached = surfaceReachability(world, new Set([base]), { [record.legacy]: true }, { seedBases: [], f2p: false });
  assert.equal(reached.size, 0);
  const shared = world.cacheWalking.mapping.find(record => record.components.length && !record.project && !record.legacy.endsWith('-0'));
  assert.ok(shared);
  assert.equal(projectLegacySections(world, new Set(componentLocations(world, shared.legacy))).has(shared.legacy), false,
    'one cache landmass does not bypass distinct legacy resource gates');
});

test('cache membership settles Temple and the free peninsula fragment without making members land free', () => {
  assert.equal(world.f2p.has('12592'), false);
  assert.equal(world.cacheWalking.components.get('12592-1000001').free, false);
  assert.equal(world.f2p.has('13621'), true);
  assert.equal(world.cacheWalking.components.get('13621-1000001').free, true);
  assert.equal(world.cacheWalking.components.get('13621-1000002').free, false);
  assert.equal(world.cacheWalking.components.get('17460-1000004').free, false);
  assert.equal(world.cacheWalking.components.get('17461-1000007').free, false, 'mixed cache blocks retain Wiki members policy');
  assert.ok(pool(stateFor(['17204'])).some(entry => entry.id === '17460'));
  assert.equal(pool(stateFor(['17716'], { '17716-1000002': true })).some(entry => entry.id === '17460'), false);
  const state = stateFor(['12848'], {}, { 'content.f2p': false });
  assert.ok(pool(state).some(entry => entry.id === '12592'));
  state.rules['content.f2p'] = true;
  assert.equal(pool(state).some(entry => entry.id === '12592'), false);
});

test('tiny landing and the witnessed 8495 coast are walking terrain', () => {
  const tiny = pool(stateFor(['11824'])).find(entry => entry.id === '12080');
  assert.ok(tiny?.reasons.some(reason => reason.destinationSection === '1000001'));
  assert.equal(world.cacheWalking.components.get('12080-1000001').tiles, 2);
  assert.ok(world.walkable.has('8495'));
  const coast = stateFor(['8751'], { '8751-1000001': true }, { 'content.f2p': false });
  assert.ok(pool(coast).some(entry => entry.id === '8495'));
  assert.ok(pool(stateFor(['8495'], {}, { 'content.f2p': false })).some(entry => entry.id === '8751'));
});

test('walking cannot use an unclaimed intermediate or a boat as a surface boundary', () => {
  const reached = surfaceReachability(world, new Set(['12082', '12338']), { '12082-1': true }, { f2p: true });
  assert.equal(reached.has('12338-1000001'), false, 'walking around inlet needs claimed 12083');
  assert.equal(reached.has('11825-1000001'), false);
  const withRoad = surfaceReachability(world, new Set(['12082', '12338', '12083']), { '12082-1': true }, { f2p: true });
  assert.ok(withRoad.has('12338-1000001'));
  assert.equal(world.cacheWalking.topology.get('12082').get('1000001').includes('11825-1000001'), false);
});

test('cyclic surface traversal preserves seed order and reevaluates changed access on the next call', () => {
  const componentIds = ['10-100', '10-101', '10-102', '20-100', '20-101', '30-100', '40-100'];
  const sharedEdges = ['10-100', '20-101', '30-100', '40-100', '50-1', '10-102', '20-100', '50-2'];
  const synthetic = {
    sectionTopology: new Map([['20', new Map([['0', []]])]]),
    sectionMembership: new Map([['50', new Map([['1', false], ['2', true]])]]),
    f2p: new Set(),
    cacheWalking: {
      components: new Map(componentIds.map(id => [id, { free: id !== '20-101' }])),
      topology: new Map([['50', new Map([['1', []], ['2', []]])]]),
      fallback: new Set(['50']), blockedRegions: new Set(['30']),
      legacyToComponents: new Map([['10-1', ['10-100']], ['10-2', ['10-102']]]),
      blockAliases: new Map([['10-102', ['10-2']]]),
      outgoing: new Map([['10-100', ['10-101', ...sharedEdges]], ['10-101', sharedEdges],
        ['20-100', ['10-101', '10-100']], ['50-2', ['10-100']]]),
    },
  };
  const claimed = new Set(['10', '20', '30', '50']);
  const overrides = { '10-1': true, '10-2': false };
  const options = { seeds: ['10-100', '10-1'], seedBases: [], f2p: true };
  assert.deepEqual([...surfaceReachability(synthetic, claimed, overrides, options)],
    ['10-100', '10-101', '20-100', '50-2']);

  claimed.add('40');
  synthetic.cacheWalking.blockedRegions.clear();
  overrides['10-2'] = true;
  overrides['20-0'] = false;
  assert.deepEqual([...surfaceReachability(synthetic, claimed, overrides, { ...options, f2p: false })],
    ['10-100', '10-102', '10-101', '30-100', '40-100', '50-1', '50-2']);
});

test('shared surface eligibility keeps captured claims and overrides while walking new seeds', () => {
  const ids = ['1-1', '1-2', '1-3', '1-4', '1-5', '2-1', '3-1'];
  const synthetic = {
    sectionTopology: new Map(), sectionMembership: new Map(), f2p: new Set(),
    cacheWalking: {
      components: new Map(ids.map(id => [id, { free: id !== '2-1' }])),
      fallback: new Set(), blockAliases: new Map(),
      outgoing: new Map([['1-1', ['1-2', '1-3', '2-1']], ['1-2', ['1-1']],
        ['1-5', ['1-4', '3-1']], ['1-4', ['1-5']]]),
    },
  };
  const claimed = new Set(['1', '2']), overrides = { '1-3': false }, originalOverrides = { ...overrides };
  const eligibility = createSurfaceEligibility(synthetic, claimed, overrides, { f2p: true });
  assert.deepEqual([...surfaceReachability(synthetic, claimed, originalOverrides,
    { seeds: ['1-1'], seedBases: [], f2p: true, eligibility })], ['1-1', '1-2']);

  claimed.add('3');
  overrides['1-3'] = true;
  overrides['1-4'] = false;
  // The second walk encounters previously unseen nodes after its inputs mutate.
  assert.deepEqual([...surfaceReachability(synthetic, claimed, originalOverrides,
    { seeds: ['1-5'], seedBases: [], f2p: true, eligibility })], ['1-5', '1-4']);
  assert.equal(eligibility('1-3'), false);
  assert.equal(eligibility('3-1'), false);
  assert.deepEqual([...surfaceReachability(synthetic, claimed, overrides,
    { seeds: ['1-5'], seedBases: [], f2p: true })], ['1-3', '1-5', '3-1']);
  assert.equal(createSurfaceEligibility(synthetic, claimed, overrides)('2-1'), true);
});

test('partner admission retains the actual cache component and requires a round trip', () => {
  const state = stateFor(['11825'], { '11825-1': true });
  state.members.push({ id: 'player2', unlocked: ['11569'], sectionOverrides: { '11569-2': true }, teleports: [] });
  const result = evaluatePartnerConnections(world, state, 'player1', { lodestones: [] });
  assert.ok(result.sections.includes('11569-2'));
  assert.ok(result.components.includes('11569-1000005'));
  assert.equal(result.sections.includes('11569-1'), false);
  const bounded = evaluatePartnerConnections(world, state, 'player1', { lodestones: [], sectionsByMember: { player1: [], player2: ['11569-1000005'] } });
  assert.equal(bounded.bases.includes('11569'), false, 'task-supplied empty personal geometry cannot be resurrected');
  const fallback = stateFor(['8244'], {}, { 'content.f2p': false });
  fallback.members.push({ id: 'player2', unlocked: ['8500'], sectionOverrides: {}, teleports: [] });
  const route = evaluatePartnerConnections(world, fallback, 'player1', { lodestones: [] });
  assert.equal(route.components.includes('8244-0'), false, 'unqualified retained topology cannot provide a walking origin');
  assert.equal(route.byChunk['8500'].connected, false);
  const noEntry = evaluatePartnerConnections(world, fallback, 'player1', { lodestones: [], sectionsByMember: { player1: [], player2: ['8500-1000001'] } });
  assert.equal(noEntry.bases.includes('8500'), false);
});

test('only missing or empty surface coverage receives documented retained walking fallback', () => {
  assert.ok(world.cacheWalking.fallbackRoutes.length);
  for (const route of world.cacheWalking.fallbackRoutes) {
    assert.equal(route.kind, 'walking');
    assert.equal(route.reason, 'missing-or-empty-plane-0-coverage');
    assert.ok(world.cacheWalking.fallback.has(route.from.split('-')[0]) || world.cacheWalking.fallback.has(route.to.split('-')[0]));
  }
  assert.deepEqual(world.cacheWalking.doors, { evidenced: 0, unverified: 1415 });
  assert.equal(world.cacheWalking.conditionalMorphs, 7034);
  const base = [...world.cacheWalking.fallback].find(base => world.cacheWalking.topology.get(base)?.has('1')
    && world.cacheWalking.topology.get(base)?.has('2'));
  assert.ok(base);
  assert.deepEqual(componentLocations(world, base, { landing: true }), [`${base}-1`]);
});

test('east Havenhythe has terrain-only region records without invented task resources', () => {
  for (const [id, name] of [['18228', 'Berylbrook'], ['18230', 'Heathervein'], ['18482', 'Fenmoor']]) {
    assert.equal(world.chunks.get(id).name, name);
    assert.equal(world.chunks.get(id).terrainOnly, true);
    assert.equal(definitions.chunks[id], undefined);
    assert.equal(world.f2p.has(id), false);
  }
  assert.ok(projectLegacySections(world, new Set(['11825-1000001'])).has('11825-2'));
});


test('the authored Kharid-et exterior policy settles component 1 for every F2P map without opening component 2', () => {
  const id = '13361-1000001', component = world.cacheWalking.components.get(id);
  assert.deepEqual(component.counts, { free: 2209, members: 1, unknown: 0 });
  assert.equal(component.free, true);
  assert.equal(component.membershipSource, 'wiki-section');
  assert.equal(world.componentMembership.get('13361').get('1000001'), true);
  assert.equal(world.sectionMembership.get('13361').get('1'), true);
  assert.deepEqual(componentLocations(world, '13361-1'), [id]);
  const state = stateFor(['13361'], { [id]: true });
  assert.deepEqual(pool(state).map(row => row.id), ['13105', '13360', '13362']);
  assert.deepEqual(pool({ ...state, rules: { 'content.f2p': false } }).map(row => row.id), ['13105', '13360', '13362', '13617']);
  assert.equal(state.members[0].preferences, undefined, 'ordinary maps use the same membership policy');
  assert.equal(createSurfaceEligibility(world, new Set(['13361']), {}, { f2p: true })('13361-1000002'), false);
  assert.equal(createSurfaceEligibility(world, new Set(['13361']), { [id]: false }, { f2p: true })(id), false);
  assert.equal(createSurfaceEligibility(world, new Set(['13361']), { '13361-1': false }, { f2p: true })(id), false);
  const record = world.mapCorrections.find(row => row.chunk === '13361' && row.field === 'sectionF2p');
  assert.match(record.evidenceUrl, /oldid=37215299$/);
});
