// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { createServer } from '../app/server.mjs';
import { createGuestMode } from '../app/guest.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';
import { createGuestSave } from '../app/web/guest-save.mjs';
import { renderSignInPage } from '../app/signin-page.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import { requestContext } from '../app/security/request.mjs';

const definitions = { chunks: { '12850': { Nickname: 'Starting town' }, '12851': { Nickname: 'Next town' } },
  walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
  challenges: { Quest: { 'Guest example quest': { Chunks: ['12850'], QuestPoints: 1 } } } };
async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await inventory(file, relative + '/'));
    else result[relative] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return result;
}
test('guest solo workflow never changes durable gameplay, registry, auth, backup or telemetry files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'guest-isolation-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  app = await createServer({ dataDir: path.join(root, 'legacy'), definitions, taskMap: {}, port: 0,
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones') },
    backupRetentionMs: 90 * 86400000, predictionPrewarm: false, liveTimingOptions: { enabled: false },
    taskWorkerOptions: { warmStoreDirectory: undefined }, guestOptions: { limits: { requestsPerIP: 100, requestsGlobal: 100 } } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const post = (route, body, token, extra = {}) => fetch(origin + route, { method: 'POST', headers: { Origin: origin,
    'Content-Type': 'application/json', ...(token ? { 'X-Guest-Token': token } : {}), ...extra }, body: JSON.stringify(body) });
  const session = await (await post('/guest/api/session', {})).json(); assert.ok(session.token);
  const before = await inventory(root), savedBefore = app.store.getState();
  async function run(body, expected = 200) {
    const response = await post('/guest/api/run', body, session.token), result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return result;
  }
  let result = await run({ operation: 'new' }), backup = result.backup;
  assert.equal(backup.state.members.length, 1); assert.equal(backup.state.members[0].id, 'guest');
  assert.equal(result.chunks.find(chunk => chunk.id === '12850')?.label, 'Starting town');
  const localValues = new Map(), local = { getItem: key => localValues.get(key) ?? null, setItem: (key, value) => localValues.set(key, value) };
  let browser = createGuestSave(local, session.dataset); browser.load(); browser.commit(backup);
  const command = async value => {
    result = await run({ operation: 'command', backup, command: { ...value, ...(value.type === 'set-rule' || value.type === 'undo' ? {} : { memberId: 'guest' }) } });
    backup = result.backup; browser.commit(backup);
  };
  await command({ type: 'set-chunk', chunkId: '12850', status: 'unlocked' });
  await command({ type: 'set-note', chunkId: '12850', note: 'Synthetic guest-only note' });
  await command({ type: 'set-chunk', chunkId: '12851', status: 'selected' });
  await command({ type: 'roll', count: 1 });
  assert.ok(backup.state.members[0].unlocked.includes('12851'));
  await command({ type: 'set-rule', ruleId: 'roll.adjacent', value: false });
  const list = await run({ operation: 'tasks', backup });
  const quest = list.tasks.find(task => task.label === 'Guest example quest'); assert.ok(quest, 'Existing task engine calculates the guest map');
  const how = await run({ operation: 'how', backup, taskId: quest.id }); assert.ok(how.how.nodes[how.how.root]);
  await command({ type: 'set-task-status', taskId: quest.id, challengeCompleted: true });
  assert.equal(backup.state.members[0].taskStatus[quest.id].challengeCompleted, true);
  const exported = browser.exportText(); assert.deepEqual(importBackup(JSON.parse(exported)), backup.state);
  browser = createGuestSave(local, session.dataset);
  assert.deepEqual(browser.load(), backup, 'Reload resumes browser state');
  const imported = browser.parseImport(exported);
  assert.deepEqual((await run({ operation: 'load', backup: imported })).backup, backup);
  assert.equal((await (await post('/guest/api/session', {}, session.token)).json()).token, session.token, 'Reload reuses admission');
  for (const bad of [exportBackup(createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }])), { ...backup, state: { ...backup.state, provenance: { dataset: { id: 'wrong' } } } }]) await run({ operation: 'load', backup: bad }, 422);
  await run({ operation: 'command', backup, command: { type: 'apply-runemetrics', memberId: 'guest' } }, 422);
  await run({ operation: 'load', backup, pickerId: 'legacy-shared' }, 400);
  const tooBig = await post('/guest/api/run', { operation: 'load', backup, padding: 'x'.repeat(2 * 1024 ** 2) }, session.token); assert.equal(tooBig.status, 413);
  for (const route of ['/guest/api/invites', '/guest/api/plugin/v1/report', '/guest/api/runemetrics/preview', '/guest/api/overlays', '/guest/api/backup', '/guest/api/usage', '/guest/api/feedback']) assert.equal((await post(route, {}, session.token)).status, 404, route);
  for (const route of ['/api/state', '/api/backup', '/api/invites', '/api/command']) {
    const response = route === '/api/command' ? await post(route, { command: { type: 'roll', memberId: 'one', count: 1 } }, session.token)
      : await fetch(origin + route, { headers: { 'X-Guest-Token': session.token } });
    assert.equal(response.status, 401, route);
  }
  assert.deepEqual(app.store.getState(), savedBefore);
  assert.deepEqual(await inventory(root), before, 'Every durable file and pathname is unchanged after guest requests');
  const joined = await fetch(`${origin}/join/${app.store.getAccessToken()}`, { redirect: 'manual' });
  assert.equal(joined.status, 303);
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const signedIn = await fetch(origin + '/api/state', { headers: { Cookie: cookie } });
  assert.equal(signedIn.status, 200); assert.deepEqual((await signedIn.json()).state.members.map(member => member.id), ['one', 'two']);
  assert.match(renderSignInPage(), /href="\/guest\/"/);
  for (const route of ['/guest/', '/guest/guest.mjs', '/guest/guest-save.mjs', '/guest/guest.css']) {
    const response = await fetch(origin + route); assert.equal(response.status, 200, route); assert.ok(response.headers.get('content-security-policy'));
  }
  assert.equal((await post('/guest/api/run', { operation: 'new' }, session.token, { Origin: 'https://other.example' })).status, 403);
});

