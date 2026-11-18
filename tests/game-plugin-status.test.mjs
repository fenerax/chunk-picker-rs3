import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry, partnerConnections } from '../app/core/rules.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { startingSectionLocations } from '../app/core/cache-surface.mjs';

async function territoryPlugin(t, world, state, registry = createRuleRegistry()) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-territory-'));
  let at = Date.parse('2026-10-19T12:00:00Z'), seq = 0, input, output, pool = { eligible: [] };
  const controller = await openGamePlugin({ dataDir, world, registry, clock: () => at,
    store: { getInfo: () => ({ revision: state.revision }), getCalculationSnapshot: () => ({ state, members: state.members }),
      peekRollPool: () => pool, rollPool: () => { throw new Error('Position/status must not calculate a pool or task engine.'); } },
    questMapping: new Map(), serializeMutation: operation => operation(), bodyJSON: async () => input,
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => {},
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true }); });
  const { key } = await controller.create({ admin: true }, { memberId: state.members[0].id, label: 'Territory contract' });
  async function call(id) {
    at += 1001;
    if (id !== undefined) input = { v: 1, seq: ++seq, sentAt: new Date(at).toISOString(),
      position: { x: Math.floor(+id / 256), z: +id % 256, floor: 0 } };
    const url = `/api/plugin/v1/${id === undefined ? 'status' : 'report'}`;
    await controller.handle({ method: id === undefined ? 'GET' : 'POST', url, headers: { authorization: `Bearer ${key}` } }, {}, { route: url, security: {} });
    return output;
  }
  return { report: call, status: () => call(), setPool: value => { pool = value; } };
}

function territoryFixture(kind) {
  const ids = ['13107', '13108', '13109'];
  const sections = {
    '13107': { '0': ['connected', 'gap'].includes(kind) ? ['13108'] : [] },
    '13108': { '0': kind === 'disconnected' ? [] : ['13107', '13109'] },
    '13109': { '0': ['13108'] },
  };
  const data = { chunks: Object.fromEntries(ids.map(id => [id, {}])), sections, challenges: {}, walkableChunks: ids, walkableChunksF2P: ids };
  const world = buildWorld(data);
  const state = createGroupState([{ id: 'a', name: 'Explorer 1', unlocked: ['13107'] },
    { id: 'b', name: 'Explorer 2', unlocked: [kind === 'gap' ? '13109' : '13108'] }]);
  return { data, world, state, target: state.members[1].unlocked[0] };
}

for (const kind of ['disconnected', 'one-way', 'gap', 'connected']) {
  test(`plugin and picker agree on ${kind} partner territory`, async t => {
    const { data, world, state, target } = territoryFixture(kind), before = structuredClone(state);
    const connections = partnerConnections(world, state, 'a');
    const picker = createTaskEngine(data).evaluate(state, 'a');
    const connected = kind === 'connected';
    assert.equal(connections.byChunk[target].connected, connected);
    assert.equal(picker.access.bases.includes(target), connected, 'Task access agrees with the map travel projection');
    if (kind === 'one-way') assert.equal(connections.byChunk[target].reason, 'no route back');
    if (kind === 'gap') assert.equal(connections.byChunk[target].reason, 'no route out', 'An unclaimed intermediate cannot be crossed');
    const plugin = await territoryPlugin(t, world, state);
    plugin.setPool({ eligible: [{ id: target }] });
    const status = await plugin.report(target), expected = connected ? 'unlocked' : 'locked';
    assert.equal(status.state, expected, 'A roll offer cannot grant access to unreachable partner territory');
    assert.deepEqual(status.nearby[12], { chunkId: target, state: expected, by: 'partner' });
    assert.equal((await plugin.status()).state, expected, 'GET status and report replies share the same contract');
    assert.equal((await plugin.report('13107')).state, 'unlocked', 'Personal ownership stays accessible');
    assert.deepEqual(state, before);
  });
}

