import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createLiveSwapCommandClient, commandOutboxKey } from '../app/web/live-swap-client.mjs';
import { mkdir, mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { openRegistry } = await import('../app/storage/registry.mjs');
const { snapshotPath } = await import('../app/storage/snapshot.mjs');
const { captureServiceCheckpoint } = await import('../scripts/linux/service-checkpoint.mjs');
const { restoreServiceStopped } = await import('../scripts/linux/service-recovery.mjs');
const { runServiceOperator } = await import('../scripts/linux/service-operator.mjs');
const { readRelease } = await import('../scripts/linux/runtime.mjs');
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const definitions = { challenges: {}, chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
function request(base, route, { body, headers = {}, method = body === undefined ? 'GET' : 'POST', stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + route, { method, agent: false, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), Origin: origin }), ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      const result = () => ({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(),
        json: () => JSON.parse(Buffer.concat(chunks).toString()), res, req, chunks });
      if (stream) { resolve(result()); return; }
      res.on('end', () => resolve(result()));
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('HTTP acceptance timeout'))); req.end(bytes);
  });
}
async function fixture(t, { initiallyEnabled = true, beforeCommit, backupRetentionMs, taskWorkerOptions, runeMetrics, unauthenticatedLimit = 10000, dataset = selectedDataset, ...limits } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'phase1-acceptance-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
  const env = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  process.env.RS3_GOOGLE_CLIENT_ID = 'synthetic-google-client'; process.env.RS3_GOOGLE_CLIENT_SECRET_FILE = secret;
  const grants = new Map(), access = new Map(); let codeId = 0;
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token') || url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant); assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), grant.challenge);
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      if (grant.name === 'google') {
        const claims = { iss: 'https://accounts.google.com', aud: 'synthetic-google-client', sub: grant.subject,
          nonce: grant.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        return Response.json({ id_token: [encode({ alg: 'RS256' }), encode(claims), encode('synthetic-signature')].join('.') });
      }
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'), ...limits };
  let app, handler;
  const start = async (multi) => {
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      backupRetentionMs, taskWorkerOptions, runeMetrics, onRequestHandler: value => { handler = value; }, beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
      rateLimits: { unauthenticated: unauthenticatedLimit, expensivePerIdentity: 10000 } });
    await app.listen();
  };
  await start(initiallyEnabled ? multiPicker : undefined);
  const base = () => `http://127.0.0.1:${app.loopbackAddress().port}`;
  const send = (route, cookie, options = {}) => request(base(), route, { ...options, headers: { ...proxy, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  async function begin(subject, cookie, route = '/auth/discord') {
    subject = String(subject);
    const response = await send(route, cookie); assert.equal(response.status, 303);
    const auth = new URL(response.headers.location), code = String(++codeId);
    const name = route.endsWith('/google') ? 'google' : 'discord';
    grants.set(code, { subject, name, nonce: auth.searchParams.get('nonce'), challenge: auth.searchParams.get('code_challenge') });
    return () => send(`/auth/${name}/callback?state=${auth.searchParams.get('state')}&code=${code}`, [response.headers['set-cookie'][0].split(';')[0], ...(cookie ?? '').split(';').filter(part => part.trim() && !part.trim().startsWith('__Host-rs3_preauth='))].join('; '));
  }
  async function login(subject, cookie, route) {
    const response = await (await begin(subject, cookie, route))(); assert.equal(response.status, 303, response.text);
    return response.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  const registry = async () => JSON.parse(await readFile(path.join(multiPicker.registryDir, 'registry.json')));
  const picker = async subject => { const doc = await registry(); return doc.accounts.find(a => a.identities.some(i => i.subject === String(subject))).defaultPickerId; };
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of envKeys.entries()) {
      if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i];
    }
  });
  return { root, send, login, begin, picker, registry, multiPicker, handler: () => handler,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async edit => { await app.close(); await edit?.(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, expectedRevision: revision, ...extra } }),
  };
}

// Public synthetic OAuth/HTTP fixture follows MP4/MP5; every test enables the
// real server router, contexts and shared scheduler/limits, including restarts.
const A = 101, B = 102, C = 103;
const hash = value => createHash('sha256').update(value).digest('hex');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const command = (f, cookie, expectedRevision, value, extra = {}) =>
  f.send('/api/command', cookie, { body: { command: value, expectedRevision, ...extra } });
const stateOf = async (f, cookie) => { const r = await f.send('/api/state', cookie); assert.equal(r.status, 200, r.text); return r.json().state; };
const keyFor = async (f, cookie) => {
  const r = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 1' } });
  assert.equal(r.status, 201, r.text); return r.json().key;
};
const closeStream = s => { s.req.destroy(); s.res.destroy(); };
const ended = s => new Promise(resolve => s.res.once('end', resolve));
const streamBytes = s => Buffer.concat(s.chunks).toString();

