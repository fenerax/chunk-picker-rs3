import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, applyCommand, exportBackup, importBackup, previewRestore, validateState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { evaluateRollPool, createRuleRegistry } from '../app/core/rules.mjs';
import { configureAutomaticTransport } from '../app/core/automatic-transport.mjs';
import { TRANSPORT_ROUTES } from '../app/data/transport-routes.mjs';
import { createServer } from '../app/server.mjs';

test('personal travel overrides survive backup and restore and undo restores optional-field absence', () => {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  const routeId = TRANSPORT_ROUTES.routes[0].id;
  const forced = applyCommand(state, { type: 'set-teleport-override', memberId: 'player1', routeId, value: true });
  assert.deepEqual(forced.members[1], state.members[1]);
  const restored = importBackup(exportBackup(forced));
  assert.equal(restored.members[0].teleportOverrides[routeId], true);
  assert.equal(previewRestore(state, restored).members[0].teleportOverrides.changed, true);
  assert.deepEqual(applyCommand(restored, { type: 'undo' }).members, state.members);
  const blocked = applyCommand(forced, { type: 'set-teleport-override', memberId: 'player1', routeId, value: false });
  assert.equal(blocked.members[0].teleportOverrides[routeId], false);
  const reset = applyCommand(blocked, { type: 'set-teleport-override', memberId: 'player1', routeId, value: null });
  assert.equal(Object.hasOwn(reset.members[0], 'teleportOverrides'), false);
  assert.deepEqual(applyCommand(reset, { type: 'undo' }).members, blocked.members);
  assert.throws(() => applyCommand(state, { type: 'set-teleport-override', memberId: 'player1', routeId: 'unresolved:unknown', value: true }), /Unknown transport route/);
  assert.throws(() => applyCommand(state, { type: 'set-teleport-override', memberId: 'player1', routeId, value: 'true' }), /true, false or null/);
  assert.throws(() => applyCommand(state, { type: 'set-teleport-override', memberId: 'player1', routeId, value: true }, { expectedRevision: 9 }), /Revision conflict/);
  const malformed = structuredClone(state); malformed.members[0].teleportOverrides = { route: 1 };
  assert.throws(() => validateState(malformed), /boolean/);
});