test('plugin reuses travel projection across reports and pool fills, then refreshes at the next save revision', async t => {
  const { world, state, target } = territoryFixture('connected');
  const topology = world.sectionTopology;
  let reads = 0;
  Object.defineProperty(world, 'sectionTopology', { get: () => { reads++; return topology; } });
  const plugin = await territoryPlugin(t, world, state);
  assert.equal((await plugin.report(target)).state, 'unlocked');
  const initialReads = reads;
  assert.ok(initialReads > 0, 'Travel topology was consulted');
  await plugin.report(target); await plugin.status();
  plugin.setPool({ eligible: [{ id: '13109' }] });
  assert.equal((await plugin.report('13109')).state, 'available', 'Late pool results still refresh');
  assert.equal(reads, initialReads, 'Reports, GET status and pool identity changes reuse accessibility');
  state.members[0].sectionOverrides = { '13108-0': false }; state.revision++;
  assert.equal(partnerConnections(world, state, 'a').byChunk[target].connected, false);
  const beforeRefresh = reads;
  assert.equal((await plugin.report(target)).state, 'locked');
  assert.ok(reads > beforeRefresh, 'The new revision recalculates travel');
  const refreshedReads = reads;
  assert.equal((await plugin.status()).state, 'locked'); assert.equal(reads, refreshedReads);
  state.members[0].sectionOverrides = {}; state.rules['access.shared'] = false; state.revision++;
  const privateStatus = await plugin.report(target);
  assert.equal(privateStatus.state, 'locked'); assert.equal(privateStatus.nearby[12].by, undefined, 'Shared ownership colouring follows the saved rule');
  state.rules['access.shared'] = true; state.members[0].unlocked.push(target); state.revision++;
  const both = await plugin.report(target);
  assert.equal(both.state, 'unlocked'); assert.equal(both.nearby[12].by, 'both');
});

test('plugin and picker map agree with real world topology for connected mainland and disconnected island ownership', async t => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const state = createGroupState([{ id: 'a', name: 'Explorer 1', unlocked: ['12850'] },
    { id: 'b', name: 'Explorer 2', unlocked: ['12851', '11569'] }]);
  // Seed each synthetic start exactly as the picker does for split chunks.
  for (const owner of state.members) owner.sectionOverrides = Object.fromEntries(owner.unlocked
    .flatMap(base => startingSectionLocations(world, base).map(id => [id, true])));
  const connections = partnerConnections(world, state, 'a');
  assert.equal(connections.byChunk['12851'].connected, true, 'Recorded mainland topology has a round trip');
  assert.equal(connections.byChunk['11569'].connected, false, 'Claiming an island does not create a crossing');
  const plugin = await territoryPlugin(t, world, state);
  for (const id of ['12851', '11569']) {
    const status = await plugin.report(id), expected = connections.bases.includes(id) ? 'unlocked' : 'locked';
    assert.equal(status.state, expected);
    assert.deepEqual(status.nearby[12], { chunkId: id, state: expected, by: 'partner' });
  }
});

