import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGroupState, applyCommand, importBackup, exportBackup, previewRestore } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { createRuleRegistry, evaluateRollPool, reachableSections } from '../app/core/rules.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import { resolveTransportStation, evaluateTransportRoutes, expandTransportReachability, validateTransportFacts } from '../app/core/transport-access.mjs';
import { buildTransportPreview, renderTransportPreview } from '../scripts/preview-transport-access.mjs';
import { TRANSPORT_ROUTES } from '../app/data/transport-routes.mjs';

const requirement = extra => ({ levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [], ...extra });
const station = (id, chunkId, locationId) => ({ id, name: id, chunkId, locationId,
  x: (Number(chunkId) >> 8) * 64 + 1, y: (Number(chunkId) & 255) * 64 + 1, plane: 0, mapId: 28, coordinateEvidence: 'synthetic fixture coordinate' });
const route = (id, from, to, extra = {}) => ({ id, name: id, kind: 'ferry', from, to, bidirectional: true, members: false, f2p: true, requirements: requirement(), provenance: ['synthetic fixture'], ...extra });

function fixture() {
  const definitions = { chunks: { '12853': { Object: { Bench: true } }, '12595': { Sections: { '1': { Object: { Ore: true } }, '2': { Object: { Hidden: true } } } }, '11569': { Object: { Anvil: true } }, '13108': {} },
    sections: { '12853': { '0': [] }, '12595': { '1': [], '2': [] }, '11569': { '0': [] }, '13108': { '0': [] } },
    walkableChunks: ['12853', '12595', '11569', '13108'], walkableChunksF2P: ['12853', '12595', '11569', '13108'],
    challenges: { Extra: { OreTask: { Objects: ['Ore'] }, HiddenTask: { Objects: ['Hidden'] }, PartnerTask: { Objects: ['Anvil'] }, SuppliedOwn: { Objects: ['Bench', 'Anvil'] } } }, codeItems: {} };
  const routes = { stations: [station('home', '12853', '12853-0'), station('owned', '12595', '12595-1'), station('island', '11569', '11569-0'), station('locked', '13108', '13108-0')],
    routes: [route('own-ferry', 'home', 'owned', { requirements: requirement({ levels: { Woodcutting: 12 }, confirmations: ['own-ferry'] }) }), route('partner-ferry', 'home', 'island', { requirements: requirement({ fare: { currency: 'coins', amount: 30 } }) }), route('island-extension', 'island', 'locked')] };
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12853', '12595'], transportFacts: { levels: { Woodcutting: 12 }, currencies: { coins: 60 }, confirmations: { 'own-ferry': true } } },
    { id: 'player2', name: 'Player 2', unlocked: ['11569'], transportFacts: {} }]);
  const options = { reviewedOverlays: false, cacheWalking: false, cacheResources: false, metadataCorrections: false, equipmentCorrections: false, transportRoutes: routes, lodestones: [] };
  const world = buildWorld(definitions, options); world.transportRoutes = routes;
  const engine = createTaskEngine(definitions, options);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  return { definitions, routes, state, world, engine, options };
}

test('default OFF is inert for access, rolls and task availability; opt-in does not unlock anything', () => {
  const { state, world, engine } = fixture(), original = structuredClone(state);
  assert.equal(createRuleRegistry().defaults['access.transport'], false);
  const before = engine.evaluate(state, 'player1'), pool = evaluateRollPool(world, state, 'player1');
  assert.equal(before.access.objects.includes('Ore'), false);
  assert.equal(before.access.objects.includes('Anvil'), false);
  assert.equal(pool.eligible.length, 0);
  state.rules['access.transport'] = true;
  const next = engine.evaluate(state, 'player1'), nextPool = evaluateRollPool(world, state, 'player1');
  assert.equal(next.access.objects.includes('Ore'), true);
  assert.equal(next.access.objects.includes('Hidden'), false, 'One endpoint must not seed a disconnected sibling section');
  assert.equal(next.access.objects.includes('Anvil'), true, 'Bidirectional ferry supplies partner capability');
  assert.equal(next.tasks.find(task => task.id === taskId('Extra', 'OreTask')).status, 'available');
  assert.equal(next.tasks.find(task => task.id === taskId('Extra', 'PartnerTask')).obligation, false);
  assert.deepEqual(nextPool.eligible.map(row => row.id), ['11569']);
  assert.ok(nextPool.eligible[0].reasons.some(reason => reason.ruleId === 'access.transport'));
  assert.ok(!nextPool.eligible.some(row => row.id === '13108'), 'Partner origins do not extend my roll pool');
  assert.deepEqual(state.members, original.members);
});

