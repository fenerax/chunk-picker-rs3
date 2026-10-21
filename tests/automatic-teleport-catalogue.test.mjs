import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSPORT_ROUTES } from '../app/data/transport-routes.mjs';
import { AUTOMATIC_TELEPORT_PATHS, buildAutomaticTeleportCatalogue } from '../scripts/build-automatic-teleport-catalogue.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url));
const read = path => JSON.parse(bytes(path));
const baseline = read(AUTOMATIC_TELEPORT_PATHS.baseline);
const supplement = read(AUTOMATIC_TELEPORT_PATHS.supplement);
const components = read(AUTOMATIC_TELEPORT_PATHS.components);
const evidence = read(AUTOMATIC_TELEPORT_PATHS.evidence);
const rollDestinations = read(AUTOMATIC_TELEPORT_PATHS.rollDestinations);
const byId = new Map(TRANSPORT_ROUTES.routes.map(row => [row.id, row]));
const stationById = new Map(TRANSPORT_ROUTES.stations.map(row => [row.id, row]));

test('automatic catalogue reproduces with canonical repository hashes and preserves manual routes', () => {
  for (const input of TRANSPORT_ROUTES.inputs) assert.equal(input.sha256, sha256RepositoryText(bytes(input.path)));
  assert.deepEqual(buildAutomaticTeleportCatalogue(baseline, supplement, components, evidence, rollDestinations, TRANSPORT_ROUTES.inputs), TRANSPORT_ROUTES);
  for (const old of baseline.routes) {
    const current = structuredClone(byId.get(old.id)); delete current.automatic; delete current.rollDestination;
    assert.deepEqual(current, old, old.id);
  }
  for (const old of baseline.stations) assert.deepEqual(stationById.get(old.id), old, old.id);
  assert.equal(TRANSPORT_ROUTES.summary.routes, baseline.routes.length + 10);
  assert.equal(TRANSPORT_ROUTES.summary.f2p, baseline.summary.f2p + 9);
});

test('current F2P standard spells distinguish personal cast requirements and members quest alternatives', () => {
  for (const [id, level, element, chunk] of [
    ['spell--varrock', 25, 'Fire', '12853'], ['spell--lumbridge', 31, 'Earth', '12850'],
    ['spell--falador', 37, 'Water', '11828'], ['spell--wendlewick', 28, 'Water', '16692'],
  ]) {
    const row = byId.get(id);
    assert.equal(row.f2p, true); assert.equal(row.requirements.levels.Magic, level);
    assert.deepEqual(row.automatic.runeCosts, { 'Air rune': 3, [`${element} rune`]: 1, 'Law rune': 1 });
    assert.equal(row.automatic.spellbook, 'standard'); assert.equal(row.consumable, true);
    assert.equal(stationById.get(row.to).chunkId, chunk);
    assert.ok(stationById.get(row.to).componentWitness);
  }
  assert.deepEqual(byId.get('spell--wendlewick').requirements.quests, ['Visions of Havenhythe']);
  const farm = byId.get('spell--wendlewick-marigold');
  assert.equal(farm.members, true); assert.equal(farm.f2p, false);
  assert.deepEqual(farm.requirements.quests, ['Visions of Havenhythe', 'Wiz Kid']);
  assert.equal(stationById.get(farm.to).chunkId, '16947');
});

test('F2P tablets require consumed held items, without acquisition skills or altar-entry requirements', () => {
  for (const name of ['air', 'mind', 'water', 'earth', 'fire', 'body']) {
    const route = byId.get(`item--${name}-altar-tablet`);
    assert.equal(route.f2p, true); assert.equal(route.consumable, true);
    assert.deepEqual(route.requirements.levels, {}); assert.deepEqual(route.requirements.quests, []);
    assert.equal(route.requirements.items.length, 1); assert.equal(route.requirements.items[0].consumed, true);
    assert.equal(route.requirements.items[0].quantity, 1);
  }
  const excluded = TRANSPORT_ROUTES.automaticTeleportExclusions;
  assert.ok(excluded.some(row => row.name === 'Ordinary city teleport tablets' && row.sources.length === 4));
  assert.ok(excluded.some(row => row.name === 'Ring of Luck' && /no teleport/.test(row.reason)));
  assert.ok(excluded.some(row => row.name === 'House Teleport' && /Construction50/.test(row.reason)));
});

test('home teleport activation preserves default, touch, quest and separate construction evidence', () => {
  assert.equal(byId.get('home-teleport--lodestone-lumbridge').automatic.activation, 'default');
  assert.equal(byId.get('home-teleport--lodestone-burthorpe').automatic.activation, 'touch');
  assert.deepEqual(byId.get('home-teleport--lodestone-wendlewick').automatic.activationQuests, ['Visions of Havenhythe']);
  assert.deepEqual(byId.get('home-teleport--lodestone-lunar-isle').automatic.activationQuests, ['Lunar Diplomacy']);
  for (const name of ['anachronia', 'fort-forinthry']) {
    const row = byId.get(`home-teleport--lodestone-${name}`);
    assert.equal(row.members, true); assert.equal(row.automatic.activation, 'build');
    assert.ok(row.automatic.buildRequirements.materials);
    assert.ok(row.requirements.confirmations.includes(`lodestone-${name}-activated`));
  }
});