test('plugin status needs no engine or pool calculation; expired positions preserve unreviewed deltas', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-status-'));
  let at = Date.parse('2026-10-19T12:00:00Z'), pool = null, input, output;
  const state = { revision: 0, rules: {}, tasks: [], history: [], members: [
    { id: 'a', name: 'Explorer 1', unlocked: ['12850'], selected: [], pendingRoll: [], completedTasks: [] },
    { id: 'b', name: 'Explorer 2', unlocked: ['11569'], selected: [], pendingRoll: [], completedTasks: [] },
  ] }, before = JSON.stringify(state);
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    store: { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => pool },
    // Deliberately lacks the topology and engine inputs needed to calculate a pool.
    world: { chunks: new Map([['12850', { name: 'Lumbridge' }], ['13107', { name: 'Mine' }], ['11569', { name: 'Island' }]]) },
    registry: { resolve: () => ({ 'access.shared': true }) }, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => input,
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => { throw new Error('Native reports need no origin check.'); },
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { key } = await controller.create({ admin: true }, { memberId: 'a', label: 'Status test' });
  const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
  async function report(seq, x, z, extra = {}) {
    at += 1001; input = { v: 1, seq, sentAt: new Date(at).toISOString(), position: { x, z, floor: 0 }, ...extra };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  const states = status => Object.fromEntries(status.nearby.map(row => [row.chunkId, row.state]));
  const first = await report(1, 51, 51, { skills: { MINING: { level: 15, xp: 2411 } } });
  assert.equal(first.state, 'locked');
  assert.equal(first.nearby.length, 25);
  assert.deepEqual(first.nearby[0], { chunkId: String(49 * 256 + 49), state: 'unknown' }, 'Rows run south-west first, x fastest');
  assert.deepEqual(first.nearby[12], { chunkId: '13107', state: 'locked' }, 'The centre row repeats the current state');
  assert.equal(states(first)['12850'], 'unlocked', 'Neighbours use the same saved ownership');
  pool = { eligible: [{ id: '13107' }] };
  const second = await report(2, 51, 51);
  assert.equal(second.state, 'available', 'An existing same-revision pool can become available without recomputation');
  assert.equal(states(second)['13107'], 'available');
  const third = await report(3, 45, 49);
  assert.equal(third.state, 'locked', 'Partner ownership without a proven round trip grants no shared access');
  assert.deepEqual(third.nearby[12], { chunkId: '11569', state: 'locked', by: 'partner' });
  const corner = await report(4, 199, 0);
  assert.equal(corner.nearby.length, 9, 'Map squares outside 0-199 are omitted');
  assert.ok(corner.nearby.every(row => row.state === 'unknown'));
  at += 10 * 60 * 1000 + 1;
  request.method = 'GET'; request.url = '/api/plugin/v1/status';
  await controller.handle(request, {}, { route: request.url, security: {} });
  assert.equal(output.chunkId, null); assert.equal(output.state, 'unknown'); assert.equal(output.pendingProgress, true);
  assert.equal(output.nearby, null);
  assert.equal(output.unlockedChunkCount, 1); assert.equal(output.activeTaskCount, null);
  const preview = controller.review({ readOnly: true }, 'a'); assert.equal(preview.skills[0].after.level, 15);
  assert.deepEqual(controller.list({ readOnly: true }), { keys: [], positions: [], active: false });
  assert.equal(JSON.stringify(state), before, 'No command, save or History was touched');
});

test('world hops preserve pending skills; switching beta/live copies starts a new proposal', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-world-'));
  let at = Date.now(), input;
  const state = { revision: 0, rules: {}, tasks: [], members: [{ id: 'a', name: 'Explorer', unlocked: [], completedTasks: [] }] };
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    store: { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => null },
    world: { chunks: new Map() }, registry: { resolve: () => ({}) }, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => input, json: async () => {}, checkRequestOrigin: () => {},
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const identity = { admin: true }, { key } = await controller.create(identity, { memberId: 'a', label: 'World test' });
  const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
  async function send(seq, world, skills) {
    at += 1001; input = { v: 1, seq, sentAt: new Date(at).toISOString(), world, position: { x: 50, z: 50, floor: 0 }, skills };
    await controller.handle(request, {}, { route: request.url, security: {} });
  }
  await send(1, { id: 1, beta: false }, { MINING: { level: 15, xp: 2411 } });
  await send(2, { id: 2, beta: false }, { ATTACK: { level: 12, xp: 1584 } });
  assert.equal(controller.review(identity, 'a').skills.length, 2);
  await send(3, { id: 3, beta: true }, { ATTACK: { level: 1, xp: 0 } });
  const review = controller.review(identity, 'a'); assert.equal(review.skills.length, 1); assert.equal(review.world.beta, true);
});