// Bullet 1: colliding IDs/revisions through sign-in, worker reads and disk reload.
test('P1.1 unrelated accounts check tasks and reload only their own durable game', async t => {
  const f = await fixture(t), cookies = [await f.login(A), await f.login(B)];
  assert.notEqual(await f.picker(A), await f.picker(B));
  for (const [i, cookie] of cookies.entries()) {
    const state = await stateOf(f, cookie);
    assert.equal(state.revision, 0); assert.deepEqual(state.members.map(m => m.id), ['owner']);
    assert.deepEqual(state.members[0].unlocked, []); assert.deepEqual(state.members[0].completedTasks, []); assert.deepEqual(state.tasks, []);
    const text = `Player ${(i + 1) * 11}`;
    assert.equal((await f.note(cookie, text, 0)).status, 200);
    assert.equal((await command(f, cookie, 1, { type: 'add-task', task: { id: 'rs3:task:synthetic', label: text, category: 'Custom' } })).status, 200);
    assert.equal((await command(f, cookie, 2, { type: 'complete-task', memberId: 'owner', taskId: 'rs3:task:synthetic', completed: true })).status, 200);
    assert.equal((await f.send('/api/tasks?memberId=owner', cookie)).status, 200);
  }
  await f.restart();
  for (const [i, cookie] of cookies.entries()) {
    const state = await stateOf(f, cookie);
    assert.equal(state.revision, 3); assert.equal(state.members[0].notes['12341'], `Player ${(i + 1) * 11}`);
    assert.equal(state.tasks[0].label, `Player ${(i + 1) * 11}`); assert.deepEqual(state.members[0].completedTasks, ['rs3:task:synthetic']);
    const history = await f.send('/api/history', cookie); assert.equal(history.status, 200);
    assert.ok(!history.text.includes(`Player ${(2 - i) * 11}`));
    assert.equal((await f.send('/api/tasks?memberId=owner', cookie)).status, 200);
  }
});

