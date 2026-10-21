import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer, apiPermission } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

const chunkIds = ['12341', '12342', '12343', ...Array.from({ length: 126 }, (_, index) =>
  String(7495 + (20 + Math.floor(index / 49)) * 256 - index % 49))];
const definitions = { chunks: Object.fromEntries(chunkIds.map(id => [id, {}])),
  walkableChunks: chunkIds, walkableChunksF2P: chunkIds,
  challenges: { Quest: { Present: { Chunks: ['12341'] }, Future: { Chunks: ['12342'] } } } };

async function fixture(t, { deferred = false, native = false } = {}) {
  const tempRoot = path.resolve('.local/test-tmp'); await mkdir(tempRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(tempRoot, 'area-check-server-'));
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => {
      worker.messages.push(message);
      if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } }));
      if (message.type === 'area-check' && !deferred) queueMicrotask(() => worker.emit('message', { id: message.id,
        result: { format: 'area-check-v1', draft: message.chunkId }, evaluationMs: 1 }));
    };
    worker.terminate = async () => {}; workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  app = await createServer({ dataDir, port: 0, definitions, taskMap: {}, predictionPrewarm: false,
    initialState: createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12343'] }]),
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'),
    ...(native ? {} : { taskWorkerOptions: { workerFactory, serializedStateInput: true } }) });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const authorization = `Bearer ${invite.pathname.slice('/join/'.length)}`;
  const request = (route, options = {}) => fetch(origin + route, { ...options, headers: { Authorization: authorization, ...options.headers } });
  const post = (route, body, headers = {}) => request(route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const check = (query = '', options) => request('/api/area-check?memberId=one&revision=' + app.store.getInfo().revision + query, options);
  return { app, dataDir, workers, origin, request, post, check };
}

test('Area check is authenticated, normalized, cached and runs on the bounded advisory worker with serialized state', async t => {
  const { app, workers, origin, check, dataDir } = await fixture(t);
  const saved = app.store.getState(), diskBefore = await readFile(path.join(dataDir, 'state.json'));
  assert.equal(apiPermission('GET', '/api/area-check'), 'read');
  assert.equal((await fetch(origin + '/api/area-check?memberId=one&revision=0')).status, 401);
  const response = await check('&chunks=12343,12342,12342&asMembers=true');
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  const first = await response.json();
  assert.equal(first.stateRevision, 0); assert.equal(first.memberId, 'one'); assert.equal(first.cache.hit, false);
  assert.deepEqual(first.draft, { chunkIds: ['12342', '12343'], asMembers: true });
  assert.equal((await (await check('&chunks=12342,12343&asMembers=true')).json()).cache.hit, true);
  assert.equal(workers.length, 2); assert.ok(!workers[0].messages.some(row => row.type === 'area-check'));
  const message = workers[1].messages.find(row => row.type === 'area-check');
  assert.equal(message.state, undefined); assert.ok(message.stateJSON instanceof SharedArrayBuffer);
  assert.deepEqual(app.store.getState(), saved); assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), diskBefore);
});

test('Area check validates malformed queries and the selection cap before scheduling', async t => {
  const { workers, request, check } = await fixture(t);
  for (const query of [
    'memberId=absent&revision=0', 'memberId=one', 'memberId=one&revision=-1', 'memberId=one&revision=1.5',
    'memberId=one&revision=9007199254740992', 'memberId=one&revision=0&asMembers=1',
    'memberId=one&revision=0&chunks=12341-0', 'memberId=one&revision=0&chunks=unknown',
    'memberId=one&revision=0&chunks=12341,', 'memberId=one&revision=0&unlock=true',
    'memberId=one&revision=0&memberId=two', `memberId=one&revision=0&chunks=${chunkIds.join(',')}`,
  ]) assert.equal((await request('/api/area-check?' + query)).status, 400, query);
  assert.equal(workers.length, 1, 'Invalid drafts do not start an advisory worker');
  assert.equal((await request('/api/area-check?memberId=one&revision=99')).status, 409);
  assert.equal((await check('&chunks=' + chunkIds.slice(0, 128).join(','))).status, 200);
  assert.equal((await check()).status, 200, 'Empty selection is supported');
});

test('view-only links can use Area check while commands remain forbidden and state unchanged', async t => {
  const { app, origin, post, check } = await fixture(t);
  const created = await post('/api/invites', { label: 'Spectator', viewer: true }); assert.equal(created.status, 201);
  const { link } = await created.json();
  const joined = await fetch(origin + new URL(link).pathname, { redirect: 'manual' }); assert.equal(joined.status, 303);
  const headers = { Authorization: '', Cookie: joined.headers.get('set-cookie').split(';')[0] }, before = app.store.getState();
  assert.equal((await check('&chunks=12342', { headers })).status, 200);
  assert.equal((await post('/api/command', { expectedRevision: 0, command: { type: 'set-chunk', memberId: 'one', chunkId: '12342', status: 'unlocked' } }, headers)).status, 403);
  assert.equal((await post('/api/area-check', {}, headers)).status, 403);
  assert.deepEqual(app.store.getState(), before);
});

test('a concurrent save supersedes Area check and stale revisions are rejected', async t => {
  const { app, workers, post, check, request } = await fixture(t, { deferred: true });
  const pending = check('&chunks=12342');
  for (let index = 0; index < 100 && !workers[1]?.messages.some(row => row.type === 'area-check'); index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(workers[1]?.messages.some(row => row.type === 'area-check'));
  const saved = await post('/api/command', { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Updated' } });
  assert.equal(saved.status, 200); assert.equal((await pending).status, 409);
  assert.equal(app.store.getInfo().revision, 1);
  assert.equal((await request('/api/area-check?memberId=one&revision=0&chunks=12342')).status, 409);
});

test('native Area check response uses the actual worker without changing the save', async t => {
  const { app, dataDir, check } = await fixture(t, { native: true });
  const saved = app.store.getState(), diskBefore = await readFile(path.join(dataDir, 'state.json'));
  const response = await check('&chunks=12342&asMembers=true'); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.format, 'area-check-v1');
  assert.equal(value.memberId, 'one'); assert.equal(value.stateRevision, 0);
  assert.deepEqual(app.store.getState(), saved); assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), diskBefore);
});
