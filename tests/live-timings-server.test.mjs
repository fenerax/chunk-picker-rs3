import test from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { openRegistry } from '../app/storage/registry.mjs';
import { openInviteStore } from '../app/storage/invites.mjs';
import { dispatchedWorker } from './helpers/deep-profile-controls.mjs';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { checkpoint } from './helpers/process-lifecycle.mjs';
import { surfaceCoordinates, SURFACE_GRID } from '../app/data/surface-grid.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { emptyMetadataDataset } from './helpers/server-dataset.mjs';

const liveTimingOptions = { now: () => 1800000000000 };
const first = surfaceCoordinates('12344') ? 12341 : SURFACE_GRID.startId - 3;
const ids = [String(first), String(first + 1), String(first + 2)];
const definitions = { chunks: { [ids[0]]: {}, [ids[1]]: {}, [ids[2]]: {} }, walkableChunks: [ids[0], ids[1], ids[2]], walkableChunksF2P: [ids[0], ids[1], ids[2]], challenges: { Extra: { 'Synthetic present': { Chunks: [ids[0]] }, 'Synthetic future': { Chunks: [ids[1]] } } } };

test('real task route propagates coalesced timing flags with a deferred calculator reply', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timing-coalesced-')), workers = [];
  let handler;
  const app = await createServer({ dataDir, liveTimingOptions, dataset: await emptyMetadataDataset(), definitions, taskMap: {},
    initialState: createGroupState([{ id: 'synthetic-member', name: 'Synthetic player' }]), port: 0, predictionPrewarm: false,
    onRequestHandler: value => { handler = value; }, taskWorkerOptions: { workerFactory() { const worker = dispatchedWorker(); workers.push(worker); return worker; } } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(url) {
    const incoming = Readable.from([]);
    Object.assign(incoming, { method: 'GET', url, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1', authorization: `Bearer ${app.store.getAccessToken()}`, 'accept-encoding': 'identity' } });
    const chunks = [], headers = new Map();
    const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
    response.getHeader = name => headers.get(name.toLowerCase());
    response.writeHead = (status, values = {}) => { response.statusCode = status; response.headersSent = true; for (const [name, value] of Object.entries(values)) response.setHeader(name, value); return response; };
    const finished = once(response, 'finish');
    await handler(incoming, response); await finished;
    assert.equal(response.statusCode, 200);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const dispatched = workers[0].nextDispatch();
  const first = request('/api/tasks?memberId=synthetic-member'), second = request('/api/tasks?memberId=synthetic-member');
  const { worker, message } = await dispatched;
  // Both direct handlers cross only resolved promise boundaries before evaluate.
  // Drain those continuations while the calculator reply remains explicitly held.
  await checkpoint();
  worker.emit('message', { id: message.id, result: { tasks: [], metrics: { availableCount: 0 } } });
  await Promise.all([first, second]);
  const summary = await request('/api/admin/live-timings'), row = summary.windows['24h'].find(row => row.action === 'tasks-full');
  assert.equal(row.count, 2); assert.equal(row.coalesced, 1);
});

test('synthetic server records actions, flags, private bytes, admin permissions and restart', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'live-timings-http-')); let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const initialState = createGroupState([{ id: 'timing-private-id', name: 'Timing private name', unlocked: [ids[0]] }, { id: 'partner', name: 'Partner', unlocked: [ids[2]] }]);
  initialState.rules['roll.neighborMode'] = createRuleRegistry().get('roll.neighborMode').options.find(v => v === 'frontier' || v === 'geometric');
  initialState.rules['access.shared'] = false; initialState.rules['content.f2p'] = false;
  const predictionDone = Promise.withResolvers();
  const options = { dataDir, liveTimingOptions, deepProfiles: true, dataset: await emptyMetadataDataset(), definitions, taskMap: {}, initialState, port: 0, predictionPrewarm: false,
    taskWorkerOptions: { workerFactory(data) {
      const worker = new ProcessWorker(data), post = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        if (message.type === 'predict') worker.on('message', function done(reply) {
          if (reply.id === message.id && !reply.type) { worker.off('message', done); predictionDone.resolve(); }
        });
        post(message);
      }; return worker;
    } } };
  app = await createServer(options); await app.listen();
  let origin = `http://127.0.0.1:${app.address().port}`;
  const admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  async function request(route, body, headers = admin, expected = 200) {
    const response = await fetch(origin + route, { headers: { ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const text = await response.text(); assert.equal(response.status, expected, `${route}: ${text.slice(0, 300)}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }
  const member = 'timing-private-id', tasksRoute = `/api/tasks?memberId=${member}`;
  const [tasks] = await Promise.all([request(tasksRoute), request(tasksRoute)]); await request(tasksRoute);
  await request(`${tasksRoute}&view=play-v1`); const state = await request('/api/state'); await request('/api/state'); await request('/api/state?view=play-v1');
  const revision = app.store.getInfo().revision, taskId = tasks.tasks[0].id;
  await request(`/api/task-how?memberId=${member}&taskId=${encodeURIComponent(taskId)}&revision=${revision}`);
  await request(`/api/task-why?memberId=${member}&taskId=${encodeURIComponent(taskId)}&revision=${revision}`);
  const chunkId = state.pools[member].eligible[0].id;
  await request(`/api/predict?memberId=${member}&chunkId=${chunkId}`);
  await predictionDone.promise;
  await request(`/api/chunk-planning?memberId=${member}&chunkId=${chunkId}`);
  await request(`/api/pool-ranking?memberId=${member}`);
  await request('/api/sandbox/evaluate', { memberId: member, baseRevision: revision, changes: {} });
  await request('/api/command', { expectedRevision: revision, command: { type: 'set-note', memberId: member, chunkId: ids[0], note: 'Private timing note' } });
  for (const body of [{ label: 'Viewer', viewer: true }, { label: 'Player', memberId: member }]) {
    const invite = await request('/api/invites', body, admin, 201), joined = await fetch(invite.link, { redirect: 'manual' });
    const headers = { cookie: joined.headers.get('set-cookie').split(';')[0] };
    for (const route of ['/admin/live-timings', '/admin/live-timings.mjs', '/api/admin/live-timings', '/api/admin/cpu-profiles?name=x']) await request(route, undefined, headers, 403);
    await request('/api/admin/cpu-profiles', { action: 'start' }, headers, 403);
  }
  const { key } = await request('/api/game-plugin/keys', { memberId: member, label: 'Timing test' }, admin, 201);
  // Plugin keys only work on plugin routes; here they count as no credential.
  await request('/api/admin/live-timings', undefined, { Authorization: `Bearer ${key}` }, 401);
  await request('/admin/live-timings', undefined, { Authorization: `Bearer ${key}` }, 401);
  for (const junk of [{ cookie: 'session=not-a-session' }, { Authorization: 'Bearer not-a-token' }]) await request('/api/admin/live-timings', undefined, junk, 401);
  assert.match(await request('/admin/live-timings'), /Live timings/);
  let summary = await request('/api/admin/live-timings'), rows = summary.windows['24h'];
  for (const action of ['tasks-full', 'tasks-play', 'preview-first', 'preview-partner', 'how', 'why', 'roll-pool', 'pool-ranking', 'chunk-planning', 'sandbox', 'command', 'state-full', 'state-play', 'worker-start']) assert.ok(rows.find(r => r.action === action).count > 0, action);
  // The controlled dispatcher case above checks exact coalescence.
  assert.ok(rows.find(r => r.action === 'tasks-full').cached > 0);
  assert.ok(rows.find(r => r.action === 'how').stages.totalMs.count > 0);
  await request('/api/admin/cpu-profiles', { action: 'start', seconds: 600 });
  await app.close();
  const bytes = await readFile(`${dataDir}/live-timings.json`, 'utf8');
  for (const secret of [member, initialState.members[0].name, 'Synthetic present', 'Synthetic future', ids[0], 'Private timing note', key]) assert.ok(!bytes.includes(JSON.stringify(secret)), secret);
  app = await createServer(options); await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  summary = await request('/api/admin/live-timings'); assert.equal(summary.profile.active, false); assert.ok(summary.profiles.length > 0);
  assert.equal(summary.windows['24h'].find(r => r.action === 'tasks-full').count, rows.find(r => r.action === 'tasks-full').count);
  for (const file of summary.profiles) {
    const profile = await request(`/api/admin/cpu-profiles?name=${encodeURIComponent(file.name)}`);
    assert.ok(profile.nodes.length > 0);
    const bytes = JSON.stringify(profile);
    for (const secret of [member, initialState.members[0].name, 'Synthetic present', 'Synthetic future', key]) assert.ok(!bytes.includes(secret));
  }
});

test('multi-picker users and invite viewers cannot inspect or control process-wide captures', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'live-timings-isolation-'));
  const dataDir = path.join(root, 'legacy'); await mkdir(dataDir);
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), maxCalculators: 1 };
  let registry, invites, app;
  t.after(async () => { await app?.close(); await invites?.close(); await registry?.close(); await rm(root, { recursive: true, force: true }); });
  registry = await openRegistry({ ...multiPicker, legacyDir: dataDir });
  const accounts = [];
  for (let index = 0; index < 2; index++) accounts.push(await registry.firstLogin('discord', String(index + 100)));
  invites = await openInviteStore({ dataDir, masterToken: randomBytes(32).toString('base64url'), masterLabel: 'Synthetic operator', pickerRegistry: registry });
  const users = [];
  for (const { account, picker } of accounts) users.push({ cookie: `duo_access=${await invites.issuePickerSession(account.id, picker.id, 'discord')}` });
  await invites.close(); invites = undefined; await registry.close(); registry = undefined;
  app = await createServer({ dataDir, liveTimingOptions, deepProfiles: true, multiPicker, dataset: await emptyMetadataDataset(), definitions, taskMap: {},
    initialState: createGroupState([{ id: 'synthetic-member', name: 'Synthetic player' }, { id: 'synthetic-partner', name: 'Synthetic partner' }]), port: 0, predictionPrewarm: false });
  await app.listen();
  const origin = new URL(app.inviteUrl).origin, admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  async function request(route, headers = admin, body, expected = 200) {
    const response = await fetch(origin + route, { headers: { ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const text = await response.text(); assert.equal(response.status, expected, text);
    if (expected === 403) { assert.deepEqual(Object.keys(JSON.parse(text)), ['message']); return text; }
    return JSON.parse(text);
  }
  for (const body of [{ label: 'Synthetic player' }, { label: 'Synthetic viewer', viewer: true }]) {
    const invite = await request('/api/invites', admin, body, 201), joined = await fetch(invite.link, { redirect: 'manual' });
    users.push({ cookie: joined.headers.get('set-cookie').split(';')[0] });
  }
  await request('/api/admin/cpu-profiles', admin, { action: 'start', seconds: 60 });
  await request('/api/admin/cpu-profiles', admin, { action: 'stop' });
  const summary = await request('/api/admin/live-timings'), filename = summary.profiles[0].name;
  assert.ok(filename);
  await request('/api/admin/cpu-profiles', admin, { action: 'start', seconds: 60 });
  for (const headers of users) {
    // Check both own and foreign picker selectors, with real registry sessions.
    for (const prefix of ['', ...accounts.map(({ picker }) => `/api/pickers/${picker.id}`)]) {
      const routes = prefix ? [`${prefix}/admin/live-timings`, `${prefix}/admin/cpu-profiles?name=${filename}`]
        : ['/admin/live-timings', '/admin/live-timings.mjs', '/admin/live-timings.css', '/api/admin/live-timings', `/api/admin/cpu-profiles?name=${filename}`, '/api/admin/cpu-profiles?name=unavailable'];
      for (const route of routes) {
        const denied = await request(route, headers, undefined, 403);
        assert.ok(!denied.includes(filename));
        for (const { account, picker } of accounts) { assert.ok(!denied.includes(account.id)); assert.ok(!denied.includes(picker.id)); }
        assert.ok(!/windows|deadline|nodes|profiles|cpu-profiles/.test(denied));
      }
      for (const action of ['start', 'stop']) await request(prefix ? `${prefix}/admin/cpu-profiles` : '/api/admin/cpu-profiles', headers, { action, seconds: 60 }, 403);
    }
  }
  const after = await request('/api/admin/live-timings'); assert.equal(after.profile.active, true);
  assert.deepEqual(after.profiles, summary.profiles, 'denied controls must not change capture files');
  await request('/api/admin/cpu-profiles', admin, { action: 'stop' });
});


test('viewer diagnostics, health and worker events omit profiling counters and reasons', { timeout: 15000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timing-viewer-')), workers = [];
  const initialState = createGroupState([{ id: 'synthetic-member', name: 'Synthetic player' }]);
  const app = await createServer({ dataDir, liveTimingOptions, deepProfiles: true, dataset: await emptyMetadataDataset(), definitions, taskMap: {}, initialState,
    port: 0, predictionPrewarm: false, taskWorkerOptions: { maxRestarts: 0, workerFactory() {
      const worker = dispatchedWorker();
      worker.startCpuProfile = async () => { worker.profileRetiring = true; worker.emit('profile-retiring'); throw new Error('Synthetic native uncertainty.'); };
      workers.push(worker); return worker;
    } } });
  const controller = new AbortController();
  t.after(async () => { controller.abort(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = new URL(app.inviteUrl).origin, admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  async function request(route, headers = admin, body) {
    const response = await fetch(origin + route, { headers: { ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `${route}: ${response.status}`); return response.json();
  }
  const invite = await request('/api/invites', admin, { label: 'Synthetic viewer', viewer: true });
  const joined = await fetch(invite.link, { redirect: 'manual' }), viewer = { cookie: joined.headers.get('set-cookie').split(';')[0] };
  const stream = await fetch(origin + '/api/events', { headers: viewer, signal: controller.signal }), reader = stream.body.getReader();
  await reader.read();
  const dispatched = workers[0].nextDispatch();
  const requestResult = request(`/api/tasks?memberId=${initialState.members[0].id}`);
  const { worker, message } = await dispatched; assert.ok(message);
  await request('/api/admin/cpu-profiles', admin, { action: 'start', seconds: 60 });
  assert.ok(!worker.terminated);
  // Diagnostics are administrator-only; viewers are refused outright.
  assert.equal((await fetch(origin + '/api/diagnostics', { headers: viewer })).status, 403);
  assert.ok(!/profil/i.test(JSON.stringify(await request('/api/health', viewer))));
  worker.emit('message', { id: message.id, result: { tasks: [], metrics: { availableCount: 0 } } });
  await requestResult;
  const event = new TextDecoder().decode((await reader.read()).value);
  // Viewers get coarse client health, so a capture may produce no worker event at all;
  // whatever they do receive must not mention profiling.
  assert.match(event, /event: (worker|task-ready)/); assert.ok(!/profil/i.test(event));
  // Diagnostics are administrator-only; viewers are refused outright.
  assert.equal((await fetch(origin + '/api/diagnostics', { headers: viewer })).status, 403);
  assert.ok(!/profil/i.test(JSON.stringify(await request('/api/health', viewer))));
  const summary = await request('/api/admin/live-timings'); assert.ok(summary.profile.failures > 0);
  assert.equal(summary.profile.retirements, 1);
});

test('CPU profiling is off unless the operator turns it on, and never attaches to calculators', { timeout: 15000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timing-off-')), workers = [];
  const initialState = createGroupState([{ id: 'synthetic-member', name: 'Synthetic player' }]);
  const app = await createServer({ dataDir, liveTimingOptions, dataset: await emptyMetadataDataset(), definitions, taskMap: {}, initialState,
    port: 0, predictionPrewarm: false, taskWorkerOptions: { workerFactory() {
      const worker = new EventEmitter(); worker.postMessage = message => {
        if (message.id !== undefined) queueMicrotask(() => worker.emit('message', { id: message.id, result: { tasks: [], metrics: { availableCount: 0 } } }));
      };
      worker.terminate = async () => { worker.emit('exit', 0); };
      worker.startCpuProfile = async () => { worker.profiled = true; };
      workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
    } } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const origin = new URL(app.inviteUrl).origin, admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const start = await fetch(origin + '/api/admin/cpu-profiles', { method: 'POST',
    headers: { ...admin, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', seconds: 60 }) });
  assert.equal(start.status, 403); await start.arrayBuffer();
  const tasks = await fetch(origin + `/api/tasks?memberId=${initialState.members[0].id}`, { headers: admin });
  assert.equal(tasks.status, 200); await tasks.arrayBuffer();
  const summary = await (await fetch(origin + '/api/admin/live-timings', { headers: admin })).json();
  assert.equal(summary.profile.enabled, false); assert.equal(summary.profile.active, false);
  assert.ok(workers.length > 0); assert.ok(workers.every(worker => !worker.profiled));
});