test('a missing pool is warmed after the status reply, so the next status shows available chunks', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-warm-'));
  let at = Date.now(), pool = null, calculated = 0, output;
  const state = { revision: 0, rules: {}, tasks: [], members: [{ id: 'a', name: 'Explorer', unlocked: ['12850'], selected: [], pendingRoll: [], completedTasks: [] }] };
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    store: { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => pool,
      rollPool: () => { calculated++; pool = { eligible: [{ id: '13107' }] }; return pool; } },
    world: { chunks: new Map([['12850', { name: 'Lumbridge' }], ['13107', { name: 'Mine' }]]) },
    registry: { resolve: () => ({}) }, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => ({ v: 1, seq: 1, sentAt: new Date(at).toISOString(), position: { x: 51, z: 51, floor: 0 } }),
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => {},
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { key } = await controller.create({ admin: true }, { memberId: 'a', label: 'Warm test' });
  const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
  await controller.handle(request, {}, { route: request.url, security: {} });
  assert.equal(output.state, 'locked'); assert.equal(calculated, 0, 'The reply never waits for a pool');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calculated, 1);
  at += 1001; request.method = 'GET'; request.url = '/api/plugin/v1/status';
  await controller.handle(request, {}, { route: request.url, security: {} });
  assert.equal(output.state, 'available'); assert.equal(calculated, 1);
});
test('status names whose chunks are whose, partners\' chunks and a waiting roll', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-duo-'));
  let at = Date.now(), output, input;
  const state = { revision: 0, rules: {}, tasks: [], members: [
    { id: 'a', name: 'Explorer 1', unlocked: ['13107', '13108'], selected: [], pendingRoll: ['13363'], completedTasks: [] },
    { id: 'b', name: 'Explorer 2', unlocked: ['13108', '12851-1'], selected: [], pendingRoll: [], completedTasks: [] },
  ] };
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    store: { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => ({ eligible: [{ id: '13109' }, { id: '12852' }] }) },
    world: { chunks: new Map([['13107', { name: 'Mine' }], ['13108', { name: 'Farm' }], ['12851', { name: 'Swamp' }], ['13363', { name: 'Draynor' }]]) },
    registry: { resolve: () => ({ 'access.shared': true }) }, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => input,
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => {},
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const keyA = (await controller.create({ admin: true }, { memberId: 'a', label: 'A' })).key;
  const keyB = (await controller.create({ admin: true }, { memberId: 'b', label: 'B' })).key;
  async function report(key, seq, x, z) {
    at += 1001; input = { v: 1, seq, sentAt: new Date(at).toISOString(), position: { x, z, floor: 0 } };
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  const first = await report(keyA, 1, 51, 51);
  assert.deepEqual(first.partners, [{ name: 'Explorer 2', chunkId: null, chunkName: null, seenAt: null }]);
  await report(keyB, 1, 50, 51);
  const status = await report(keyA, 2, 51, 51);
  const rows = Object.fromEntries(status.nearby.map(row => [row.chunkId, row]));
  assert.equal(rows['13107'].by, 'me'); assert.equal(rows['13108'].by, 'both'); assert.equal(rows['12851'].by, 'partner');
  assert.equal(rows['12851'].state, 'locked', 'Ownership colouring does not grant shared access');
  assert.equal(rows['13109'].by, undefined, 'Unclaimed rows have no owner');
  assert.deepEqual(status.partners, [{ name: 'Explorer 2', chunkId: '12851', chunkName: 'Swamp', seenAt: status.partners[0].seenAt }]);
  assert.ok(status.partners[0].seenAt);
  assert.deepEqual(status.pendingRoll, [{ chunkId: '13363', chunkName: 'Draynor', summary: null }]);
  assert.equal(status.pickableCount, 2);
  at += 10 * 60 * 1000 + 1;
  assert.equal((await report(keyA, 3, 51, 51)).partners[0].chunkId, null, 'A stale partner report is not shown');
});
