import { fixtureDataset, emptyMetadataDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const initialState = createGroupState([{ id: 'a', name: 'Player', unlocked: [ids[0]], pendingRoll: ids.slice(1) }]);
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


async function completionFixture(t, { retention, startAt = Date.parse('2026-10-30T12:00:00Z') } = {}) {
  let at = startAt;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'plugin-completion-http-'));
  const initialState = createGroupState([{ id: 'a', name: 'Player', unlocked: [ids[0]] }]);
  const app = await createServer({ dataset: await emptyMetadataDataset(), dataDir, definitions, taskMap: {}, initialState,
    gameDataDir: path.join(dataDir, 'game-data'), mapAssetsDir: path.join(dataDir, 'assets'), host: '127.0.0.1', port: 0,
    predictionPrewarm: false, retention, now: () => at, progressSources: { clock: () => at } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  async function request(route, auth = admin, body) {
    at += 1001;
    const response = await fetch(origin + route, { headers: body === undefined ? auth : { ...auth, Origin: origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    assert.equal(response.status, route === '/api/game-plugin/keys' ? 201 : 200); return response.json();
  }
  const { key } = await request('/api/game-plugin/keys', admin, { memberId: 'a', label: 'Completion fixture' });
  const plugin = { Authorization: `Bearer ${key}` };
  const command = body => request('/api/command', admin, { expectedRevision: app.store.getInfo().revision, command: body });
  const tasks = () => request('/api/plugin/v1/tasks', plugin);
  const calculate = () => request('/api/tasks?memberId=a&view=play-v1');
  await calculate();
  const active = await tasks(), id = active.all[0]?.id; assert.ok(id);
  async function complete() {
    await command({ type: 'complete-task', memberId: 'a', taskId: id, completed: true });
    return app.store.getTaskCompletionHistory('a').find(event => event.type === 'complete-task').at;
  }
  async function ruleChanges(count) {
    for (let index = 0; index < count; index++) await command({ type: 'set-rule', ruleId: 'access.shared', value: index % 2 === 1 });
  }
  async function waitForFinish() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const value = await tasks();
      if (value.done.all.some(row => row.id === id)) return value;
      await delay(20);
    }
    assert.fail('Background completion history did not fill');
  }
  return { app, dataDir, id, tasks, calculate, complete, ruleChanges, waitForFinish, advance(ms) { at += ms; },
    async reportHere() { const gameId = Number(ids[0]); await request('/api/plugin/v1/report', plugin,
      { v: 1, seq: 1, sentAt: new Date(at).toISOString(), position: { x: Math.floor(gameId / 256), z: gameId % 256, floor: 0 } }); } };
}

test('a completed ordinary task remains here after recalculation removes its active map location', async t => {
  const f = await completionFixture(t);
  await f.reportHere();
  assert.ok((await f.tasks()).here.some(row => row.id === f.id));
  const doneAt = await f.complete();
  const recalculated = await f.calculate();
  assert.equal(recalculated.taskLocations?.[f.id], undefined);
  const finished = await f.tasks();
  assert.equal(finished.stale, false); assert.equal(finished.done.hereKnown, true);
  assert.ok(finished.done.here.some(row => row.id === f.id && row.doneAt === doneAt));
  assert.ok(!finished.here.some(row => row.id === f.id));
  assert.deepEqual((await f.tasks()).done, finished.done, 'The revision cache preserves recovered locations');
});

test('retention of two live events fills a recent archived finish asynchronously after six rule changes', async t => {
  const f = await completionFixture(t, { retention: { historyEntries: 2 } });
  const doneAt = await f.complete();
  await f.ruleChanges(6);
  assert.ok(f.app.store.getInfo().retention.historyArchives > 0);
  assert.ok(!f.app.store.getState().history.some(event => event.type === 'complete-task'));
  const immediate = await f.tasks();
  assert.ok(!immediate.done.all.some(row => row.id === f.id), 'The first reply uses live history without waiting for archives');
  const filled = await f.waitForFinish();
  assert.equal(filled.done.all.find(row => row.id === f.id).doneAt, doneAt);
  const view = f.app.store.getTaskCompletionHistory('a');
  assert.equal(f.app.store.getTaskCompletionHistory('a'), view, 'Warm reads reuse the completion view');
  assert.deepEqual((await f.tasks()).done, filled.done);
  assert.equal(f.app.store.getInfo().revision, 7);
  assert.ok(!f.app.store.getState().history.some(event => event.type === 'complete-task'), 'No full history hydration');
});

test('recent completion reads stop before an older archive outside seven days', async t => {
  const f = await completionFixture(t, { retention: { historyEntries: 2 }, startAt: Date.parse('2026-10-01T12:00:00Z') });
  await f.ruleChanges(9);
  f.advance(29 * 24 * 60 * 60 * 1000);
  const doneAt = await f.complete();
  await f.ruleChanges(6);
  const oldest = f.app.store.getState().provenance.historyArchive[0].id;
  await writeFile(path.join(f.dataDir, 'history', oldest), 'unread older segment');
  const first = await f.tasks(); assert.equal(first.done.allCount, 0);
  const filled = await f.waitForFinish();
  assert.equal(filled.done.all.find(row => row.id === f.id).doneAt, doneAt, 'An unrelated old archive is never opened');
});
