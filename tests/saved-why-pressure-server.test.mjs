// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { caveDefinitions } from './task-how-fixture.mjs';

// The service singleton reads its profile at import, as production does.
process.env.RS3_MEMORY_PROFILE = 'budget-672';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { createResponseCache } = await import('../app/http-response.mjs');
const { serviceResponseCacheBudget: budget } = await import('../app/response-cache-budget.mjs');

test('saved Why stays HTTP 200 with identical bytes when peers pin the entire budget-672 response quota', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'why-pressure-'));
  let app, events;
  const peer = createResponseCache({ budget, maxBytes: 128 * 1024 ** 2 });
  const reservation = { retainedBytes: 128 * 1024 ** 2, pinned: true };
  t.after(async () => {
    reservation.pinned = false; peer.clear(); events?.destroy();
    await app?.close(); await rm(directory, { recursive: true, force: true });
  });
  const jobs = [];
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => { jobs.push(message.type); return post(message); };
    return worker;
  };
  app = await createServer({ dataDir: directory, dataset: fixtureDataset, definitions: caveDefinitions(), port: 0,
    initialState: createGroupState([{ id: 'one', name: 'Synthetic Player', unlocked: ['12593'] }]),
    predictionPrewarm: false, taskWorkerOptions: { workerFactory, serializedStateInput: true } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { authorization: `Bearer ${app.store.getAccessToken()}` };
  const invite = await fetch(origin + '/api/invites', { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Synthetic viewer', viewer: true }) });
  assert.equal(invite.status, 201);
  const joined = await fetch((await invite.json()).link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const ready = Promise.withResolvers();
  await new Promise((resolve, reject) => {
    events = http.get(origin + '/api/events', { headers: { cookie } }, response => {
      let text = '';
      response.on('data', chunk => {
        text += chunk;
        if (text.includes('event: task-ready\n')) ready.resolve();
      });
      response.on('error', error => { if (!events.destroyed) ready.reject(error); });
      resolve();
    });
    events.on('error', reject);
  });
  const full = await fetch(origin + '/api/tasks?memberId=one', { headers });
  assert.equal(full.status, 200);
  const list = await full.json(); await ready.promise;
  const revision = app.store.getInfo().revision;
  const route = `/api/task-why?view=display-v1&memberId=one&taskId=${encodeURIComponent(list.tasks[0].id)}&revision=${revision}`;
  const read = async () => {
    const response = await fetch(origin + route, { headers: { cookie, 'accept-encoding': 'identity' } });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const expected = await read(); assert.equal(expected.status, 200, expected.bytes.toString());
  const before = jobs.length;
  peer.set('peer-pinned', reservation);
  assert.equal(budget.bytes, reservation.retainedBytes);
  assert.equal(budget.retentionLedger().dimensions[1].cap, 128 * 1024 ** 2);
  assert.deepEqual(await read(), expected);
  assert.equal(jobs.length, before, 'read-only saved evidence never admits another calculator job');
});