test('unknown and unmet personal route requirements fail closed; partner facts and challenge checks cannot satisfy them', () => {
  const { state, world, routes } = fixture();
  routes.routes = [route('gated', 'home', 'owned', { requirements: requirement({ levels: { Agility: 10 }, quests: ['Quest A'], items: [{ name: 'Ticket', quantity: 2 }], fare: { currency: 'coins', amount: 30 }, conditions: ['door-open'], confirmations: ['route-tested'] }) })];
  state.members[1].transportFacts = { levels: { Agility: 99 }, quests: { 'Quest A': true }, items: { Ticket: 100 }, currencies: { coins: 100 }, conditions: { 'door-open': true }, confirmations: { 'route-tested': true } };
  let result = evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0];
  assert.equal(result.available, false); assert.equal(result.unknown.length, 5);
  state.members[0].transportFacts = { levels: { Agility: 9 }, quests: { 'Quest A': false }, items: { Ticket: 1 }, currencies: { coins: 29 }, conditions: { 'door-open': false }, confirmations: { 'route-tested': false } };
  result = evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0];
  assert.equal(result.unknown.length, 0); assert.equal(result.unmet.length, 6);
  state.members[0].transportFacts = structuredClone(state.members[1].transportFacts);
  assert.equal(evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0].available, true);
});

test('levels and quests use personal observations/completions rather than potential tasks or group checkmarks', () => {
  const { state, world, routes } = fixture();
  routes.routes = [route('quest', 'home', 'owned', { requirements: requirement({ levels: { Agility: 10 }, quests: ['Quest A'] }) })];
  state.tasks.push({ id: 'personal-quest', label: 'Quest A', category: 'Quest' });
  state.members[0].skillProgress = { Agility: { level: 10, xp: 1200, source: 'runemetrics', runescapeName: 'exampleGIMab' } };
  state.members[0].taskStatus = { 'personal-quest': { challengeCompleted: true } };
  assert.equal(evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0].available, false);
  state.members[0].completedTasks.push('personal-quest');
  assert.equal(evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0].available, true);
  state.members[0].skillProgress.Agility.runescapeName = 'another-player';
  assert.equal(evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes })[0].available, false);
});

test('shared capability needs a personal round trip and never supplies partner roll origins or obligations', () => {
  const { state, world, routes, engine } = fixture(); state.rules['access.transport'] = true;
  routes.routes.find(row => row.id === 'partner-ferry').bidirectional = false;
  let result = evaluatePartnerConnections(world, state, 'player1', { lodestones: [], sectionsByMember: { player1: reachableSections(world, state, 'player1'), player2: [] } });
  assert.equal(result.byChunk['11569'].connected, false); assert.equal(result.byChunk['11569'].reason, 'no route back');
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false);
  state.members[1].teleports.push({ id: 'return', label: 'Partner home teleport', destination: '12853', available: true, consumable: false });
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false);
  state.members[0].teleports.push({ id: 'return', label: 'Personal home teleport', destination: '12853', available: true, consumable: false });
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), true);
  state.rules['access.shared'] = false;
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false);
});