// Bullet 2: deny at the combined HTTP boundary, and compare B before/after.
test('P1.2 cross-picker routes, selectors and capabilities refuse without foreign state or writes', async t => {
  let commits = 0;
  const f = await fixture(t, { beforeCommit: () => { commits++; } }), a = await f.login(A), b = await f.login(B);
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const own = await f.picker(A), other = await f.picker(B), before = await stateOf(f, b), committed = commits;
  const key = await keyFor(f, a), backup = (await f.send('/api/backup', a)).json();
  const attempts = [
    ...['/api/state', '/api/tasks?memberId=owner', '/api/chunk-planning?memberId=owner', '/api/history', '/api/backup', '/api/backups', '/api/backups/123', '/api/invites', '/api/overlays', '/api/events'].map(route => [route + (route.includes('?') ? '&' : '?') + 'pickerId=' + other, {}]),
    ['/api/command', { body: { pickerId: other, expectedRevision: 0, command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Player 1' } } }],
    ['/api/command?pickerId=' + own, { body: { command: { pickerId: other } } }],
    ['/api/state?pickerId=' + own, { headers: { 'X-Picker-Id': other } }],
    ['/api/pickers/' + other + '/state', {}],
    ['/pickers/' + other + '/api/state', {}],
    ...['/api/restore/preview', '/api/restore', '/api/import', '/api/invites', '/api/overlays'].map(route => [route, { body: { pickerId: other, backup, expectedRevision: 0 } }]),
    ['/api/restore', { body: { pickerId: other, backupId: '123', expectedRevision: 0 } }],
    ['/overlay/data?widget=count&player=owner&pickerId=' + other, {}],
    ['/overlay/events?widget=count&player=owner&pickerId=' + other, {}],
  ];
  for (const [route, options] of attempts) {
    const r = await f.send(route, a, options); assert.equal(r.status, 403, route + ': ' + r.text);
    assert.ok(!r.text.includes('Player 2'), route);
  }
  for (const [cookie, headers, route, body] of [
    [undefined, { Authorization: 'Bearer ' + key, 'X-Picker-Id': other }, '/api/plugin/v1/status'],
    [b, { Authorization: 'Bearer ' + key }, '/api/plugin/v1/status'],
    [undefined, { Authorization: 'Bearer ' + key }, '/api/plugin/v1/report', { pickerId: other, memberId: 'owner' }],
  ]) {
    const r = await f.send(route, cookie, { headers, body }); assert.equal(r.status, 403, route + ': ' + r.text);
  }
  const wrongMember = await f.send('/api/plugin/v1/status?memberId=two', undefined, { headers: { Authorization: 'Bearer ' + key } });
  assert.equal(wrongMember.status, 400); assert.match(wrongMember.text, /no query parameters/);
  // A stale write's conflict envelope belongs to A, even with colliding revision 1.
  const conflict = await f.note(a, 'Player 1', 0); assert.equal(conflict.status, 409);
  assert.equal(conflict.json().state.members[0].notes['12341'], 'Player 1'); assert.ok(!conflict.text.includes('Player 2'));
  assert.equal(commits, committed); assert.deepEqual(await stateOf(f, b), before);
});

// Bullet 3: real on-disk collision setup only while writers are closed.
test('P1.3 colliding requests, receipts, revisions, undo and retained backups stay scoped', async t => {
  const f = await fixture(t), a = await f.login(A), b = await f.login(B), clientId = '40000000-0000-4000-8000-000000000001';
  const sessions = [];
  for (const cookie of [a, b]) {
    const r = await f.send('/api/action-session', cookie, { body: { clientId } }); assert.equal(r.status, 200); sessions.push(r.json());
  }
  const ids = [await f.picker(A), await f.picker(B)], scope = sessions[0].scope;
  await f.restart(async () => {
    const file = path.join(f.multiPicker.pickerRoot, ids[1], 'state.json'), doc = JSON.parse(await readFile(file));
    doc.actionReceipts.slots[0].scope = scope; await writeFile(file, JSON.stringify(doc));
  });
  const requestId = `v3.${scope}.0.1.1`;
  for (const [i, cookie] of [a, b].entries()) {
    const r = await f.note(cookie, `Player ${i + 1}`, 0, { requestId, requestAck: 0 });
    assert.equal(r.status, 200, r.text); assert.equal(r.json().receipt.requestId, requestId);
    const replay = await f.note(cookie, `Player ${i + 1}`, 0, { requestId, requestAck: 0 });
    assert.equal(replay.json().state.members[0].notes['12341'], `Player ${i + 1}`); assert.equal(replay.json().state.revision, 1);
  }
  assert.equal((await f.send('/api/action-session', a, { body: { clientId, acknowledge: { ...sessions[0], sequence: 1 } } })).status, 200);
  assert.equal((await f.note(a, 'Player 1', 0, { requestId, requestAck: 0 })).json().code, 'REQUEST_ACKNOWLEDGED');
  assert.equal((await f.note(b, 'Player 2', 0, { requestId, requestAck: 0 })).status, 200);
  for (const [i, cookie] of [a, b].entries()) assert.equal((await f.note(cookie, `Player ${i + 3}`, 1)).status, 200);
  const backups = [];
  for (const cookie of [a, b]) backups.push((await f.send('/api/backups', cookie)).json().backups.find(row => row.revision === 1).id);
  await f.restart(async () => {
    if (backups[1] !== backups[0]) await rename(path.join(f.multiPicker.pickerRoot, ids[1], 'backups', backups[1]), path.join(f.multiPicker.pickerRoot, ids[1], 'backups', backups[0]));
  });
  for (const [i, cookie] of [a, b].entries()) {
    const r = await f.send('/api/backups/' + backups[0], cookie); assert.equal(r.status, 200); assert.equal(r.json().state.members[0].notes['12341'], `Player ${i + 1}`);
    assert.equal((await f.send('/api/restore/preview', cookie, { body: { backupId: backups[0] } })).status, 200);
  }
  assert.equal((await command(f, a, 2, { type: 'undo' })).status, 200);
  assert.equal((await stateOf(f, a)).members[0].notes['12341'], 'Player 1');
  assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 4');
  assert.equal((await f.send('/api/restore', b, { body: { backupId: backups[0], expectedRevision: 2 } })).status, 200);
  assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 2');
  assert.equal((await stateOf(f, a)).members[0].notes['12341'], 'Player 1');
});

// A token issued in A must not consume a same-revision proposal in B.
test('P1.3 preview tokens cannot apply or consume another picker proposal', async t => {
  const profile = JSON.parse(await readFile(new URL('./fixtures/runemetrics/examplegimab-profile.json', import.meta.url)));
  const quests = JSON.parse(await readFile(new URL('./fixtures/runemetrics/examplegimab-quests.json', import.meta.url)));
  const dataset = { ...selectedDataset, capabilities: { ...selectedDataset.capabilities, features: { ...selectedDataset.capabilities.features, runeMetrics: true, externalNames: true } } };
  const f = await fixture(t, { dataset, runeMetrics: { fetchImpl: async url => Response.json(url.pathname.endsWith('/quests') ? quests : { ...profile, name: url.searchParams.get('user') }) } });
  const a = await f.login(A), b = await f.login(B);
  for (const [i, cookie] of [a, b].entries()) {
    const r = await command(f, cookie, 0, { type: 'set-runescape-name', memberId: 'owner', name: `Player ${i + 1}` }); assert.equal(r.status, 200, r.text);
  }
  // Force only proposal allocation, then restore randomness before any writes.
  const previewId = '50000000-0000-4000-8000-000000000001', randomUUID = crypto.randomUUID;
  async function preview(cookie) {
    try {
      crypto.randomUUID = () => previewId; syncBuiltinESMExports();
      const r = await f.send('/api/runemetrics/preview', cookie, { body: { memberId: 'owner' } }); assert.equal(r.status, 200, r.text);
      assert.equal(r.json().previewId, previewId); return r.json();
    } finally { crypto.randomUUID = randomUUID; syncBuiltinESMExports(); }
  }
  await preview(a);
  assert.equal((await f.send('/api/runemetrics/apply', b, { body: { previewId, expectedRevision: 1 } })).status, 410);
  assert.equal((await stateOf(f, b)).revision, 1);
  await preview(b); // The same ID now denotes a different proposal in B.
  for (const [i, cookie] of [a, b].entries()) {
    const r = await f.send('/api/runemetrics/apply', cookie, { body: { previewId, expectedRevision: 1 } }); assert.equal(r.status, 200, r.text);
    assert.equal(r.json().state.members[0].runescapeName, `Player ${i + 1}`);
    assert.equal((await f.send('/api/runemetrics/apply', cookie, { body: { previewId, expectedRevision: 2 } })).status, 410);
  }
});

// Bullet 4: native credentials, SSE and overlay delivery across durable deletion.
test('P1.4 deletion closes A streams and capabilities while B continues worker and plugin events', { timeout: 15000 }, async t => {
  const f = await fixture(t), a = await f.login(A), b = await f.login(B);
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const id = await f.picker(A), account = (await f.registry()).accounts.find(row => row.defaultPickerId === id);
  const token = 'x'.repeat(43), uuid = '11111111-1111-4111-8111-111111111111';
  await f.restart(async () => {
    await writeFile(path.join(f.multiPicker.pickerRoot, id, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: [{ id: uuid, label: 'Player 1', widget: 'count', player: 'owner', createdAt: '2026-10-21T12:00:00.000Z', revoked: false, tokenHash: hash(token) }] }));
    const registry = await openRegistry(f.multiPicker);
    try { await registry.setCapability({ kind: 'overlay-capability', hash: hash(token), pickerId: id, accountId: account.id, memberId: 'owner' }); }
    finally { await registry.close(); }
  });
  const keys = [await keyFor(f, a), await keyFor(f, b)];
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  const overlay = await f.send('/overlay/events?widget=count&player=owner', a, { stream: true, headers: { Authorization: 'Bearer ' + token } });
  t.after(() => [left, right, overlay].forEach(closeStream));
  assert.deepEqual([left.status, right.status, overlay.status], [200, 200, 200]);
  const closed = Promise.all([ended(left), ended(overlay)]), before = streamBytes(right);
  assert.equal((await f.send('/api/picker/delete', a, { body: {} })).status, 200); await closed; await settle();
  assert.equal(streamBytes(right), before); assert.equal(right.res.readableEnded, false);
  const lengths = [streamBytes(left).length, streamBytes(overlay).length];
  assert.equal((await f.note(b, 'Player 2', 1)).status, 200); assert.equal((await f.send('/api/tasks?memberId=owner', b)).status, 200);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + keys[1] } })).status, 200);
  await keyFor(f, b); await settle(); assert.ok(streamBytes(right).length > before.length);
  assert.match(streamBytes(right), /event: game-plugin/);
  assert.deepEqual([streamBytes(left).length, streamBytes(overlay).length], lengths);
  assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + keys[0] } })).status, 401);
  assert.equal((await f.send('/overlay/data?widget=count&player=owner', a, { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  await f.restart(); assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 2');
});
function controlledWorkers() {
  const pending = [], waiting = [], workers = [];
  return {
    workers, next: () => pending.length ? Promise.resolve(pending.shift()) : new Promise(resolve => waiting.push(resolve)),
    workerFactory() {
      const worker = new EventEmitter(); worker.messages = []; workers.push(worker);
      worker.postMessage = message => {
        worker.messages.push(message);
        if (['cancel', 'supersede'].includes(message.type)) return;
        const item = { worker, message }; if (waiting.length) waiting.shift()(item); else pending.push(item);
      };
      worker.terminate = async () => { worker.emit('exit', 1); };
      queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'], compileMs: 0 }));
      return worker;
    },
    finish({ worker, message }, marker) {
      worker.emit('message', { id: message.id, result: { tasks: [], marker, metrics: { availableCount: 0 }, presentation: { tasks: [] } }, evaluationMs: 0, timingMs: {} });
    },
  };
}

// Bullet 5: the scheduler itself is real; only its transport is deterministic.
test('P1.5 cancellation, late delivery and worker crash preserve B queued HTTP work', { timeout: 15000 }, async t => {
  const workers = controlledWorkers(), f = await fixture(t, { taskWorkerOptions: { workerFactory: workers.workerFactory, backoffMs: 1 } });
  const a = await f.login(A), b = await f.login(B), aId = await f.picker(A), bId = await f.picker(B);
  const aRequest = f.send('/api/tasks?memberId=owner', a), first = await workers.next(); assert.equal(first.message.pickerId, aId);
  const bRequest = f.send('/api/tasks?memberId=owner', b); await settle();
  const deletion = f.send('/api/picker/delete', a, { body: {} });
  // Deletion fences admission and signals A's active job before late delivery.
  for (let i = 0; i < 200 && !first.worker.messages.some(m => m.type === 'cancel' && m.pickerId === aId); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(first.worker.messages.some(m => m.type === 'cancel' && m.pickerId === aId));
  first.worker.emit('error', new Error('synthetic transport crash'));
  workers.finish(first, 'Player 1');
  const second = await workers.next(); assert.equal(second.message.pickerId, bId); assert.notEqual(second.worker, first.worker);
  workers.finish(second, 'Player 2');
  assert.notEqual((await aRequest).status, 200); assert.equal((await deletion).status, 200);
  const result = await bRequest; assert.equal(result.status, 200, result.text); assert.equal(result.json().marker, 'Player 2');
  const cached = await f.send('/api/tasks?memberId=owner', b); assert.equal(cached.json().marker, 'Player 2');
  assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  await f.restart(); assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 2');
});

test('P1.5 eviction during queued HTTP writes drains accepted work and preserves B', { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let held = false;
  const f = await fixture(t, { maxOpenContexts: 3, beforeCommit: async ({ state }) => {
    if (!held && state.members[0].notes?.['12341'] === 'Player 1') { held = true; entered.resolve(); await release.promise; }
  } });
  t.after(() => release.resolve());
  const a = await f.login(A), b = await f.login(B), c = await f.login(C);
  const left = await f.send('/api/events', a, { stream: true }); t.after(() => closeStream(left));
  const closed = ended(left), accepted = f.note(a, 'Player 1', 0);
  try {
    await entered.promise; assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
    const queued = f.note(a, 'Player 3', 1); await settle();
    const right = await f.send('/api/events', b, { stream: true }), bClosed = ended(right); t.after(() => closeStream(right));
    assert.equal((await f.send('/api/state', c)).status, 200); await bClosed;
    assert.equal(left.res.readableEnded, false);
    const restarting = f.restart(); await closed; release.resolve();
    assert.equal((await accepted).status, 200); assert.equal((await queued).status, 503); await restarting;
    assert.equal((await stateOf(f, a)).members[0].notes['12341'], 'Player 1');
    assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 2');
  } finally { release.resolve(); }
});

// Bullet 6: races share durable provisioning; established shared members keep
// separate default slots. Offline registry setup models an operator grant.
test('P1.6 racing sign-ins preserve the shared game and separate private default slots', async t => {
  const f = await fixture(t, { registrationsPerAccount: 20 }), left = await f.begin(A), right = await f.begin(A);
  const callbacks = await Promise.all([left(), right()]); assert.deepEqual(callbacks.map(r => r.status), [303, 303]);
  let doc = await f.registry(); assert.equal(doc.accounts.length, 1); assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
  const before = hash((await f.private('/api/backup')).text);
  for (const [subject, memberId] of [[B, 'one'], [C, 'two']]) {
    const invite = await f.private('/api/invites', { body: { label: 'Player 2', memberId } }); assert.equal(invite.status, 201);
    const join = await f.send(new URL(invite.json().link).pathname); assert.equal(join.status, 200);
    await f.login(subject, join.headers['set-cookie'][0].split(';')[0]);
  }
  await f.restart(async () => {
    const registry = await openRegistry(f.multiPicker);
    try {
      for (const row of (await f.registry()).accounts.filter(row => !row.defaultPickerId)) await registry.ensureDefaultPicker(row.id);
    } finally { await registry.close(); }
  });
  doc = await f.registry(); assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 3);
  const shared = doc.pickers.find(p => p.kind === 'legacy-shared'); assert.equal(shared.ownerAccountId, null);
  for (const subject of [B, C]) {
    const state = await stateOf(f, await f.login(subject)); assert.deepEqual(state.members.map(m => m.id), ['one', 'two']);
    const row = doc.accounts.find(row => row.identities.some(identity => identity.subject === String(subject)));
    assert.ok(row.defaultPickerId); assert.ok(row.memberships.some(m => m.pickerId === shared.id));
    assert.ok(row.memberships.some(m => m.pickerId === row.defaultPickerId && m.role === 'owner'));
  }
  assert.equal(hash((await f.private('/api/backup')).text), before);
  const cookie = await f.login(A), fresh = await stateOf(f, cookie); assert.equal(fresh.revision, 0); assert.deepEqual(fresh.members[0].unlocked, []);
});

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
async function browser(f, initialCookie) {
  let cookie = initialCookie, reloads = 0;
  const siteStore = storage(), tabStore = storage(), notices = [], calls = [], rendered = { text: 'Player 1', replaceChildren() { this.text = ''; } };
  const c = { state: await stateOf(f, cookie), result: {}, normalPlayResults: new Map([['owner', {}]]), planningResults: new Map([['owner', {}]]), viewerPreferences: { ids: true }, taskRequest: 0, taskRenderGeneration: 0, dialogGeneration: 0 };
  const context = vm.createContext({ Headers, AbortController, Map, Set, clearTimeout, console,
    document: { querySelectorAll: () => [rendered], addEventListener() {} }, localStorage: siteStore, sessionStorage: tabStore, addEventListener() {} });
  const source = await readFile(new URL('../app/web/screen-save-status.mjs', import.meta.url), 'utf8');
  const exports = vm.runInContext(`(() => { ${source.replace(/^import .*\n/gm, '').replace(/^export /gm, '')}\nreturn { createScreenPickerSession, gameStorage, pickerStoragePrefix }; })()`, context);
  const transport = async (route, options = {}) => {
    calls.push(route);
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    const result = await f.send(route, cookie, { method: options.method, body, headers: Object.fromEntries(new Headers(options.headers)) });
    return { ok: result.status < 400, status: result.status, json: async () => result.json(), text: async () => result.text, headers: new Headers(result.headers) };
  };
  exports.createScreenPickerSession(c, { fetch: transport, storage: () => siteStore, tabStorage: () => tabStore,
    location: { reload: () => { reloads++; } }, notify: text => notices.push(text), schedule: () => 1, cancel() {} });
  const session = (await f.send('/api/session', cookie)).json(); c.panelContext.pickerSession.initialize(session);
  return { c, session, siteStore, tabStore, notices, calls, rendered, transport, ...exports,
    setCookie: value => { cookie = value; }, get reloads() { return reloads; } };
}

// Bullet 7: real bound HTTP sessions feed the actual browser coordinator and
// durable command queue; no mocked session response can hide routing failures.
for (const change of ['switch', 'logout']) test(`P1.7 browser ${change} retires queued commands, views, streams and recovery`, async t => {
  const f = await fixture(t), a = await f.login(A), b = await f.login(B), page = await browser(f, a);
  const session = page.c.panelContext.pickerSession, prefix = page.pickerStoragePrefix(page.session.pickerId);
  page.gameStorage().setItem('rs3:task-view', 'Player 1');
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let released = false;
  t.after(() => release.resolve(() => { released = true; }));
  const client = createLiveSwapCommandClient({ pickerId: page.session.pickerId, storage: page.tabStore,
    uuid: () => '40000000-0000-4000-8000-000000000001', fetch: session.fetch,
    acquireSession: () => { entered.resolve(); return release.promise; } });
  session.registerCommands(client);
  const stream = await f.send(session.streamPath(), a, { stream: true }); assert.equal(stream.status, 200);
  session.registerStop(() => closeStream(stream));
  const body = { expectedRevision: 0, command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Player 1' } };
  const sending = client.send(body), rejected = assert.rejects(sending, error => error.pendingCommand === true && /closed or suspended/.test(error.message));
  await entered.promise;
  // Keep one durable unconfirmed intention alongside the not-yet-owned queue.
  page.tabStore.setItem(prefix + commandOutboxKey, JSON.stringify({ unsent: JSON.stringify(body) }));
  if (change === 'switch') {
    page.setCookie(b); await assert.rejects(session.fetch('/api/state'), { name: 'AbortError' });
  } else {
    session.beforeSignOut(); assert.equal((await page.transport('/auth/signout', { method: 'POST', body: '{}' })).status, 303);
  }
  release.resolve(() => { released = true; }); await rejected;
  assert.equal(session.stopped, true); assert.equal(released, true);
  assert.equal(page.c.state, undefined); assert.equal(page.c.result, undefined); assert.equal(page.c.normalPlayResults.size, 0); assert.equal(page.c.planningResults.size, 0);
  assert.equal(Object.keys(page.c.viewerPreferences).length, 0); assert.equal(page.rendered.text, ''); assert.equal(stream.res.destroyed, true);
  assert.equal(page.siteStore.getItem(prefix + 'rs3:task-view'), null); assert.equal(page.tabStore.getItem(prefix + commandOutboxKey), null);
  assert.equal(page.calls.filter(route => route === '/api/command').length, 0); assert.equal(page.notices.length, 1); assert.match(page.notices[0], /Queued changes were not sent/);
  assert.equal((await stateOf(f, b)).revision, 0); assert.equal((await f.send('/api/history', b)).json().history?.length ?? 0, 0);
  if (change === 'switch') assert.equal(page.reloads, 1); else assert.equal((await f.send('/api/session', a)).status, 401);
});

// MP8 must provide the service backup/restore entry point before this can run.
// Bullet 8: MP8 service backup and stopped restore with the real server on both
// sides. A is deleted after the backup; its tombstone wins over the backup copy.
test('P1.8 restoring a service backup containing a later-deleted picker keeps it deleted and B unchanged', { timeout: 15000 }, async t => {
  const f = await fixture(t), a = await f.login(A), b = await f.login(B);
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const ids = [await f.picker(A), await f.picker(B)], keys = [await keyFor(f, a), await keyFor(f, b)];
  const accountB = (await f.registry()).accounts.find(row => row.defaultPickerId === ids[1]).id;
  const paths = root => ({ dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'), backupDir: path.join(root, 'backups'), scratchRoot: path.join(root, 'scratch'), minFreeBytes: 0,
    multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: f.multiPicker.tombstoneDir } });
  let claimLink;
  const live = paths(f.root), recovered = paths(path.join(f.root, 'recovered')), backupId = crypto.randomUUID();
  await f.restart(async () => {
    const registry = await openRegistry(f.multiPicker);
    try { await captureServiceCheckpoint({ settings: live, registry, id: backupId }); } finally { await registry.close(); }
  });
  const backup = snapshotPath(live.dataDir, backupId);
  // Restore pins a release identity; the probe below replaces the release's own probe.
  const core = path.join(f.root, 'release'), config = path.join(f.root, 'config.json'), pointer = path.join(f.root, 'current.json');
  await mkdir(core); await writeFile(path.join(core, 'README.md'), 'synthetic release');
  const configBytes = JSON.stringify({ coreRoot: core, dataDir: live.dataDir, datasetId: 'open-f2p', multiPicker: live.multiPicker });
  await writeFile(config, configBytes); await writeFile(pointer, JSON.stringify({ config: { path: config, sha256: hash(configBytes) } }));
  const release = await readRelease(pointer, live.dataDir);
  assert.equal((await f.send('/api/picker/delete', a, { body: {} })).status, 200);
  const before = await stateOf(f, b);
  await f.restart(async () => {
    const probe = async (_release, dir) => JSON.parse(await readFile(path.join(dir, 'state.json')));
    const result = await restoreServiceStopped({ settings: recovered, backup, release, assertStopped: async () => {}, probe });
    assert.equal(result.excluded, 1); assert.equal(result.credentialsRestored, 0);
    // Swap the recovered service roots into place, as a disk recovery would.
    for (const name of ['legacy', 'legacy.dataset.json', 'registry', 'pickers']) {
      await rename(path.join(f.root, name), path.join(f.root, 'replaced-' + name));
      await rename(path.join(f.root, 'recovered', name), path.join(f.root, name));
    }
    const registry = await openRegistry(f.multiPicker);
    try {
      const account = registry.getAccount(accountB);
      assert.deepEqual(account.identities, []); assert.equal(account.defaultPickerId, ids[1]);
    } finally { await registry.close(); }
    const publicOriginFile = path.join(f.root, 'origin'); await writeFile(publicOriginFile, origin);
    const issued = await runServiceOperator({ settings: live, release: { ...release, config: { ...release.config, publicOriginFile } },
      command: 'relink-code', argument: accountB, controller: { state: async () => ({ stopped: true, active: false }) },
      // Windows has no POSIX ids; its chown is a no-op, so the ownership repair is exercised on Linux only.
      serviceIdentity: async () => ({ uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }) });
    claimLink = issued.claimLink;
  });
  const doc = await f.registry();
  assert.equal(doc.pickers.find(p => p.id === ids[0])?.lifecycle ?? 'deleted', 'deleted');
  await assert.rejects(readFile(path.join(f.multiPicker.pickerRoot, ids[0], 'state.json')), { code: 'ENOENT' });
  // Credentials are never part of a service backup: A's session and key stay revoked.
  assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + keys[0] } })).status, 401);
  // B already signed in after recovery and has only a revision-zero default.
  const empty = await f.login(B), emptyId = await f.picker(B);
  const landing = await f.send(new URL(claimLink).pathname + new URL(claimLink).search, empty);
  assert.equal(landing.status, 303);
  const pending = landing.headers['set-cookie'][0].split(';')[0];
  const claimPage = await f.send(landing.headers.location, pending);
  assert.equal(claimPage.status, 200); assert.match(claimPage.text, /Reclaim your account/);
  const again = await f.login(B, pending);
  assert.equal(await f.picker(B), ids[1]);
  assert.notEqual(emptyId, ids[1]);
  assert.equal((await f.send('/api/state', empty)).status, 401);
  const ledger = JSON.parse(await readFile(path.join(f.multiPicker.tombstoneDir, 'ledger.json')));
  assert.equal(ledger.pickers.find(p => p.pickerId === emptyId).purgeProgress, 'complete');
  assert.equal(ledger.accounts.length, 1);
  const after = await stateOf(f, again);
  assert.equal(after.revision, before.revision); assert.equal(after.members[0].notes['12341'], 'Player 2');
  // A signs in to a fresh empty default, never the deleted game.
  const fresh = await f.login(A);
  const blank = await stateOf(f, fresh);
  assert.notEqual(await f.picker(A), ids[0]); assert.equal(blank.revision, 0); assert.equal(blank.members[0].notes?.['12341'], undefined);
});