test('existing global membership audit matches current pinned specific pages and retains exact destinations', () => {
  assert.equal(evidence.existingGlobalAudit.length, 43);
  for (const audit of evidence.existingGlobalAudit) {
    assert.equal(audit.sourceMembership, audit.members, audit.routeId);
    assert.equal(audit.f2p, !audit.members, audit.routeId);
    assert.equal(byId.get(audit.routeId).members, audit.members);
    assert.equal(stationById.get(audit.to).chunkId, audit.chunkId);
    assert.ok(audit.sources.every(row => row.verifiedThisReview));
  }
  for (const revision of evidence.revisions) {
    assert.ok(revision.url.endsWith(`oldid=${revision.revisionId}`));
    assert.match(revision.contentSha256, /^[a-f0-9]{64}$/);
  }
});

test('exact witness labels stay verifiable while incompatible planes and interiors remain unadmitted', () => {
  assert.equal(components.witnesses.length, 7);
  assert.equal(components.unresolved.length, 3);
  for (const witness of components.witnesses) {
    const station = stationById.get(witness.stationId);
    assert.deepEqual(station.componentWitness, witness);
    assert.deepEqual([witness.x, witness.y, witness.plane, witness.mapId], [station.x, station.y, station.plane, station.mapId]);
    assert.equal(witness.componentId, `${station.chunkId}-${1000000 + witness.evidence.label}`);
    assert.equal(Buffer.from(witness.evidence.encodedLabelBytes).readUInt16LE(), witness.evidence.label);
    assert.equal(witness.evidence.offsetBytes, ((station.x % 64) * 64 + station.y % 64) * 2);
    assert.equal(witness.runtimeSha256, sha256RepositoryText(bytes(components.runtime.path)));
  }
  for (const row of components.unresolved) {
    assert.match(row.reason, /source plane/); assert.equal(stationById.get(row.stationId).componentWitness, undefined);
  }
  for (const name of ["War's Retreat Teleport", 'Runecrafting guild teleport']) {
    const pending = TRANSPORT_ROUTES.automaticTeleportExclusions.find(row => row.name === name);
    assert.equal(pending.f2p, true); assert.ok(pending.coordinate.mapId !== 28);
    assert.ok(!TRANSPORT_ROUTES.routes.some(row => row.name === name));
  }
  assert.ok(evidence.landingReview.unresolved.some(row => row.stationId === 'lodestone-lumbridge'));
  assert.equal(stationById.get('lodestone-lumbridge').componentWitness, undefined);
});

test('clan vexillum follows its 2026 Grand Exchange destination and journal is unlimited F2P', () => {
  const clan = byId.get('item--clan-vexillum-grand-exchange');
  const station = stationById.get(clan.to);
  assert.deepEqual([station.x, station.y, station.chunkId], [3181, 3472, '12598']);
  assert.equal(clan.f2p, true); assert.equal(clan.consumable, false);
  assert.equal(byId.get('item--archaeology-journal').f2p, true);
  assert.equal(byId.get('item--archaeology-journal').consumable, false);
  assert.deepEqual(byId.get('explorer-ring--cabbage-port').automatic.itemAlternatives, ["Explorer's ring 3", "Explorer's ring 4"]);
});

test('verified surface destination chunks remain independent from component landing access', () => {
  assert.equal(rollDestinations.destinations.length, 48);
  assert.equal(TRANSPORT_ROUTES.routes.filter(row => row.f2p && row.rollDestination).length, 26);
  for (const entry of rollDestinations.destinations) {
    const destination = byId.get(entry.routeId).rollDestination, station = stationById.get(destination.stationId);
    assert.deepEqual(destination, entry.rollDestination);
    assert.equal(destination.chunkId, station.chunkId); assert.equal(destination.mapId, 28); assert.equal(destination.plane, 0);
    assert.equal(destination.chunkId, String(Math.floor(destination.x / 64) * 256 + Math.floor(destination.y / 64)));
    assert.equal(destination.evidence.kind, 'verified-teleport-destination-chunk');
    assert.ok(destination.evidence.url.endsWith(`oldid=${destination.evidence.revisionId}`));
    assert.match(destination.evidence.coordinateSha256, /^[a-f0-9]{64}$/);
  }
  const lumbridge = byId.get('home-teleport--lodestone-lumbridge');
  assert.equal(lumbridge.rollDestination.chunkId, '12850');
  assert.equal(stationById.get(lumbridge.to).componentWitness, undefined);
  for (const name of ['air', 'mind', 'water']) {
    const row = byId.get(`item--${name}-altar-tablet`);
    assert.ok(row.rollDestination); assert.equal(stationById.get(row.to).componentWitness, undefined);
  }
  for (const row of rollDestinations.unresolved) assert.equal(byId.get(row.routeId).rollDestination, undefined);
});

test('roll destination validation rejects wrong chunks, interior maps, forged roles and stale coordinate hashes', () => {
  const validate = value => buildAutomaticTeleportCatalogue(baseline, supplement, components, evidence, value, TRANSPORT_ROUTES.inputs);
  for (const edit of [
    value => { value.destinations[0].rollDestination.chunkId = '12850'; },
    value => { value.destinations[0].rollDestination.mapId = 742; },
    value => { value.destinations[0].rollDestination.plane = 1; },
    value => { value.destinations[0].rollDestination.x += 1; },
    value => { value.destinations[0].rollDestination.evidence.sourceKind = 'wiki-object-map'; },
    value => { value.destinations[0].rollDestination.evidence.coordinateSha256 = '0'.repeat(64); },
    value => { value.destinations[0].rollDestination.evidence.revisionId += 1; },
  ]) {
    const value = structuredClone(rollDestinations); edit(value);
    assert.throws(() => validate(value), /Unverified roll destination/);
  }
});
