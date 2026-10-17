import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';

test('HTTP area advice reuses the current ordinary list across isolated workers and stays read-only for viewers', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'area-check-server-'));
  const messages = [];
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { messages.push(message); return post(message); };
    return worker;
  };
  const definitions = { chunks: { '12850': {}, '12851': {} },
    walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
    challenges: { Quest: { 'Present quest': { Chunks: ['12850'], QuestPoints: 1 }, 'Area quest': { Chunks: ['12851'], QuestPoints: 1 } } } };
  const initialState = createGroupState([{ id: 'one', name: 'Player', unlocked: ['12850'] }]);
  const dataset = { ...fixtureDataset, capabilities: { ...fixtureDataset.capabilities,
    features: { ...fixtureDataset.capabilities.features, training: true } } };
  const app = await createServer({ dataDir, dataset, definitions, initialState, port: 0,
    predictionPrewarm: false, taskWorkerOptions: { workerFactory } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const adminHeaders = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const tasks = await (await fetch(`${origin}/api/tasks?memberId=one`, { headers: adminHeaders })).json();
  await nextTurn(); await nextTurn();
  const before = app.store.getInfo().revision;
  const created = await fetch(`${origin}/api/invites`, { method: 'POST', headers: { ...adminHeaders, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Test viewer', viewer: true }) });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  const joined = await fetch(invitation.link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${origin}/api/area-check?memberId=one&chunks=12851&revision=${before}`, { headers: { cookie } });
  const area = await response.json();
  assert.equal(response.status, 200, area.message);
  assert.equal(area.cache.baselineSource, 'current-list');
  const request = messages.find(message => message.type === 'area-check');
  assert.deepEqual(request.chunkId.baselineTaskIds, tasks.presentation.tasks.map(task => task.id));
  assert.deepEqual(area.tasks.combined.categories[0].tasks.map(task => task.label), ['Area quest']);
  assert.equal(app.store.getInfo().revision, before);
  const invalid = await fetch(`${origin}/api/area-check?memberId=one&chunks=12851&revision=${before}&baselineTaskIds=forged`, { headers: { cookie } });
  assert.equal(invalid.status, 400, 'baseline IDs are internal and cannot be supplied by HTTP clients');
});