// Bullet 9: owner affordances never grant operator authority; shared limits
// persist across account sessions, eviction and server-side routing.
test('P1.9 owner capabilities remain scoped and account/global limits remain shared', async t => {
  const f = await fixture(t, { expensivePerAccount: 2, expensivePerPicker: 10, expensiveGlobal: 3, registrationsPerAccount: 10, maxOpenContexts: 2 });
  const a = await f.login(A), a2 = await f.login(A), b = await f.login(B);
  const session = (await f.send('/api/session', a)).json();
  assert.equal(session.admin, false); assert.equal(session.capabilities.canWrite, true); assert.equal(session.ownerControls.role, 'owner'); assert.equal(session.ownerControls.shared, false);
  for (const route of ['/api/accounts', '/api/invites', '/api/overlays', '/api/admin/master-link']) assert.equal((await f.send(route, a)).status, 403, route);
  for (const route of ['/api/shutdown', '/api/worker-restart', '/api/operator/snapshot']) assert.equal((await f.send(route, a, { body: {} })).status, 403, route);
  assert.equal((await f.note(a, 'Player 1', 0)).status, 200); assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  const backup = (await f.send('/api/backup', a)).json();
  assert.equal((await f.send('/api/restore/preview', a, { body: { backup } })).status, 200);
  assert.equal((await f.send('/api/restore', a, { body: { backup, expectedRevision: 1 } })).status, 200);
  assert.equal((await stateOf(f, b)).members[0].notes['12341'], 'Player 2');
  for (const cookie of [a, a2]) assert.equal((await f.send('/api/tasks?memberId=owner', cookie)).status, 200);
  const accountLimit = await f.send('/api/tasks?memberId=owner', a2); assert.equal(accountLimit.status, 429); assert.ok(accountLimit.headers['retry-after']);
  assert.equal((await f.send('/api/tasks?memberId=owner', b)).status, 200);
  const globalLimit = await f.send('/api/tasks?memberId=owner', b); assert.equal(globalLimit.status, 429); assert.ok(globalLimit.headers['retry-after']);
});

