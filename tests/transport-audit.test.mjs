import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTransportSupplement, buildSupplementConnections } from '../scripts/build-transport-supplement.mjs';
import { MAP_CONNECTIONS, mapConnectionsPayload } from '../app/data/map-connections.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { evaluateTransportRoutes, resolveTransportStation } from '../app/core/transport-access.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
// Reproduce the immutable desert/Anachronia extension and its display artifact.
// The active automatic v2 extension is audited in automatic-teleport-catalogue.
const TRANSPORT_ROUTES = read('app/data/transport-routes.2026-10-09.v1.json');
const baseline = read('app/data/transport-routes.2026-10-08.v1.json');
const supplement = read('app/data/transport-routes.desert-anachronia.2026-10-09.v1.json');
const components = read('app/data/transport-components.desert-anachronia.2026-10-09.v1.json');
const byId = new Map(TRANSPORT_ROUTES.routes.map(row => [row.id, row]));
const stations = new Map(TRANSPORT_ROUTES.stations.map(row => [row.id, row]));
const auditedIds = [...supplement.routes.map(row => row.id), 'stormbreaker-digsite-anachronia', 'home-teleport--lodestone-anachronia'];

function syntheticRequirementsFixture() {
  const chunkIds = [...new Set(TRANSPORT_ROUTES.stations.map(row => row.chunkId))];
  // All stations are given synthetic unsplit free geometry to isolate membership
  // and personal requirement logic from real collision/endpoint resolution.
  const world = buildWorld({ chunks: Object.fromEntries(chunkIds.map(id => [id, {}])),
    sections: Object.fromEntries(chunkIds.map(id => [id, Object.fromEntries(['0', ...TRANSPORT_ROUTES.stations.filter(s => s.chunkId === id && s.locationId).map(s => s.locationId.split('-')[1])].map(suffix => [suffix, []]))])), walkableChunks: chunkIds, walkableChunksF2P: chunkIds },
  { cacheWalking: false, cacheResources: false, cacheArchaeology: false });
  const facts = { levels: { Magic: 99 }, quests: { "Icthlarin's Little Helper": true, 'Love Story': true, 'The Golem': true, 'Do No Evil': true },
    items: { 'Nature rune': 100, 'Law rune': 100, 'Time rune': 100, 'Earth rune': 100, 'Anachronia tablet': 1 },
    currencies: { coins: 2000 }, conditions: { membership: true, 'teleport-origin-permitted': true, 'standard-spellbook': true },
    confirmations: Object.fromEntries(auditedIds.flatMap(id => byId.get(id).requirements.confirmations).map(key => [key, true])) };
  // A personal home return keeps this fixture focused on membership and fares.
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: [chunkIds[0]], transportFacts: facts,
    teleports: [{ id: 'home', label: 'Home', destination: chunkIds[0], available: true, consumable: false }] }]);
  state.rules['roll.consumableTeleports'] = true;
  return { world, state, facts };
}

test('historical desert transport extension has reproducible pinned inputs and retains every historical station and route', () => {
  const data = TRANSPORT_ROUTES.inputs.map(row => {
    const bytes = readFileSync(new URL(`../${row.path}`, import.meta.url));
    assert.equal(sha256RepositoryText(bytes), row.sha256); return JSON.parse(bytes);
  });
  assert.deepEqual(buildTransportSupplement(...data, TRANSPORT_ROUTES.inputs), TRANSPORT_ROUTES);
  for (const row of baseline.routes) assert.deepEqual(byId.get(row.id), row);
  for (const row of baseline.stations) assert.deepEqual(stations.get(row.id), row);
  assert.equal(TRANSPORT_ROUTES.summary.routes, baseline.routes.length + supplement.routes.length);
  assert.equal(TRANSPORT_ROUTES.summary.f2p, baseline.summary.f2p);
  for (const row of TRANSPORT_ROUTES.routes) {
    assert.equal(row.f2p, !row.members);
    assert.ok(row.provenance.some(proof => /^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/.test(proof.url ?? '')));
    for (const field of ['quests', 'items', 'conditions', 'confirmations']) assert.ok(Array.isArray(row.requirements[field]));
    assert.ok(stations.has(row.to)); assert.ok(row.from === null || stations.has(row.from));
  }
});

test('current carpet network has 66 directed legs with destination quests and asymmetric colony fares', () => {
  const carpets = supplement.routes.filter(row => row.kind === 'carpet');
  assert.equal(carpets.length, 66);
  for (const row of carpets) {
    assert.equal(row.bidirectional, false);
    assert.equal(row.requirements.fare.amount, row.from === 'carpet-monkey-colony' ? 0 : 1000);
    const expected = row.to === 'carpet-uzer' ? ['The Golem'] : /carpet-(menaphos|sophanem)$/.test(row.to) ? ["Icthlarin's Little Helper"] : [];
    if (row.to === 'carpet-monkey-colony' || row.from === 'carpet-monkey-colony') expected.push('Do No Evil');
    assert.deepEqual(row.requirements.quests, expected);
  }
  const colony = carpets.filter(row => row.from === 'carpet-monkey-colony');
  assert.deepEqual(colony.map(row => row.to).sort(), ['carpet-shantay-pass', 'carpet-south-pollnivneach']);
  assert.notEqual(stations.get('carpet-north-pollnivneach').chunkId, stations.get('carpet-south-pollnivneach').chunkId);
});

