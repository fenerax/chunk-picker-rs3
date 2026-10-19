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
  assert.equal((await report(1, 51, 51, { skills: { MINING: { level: 15, xp: 2411 } } })).state, 'locked');
  pool = { eligible: [{ id: '13107' }] };
  assert.equal((await report(2, 51, 51)).state, 'available', 'An existing same-revision pool can become available without recomputation');
  assert.equal((await report(3, 45, 49)).state, 'unlocked', 'Saved shared access includes partner ownership');
  at += 10 * 60 * 1000 + 1;
  request.method = 'GET'; request.url = '/api/plugin/v1/status';
  await controller.handle(request, {}, { route: request.url, security: {} });
  assert.equal(output.chunkId, null); assert.equal(output.state, 'unknown'); assert.equal(output.pendingProgress, true);
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