async function issueReclaim(f, accountId) {
  const response = await f.private('/api/operator/relink-code', { body: { accountId } });
  assert.equal(response.status, 200);
  return response.json().claimLink;
}
async function openReclaim(f, claimLink, cookie) {
  const url = new URL(claimLink), response = await f.send(url.pathname + url.search, cookie);
  assert.equal(response.status, 303);
  assert.equal(response.headers['referrer-policy'] ?? 'no-referrer', 'no-referrer');
  return response.headers['set-cookie'][0].split(';')[0];
}
async function restoredAccount(f) {
  const cookie = await f.login(A);
  await f.note(cookie, 'Player 1', 0);
  const id = await f.picker(A), accountId = (await f.registry()).accounts.find(a => a.defaultPickerId === id).id;
  await f.restart(async () => {
    const registry = await openRegistry(f.multiPicker);
    try { await registry.unlinkIdentity(accountId, 'discord'); } finally { await registry.close(); }
  });
  return { id, accountId };
}
for (const provider of ['discord', 'google']) test(`MP15 unlinked ${provider} identity reclaims restored revision and survives restart`, async t => {
  const f = await fixture(t), target = await restoredAccount(f);
  const link = await issueReclaim(f, target.accountId), pending = await openReclaim(f, link);
  const page = await f.send('/auth/reclaim/signin', pending);
  assert.equal(page.status, 200); assert.match(page.text, /Sign in with Discord/); assert.match(page.text, /Sign in with Google/);
  assert.equal(page.headers['cache-control'], 'private, no-store'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  const cookie = await f.login(B, pending, '/auth/' + provider);
  const outcome = await f.send('/auth/reclaim/done', cookie);
  assert.equal(outcome.status, 200); assert.match(outcome.text, /Account reclaimed/);
  assert.equal((await stateOf(f, cookie)).revision, 1);
  await f.restart();
  assert.equal((await stateOf(f, cookie)).revision, 1);
  const account = (await f.registry()).accounts.find(a => a.id === target.accountId);
  assert.equal(account.defaultPickerId, target.id); assert.equal(account.identities[0].provider, provider);
  // Used codes reach the callback and refuse without writing the registry.
  const before = JSON.stringify(await f.registry());
  const replay = await f.begin(C, await openReclaim(f, link), '/auth/' + provider);
  assert.equal((await replay()).status, 409);
  assert.equal(JSON.stringify(await f.registry()), before);
});

test('MP15 identity with gameplay refuses 409 and leaves both accounts and code unchanged', async t => {
  const f = await fixture(t), target = await restoredAccount(f), cookie = await f.login(B);
  await f.note(cookie, 'Player 2', 0);
  const link = await issueReclaim(f, target.accountId), pending = await openReclaim(f, link, cookie);
  const before = JSON.stringify(await f.registry()), state = await stateOf(f, cookie);
  const callback = await f.begin(B, pending);
  assert.equal((await callback()).status, 409);
  assert.equal(JSON.stringify(await f.registry()), before); assert.deepEqual(await stateOf(f, cookie), state);
  const restored = await f.login(C, await openReclaim(f, link));
  assert.equal((await stateOf(f, restored)).revision, 1);
});

test('MP15 gameplay queued before a claim wins and the claim changes nothing', async t => {
  let armed = false;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, { beforeCommit: async () => { if (armed) { entered.resolve(); await release.promise; } } });
  const target = await restoredAccount(f), cookie = await f.login(B);
  await stateOf(f, cookie);
  const pending = await openReclaim(f, await issueReclaim(f, target.accountId), cookie), callback = await f.begin(B, pending);
  const before = JSON.stringify(await f.registry());
  armed = true;
  const note = f.note(cookie, 'Player 2', 0); await entered.promise;
  try {
    const claiming = callback(); await settle(); release.resolve();
    assert.equal((await note).status, 200); assert.equal((await claiming).status, 409);
    assert.equal(JSON.stringify(await f.registry()), before); assert.equal((await stateOf(f, cookie)).revision, 1);
  } finally { release.resolve(); }
});