test('all audited routes reject F2P even with every personal requirement declared, and members rules satisfy membership without a declaration', () => {
  const { world, state, facts } = syntheticRequirementsFixture();
  const evaluate = () => new Map(evaluateTransportRoutes(world, state, 'player1').map(row => [row.id, row]));
  let rows = evaluate();
  for (const id of auditedIds) { assert.equal(rows.get(id).available, false, id); assert.ok(rows.get(id).unmet.some(row => row.requirement === 'membership'), id); }
  state.rules['content.f2p'] = false;
  rows = evaluate(); for (const id of auditedIds) assert.equal(rows.get(id).available, true, JSON.stringify(rows.get(id)));
  delete facts.conditions.membership; delete state.members[0].transportFacts.conditions.membership;
  rows = evaluate(); for (const id of auditedIds) assert.equal(rows.get(id).available, true, id);
});

test('audited spell routes with full members facts still need a way home', () => {
  const { world, state } = syntheticRequirementsFixture();
  state.rules['content.f2p'] = false;
  state.members[0].teleports = [];
  const rows = new Map(evaluateTransportRoutes(world, state, 'player1').map(row => [row.id, row]));
  for (const id of auditedIds.filter(id => byId.get(id).kind === 'teleport')) {
    assert.equal(rows.get(id).available, false, id);
    assert.ok(rows.get(id).unmet.some(row => row.requirement === 'return-route'), id);
  }
});

test('members availability still requires own fare, quest, Magic, tutorial, totem and consumable settings', () => {
  const { world, state } = syntheticRequirementsFixture(); state.rules['content.f2p'] = false;
  const facts = state.members[0].transportFacts;
  const evaluate = id => evaluateTransportRoutes(world, state, 'player1').find(row => row.id === id);
  facts.currencies.coins = 999; assert.equal(evaluate('carpet-shantay-pass--north-pollnivneach').available, false);
  facts.currencies.coins = 1000; facts.quests["Icthlarin's Little Helper"] = false; assert.equal(evaluate('carpet-shantay-pass--menaphos').available, false);
  facts.levels.Magic = 74; assert.equal(evaluate('spell-north-western-anachronia').available, false);
  facts.levels.Magic = 99; facts.confirmations['anachronia-base-camp-tutorial-complete'] = false; assert.equal(evaluate('spell-eastern-anachronia').available, false);
  facts.confirmations['totem-of-the-abyss-active:west'] = false; assert.equal(evaluate('spell-anachronia-totem-west').available, false);
  state.rules['roll.consumableTeleports'] = false; assert.ok(evaluate('spell-anachronia-totem-north').unmet.some(row => row.requirement === 'consumable'));
});

test('supplement component witnesses match exact station points and tablet plane ambiguity fails closed', () => {
  assert.equal(components.witnesses.length, 10);
  for (const witness of components.witnesses) {
    const row = stations.get(witness.stationId);
    assert.deepEqual(row.componentWitness, witness);
    assert.equal(witness.evidence.offsetBytes, ((row.x % 64) * 64 + row.y % 64) * 2);
    assert.equal(witness.evidence.label, witness.evidence.encodedLabelBytes[0] + witness.evidence.encodedLabelBytes[1] * 256);
  }
  const tablet = stations.get('teleport-anachronia-tablet');
  assert.ok(components.unresolved.some(row => row.stationId === tablet.id && /plane/.test(row.reason)));
  assert.equal(tablet.componentWitness, undefined);
  const world = { chunks: new Map([[tablet.chunkId, {}]]), cacheWalking: { provenance: { mapId: 28 }, components: new Map(), fallback: new Set(), eligibility: new Map() } };
  assert.match(resolveTransportStation(world, tablet).reason, /exact decoded tile/);
});

test('normal connection payload includes new members transport and teleport destinations without altering walking or retained provenance', () => {
  const old = read('archive/data/map-connections.2026-10-08.v3.json');
  const inputs = MAP_CONNECTIONS.inputs.slice(old.inputs.length);
  for (const row of inputs) assert.equal(sha256RepositoryText(readFileSync(new URL(`../${row.path}`, import.meta.url))), row.sha256);
  assert.deepEqual(buildSupplementConnections(old, TRANSPORT_ROUTES, supplement, inputs), MAP_CONNECTIONS);
  assert.deepEqual(MAP_CONNECTIONS.connections.filter(row => row.kind === 'walking'), old.connections.filter(row => row.kind === 'walking'));
  for (const row of old.connections) assert.deepEqual(MAP_CONNECTIONS.connections.find(next => next.id === row.id), row);
  for (const row of old.destinations) assert.deepEqual(MAP_CONNECTIONS.destinations.find(next => next.id === row.id), row);
  const shantay = mapConnectionsPayload({ chunkId: stations.get('carpet-shantay-pass').chunkId });
  const carpets = shantay.connections.filter(row => row.routeKind === 'carpet'); assert.equal(carpets.length, 16);
  for (const row of carpets) { assert.equal(row.kind, 'transport'); assert.equal(row.members, true); assert.equal(row.f2p, false); }
  for (const route of supplement.routes.filter(row => row.from === null)) {
    const payload = mapConnectionsPayload({ chunkId: stations.get(route.to).chunkId });
    assert.ok(payload.destinations.some(row => row.routeId === route.id && row.members && !row.f2p));
  }
});
