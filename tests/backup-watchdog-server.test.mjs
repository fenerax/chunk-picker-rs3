import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('backup metadata and worker recovery are admin-only and preserve saves during a stall', async t => {
  const root = path.resolve('.local/backup-watchdog-tests'); await mkdir(root, { recursive: true });
  const local = await mkdtemp(path.join(root, 'server-')), dataDir = path.join(local, 'duo');
  let time = 0;
  const idleClock = { now: () => time, setTimeout: () => 0, clearTimeout() {} }, workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 1); };
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const application = await createServer({ dataDir, port: 0, predictionPrewarm: false,
    initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]),
    definitions: { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} }, taskMap: {},
    taskWorkerOptions: { workerFactory, idleClock, deadlineMs: 600000 } });
  await application.listen();
  t.after(async () => { await application.close(); await rm(local, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${application.address().port}`, token = application.store.getAccessToken();
  const api = (route, body, credential = token) => fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(typeof credential === 'string' ? { Authorization: `Bearer ${credential}` } : credential), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
  assert.equal((await fetch(`${origin}/api/backup-status`)).status, 401);
  const invitation = await (await api('/api/invites', { label: 'Reed', admin: false })).json();
  const joined = await fetch(invitation.link, { redirect: 'manual' }); assert.equal(joined.status, 303);
  const inviteHeaders = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  assert.equal((await api('/api/backup-status', undefined, inviteHeaders)).status, 403);
  assert.equal((await api('/api/worker-restart', {}, inviteHeaders)).status, 403);
  await writeFile(path.join(local, 'backup-destination'), 'C:/private/destination');
  const at = new Date().toISOString();
  await writeFile(path.join(local, 'backup-status.json'), JSON.stringify({ lastRunAt: at, lastSuccessAt: at, result: 'success',
    byteSize: 256, fileName: 'private.zip', revision: 88, token, destination: 'C:/private/destination' }));
  const backupStatus = await (await api('/api/backup-status')).json();
  assert.deepEqual(backupStatus, { lastRunAt: at, lastSuccessAt: at, result: 'success', byteSize: 256, warning: null });
  assert.equal((await api('/backup-status.mjs')).status, 200);
  const stalled = api('/api/tasks?memberId=actor1');
  for (let i = 0; !workers[0].messages.length && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(workers[0].messages[0].reportProgress, true);
  time = 120001;
  const health = await (await api('/api/health')).json();
  assert.equal(health.status, 'stuck'); assert.equal(health.worker.stuck, true);
  assert.equal((await api('/api/backup')).status, 200);
  const before = await application.store.backup();
  const recovery = await (await api('/api/worker-restart', {})).json();
  assert.deepEqual(recovery.restarted, ['foreground']); assert.equal((await stalled).status, 503);
  assert.equal(workers[0].terminated, true); assert.equal(workers.length, 2);
  assert.deepEqual((await application.store.backup()).state, before.state);
  assert.equal((await (await api('/api/health')).json()).worker.stuck, false);
});