test('F2P, exact endpoint blocks, unknown hard requirements and global activation remain restrictive', () => {
  const { state, world, routes } = fixture(); state.rules['access.transport'] = true;
  routes.routes = [route('member', 'home', 'owned', { members: true, f2p: false }), route('unsupported', 'home', 'owned', { requirements: { ...requirement(), randomHardGate: true } }), route('stone', null, 'island', { kind: 'lodestone', requirements: requirement() })];
  const rows = () => evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes });
  assert.equal(rows()[0].available, false); assert.equal(rows()[1].unknown[0].requirement, 'unsupported'); assert.equal(rows()[2].available, false);
  state.members[0].transportFacts.confirmations.stone = true;
  assert.equal(rows()[2].available, false, 'Activation alone has no return');
  state.members[0].teleports.push({ id: 'fixture-home', destination: '12853', available: true, consumable: false });
  assert.equal(rows()[2].available, true);
  state.members[0].sectionOverrides = { '11569-0': false };
  assert.equal(rows()[2].available, false);
  state.rules['content.f2p'] = false;
  assert.equal(rows()[0].available, true, 'Members mode satisfies the membership condition');
  state.members[0].transportFacts.conditions = { membership: false };
  assert.equal(rows()[0].available, true, 'Membership follows the content rule, not a personal declaration');
});

test('locked transit stops at the first candidate; selected/pending/blacklisted exclusion remains personal', () => {
  const { state, world } = fixture(); state.rules['access.transport'] = true;
  state.members[0].pendingRoll = ['11569'];
  assert.equal(evaluateRollPool(world, state, 'player1').eligible.length, 0);
  state.members[0].pendingRoll = []; state.members[0].blacklisted = ['11569'];
  assert.equal(evaluateRollPool(world, state, 'player1').eligible.length, 0);
  const reached = expandTransportReachability(world, state, 'player1', new Set(['12853']));
  assert.ok(!reached.has('11569')); assert.ok(!reached.has('13108'));
});

test('a 30-coin ferry is a one-way candidate with 30 coins but shared round-trip capability needs 60', () => {
  const { state, world, engine } = fixture(); state.rules['access.transport'] = true;
  state.members[0].transportFacts.currencies.coins = 30;
  assert.ok(evaluateRollPool(world, state, 'player1').eligible.some(row => row.id === '11569'));
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false);
  state.members[0].transportFacts.currencies.coins = 60;
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), true);
});

test('consumed items are budgeted for both legs independently of ordinary required equipment', () => {
  const { state, world, routes, engine } = fixture(); state.rules['access.transport'] = true; state.rules['roll.consumableTeleports'] = true;
  routes.routes = [route('ticket-ferry', 'home', 'island', { requirements: requirement({ items: [{ name: 'Ticket', quantity: 1, consumed: true }, 'Hat'] }) })];
  state.members[0].transportFacts.items = { Ticket: 1, Hat: 1 };
  assert.ok(evaluateRollPool(world, state, 'player1').eligible.some(row => row.id === '11569'));
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false);
  state.members[0].transportFacts.items.Ticket = 2;
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), true, 'Equipment is reusable but both tickets are consumed');
});

test('focused exact transport admits partner sections without their own entry; cumulative 30+30+30 journey budget is preserved', () => {
  const { state, definitions, routes, options } = fixture(); state.rules['access.transport'] = true;
  definitions.chunks['11569'] = { Sections: { '1': { Object: { Anvil: true } }, '2': { Object: { HiddenPartner: true } } } };
  definitions.sections['11569'] = { '1': [], '2': [] };
  routes.stations.find(row => row.id === 'island').locationId = '11569-1';
  const paid = id => requirement({ fare: { currency: 'coins', amount: 30 } });
  routes.routes = [route('first', 'home', 'owned', { bidirectional: false, requirements: paid() }), route('second', 'owned', 'island', { bidirectional: false, requirements: paid() }), route('third', 'island', 'home', { bidirectional: false, requirements: paid() })];
  const world = buildWorld(definitions, options); world.transportRoutes = routes;
  const engine = createTaskEngine(definitions, options);
  state.members[0].transportFacts.currencies.coins = 30;
  assert.ok(reachableSections(world, state, 'player1').includes('12595-1'));
  assert.ok(!evaluateRollPool(world, state, 'player1').eligible.some(row => row.id === '11569'), 'Final candidate fare is added to origin journey cost');
  state.members[0].transportFacts.currencies.coins = 60;
  assert.ok(evaluateRollPool(world, state, 'player1').eligible.some(row => row.id === '11569'));
  assert.equal(engine.evaluate(state, 'player1').access.objects.includes('Anvil'), false, '60 pays outbound but not the 90-coin round trip');
  state.members[0].transportFacts.currencies.coins = 90;
  const result = engine.evaluate(state, 'player1');
  assert.equal(result.access.objects.includes('Anvil'), true);
  assert.equal(result.access.objects.includes('HiddenPartner'), false);
  assert.equal(result.tasks.find(row => row.id === taskId('Extra', 'PartnerTask')).obligation, false);
});