test('MP15 public and owner callers cannot issue codes; option-absent reclaim stays unavailable', async t => {
  const f = await fixture(t), cookie = await f.login(A);
  const accountId = (await f.registry()).accounts.find(a => a.identities.some(i => i.subject === String(A))).id;
  const before = JSON.stringify(await f.registry());
  for (const credential of [undefined, cookie]) assert.equal((await f.send('/api/operator/relink-code', credential, { body: { accountId } })).status, 403);
  assert.equal(JSON.stringify(await f.registry()), before);
  const absent = await fixture(t, { initiallyEnabled: false });
  assert.equal((await absent.send('/auth/reclaim')).status, 404);
});

test('MP15 accepted and refused claim routes share the sign-in rate limit', async t => {
  const f = await fixture(t, { unauthenticatedLimit: 6 });
  const cookie = await f.login(A), account = (await f.registry()).accounts[0];
  await f.restart(async () => {
    const registry = await openRegistry(f.multiPicker);
    try { await registry.unlinkIdentity(account.id, 'discord'); } finally { await registry.close(); }
  });
  const link = await issueReclaim(f, account.id), pending = await openReclaim(f, link);
  const callback = await f.begin(B, pending);
  const claimed = await callback(); assert.equal(claimed.status, 303);
  // Landing, provider start and callback have each consumed one attempt.
  for (let i = 0; i < 3; i++) assert.equal((await f.send('/auth/reclaim', cookie)).status, 409);
  assert.equal((await f.send('/auth/reclaim', cookie)).status, 429);
  assert.equal((await f.send('/auth/discord', cookie)).status, 429);
});

