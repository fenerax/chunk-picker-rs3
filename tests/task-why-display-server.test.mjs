// @test quick dataset=open-f2p
import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { caveDefinitions } from './task-how-fixture.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { TASK_WHY_DISPLAY_LIMIT } from '../app/tasks/task-why-display.mjs';
import { loadTaskWhyEvidence, catalogued, createRuleDescriber } from '../app/web/task-why.mjs';

const wire = value => JSON.parse(JSON.stringify(value));

for (const groupOn of [false, true]) test(`Why HTTP equals full results for both members, Group ${groupOn ? 'on' : 'off'}`, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'why-display-'));
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const jobs = []; let mutateDuringRead, mutation;
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => {
      jobs.push(message);
      if (message.type === 'why-task' && mutateDuringRead) {
        const mutate = mutateDuringRead; mutateDuringRead = undefined;
        mutation = mutate(); void mutation.then(() => post(message)); return;
      }
      return post(message);
    };
    return worker;
  };
  const initialState = createGroupState([{ id: 'one', name: 'Explorer 1', unlocked: ['12593'] }, { id: 'two', name: 'Explorer 2', unlocked: ['12850'] }]);
  initialState.rules['access.shared'] = groupOn;
  app = await createServer({ dataDir, dataset: fixtureDataset, definitions: caveDefinitions(), initialState, port: 0,
    predictionPrewarm: false, taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory, serializedStateInput: true } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const revision = app.store.getInfo().revision;
  const route = (memberId, taskId, rev = revision) => `/api/task-why?view=display-v1&memberId=${memberId}&taskId=${encodeURIComponent(taskId)}&revision=${rev}`;
  const get = async url => {
    const response = await fetch(origin + url, { headers }), value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message), { status: response.status, code: value.code });
    return value;
  };
  const transferred = url => new Promise((resolve, reject) => {
    http.get(origin + url, { headers: { ...headers, 'Accept-Encoding': 'gzip' } }, response => {
      let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; }); response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error(`Transfer check returned ${response.statusCode}.`));
        else resolve(bytes);
      });
    }).on('error', reject);
  });
  const beforeList = await fetch(origin + route('one', 'absent'), { headers });
  assert.equal(beforeList.status, 409);
  assert.equal((await beforeList.json()).code, 'TASK_WHY_UNAVAILABLE');
  assert.ok(!jobs.some(job => job.type === 'evaluate'), 'snapshot miss must not calculate');

  // A read-only invitation cannot admit a Why job, even on a retained worker.
  const invitation = await (await fetch(origin + '/api/invites', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Saved view', viewer: true }) })).json();
  const joined = await fetch(invitation.link, { redirect: 'manual' }), cookie = joined.headers.get('set-cookie').split(';')[0];
  const beforeViewer = jobs.length;
  const viewerMiss = await fetch(origin + route('one', 'absent'), { headers: { cookie } });
  assert.equal(viewerMiss.status, 409); assert.equal(jobs.length, beforeViewer);

  const displays = new Map(), lists = new Map();
  for (const memberId of ['one', 'two']) {
    const group = groupOn ? memberId === 'one' ? '&projection=duo-sidebar-v1' : '&lane=duo-v1&peerFor=one' : '';
    const list = await get(`/api/tasks?view=play-v1&memberId=${memberId}&revision=${revision}${group}`);
    lists.set(memberId, list);
    assert.ok(!JSON.stringify(list).includes('task-why-display-v1'));
    for (const row of list.tasks) {
      const before = jobs.filter(job => job.type === 'evaluate').length;
      const response = await fetch(origin + route(memberId, row.id), { headers });
      const bytes = Buffer.from(await response.arrayBuffer()), display = JSON.parse(bytes);
      assert.equal(response.status, 200, JSON.stringify(display));
      assert.ok(bytes.length <= TASK_WHY_DISPLAY_LIMIT);
      assert.equal(display.memberId, memberId); assert.equal(display.stateRevision, revision);
      assert.equal(jobs.filter(job => job.type === 'evaluate').length, before);
      displays.set(`${memberId}/${row.id}`, display);
    }
  }
  assert.ok(jobs.some(job => job.type === 'why-task' && job.stateTransport === 'json-shared-v1'));
  if (groupOn) assert.ok(jobs.filter(job => job.type === 'why-task' && job.memberId === 'two').length >= lists.get('two').tasks.length);
  for (const memberId of ['one', 'two']) {
    const full = await get(`/api/tasks?memberId=${memberId}`);
    const describeRule = catalogued(await createRuleDescriber(app.store.getState(), memberId));
    for (const row of lists.get(memberId).tasks) {
      const task = full.tasks.find(task => task.id === row.id); assert.ok(task, row.id);
      const display = displays.get(`${memberId}/${task.id}`); assert.ok(display, task.id);
      assert.deepEqual(wire(explainTask(display.task, { ...display, describeRule })), wire(explainTask(task, { result: full, describeRule })), `${memberId}/${task.id}`);
    }
    // The saved gzip path returns the same projection without another job.
    const taskId = lists.get(memberId).tasks[0].id, before = jobs.length;
    // Full gzip retention runs asynchronously after the list response.
    let viewer;
    for (;;) {
      viewer = await fetch(origin + route(memberId, taskId), { headers: { cookie } });
      if (viewer.ok) break;
      await viewer.arrayBuffer(); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(viewer.status, 200); assert.equal(jobs.length, before);
    const saved = await get(route(memberId, taskId));
    assert.deepEqual(saved, displays.get(`${memberId}/${taskId}`)); assert.equal(jobs.length, before);
    assert.deepEqual(await viewer.json(), saved); assert.equal(jobs.length, before);
    const perTaskBytes = await transferred(route(memberId, taskId));
    const fullBytes = await transferred(`/api/tasks?memberId=${memberId}`) + await transferred('/api/definitions');
    assert.ok(perTaskBytes < fullBytes);
    t.diagnostic(JSON.stringify({ synthetic: true, groupOn, memberId, full: { calls: 2, transferredBytes: fullBytes }, perTask: { calls: 1, transferredBytes: perTaskBytes } }));
  }

  const stale = await fetch(origin + route('one', lists.get('one').tasks[0].id, revision + 1), { headers });
  assert.equal(stale.status, 409);
  const badMember = await fetch(origin + route('absent', 'task'), { headers }); assert.equal(badMember.status, 400);
  const oldId = lists.get('one').tasks[0].id;
  // Clear saved evidence with a task-affecting write, then test browser fallback
  // using the real HTTP endpoint and the same full-details URLs as today's UI.
  await app.store.command({ type: 'set-task-rule', memberId: 'one', ruleId: 'Quests', value: false }, revision);
  const changedRevision = app.store.getInfo().revision;
  const calls = [];
  const api = async url => { calls.push(url); return get(url); };
  const narrow = await loadTaskWhyEvidence(api, oldId, 'one', changedRevision, () => true);
  assert.equal(narrow, undefined);
  // As in the UI, settle the current compact list before requesting its full
  // details; a direct store write does not start the browser's list refresh.
  await get('/api/tasks?view=play-v1&memberId=one');
  const full = await get('/api/tasks?memberId=one');
  assert.equal(full.stateRevision, changedRevision); assert.ok(full.tasks.length);
  assert.equal(calls.length, 1);

  // A save landing during a worker read must reject the answer. Use an ID not
  // retained by a previous projection and a new task input to force that read.
  await app.store.command({ type: 'set-task-rule', memberId: 'one', ruleId: 'Quests', value: true }, changedRevision);
  const currentRevision = app.store.getInfo().revision;
  await get(`/api/tasks?view=play-v1&memberId=one`);
  mutateDuringRead = () => app.store.command({ type: 'set-note', memberId: 'one', chunkId: '12593', note: 'Synthetic stale Why read' }, currentRevision);
  const during = await fetch(origin + route('one', oldId, currentRevision), { headers });
  await mutation;
  assert.equal(during.status, 409, await during.text());
});