test('pending routes and unresolved destinations are reported, never admitted', () => {
  const { state, world, routes } = fixture();
  routes.pendingRoutes = [{ id: 'pending', name: 'Pending island', kind: 'boat', unknowns: ['Landing is unknown'] }];
  routes.unresolvedDestinations = [{ id: 'unknown-island', reason: 'No exact current landing' }];
  const rows = evaluateTransportRoutes(world, state, 'player1', { transportRoutes: routes });
  assert.equal(rows.find(row => row.id === 'pending').available, false);
  assert.equal(rows.find(row => row.id === 'unresolved:unknown-island').unknown[0].requirement, 'unresolved-destination');
});

test('endpoint resolution requires exact tile evidence even inside one irregular component bounding box', () => {
  const { world } = fixture();
  assert.equal(resolveTransportStation(world, station('split', '12595')).location, null);
  assert.equal(resolveTransportStation(world, { ...station('mismatch', '12853'), x: 1 }).location, null);
  assert.equal(resolveTransportStation(world, { ...station('interior', '12853'), plane: 1 }).location, null);
  const point = station('cache', '12595');
  world.cacheWalking = { provenance: { mapId: 28 }, components: new Map([['12595-1000001', { id: '12595-1000001', base: '12595', bounds: [point.x, point.y, point.x + 10, point.y + 10] }], ['12595-1000002', { id: '12595-1000002', base: '12595', bounds: [point.x, point.y, point.x + 10, point.y + 10] }]]), fallback: new Set(), legacyToComponents: new Map([['12595-1', ['12595-1000001', '12595-1000002']]]) };
  assert.match(resolveTransportStation(world, point).reason, /exact decoded tile/);
  assert.equal(resolveTransportStation(world, { ...point, locationId: '12595-1' }).location, null);
  world.cacheWalking.components.delete('12595-1000002');
  assert.equal(resolveTransportStation(world, point).location, null, 'A blocked/nonmember hole inside one irregular bounding box proves no walkable tile');
  world.cacheWalking.tileComponents = new Map([['28:0:3137:3265', '12595-1000001']]);
  assert.equal(resolveTransportStation(world, point).location, '12595-1000001');
  assert.equal(resolveTransportStation(world, { ...point, mapId: 0 }).location, null);
});

test('canoe instructor witnesses preserve display anchors and pin exact mask/runtime/plane evidence', () => {
  const actual = TRANSPORT_ROUTES.stations.find(row => row.id === 'canoe-lumbridge');
  assert.ok(actual.accessAnchor && actual.componentWitness);
  const { world } = fixture(); world.chunks.set(actual.chunkId, { id: actual.chunkId });
  world.cacheWalking = { provenance: { mapId: 28 }, fallback: new Set(), components: new Map([[actual.componentWitness.componentId, { id: actual.componentWitness.componentId, base: actual.chunkId, free: true }]]) };
  const resolved = resolveTransportStation(world, actual);
  assert.equal(resolved.location, actual.componentWitness.componentId);
  assert.equal(resolved.evidence, 'exact-station-instructor-component');
  const mutated = structuredClone(actual); mutated.componentWitness.runtimeSha256 = '0'.repeat(64);
  assert.equal(resolveTransportStation(world, mutated).location, null);
  mutated.componentWitness.runtimeSha256 = actual.componentWitness.runtimeSha256; mutated.componentWitness.evidence.sourceShift = 1;
  assert.equal(resolveTransportStation(world, mutated).location, null);
  mutated.componentWitness.evidence.sourceShift = actual.componentWitness.evidence.sourceShift; mutated.componentWitness.evidence.encodedLabelBytes[0]++;
  assert.equal(resolveTransportStation(world, mutated).location, null);
});