test('MP15 provider cancellation preserves the claim flow for a retry', async t => {
  const f = await fixture(t), target = await restoredAccount(f);
  const pending = await openReclaim(f, await issueReclaim(f, target.accountId));
  const started = await f.send('/auth/discord', pending), url = new URL(started.headers.location);
  const cancelled = await f.send('/auth/discord/callback?state=' + url.searchParams.get('state') + '&error=access_denied', started.headers['set-cookie'][0].split(';')[0]);
  assert.equal(cancelled.status, 400); assert.match(cancelled.text, /Sign-in cancelled/);
  const retry = cancelled.headers['set-cookie'].find(value => value.startsWith('__Host-rs3_preauth=') && !value.startsWith('__Host-rs3_preauth=;')).split(';')[0];
  const cookie = await f.login(B, retry);
  assert.equal((await stateOf(f, cookie)).revision, 1);
  assert.equal((await f.registry()).accounts.find(a => a.id === target.accountId).defaultPickerId, target.id);
});

test('MP15 reclaim refuses an empty source with linked providers and preserves both sign-ins', async t => {
  const f = await fixture(t, { registrationsPerAccount: 20 }), target = await restoredAccount(f), cookie = await f.login(B);
  await f.login(C, cookie, '/auth/link/google');
  const sourceId = (await f.registry()).accounts.find(a => a.identities.some(i => i.provider === 'discord' && i.subject === String(B))).id;
  const link = await issueReclaim(f, target.accountId), pending = await openReclaim(f, link, cookie);
  const before = JSON.stringify(await f.registry());
  const callback = await f.begin(B, pending);
  assert.equal((await callback()).status, 409);
  assert.equal(JSON.stringify(await f.registry()), before);
  for (const [subject, route] of [[B, '/auth/discord'], [C, '/auth/google']]) {
    const session = await f.send('/api/session', await f.login(subject, undefined, route));
    assert.equal(session.status, 200); assert.equal(session.json().accountId, sourceId);
  }
  const claimed = await f.login(A, await openReclaim(f, link));
  assert.equal((await stateOf(f, claimed)).revision, 1);
});

test('MP15 claim refuses a deleted target default even when another membership survives', async t => {
  const f = await fixture(t), target = await restoredAccount(f);
  await f.login(B);
  const link = await issueReclaim(f, target.accountId);
  await f.restart(async () => {
    const registry = await openRegistry(f.multiPicker);
    try {
      await registry.attachMembership(target.accountId, { pickerId: await f.picker(B), role: 'viewer', memberId: null });
      await registry.beginPickerDeletion(target.id);
    } finally { await registry.close(); }
  });
  const callback = await f.begin(C, await openReclaim(f, link));
  const before = JSON.stringify(await f.registry());
  const ledgerFile = path.join(f.multiPicker.tombstoneDir, 'ledger.json'), ledger = await readFile(ledgerFile);
  assert.equal((await callback()).status, 409);
  assert.equal(JSON.stringify(await f.registry()), before);
  assert.deepEqual(await readFile(ledgerFile), ledger);
});
