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
  challenges: { Quest: { 'Guest example quest': { Chunks: ['12850'], QuestPoints: 1, XpReward: { Any: 100 } } } } };
function guestFlag(t, value) {
  const previous = process.env.RS3_GUEST_MODE;
  if (value === undefined) delete process.env.RS3_GUEST_MODE;
  else process.env.RS3_GUEST_MODE = value;
  t.after(() => {
    if (previous === undefined) delete process.env.RS3_GUEST_MODE;
    else process.env.RS3_GUEST_MODE = previous;
  });
}
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
  guestFlag(t, '1');
  const root = await mkdtemp(path.join(tmpdir(), 'guest-isolation-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  app = await createServer({ dataDir: path.join(root, 'legacy'), definitions, taskMap: {}, port: 0,
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    multiPicker: { admission: 'open', registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones') },
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
  const bootstrap = result.bootstrap;
  assert.ok(bootstrap.world.chunks.some(([id]) => id === '12850'));
  assert.ok(bootstrap.rules.definitions.length);
  assert.deepEqual(bootstrap.definitions.chunks['12850'], definitions.chunks['12850']);
  assert.ok(result.pool.partnerConnections.byChunk, 'The real map receives authoritative connection metadata');
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
  assert.equal(list.result.stateRevision, backup.state.revision);
  assert.equal(list.result.memberId, 'guest');
  assert.ok(list.result.presentation.tasks.some(task => task.id === quest.id));
  const why = await run({ operation: 'why', backup, taskId: quest.id });
  assert.equal(why.why.task.id, quest.id);
  assert.equal(why.why.stateRevision, backup.state.revision);
  assert.ok((await run({ operation: 'chunk-sections', backup, chunkId: '12850' })).sections);
  const planning = (await run({ operation: 'chunk-planning', backup, chunkId: '12850' })).planning;
  assert.equal(planning.format, 'chunk-planning-v1');
  assert.equal(planning.stateRevision, backup.state.revision);
  assert.ok(planning.rows.some(row => row.task.id === quest.id));
  const prediction = (await run({ operation: 'predict', backup, chunkId: '12851' })).prediction;
  assert.equal(prediction.memberId, 'guest');
  assert.equal(prediction.stateRevision, backup.state.revision);
  assert.equal((await run({ operation: 'teleports', backup })).teleports.memberId, 'guest');
  const profile = (await run({ operation: 'profile-preview', backup,
    profile: { format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: backup.state.rules, taskRules: {} } })).profile;
  assert.equal(profile.stateRevision, backup.state.revision);
  const how = await run({ operation: 'how', backup, taskId: quest.id }); assert.ok(how.how.nodes[how.how.root]);
  const chain = (await run({ operation: 'why-chain', backup, selector: { taskId: quest.id } })).chain;
  assert.equal(chain.memberId, 'guest'); assert.equal(chain.stateRevision, backup.state.revision); assert.ok(chain.root);
  await command({ type: 'set-task-alternative', category: quest.category, group: 'Synthetic', taskId: quest.id });
  assert.equal(backup.state.members[0].taskAlternatives[quest.category].Synthetic, quest.id);
  const xp = (await run({ operation: 'xp-choices', backup })).xpChoices;
  assert.equal(xp.memberId, 'guest'); assert.equal(xp.stateRevision, backup.state.revision);
  assert.ok(xp.rows.some(row => row.id === quest.id));
  await command({ type: 'set-xp-choices', taskId: quest.id, choices: ['Mining'] });
  assert.deepEqual(backup.state.members[0].xpChoices[quest.id], ['Mining']);
  await command({ type: 'set-task-status', taskId: quest.id, backlogged: true });
  const backlog = (await run({ operation: 'backlog-search', backup })).backlog;
  assert.equal(backlog.memberId, 'guest'); assert.equal(backlog.stateRevision, backup.state.revision);
  assert.ok(backlog.tasks.some(row => row.id === quest.id));
  await command({ type: 'set-task-status', taskId: quest.id, backlogged: false });
  const rollStats = (await run({ operation: 'roll-stats', backup })).rollStats;
  assert.equal(rollStats.stateRevision, backup.state.revision); assert.ok(rollStats.members.some(row => row.id === 'guest'));
  assert.equal((await run({ operation: 'map-info', backup })).mapInfo.schemaVersion, 1);
  await command({ type: 'set-task-status', taskId: quest.id, challengeCompleted: true });
  await command({ type: 'set-preference', preferenceId: 'theme', value: 'gray' });
  assert.equal(backup.state.members[0].preferences.theme, 'gray');
  assert.equal(backup.state.members[0].taskStatus[quest.id].challengeCompleted, true);
  await command({ type: 'unpick' });
  assert.equal(backup.state.members[0].unlocked.length, 1);
  await command({ type: 'undo' });
  assert.equal(backup.state.members[0].unlocked.length, 2);
  for (const value of [
    { type: 'set-finish-line-item', itemId: 'skill:Mining', target: 60, enabled: false },
    { type: 'add-finish-line-custom', itemId: 'finish:guest-goal', text: 'Synthetic guest goal' },
    { type: 'set-finish-line-custom', itemId: 'finish:guest-goal', memberId: 'guest', completed: true },
  ]) {
    result = await run({ operation: 'command', backup, command: value }); backup = result.backup; browser.commit(backup);
  }
  assert.deepEqual(backup.state.finishLine.items['skill:Mining'], { target: 60, enabled: false });
  assert.deepEqual(backup.state.finishLine.customItems[0].completedBy, ['guest']);
  await run({ operation: 'command', backup, command: { type: 'set-finish-line-custom', itemId: 'finish:guest-goal', memberId: 'other', completed: true } }, 422);
  result = await run({ operation: 'command', backup, command: { type: 'delete-finish-line-custom', itemId: 'finish:guest-goal' } });
  backup = result.backup; browser.commit(backup);
  assert.deepEqual(backup.state.finishLine.customItems, []);
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
  assert.match(renderSignInPage({ guestModeEnabled: true }), /href="\/guest\/"/);
  for (const route of ['/guest/', '/guest/guest.mjs', '/guest/guest-save.mjs', '/guest/guest.css']) {
    const response = await fetch(origin + route); assert.equal(response.status, 200, route); assert.ok(response.headers.get('content-security-policy'));
  }
  const shell = await (await fetch(origin + '/guest/')).text();
  for (const id of ['map-base', 'map-state', 'active-tasks', 'settings-open', 'chunk-info']) assert.ok(shell.includes(`id="${id}"`), id);
  assert.match(shell, /src="\/guest\/guest.mjs"/);
  const guestSheets = [...shell.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(guestSheets, ['/guest/app.css', '/guest/guest.css']);
  const guestBundle = await fetch(origin + '/guest/app.css');
  assert.equal(guestBundle.status, 200);
  assert.match(guestBundle.headers.get('content-type'), /^text\/css/);
  assert.equal(guestBundle.headers.get('cache-control'), 'private, no-store');
  const guestBundleCss = await guestBundle.text();
  assert.match(guestBundleCss, /url\('\/guest\/assets\/fontawesome\/fa-solid-900\.woff2'\)/);
  assert.match(guestBundleCss, /url\(\/guest\/favicon\.svg\)/);
  assert.equal((await fetch(origin + '/guest/guest.html')).status, 404);
  for (const route of ['/guest/core/state.mjs', '/guest/data/dataset-runtime.json', '/guest/screen-context.mjs', '/guest/art-status.json']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (route.endsWith('screen-context.mjs')) assert.match(await response.text(), /from '\/guest\/dataset-runtime.mjs'/);
  }
  assert.equal((await fetch(origin + '/guest/tasks/worker.mjs')).status, 404);
  assert.match(await (await fetch(origin + '/guest/copy-lists.mjs')).text(), /\/guest\/copy-lists.css/);
  await run({ operation: 'new', accountId: 'unknown' }, 400);
  await run({ operation: 'why', backup, taskId: {} }, 422);
  await run({ operation: 'why-chain', backup, selector: { taskId: quest.id, accountId: 'unknown' } }, 422);
  await run({ operation: 'chunk-sections', backup, chunkId: '../private' }, 422);
  assert.equal((await post('/guest/api/run', { operation: 'new' }, session.token, { Origin: 'https://other.example' })).status, 403);
});

test('guest mode requires the exact operator opt-in and shares its startup setting with sign-in', async t => {
  assert.doesNotMatch(renderSignInPage(), /guest\/|Try without signing in/);
  for (const value of [undefined, '0', 'true', '1']) await t.test(value ?? 'unset', async t => {
    guestFlag(t, value);
    const enabled = value === '1';
    const root = await mkdtemp(path.join(tmpdir(), 'guest-flag-'));
    let app;
    t.after(async () => {
      try { await app?.close(); }
      finally { await rm(root, { recursive: true }); }
    });
    // Spreading these options would initialize the guest limits and worker path.
    const guestOptions = enabled ? {} : {
      get limits() { assert.fail('Disabled guest limits must not be constructed'); },
      get workerFactory() { assert.fail('Disabled guest workers must not be constructed'); },
    };
    app = await createServer({ dataDir: path.join(root, 'game'), definitions, taskMap: {}, port: 0,
      loopbackPort: 0, loopbackRole: 'public', publicOrigin: 'https://picker.example', signIn: 'optional',
      predictionPrewarm: false, liveTimingOptions: { enabled: false },
      taskWorkerOptions: { warmStoreDirectory: undefined }, guestOptions });
    await app.listen();
    // Changes to the process environment cannot expose a disabled running server.
    process.env.RS3_GUEST_MODE = enabled ? '0' : '1';
    const origin = `http://127.0.0.1:${app.address().port}`;
    const signIn = await fetch(`http://127.0.0.1:${app.loopbackAddress().port}/auth/signin`, {
      headers: { 'X-Forwarded-Host': 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' },
    });
    assert.equal(signIn.status, 200);
    const page = await signIn.text();
    if (enabled) assert.match(page, /href="\/guest\/"/);
    else assert.doesNotMatch(page, /guest\/|Try without signing in/);
    for (const route of ['/guest', '/guest?test=1', '/guest/', '/guest/guest.mjs', '/guest/guest-save.mjs', '/guest/core/state.mjs']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + route, { method, redirect: 'manual' });
        const expected = !enabled ? 404 : route.startsWith('/guest/') ? 200 : method === 'GET' ? 303 : 404;
        assert.equal(response.status, expected, `${method} ${route}`);
        await response.arrayBuffer();
      }
    }
    for (const route of ['/guest/api/session', '/guest/api/run', '/guest/arbitrary']) {
      const response = await fetch(origin + route, { method: 'POST', headers: {
        Origin: origin, 'Content-Type': 'application/json',
      }, body: JSON.stringify(route.endsWith('/run') ? { operation: 'new' } : {}) });
      assert.equal(response.status, enabled ? route.endsWith('/session') ? 200 : route.endsWith('/run') ? 401 : 404 : 404, route);
      await response.arrayBuffer();
    }
  });
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

test('guest unlock predictions include derived collection tasks', async t => {
  guestFlag(t, '1');
  const root = await mkdtemp(path.join(tmpdir(), 'guest-prediction-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  const dropDefinitions = { ...definitions,
    chunks: { ...definitions.chunks, '12851': { Nickname: 'Next town', Monster: { Goblin: true } } },
    drops: { Goblin: { Bones: { '1': 'Always' } } } };
  app = await createServer({ dataDir: path.join(root, 'legacy'), definitions: dropDefinitions, taskMap: {}, port: 0,
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }]),
    backupRetentionMs: 90 * 86400000, predictionPrewarm: false, liveTimingOptions: { enabled: false },
    taskWorkerOptions: { warmStoreDirectory: undefined }, guestOptions: { limits: { requestsPerIP: 100, requestsGlobal: 100 } } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const post = (body, token) => fetch(origin + (token ? '/guest/api/run' : '/guest/api/session'), { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { 'X-Guest-Token': token } : {}) }, body: JSON.stringify(body) });
  const { token } = await (await post({})).json();
  async function run(body) {
    const response = await post(body, token), result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  let backup = (await run({ operation: 'new' })).backup;
  for (const command of [{ type: 'set-chunk', chunkId: '12850', status: 'unlocked', memberId: 'guest' },
    { type: 'set-task-rule', ruleId: 'Every Drop', value: true, memberId: 'guest' }])
    backup = (await run({ operation: 'command', backup, command })).backup;
  const added = (await run({ operation: 'predict', backup, chunkId: '12851' })).prediction.delta.tasksAdded;
  assert.ok(added.some(task => /Goblin/.test(task.label) && /Bones/.test(task.label)), JSON.stringify(added));
});

test('a slow or stalled guest upload does not block another visitor from completing a guest action', async t => {
  const clock = createManualClock();
  let workersStarted = 0;
  const runtime = { parsedDefinitions: definitions, dataset: selectedDataset, requestContextFor: requestContext };
  const mode = createGuestMode({ runtime, host: '127.0.0.1', clock, now: clock.now,
    limits: { uploadIdleMs: 2000, uploadMaxMs: 5000, requestsPerIP: 20, requestsGlobal: 20 },
    workerFactory() {
      workersStarted++;
      const worker = new EventEmitter(); worker.stdout = new PassThrough(); worker.stderr = new PassThrough();
      worker.terminate = () => Promise.resolve();
      queueMicrotask(() => worker.emit('message', { backup: { ok: true } }));
      return worker;
    } });
  const server = http.createServer((request, response) => mode.handle(request, response));
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await mode.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const openSession = async () => (await (await fetch(origin + '/guest/api/session', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).json()).token;
  const slowToken = await openSession(), fastToken = await openSession();
  const slowDone = Promise.withResolvers();
  const slowReq = http.request({ host: '127.0.0.1', port: server.address().port, path: '/guest/api/run', method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guest-Token': slowToken } }, response => {
    response.resume();
    response.once('end', () => slowDone.resolve(response.statusCode));
  });
  slowReq.once('error', () => slowDone.resolve('destroyed'));
  // Send a partial JSON body and stall before finishing.
  slowReq.write('{"operation":"new"');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(workersStarted, 0, 'a stalled upload must not start a worker');
  // Another visitor completes a full guest action while the slow upload is still pending.
  const fastResponse = await fetch(origin + '/guest/api/run', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guest-Token': fastToken },
    body: JSON.stringify({ operation: 'new' }) });
  assert.equal(fastResponse.status, 200);
  assert.equal(workersStarted, 1);
  // Advancing past the short upload idle deadline terminates the stalled upload.
  await clock.advance(2000);
  const outcome = await slowDone.promise;
  assert.ok(outcome === 408 || outcome === 'destroyed', `unexpected stalled upload outcome: ${outcome}`);
});

test('repeated invalid guest uploads consume the request rate budget before body buffering', async t => {
  const clock = createManualClock();
  const runtime = { parsedDefinitions: definitions, dataset: selectedDataset, requestContextFor: requestContext };
  const mode = createGuestMode({ runtime, host: '127.0.0.1', clock, now: clock.now,
    limits: { requestsPerIP: 1, requestsGlobal: 1 },
    workerFactory() { throw new Error('Invalid operations must never spawn a worker'); } });
  const server = http.createServer((request, response) => mode.handle(request, response));
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await mode.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(origin + '/guest/api/session', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).json();
  const invalid = () => fetch(origin + '/guest/api/run', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guest-Token': token },
    body: JSON.stringify({ operation: 'invalid-op' }) });
  assert.equal((await invalid()).status, 400);
  assert.equal((await invalid()).status, 429, 'second invalid upload is rate-limited before parsing');
});

test('guest upgrade operation re-stamps an older-digest solo save from the same dataset', async t => {
  guestFlag(t, '1');
  const root = await mkdtemp(path.join(tmpdir(), 'guest-upgrade-'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  app = await createServer({ dataDir: path.join(root, 'legacy'), definitions, taskMap: {}, port: 0,
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }]),
    backupRetentionMs: 90 * 86400000, predictionPrewarm: false, liveTimingOptions: { enabled: false },
    taskWorkerOptions: { warmStoreDirectory: undefined }, guestOptions: { limits: { requestsPerIP: 100, requestsGlobal: 100 } } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const post = (route, body, token) => fetch(origin + route, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { 'X-Guest-Token': token } : {}) }, body: JSON.stringify(body) });
  const session = await (await post('/guest/api/session', {})).json();
  let backup = (await (await post('/guest/api/run', { operation: 'new' }, session.token)).json()).backup;
  backup = (await (await post('/guest/api/run', { operation: 'command', backup, command: { type: 'set-chunk', memberId: 'guest', chunkId: '12850', status: 'unlocked' } }, session.token)).json()).backup;
  const older = structuredClone(backup);
  older.state.provenance.dataset.digest = '0'.repeat(64);
  assert.equal((await post('/guest/api/run', { operation: 'load', backup: older }, session.token)).status, 422);
  const upgradedResponse = await post('/guest/api/run', { operation: 'upgrade', backup: older }, session.token);
  assert.equal(upgradedResponse.status, 200);
  const upgraded = await upgradedResponse.json();
  assert.equal(upgraded.backup.state.provenance.dataset.digest, session.dataset.digest);
  assert.deepEqual(upgraded.backup.state.members[0].unlocked, ['12850']);
  assert.ok(upgraded.bootstrap?.world);
});