test('HTTP guest limits hold capacity through worker disposal, deadline, disconnect and shutdown', async t => {
  const clock = createManualClock();
  const workers = [], started = [];
  let cleaning = false;
  const runtime = { parsedDefinitions: definitions, dataset: selectedDataset, requestContextFor: requestContext };
  const mode = createGuestMode({ runtime, host: '127.0.0.1', clock, now: clock.now,
    workerFactory(url, options) {
      const worker = new EventEmitter(); worker.stdout = new PassThrough(); worker.stderr = new PassThrough();
      worker.options = options;
      worker.terminate = () => { worker.terminating = true; return cleaning ? Promise.resolve() : new Promise(resolve => { worker.finish = resolve; }); };
      workers.push(worker); started.shift()?.(worker); return worker;
    } });
  const server = http.createServer((request, response) => mode.handle(request, response));
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { cleaning = true; for (const worker of workers) worker.finish?.(); await mode.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, token, signal) => fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { 'X-Guest-Token': token } : {}) }, body: JSON.stringify(body), signal });
  const token = (await (await post('/guest/api/session', {})).json()).token;
  const nextWorker = () => new Promise(resolve => started.push(resolve));
  let ready = nextWorker(), pending = post('/guest/api/run', { operation: 'new' }, token), worker = await ready;
  assert.deepEqual(worker.options.env, { NODE_DISABLE_COMPILE_CACHE: '1' }); assert.deepEqual(worker.options.execArgv, []);
  assert.equal((await post('/guest/api/run', { operation: 'new' }, token)).status, 429);
  worker.emit('message', { backup: {} });
  await Promise.resolve(); assert.equal(worker.terminating, true);
  assert.equal((await post('/guest/api/run', { operation: 'new' }, token)).status, 429, 'Termination still holds the slot');
  worker.finish(); assert.equal((await pending).status, 200);
  ready = nextWorker(); pending = post('/guest/api/run', { operation: 'new' }, token); worker = await ready;
  await clock.advance(30000); assert.equal(worker.terminating, true); worker.finish(); assert.equal((await pending).status, 503);
  const controller = new AbortController(); ready = nextWorker(); pending = post('/guest/api/run', { operation: 'new' }, token, controller.signal); worker = await ready;
  const aborted = assert.rejects(pending); controller.abort(); await aborted;
  // Observe the socket close without a timed race or sleep.
  if (!worker.terminating) await new Promise(resolve => { const terminate = worker.terminate; worker.terminate = () => { const result = terminate(); resolve(); return result; }; });
  worker.finish();
  // Completion is acknowledged by the next run's admission, after disposal.
  await mode.close();
  assert.equal((await post('/guest/api/session', {})).status, 503);
});