function rollFixture() {
  let baselineCalls = 0;
  const definitions = { chunks: { '12341': { Nickname: 'Barbarian Village' }, '12853': { Nickname: 'Varrock' } },
    walkableChunks: ['12341', '12853'], walkableChunksF2P: ['12341', '12853'] };
  const world = buildWorld(definitions, { cacheWalking: false });
  world.sectionTopology.set('12341', new Map([['0', []]]));
  world.sectionTopology.set('12853', new Map([['0', []]]));
  world.transportRoutes = { stations: [{ id: 'varrock', name: 'Varrock square', chunkId: '12853', x: 3212, y: 3424, plane: 0, mapId: 28,
    coordinateEvidence: { kind: 'fixture' } }], routes: [{ id: 'spell-test', name: 'Varrock Teleport', kind: 'teleport', from: null,
    to: 'varrock', f2p: true, members: false, consumable: true,
    requirements: { levels: { Magic: 25 }, quests: [], items: [{ name: 'Law rune', quantity: 1, consumed: true }],
      fare: null, conditions: [], confirmations: ['teleport-runes-or-valid-substitution-available'] } }] };
  configureAutomaticTransport(world, { definitions, engine: { evaluate(_state, id) { baselineCalls++; return {
    training: { Magic: { level: id === 'player1' ? 25 : 1 } },
    items: id === 'player1' ? [{ name: 'Law rune', sources: [{ kind: 'drop', source: 'Fixture monster' }] }] : [],
    access: { sections: ['12341'], bases: ['12341'] },
  }; } } });
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12341'] }, { id: 'player2', name: 'Player 2', unlocked: ['12341'] }]);
  state.members[0].teleports = [{ id: 'fixture-home', destination: '12341', available: true, consumable: false }];
  state.rules = { ...state.rules, 'roll.adjacent': false, 'roll.selected': false };
  return { state, world, baselineCalls: () => baselineCalls };
}
test('automatic roll destinations stay personal and locked, honor consumables and revert exactly when off', () => {
  const { state, world } = rollFixture(), before = structuredClone(state);
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
  state.rules['travel.automatic'] = true;
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
  state.rules['roll.consumableTeleports'] = true;
  state.members[0].teleports = [];
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, [], 'An outbound spell alone has no personal return');
  state.members[0].teleports = structuredClone(before.members[0].teleports);
  const pool = evaluateRollPool(world, state, 'player1');
  assert.deepEqual(pool.eligible.map(row => row.id), ['12853']);
  assert.match(pool.eligible[0].reasons[0].detail, /Varrock Teleport.*estimated/);
  assert.deepEqual(evaluateRollPool(world, state, 'player2').eligible, []);
  assert.deepEqual(state.members, before.members);
  assert.deepEqual(state.tasks, before.tasks);
  state.rules['travel.automatic'] = false;
  assert.deepEqual(evaluateRollPool(world, state, 'player1').eligible, []);
});
test('automatic rolls avoid redundant derivation for already eligible and unconditionally excluded destinations', () => {
  const f = rollFixture();
  f.state.rules['travel.automatic'] = true;
  f.state.rules['roll.consumableTeleports'] = true;
  f.state.rules['roll.selected'] = true;
  f.state.members[0].selected = ['12853'];
  assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1', createRuleRegistry()).eligible.map(row => row.id), ['12853']);
  assert.equal(f.baselineCalls(), 0, 'an existing fully eligible selection needs no redundant automatic reason');
  f.state.members[0].selected = [];
  for (const field of ['unlocked', 'pendingRoll', 'blacklisted']) {
    f.state.members[0][field].push('12853');
    assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1').eligible, []);
    f.state.members[0][field].pop();
  }
  assert.equal(f.baselineCalls(), 0);
  assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1').eligible.map(row => row.id), ['12853']);
  assert.ok(f.baselineCalls() > 0, 'removing the unconditional exclusion must derive the new candidate');
});
test('custom roll hooks retain every automatic inclusion reason', () => {
  const f = rollFixture();
  f.state.rules['travel.automatic'] = true;
  f.state.rules['roll.consumableTeleports'] = true;
  f.state.rules['roll.selected'] = true;
  f.state.members[0].selected = ['12853'];
  const registry = createRuleRegistry([{ id: 'test.travel', label: 'Fixture travel inspection', type: 'boolean', default: true,
    exclude({ candidateId, reasons }) {
      return candidateId === '12853' && reasons.some(row => row.ruleId === 'roll.teleports') ? 'Fixture rejects automatic travel.' : null;
    } }]);
  const pool = evaluateRollPool(f.world, f.state, 'player1', registry);
  assert.deepEqual(pool.eligible, []);
  assert.match(pool.excluded.find(row => row.id === '12853').reasons.find(row => row.ruleId === 'test.travel').detail, /rejects automatic travel/);
  assert.ok(f.baselineCalls() > 0);
});
test('an existing selection with a world-entry blocker still evaluates automatic travel', () => {
  const f = rollFixture();
  f.world.cacheWalking = { blockedRegions: new Set(['12853']), suppressedRegions: new Set(), eligibility: new Map(),
    provenance: { mapId: 28 }, fallback: new Set(['12341', '12853']), components: new Map(), tileComponents: new Map(),
    componentToLegacy: new Map(), legacyToComponents: new Map(), topology: f.world.sectionTopology, mapping: [] };
  f.state.rules['travel.automatic'] = true;
  f.state.rules['roll.consumableTeleports'] = true;
  f.state.rules['roll.selected'] = true;
  f.state.members[0].selected = ['12853'];
  const pool = evaluateRollPool(f.world, f.state, 'player1');
  assert.deepEqual(pool.eligible.map(row => row.id), ['12853']);
  assert.ok(pool.eligible[0].reasons.some(row => row.ruleId === 'roll.teleports'));
  assert.ok(f.baselineCalls() > 0);
});
test('automatic access rolls skip supplies for impossible landings and revisit repaired geometry', () => {
  const f = rollFixture();
  f.state.rules['travel.automatic'] = true;
  f.state.rules['access.transport'] = true;
  f.state.rules['roll.consumableTeleports'] = true;
  f.state.rules['roll.teleports'] = false;
  f.world.transportRoutes.stations[0].plane = 1;
  assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1').eligible, []);
  assert.equal(f.baselineCalls(), 0, 'an unmapped interior cannot become an access candidate regardless of supplies');
  f.world.transportRoutes.stations[0].plane = 0;
  assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1').eligible.map(row => row.id), ['12853']);
  assert.ok(f.baselineCalls() > 0, 'a repaired exact landing must evaluate its personal supplies');
});
test('automatic access candidate pruning keeps the reverse endpoint of a two-way route', () => {
  const f = rollFixture();
  f.state.rules['travel.automatic'] = true;
  f.state.rules['access.transport'] = true;
  f.state.rules['roll.teleports'] = false;
  f.world.transportRoutes.stations.push({ id: 'home', chunkId: '12341', x: 3073, y: 3393, plane: 0, mapId: 28,
    coordinateEvidence: { kind: 'fixture' } });
  f.world.transportRoutes.routes = [{ id: 'two-way-test', name: 'Two-way fixture ferry', kind: 'ferry', from: 'varrock', to: 'home',
    f2p: true, members: false, bidirectional: true, requirements: { levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [] } }];
  assert.deepEqual(evaluateRollPool(f.world, f.state, 'player1').eligible.map(row => row.id), ['12853']);
  assert.ok(f.baselineCalls() > 0);
});
test('Teleports catalogue is authenticated, revision-bound and opening its off-mode preview cannot save gameplay', async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, '.local'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.local', 'teleports-api-test-'));
  const definitions = { chunks: { '12341': { Nickname: 'Barbarian Village' } }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12341'] }]);
  const app = await createServer({ dataDir: directory, definitions, taskMap: {}, initialState, port: 0, host: '127.0.0.1', predictionPrewarm: false });
  t.after(async () => { await app.close(); assert.ok(path.relative(root, directory).startsWith('.local')); await rm(directory, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  assert.equal((await fetch(`${origin}/api/teleports?member=player1`)).status, 401);
  assert.equal((await fetch(`${origin}/api/teleports?member=unknown`, { headers })).status, 400);
  const before = app.store.getState();
  const response = await fetch(`${origin}/api/teleports?member=player1`, { headers });
  const catalogue = await response.json();
  assert.equal(response.status, 200, catalogue.message);
  assert.equal(catalogue.stateRevision, before.revision);
  assert.equal(catalogue.memberId, 'player1'); assert.equal(catalogue.automatic, false);
  assert.ok(catalogue.rows.length >= 247);
  assert.ok(catalogue.rows.every(row => typeof row.available === 'boolean' && typeof row.reason === 'string'));
  assert.deepEqual(app.store.getState(), before);
});
