import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { pathDefinitions, pathState, caveDefinitions } from './task-how-fixture.mjs';

test('How HTTP uses its worker job, revision guards, read-only semantics and no normal payload growth', async t => {
  await mkdir(new URL('../.local/how-tests/', import.meta.url), { recursive: true });
  const dataDir = await mkdtemp(new URL('../.local/how-tests/server-', import.meta.url));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const messages = []; let mutateDuringProof, mutation;
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { messages.push(message); if (message.type === 'how-task' && mutateDuringProof) { mutation = mutateDuringProof(); void mutation.then(() => post(message)); return; } return post(message); }; return worker;
  };
  const initialState = createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['12593'] }]);
  initialState.rules['content.f2p'] = false; initialState.rules['access.shared'] = false;
  const app = await createServer({ dataDir, dataset: fixtureDataset, definitions: caveDefinitions(), initialState, port: Number(process.env.RS3_HOW_TEST_PORT ?? 0),
    predictionPrewarm: false, taskWorkerOptions: { workerFactory, serializedStateInput: true } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const revision = app.store.getInfo().revision, id = taskId('Extra', 'Defeat a cave bug');
  const route = `/api/task-how?memberId=one&taskId=${encodeURIComponent(id)}&revision=${revision}`;
  const stale = await fetch(origin + route.replace(`revision=${revision}`, `revision=${revision + 1}`), { headers });
  assert.equal(stale.status, 409); assert.ok(!messages.some(message => message.type === 'how-task'));
  const badMember = await fetch(origin + route.replace('memberId=one', 'memberId=absent'), { headers }); assert.equal(badMember.status, 400);
  const response = await fetch(origin + route, { headers }), proof = await response.json();
  assert.equal(response.status, 200, JSON.stringify(proof)); assert.equal(proof.proofStatus, 'complete');
  assert.equal(proof.context.memberId, 'one'); assert.equal(proof.context.stateRevision, revision);
  const job = messages.find(message => message.type === 'how-task'); assert.ok(job); assert.equal(job.stateTransport, 'json-shared-v1');
  const normal = await (await fetch(`${origin}/api/tasks?view=play-v1&memberId=one`, { headers })).json();
  const saved = await (await fetch(`${origin}/api/state?view=play-v1`, { headers })).json();
  assert.ok(!JSON.stringify(normal).includes('admissionOrder')); assert.ok(!JSON.stringify(saved).includes('admissionOrder'));
  assert.equal((await fetch(origin + '/task-how.mjs', { headers })).status, 200);
  const inviteResponse = await fetch(`${origin}/api/invites`, { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Viewer', viewer: true }) });
  const invite = await inviteResponse.json(), joined = await fetch(invite.link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0], before = messages.length;
  const viewer = await fetch(origin + route, { headers: { cookie } }); assert.equal(viewer.status, 403); assert.equal(messages.length, before);
  const unknown = await (await fetch(origin + route.replace(encodeURIComponent(id), 'generated%3Ax'), { headers })).json();
  assert.equal(unknown.proofStatus, 'partial'); assert.ok(unknown.gaps.some(gap => gap.kind === 'unsupported-subject'));
  assert.equal(app.store.getInfo().revision, revision);
  mutateDuringProof = () => app.store.command({ type: 'set-note', memberId: 'one', chunkId: '12593', note: 'Isolated stale-proof fixture' }, revision);
  const during = await fetch(origin + route.replace(encodeURIComponent(id), encodeURIComponent(taskId('Nonskill', 'Swamp entrance'))), { headers });
  await mutation; assert.equal(during.status, 409, await during.text());
});

test('How HTTP transports conjunctive witnesses and a neutral historical gap without gameplay writes', async t => {
  const dataDir = await mkdtemp('/tmp/how-paths-http-');
  const initialState = createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['100', '200', '300'] }]);
  Object.assign(initialState.rules, pathState().rules);
  initialState.tasks = createTaskEngine(pathDefinitions()).catalogue.map(({ id, label, category }) => ({ id, label, category }));
  initialState.members[0].completedTasks = pathState().members[0].completedTasks;
  const app = await createServer({ dataDir, dataset: fixtureDataset, definitions: pathDefinitions(), initialState, port: 0, predictionPrewarm: false });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const before = JSON.stringify(app.store.getState()), revision = app.store.getInfo().revision;
  const tasks = await (await fetch(`${origin}/api/tasks?view=play-v1&memberId=one`, { headers })).json();
  for (const [goal, count] of [['Use both stations', 2], ['Use any station', 1], ['Use two stations', 2], ['Use historical supply', 0]]) {
    const id = taskId('Extra', goal);
    assert.equal(tasks.tasks.find(task => task.id === id).status, 'available');
    const response = await fetch(`${origin}/api/task-how?memberId=one&taskId=${encodeURIComponent(id)}&revision=${revision}`, { headers });
    assert.equal(response.status, 200);
    const proof = await response.json();
    assert.equal(proof.context.memberId, 'one'); assert.equal(proof.context.stateRevision, revision);
    assert.equal(Object.values(proof.nodes).filter(node => node.kind === 'placement').length, count);
    if (count) assert.equal(proof.proofStatus, 'complete');
    else {
      assert.equal(proof.proofStatus, 'partial');
      assert.deepEqual(proof.gaps.map(gap => gap.kind), ['historical-source-access']);
      assert.doesNotMatch(JSON.stringify(proof), /This supply uses partner access/);
      assert.ok(Object.values(proof.nodes).some(node => node.rule === 'recorded-completion'));
    }
  }
  assert.equal(JSON.stringify(app.store.getState()), before);
  const after = await (await fetch(`${origin}/api/tasks?view=play-v1&memberId=one`, { headers })).json();
  assert.deepEqual(after.tasks, tasks.tasks);
});