test('personal transport facts survive state commands, backup/restore and undo with strict bounded validation', () => {
  const { state } = fixture(), original = structuredClone(state);
  const next = applyCommand(state, { type: 'set-transport-facts', memberId: 'player1', facts: { currencies: { coins: 100 }, confirmations: { ferry: true } } });
  const restored = importBackup(exportBackup(next));
  assert.deepEqual(restored.members[0].transportFacts, next.members[0].transportFacts);
  assert.deepEqual(applyCommand(restored, { type: 'undo' }).members, original.members);
  assert.equal(previewRestore(state, next).members[0].transportFacts.changed, true);
  assert.throws(() => validateTransportFacts({ confirmations: { ferry: 'yes' } }));
  assert.throws(() => validateTransportFacts({ items: { Ticket: -1 } }));
  assert.throws(() => validateTransportFacts({ currencies: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`currency-${i}`, 1])) }));
  assert.throws(() => applyCommand(state, { type: 'set-transport-facts', memberId: 'player1', facts: { unexpected: {} } }));
});

test('preview compares only admission switch, reports per-member requirements and task gains, and leaves input/topology unchanged', () => {
  const { definitions, state, routes, options, world } = fixture();
  const original = JSON.stringify(state), topology = JSON.stringify([...world.sectionTopology].map(([base, parts]) => [base, [...parts]]));
  const report = buildTransportPreview(definitions, state, { ...options, transportRoutes: routes });
  const player1 = report.members.find(member => member.id === 'player1'), player2 = report.members.find(member => member.id === 'player2');
  assert.equal(player1.counts.rollAdditions, 1); assert.equal(player1.counts.rollRemovals, 0);
  assert.ok(player1.counts.availabilityGains >= 1);
  assert.ok(player2.requirements.some(row => row.unknown.length));
  assert.ok(player1.reachable.own.added.includes('12595-1'));
  assert.match(renderTransportPreview(report), /default OFF/);
  assert.equal(JSON.stringify(state), original); assert.equal(JSON.stringify([...world.sectionTopology].map(([base, parts]) => [base, [...parts]])), topology);
});

test('preview CLI requires explicit copied input and does not write it', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, ['scripts/preview-transport-access.mjs'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), /Use node/);
  const statePath = fileURLToPath(new URL('./fixtures/transport/state.json', import.meta.url));
  const bytes = readFileSync(statePath);
  const output = execFileSync(process.execPath, ['scripts/preview-transport-access.mjs', '--state', statePath, '--routes', 'tests/fixtures/transport/routes.json', '--definitions', 'tests/fixtures/transport/definitions.json', '--no-cache-walking', '--synthetic-definitions', '--json'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const report = JSON.parse(output);
  assert.equal(report.members.find(member => member.id === 'player1').counts.rollAdditions, 1);
  assert.deepEqual(readFileSync(statePath), bytes);
});

test('state-only CLI exercises the reviewed canoe catalogue and exact copied-cache geometry', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const statePath = fileURLToPath(new URL('./fixtures/transport/catalogue-state.json', import.meta.url)), bytes = readFileSync(statePath);
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/preview-transport-access.mjs', '--state', statePath, '--json'], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }));
  const player1 = report.members.find(member => member.id === 'player1');
  assert.ok(player1.rollPool.additions.some(row => row.id === '12852' && row.reasons.some(reason => reason.ruleId === 'access.transport')));
  assert.ok(player1.reachable.own.added.includes('12342-1000001'));
  assert.ok(player1.reachable.capability.added.includes('12341-1000001'));
  assert.equal(player1.routes.filter(row => row.kind === 'canoe' && row.available).length, 6);
  assert.ok(player1.requirements.some(row => row.unknown.some(reason => reason.requirement === 'pending-route')));
  assert.deepEqual(readFileSync(statePath), bytes);
});
