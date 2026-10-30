import { fixtureDataset, emptyMetadataDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const ids = Array.from({ length: 3 }, (_, index) => String(fixtureDataset.capabilities.independent ? SURFACE_GRID.startId - index : 12850 + index));
const definitions = { chunks: Object.fromEntries(ids.map((id, index) => [id, { Nickname: `Place ${index}`, Spawn: { [`Supply ${index}`]: 1 } }])),
  walkableChunks: ids, walkableChunksF2P: ids, challenges: { Extra: Object.fromEntries(ids.map((id, index) => [`Mine ${index}`, { Items: [`Supply ${index}`] }])) } };

test('HTTP reads use the picker prediction cache and retained completion history without admitting work', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'plugin-reads-http-'));
  const initialState = createGroupState([{ id: 'a', name: 'Explorer', unlocked: [ids[0]], pendingRoll: ids.slice(1) }]);
  initialState.tasks = [{ id: 'custom:finish', label: 'A personal task', category: 'Custom', memberIds: ['a'] }];
  const app = await createServer({ dataset: await emptyMetadataDataset(), gameDataDir: path.join(dataDir, 'game-data'), mapAssetsDir: path.join(dataDir, 'assets'), dataDir, host: '127.0.0.1', port: 0, initialState, definitions, taskMap: {}, predictionPrewarm: false });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  async function request(route, auth = admin, body) {
    const response = await fetch(origin + route, { headers: body ? { ...auth, Origin: origin, 'Content-Type': 'application/json' } : auth,
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `HTTP ${response.status} for ${route.split('?')[0]}`); return response.json();
  }
  const { key } = await request('/api/game-plugin/keys', admin, { memberId: 'a', label: 'Synthetic HTTP test' });
  const plugin = { Authorization: `Bearer ${key}` };
  const before = await request('/api/diagnostics');
  assert.equal((await request('/api/plugin/v1/status', plugin)).pendingRoll[0].summary, null);
  await delay(10);
  assert.deepEqual((await request('/api/diagnostics')).predictionLane, before.predictionLane);
  const baseline = await request('/api/tasks?memberId=a');
  const prediction = await request(`/api/predict?memberId=a&chunkId=${ids[1]}`);
  const ready = await request('/api/diagnostics');
  const status = await request('/api/plugin/v1/status', plugin);
  const summary = status.pendingRoll[0].summary;
  assert.ok(summary); assert.equal(Object.values(summary.newTasks).reduce((a, b) => a + b, 0), prediction.delta.tasksAdded.length);
  assert.equal(summary.newTasks.other, prediction.delta.tasksAdded.length);
  assert.ok(prediction.delta.tasksAdded.length > 0, JSON.stringify({ rows: baseline.tasks.map(row => ({ label: row.label, status: row.status, blockers: row.blockers, hiddenReasons: row.hiddenReasons })), access: baseline.access, member: app.store.getState().members[0], delta: prediction.delta }));
  await delay(10);
  assert.deepEqual((await request('/api/diagnostics')).predictionLane, ready.predictionLane, 'Summary reads start no prediction work');
  const calculated = await request('/api/tasks?memberId=a&view=play-v1');
  const active = await request('/api/plugin/v1/tasks', plugin);
  const id = active.all.find(row => calculated.tasks.some(task => task.id === row.id))?.id; assert.ok(id, JSON.stringify({ tasks: calculated.tasks.map(row => ({ id: row.id, status: row.status, hidden: row.hidden })), presentation: calculated.presentation, active })); assert.ok(calculated.tasks.some(row => row.id === id));
  await request('/api/command', admin, { expectedRevision: 0, command: { type: 'complete-task', memberId: 'a', taskId: id, completed: true } });
  await delay(1100);
  const stale = await request('/api/plugin/v1/tasks', plugin);
  assert.equal(stale.stale, true); assert.equal(stale.done.all[0].id, id);
  assert.equal(stale.done.all[0].doneAt, app.store.getTaskCompletionHistory('a').at(-1).at);
  assert.ok(!stale.all.some(row => row.id === id));
  assert.equal(app.store.getInfo().revision, 1, 'All reads preserve game state');
});
