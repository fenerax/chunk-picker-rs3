// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { scaleWorkerDefinitions } from './fixtures/why-scale.mjs';
import { loadWhyChain } from '../app/web/task-why-chain.mjs';
import { buildWhyChain } from '../app/tasks/why-chain.mjs';

const wire = value => JSON.parse(JSON.stringify(value));
test('20,560-task calculator serves ordinary Why and How without full downloads; charged index is reused', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'why-scale-'));
  let app; t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const definitions = scaleWorkerDefinitions(), jobs = [], replies = [];
  const initialState = createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['12850'] }]);
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: { ...workerData, skillGuideCatalogue: { skills: [], tasks: [] } },
      execArgv: ['--import', new URL('./fixtures/resident-planning-probe.mjs', import.meta.url).href] });
    const post = worker.postMessage.bind(worker); worker.postMessage = message => { jobs.push(message); return post(message); };
    worker.on('message', message => { if (message.id !== undefined && message.type !== 'progress') replies.push(message); }); return worker;
  };
  app = await createServer({ dataDir, dataset: fixtureDataset, definitions, initialState, port: 0, predictionPrewarm: false,
    taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory, serializedStateInput: true } }); await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` }, calls = [];
  const get = async route => {
    calls.push(route); const response = await fetch(origin + route, { headers }), value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message), { status: response.status, code: value.code }); return value;
  };
  const transfer = route => new Promise((resolve, reject) => {
    let size = 0; http.get(origin + route, { headers: { ...headers, 'Accept-Encoding': 'gzip' } }, response => {
      response.on('data', bytes => { size += bytes.length; }); response.on('error', reject);
      response.on('end', () => response.statusCode === 200 ? resolve(size) : reject(new Error(`Transfer status ${response.statusCode}`)));
    }).on('error', reject);
  });
  const list = await get('/api/tasks?view=play-v1&memberId=one'), revision = list.stateRevision;
  const before = jobs.filter(job => job.type === 'evaluate').length, start = calls.length;
  const id = taskId('Extra', 'Regional objective 16'), nextId = taskId('Extra', 'Regional objective 17');
  const whyRoute = subject => `/api/task-why?view=display-v1&memberId=one&revision=${revision}&taskId=${encodeURIComponent(subject)}`;
  const first = await get(whyRoute(id)), firstProbe = replies.at(-1).probe;
  const second = await get(whyRoute(nextId)), secondProbe = replies.at(-1).probe;
  const howRoute = `/api/task-how?memberId=one&revision=${revision}&taskId=${encodeURIComponent(id)}`;
  const how = await get(howRoute);
  assert.equal(calls.length - start, 3); assert.ok(calls.slice(start).every(route => !route.startsWith('/api/tasks?') && !route.startsWith('/api/definitions')));
  assert.equal(jobs.filter(job => job.type === 'evaluate').length, before);
  const firstIndex = firstProbe.snapshots.find(row => row.whyIndexId), secondIndex = secondProbe.snapshots.find(row => row.whyIndexId);
  assert.ok(firstIndex); assert.equal(firstIndex.whyIndexId, secondIndex.whyIndexId); assert.ok(firstIndex.whyIndexCharge > 1_000_000);
  assert.ok(firstIndex.charge >= firstIndex.measured); assert.equal(secondProbe.evaluateFull, firstProbe.evaluateFull);
  const full = await get('/api/tasks?memberId=one'); assert.equal(full.tasks.length, 20_560);
  for (const display of [first, second]) assert.deepEqual(wire(explainTask(display.task, display)), wire(explainTask(full.tasks.find(row => row.id === display.task.id), { result: full })));
  const expectedHow = createTaskEngine(definitions).how(app.store.getState(), 'one', id, { baseline: full, context: { datasetDigest: how.context.datasetDigest } });
  assert.deepEqual(wire(how), wire(expectedHow));
  // The same large saved-result API refusal used by task/Slayer disclosures
  // carries an explicit fallback code. The actual full HTTP route recovers it.
  const blockedId = taskId('Extra', 'Regional objective 0'), selector = { taskId: blockedId };
  const chain = await loadWhyChain({ api: get }, selector, { memberId: 'one', revision,
    loadFull: async () => { const result = await get('/api/tasks?memberId=one'); await get('/api/definitions'); return { result, definitions }; } });
  assert.deepEqual(chain.root, buildWhyChain(full, definitions, selector).root);
  const whyBytes = await transfer(whyRoute(id)), howBytes = await transfer(howRoute);
  const fullBytes = await transfer('/api/tasks?memberId=one') + await transfer('/api/definitions');
  assert.ok(whyBytes < fullBytes); assert.ok(howBytes < fullBytes);
  t.diagnostic(JSON.stringify({ synthetic: true, tasks: full.tasks.length, fullRawBytes: Buffer.byteLength(JSON.stringify(full)),
    full: { calls: 2, transferredBytes: fullBytes }, why: { calls: 1, transferredBytes: whyBytes }, how: { calls: 1, transferredBytes: howBytes },
    indexCharge: firstIndex.whyIndexCharge }));
});
