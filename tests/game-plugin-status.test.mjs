import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openGamePlugin } from '../app/game-plugin.mjs';

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
  assert.equal(third.state, 'unlocked', 'Saved shared access includes partner ownership');
  assert.equal(states(third)['11569'], 'unlocked');
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