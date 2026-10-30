import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { openGamePlugin } from '../app/game-plugin.mjs';

// Controller only: no listener, worker, real save, pack or game client.
async function fixture(t, { ids, members, saved = null, eligible = [], walkable = ids, surface = [] }) {
  const scratch = new URL('../.local/', import.meta.url);
  await mkdir(scratch, { recursive: true });
  const dataDir = await mkdtemp(new URL('game-plugin-coords-', scratch));
  let at = Date.parse('2026-10-27T12:00:00Z'), input, output;
  const state = { revision: 0, rules: {}, tasks: [], history: [], members }, before = JSON.stringify(state);
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    store: { getInfo: () => ({ revision: 0 }), getCalculationSnapshot: () => ({ state, members }), peekRollPool: () => ({ eligible }) },
    world: { chunks: new Map(ids.map(id => [id, { name: `Fixture ${id}` }])), walkable: new Set(walkable), surface: new Set(surface) },
    registry: { resolve: () => ({ 'access.shared': true, 'tasks.completion': 'any' }) }, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => input,
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => {},
    savedTasks: () => saved,
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const keys = new Map(), sequences = new Map();
  for (const member of members) keys.set(member.id, (await controller.create({ admin: true }, { memberId: member.id, label: 'Coordinates test' })).key);
  async function call(player, url, id = null) {
    at += 1001;
    if (id !== null) {
      const seq = (sequences.get(player) ?? 0) + 1; sequences.set(player, seq);
      input = { v: 1, seq, sentAt: new Date(at).toISOString(), position: { x: Math.floor(+id / 256), z: +id % 256, floor: 0 } };
    }
    await controller.handle({ method: id === null ? 'GET' : 'POST', url, headers: { authorization: `Bearer ${keys.get(player)}` } }, {}, { route: url, security: {} });
    return output;
  }
  return { controller, state, before, call, report: (player, id) => call(player, '/api/plugin/v1/report', id), expire: () => { at += 600001; } };
}
const member = (id, extra = {}) => ({ id, name: `Explorer ${id}`, unlocked: [], selected: [], pendingRoll: [], completedTasks: [], ...extra });

test('Anachronia report stores picker identity, shades game squares and filters tasks here by picker identity', async t => {
  const tasks = ['here', 'away', 'raw-game-id'].map(id => ({ id, label: id, category: 'Skills', status: 'available' }));
  const saved = { revision: 0, bytes: Buffer.from(JSON.stringify({ tasks, taskLocations: { here: ['15426-1'], away: ['12850'], 'raw-game-id': ['21283'] },
    presentation: { tasks: tasks.map(row => row.id) } })) };
  const f = await fixture(t, { ids: ['15424', '15425', '15426', '15427', '15428', '15429', '15430', '12850'], saved,
    members: [member('a', { unlocked: ['15425-1', '15426'], selected: ['15429'], pendingRoll: ['15430-2'] }),
      member('b', { unlocked: ['15425', '15427'] })], eligible: [{ id: '15428' }] });
  const first = await f.report('a', 21283);
  assert.equal(first.chunkId, '21283', 'Lua compares status with the raw player game ID');
  assert.equal(first.chunkName, 'Fixture 15426'); assert.equal(first.state, 'unlocked');
  const stored = f.controller.list({ admin: true }).positions.find(row => row.memberId === 'a');
  assert.equal(stored.chunkId, '15426'); assert.deepEqual(stored.position, { x: 83, z: 35, floor: 0 });
  assert.equal(first.nearby.length, 25);
  assert.deepEqual(first.nearby[12], { chunkId: '21283', state: 'unlocked', by: 'me' });
  const rows = Object.fromEntries(first.nearby.map(row => [row.chunkId, row]));
  assert.deepEqual(rows['21282'], { chunkId: '21282', state: 'unlocked', by: 'both' });
  assert.deepEqual(rows['21284'], { chunkId: '21284', state: 'unlocked', by: 'partner' });
  assert.equal(rows['21281'].state, 'locked'); assert.equal(rows['21285'].state, 'available');
  assert.ok(!rows['15426'], 'nearby row shape and map-square positions remain compatible with current Lua');
  assert.deepEqual(first.pendingRoll, [{ chunkId: '21287-2', chunkName: 'Fixture 15430', summary: null }]);
  const here = await f.call('a', '/api/plugin/v1/tasks');
  assert.equal(here.chunkId, '21283'); assert.equal(here.hereKnown, true);
  assert.deepEqual(here.here.map(row => row.id), ['here']); assert.equal(here.allCount, 3);
  assert.ok(here.all.every(row => !Object.hasOwn(row, 'chunks')));
  await f.report('b', 21284);
  const status = await f.call('a', '/api/plugin/v1/status');
  assert.equal(status.partners[0].chunkId, '21284'); assert.equal(status.partners[0].chunkName, 'Fixture 15427');
  assert.equal((await f.report('a', 21286)).state, 'available', 'selected uses picker IDs');
  assert.equal((await f.report('a', 21287)).state, 'available', 'pending roll uses picker IDs');
  f.expire();
  const expired = await f.call('a', '/api/plugin/v1/status');
  assert.equal(expired.chunkId, null); assert.equal(expired.nearby, null); assert.equal(expired.partners[0].chunkId, null);
  const expiredTasks = await f.call('a', '/api/plugin/v1/tasks');
  assert.equal(expiredTasks.chunkId, null); assert.equal(expiredTasks.hereKnown, false);
  assert.equal(JSON.stringify(f.state), f.before, 'coordinate reports never mutate saved state');
});

test('all four areas keep outgoing game identity while browser positions use picker identity', async t => {
  const pairs = [['14878', 7093], ['15426', 21283], ['16436', 13592], ['7729', 5464]];
  const ids = pairs.map(([id]) => id);
  const f = await fixture(t, { ids, members: [member('a', { unlocked: ids, pendingRoll: ids })] });
  for (const [picker, game] of pairs) {
    const response = await f.report('a', game);
    assert.equal(response.chunkId, String(game)); assert.equal(response.state, 'unlocked');
    assert.equal(response.chunkName, `Fixture ${picker}`);
    assert.equal(f.controller.list({ admin: true }).positions[0].chunkId, picker);
    assert.equal(response.nearby[12].chunkId, String(game));
    const tasks = await f.call('a', '/api/plugin/v1/tasks');
    assert.equal(tasks.ready, false); assert.equal(tasks.chunkId, String(game));
    assert.deepEqual(response.pendingRoll.map(row => row.chunkId), pairs.map(([, id]) => String(id)));
  }
  // The same numeric ID can be a picker display position and an unmapped game
  // location. Echo actual reports rather than applying the reverse transform twice.
  assert.equal((await f.report('a', 15426)).chunkId, '15426');
});

test('ambiguous authored destinations retain their own state and task identity', async t => {
  const f = await fixture(t, { ids: ['16436', '13592'], members: [member('a', { unlocked: ['16436'] })] });
  const response = await f.report('a', 13592);
  assert.equal(response.chunkId, '13592'); assert.equal(response.state, 'locked');
  assert.equal(response.chunkName, 'Fixture 13592');
  assert.equal(f.controller.list({ admin: true }).positions[0].chunkId, '13592');
});
