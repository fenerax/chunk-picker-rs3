import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { resolveDataset } from '../app/datasets.mjs';
import { prepareGameStorage } from '../app/game-profile.mjs';

const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'],
  walkableChunksF2P: ['12341', '12342'], challenges: {} };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function directory(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-warmstart-'));
  const token = randomBytes(32).toString('base64url');
  await prepareGameStorage(dataDir, await resolveDataset());
  await writeFile(path.join(dataDir, 'access-token'), token);
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, token };
}
const options = { definitions, taskMap: {}, port: 0, predictionPrewarm: false, shutdownDeadlineMs: 300 };
function client(handle, token) {
  const origin = `http://127.0.0.1:${handle.address().port}`;
  return (route, init = {}) => fetch(origin + route, { ...init,
    headers: { Authorization: `Bearer ${token}`, Origin: origin, ...init.headers } });
}

test('early private health answers while the store loads; refused commands never enter its queue', async t => {
  const { dataDir, token } = await directory(t), entered = deferred(), release = deferred();
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12341'] }]);
  let preparing = 0;
  const handle = await startServer({ ...options, dataDir, initialState, async prepareState(state) {
    preparing++; entered.resolve(); await release.promise; return state;
  } });
  t.after(async () => { release.resolve(); await handle.close(); });
  const request = client(handle, token);
  await entered.promise;
  for (let index = 0; index < 3; index++) {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ready: false, status: 'warming', savesReady: false,
      worker: { status: 'starting', ready: false, stuck: false, restartRequired: false }, local: true });
  }
  const earlyCommand = await request('/api/command', { method: 'POST', body: '{invalid body' });
  assert.equal(earlyCommand.status, 503); assert.equal(earlyCommand.headers.get('retry-after'), '1');
  assert.equal((await earlyCommand.json()).code, 'PICKER_WARMING');
  assert.equal((await request('/api/state')).status, 503);
  assert.equal((await request('/api/health', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request('/api/health', { headers: { 'Tailscale-Funnel-Request': '1' } })).status, 401);
  assert.equal((await request('/api/health', { headers: { 'X-Forwarded-For': '8.8.8.8' } })).status, 401);
  release.resolve();
  const app = await handle.ready;
  assert.equal(preparing, 1); assert.equal(app.store.getInfo().revision, 0);
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  const command = { expectedRevision: 0, command: { type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'Ready save' } };
  const saved = await request('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).state.revision, 1);
  assert.equal(app.store.getState().members[0].notes['12341'], 'Ready save');
});

test('initialization failure closes both early listeners and keeps the saved bytes intact', async t => {
  const { dataDir, token } = await directory(t);
  await writeFile(path.join(dataDir, 'state.json'), 'broken saved bytes');
  const handle = await startServer({ ...options, dataDir, loopbackPort: 0 });
  t.after(() => handle.close());
  await assert.rejects(handle.ready, /Cannot load the saved state/);
  assert.equal(handle.server.listening, false); assert.equal(handle.loopbackAddress(), null);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), 'broken saved bytes');
  assert.equal(await readFile(path.join(dataDir, 'access-token'), 'utf8'), token);
});

test('close during worker compilation cancels startup without waiting for its five minute allowance', async t => {
  const { dataDir } = await directory(t), created = deferred();
  let terminated = false;
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.postMessage = () => {};
    worker.terminate = async () => { terminated = true; };
    created.resolve(); return worker; // deliberately never announces ready
  };
  const handle = await startServer({ ...options, dataDir, taskWorkerOptions: { workerFactory } });
  t.after(() => handle.close());
  await created.promise;
  await handle.close();
  await assert.rejects(handle.ready, { name: 'AbortError' });
  assert(terminated); assert.equal(handle.server.listening, false);
});

test('close while store preparation is pending closes health first and cleans the store at its safe boundary', async t => {
  const { dataDir } = await directory(t), entered = deferred(), release = deferred();
  const handle = await startServer({ ...options, dataDir, async prepareState(state) { entered.resolve(); await release.promise; return state; } });
  t.after(async () => { release.resolve(); await handle.close(); });
  await entered.promise;
  const closing = handle.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handle.server.listening, false);
  release.resolve(); await closing;
  await assert.rejects(handle.ready, { name: 'AbortError' });
  await assert.rejects(readFile(path.join(dataDir, 'store.lock')), { code: 'ENOENT' });
});

test('autonomous native warmup prepares both task lists without commands and keeps Preview available', async t => {
  const { dataDir, token } = await directory(t);
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12341'] }, { id: 'reed', name: 'Reed', unlocked: ['12342'] }]);
  const handle = await startServer({ ...options, dataDir, initialState });
  t.after(() => handle.close());
  const app = await handle.ready, revision = app.store.getInfo().revision;
  const savedBytes = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  const request = client(handle, token);
  const deadline = Date.now() + 30000;
  let diagnostic;
  do {
    diagnostic = await (await request('/api/diagnostics')).json();
    if (diagnostic.startupWarmup.status === 'ready') break;
    assert(Date.now() < deadline, `Warmup did not finish: ${diagnostic.startupWarmup.status}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (true);
  assert.equal(diagnostic.startupWarmup.status, 'ready');
  assert.equal(diagnostic.deathLane.worker.status, 'idle'); assert.equal(diagnostic.duoLane.worker.status, 'idle');
  for (const memberId of ['actor1', 'reed']) {
    const response = await request(`/api/tasks?memberId=${memberId}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cache.hit, true);
  }
  const preview = await request('/api/predict?memberId=actor1&chunkId=12342');
  assert.equal(preview.status, 200); assert.equal((await preview.json()).stateRevision, revision);
  assert.equal(app.store.getInfo().revision, revision);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), savedBytes);
});
