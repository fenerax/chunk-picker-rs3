import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm, writeFile, readFile, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { openRegistry } = await import('../app/storage/registry.mjs');
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
    req.on('error', reject); req.end(bytes);
  });
}
async function fixture(t, { initiallyEnabled = true, beforeCommit, backupRetentionMs, taskWorkerOptions, ...limits } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-routing-'));
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
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      backupRetentionMs, taskWorkerOptions, onRequestHandler: value => { handler = value; }, beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
      rateLimits: { unauthenticated: 10000, expensivePerIdentity: 10000 } });
    await app.listen();
  };
  await start(initiallyEnabled ? multiPicker : undefined);
  const base = () => `http://127.0.0.1:${app.loopbackAddress().port}`;
  const send = (route, cookie, options = {}) => request(base(), route, { ...options, headers: { ...proxy, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  async function begin(subject, cookie, route = '/auth/discord') {
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
  const picker = async subject => { const doc = await registry(); return doc.accounts.find(a => a.identities.some(i => i.subject === subject)).defaultPickerId; };
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

const hash = value => createHash('sha256').update(value).digest('hex');
const exists = async file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('deletion is session-scoped, checks origin and fields, and never opens the named picker', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102'), id = await f.picker('102');
  assert.equal((await f.send('/api/picker/delete', null, { body: {} })).status, 401);
  assert.equal((await f.private('/api/picker/delete', { body: {} })).status, 403);
  assert.equal((await f.send('/api/picker/delete', a)).status, 405);
  for (const route of ['/api/picker/delete', '/api/account/delete']) {
    assert.equal((await f.send(route + '?pickerId=' + id, a, { body: {} })).status, 403);
    assert.equal((await f.send(route, a, { body: { accountId: 102 } })).status, 400);
    assert.equal((await f.send(route, a, { body: { pickerId: id } })).status, 403);
    assert.equal((await f.send(route, a, { body: {}, headers: { Origin: 'https://foreign.example' } })).status, 403);
  }
  assert.equal(await exists(path.join(f.multiPicker.pickerRoot, id, 'state.json')), false);
  assert.equal((await f.send('/api/state', b)).status, 200);
});

test('deleting A closes its streams, refuses old credentials and leaves B events and game independent', { timeout: 10000 }, async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const id = await f.picker('101'), directory = path.join(f.multiPicker.pickerRoot, id);
  const created = await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Player 1' } });
  assert.equal(created.status, 201); const key = created.json().key;
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  const ended = new Promise(resolve => left.res.once('end', resolve));
  t.after(() => { left.req.destroy(); right.req.destroy(); });
  const before = Buffer.concat(right.chunks).length;
  const response = await f.send('/api/picker/delete', a, { body: {} }); assert.equal(response.status, 200, response.text);
  await ended; await settle();
  assert.match(response.json().backups.message, /not erased immediately/);
  assert.match(response.json().backups.message, /not configured/); assert.equal(response.json().backups.retentionMs, null);
  assert.equal(right.res.readableEnded, false); assert.equal(Buffer.concat(right.chunks).length, before);
  assert.equal(await exists(directory), false); assert.equal(await exists(directory + '.dataset.json'), false);
  assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  const stopped = Buffer.concat(left.chunks).length;
  assert.equal((await f.note(b, 'Player 2', 1)).status, 200);
  await f.send('/api/tasks?memberId=owner', b); await settle();
  assert.equal(Buffer.concat(left.chunks).length, stopped);
  assert.ok(Buffer.concat(right.chunks).length > before);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
  const fresh = await f.login('101'); assert.notEqual(await f.picker('101'), id);
  const state = (await f.send('/api/state', fresh)).json().state;
  assert.equal(state.revision, 0); assert.deepEqual(state.members[0].unlocked, []); assert.equal(state.members[0].notes, undefined);
  assert.deepEqual(state.members[0].completedTasks, []); assert.deepEqual(state.tasks, []);
});

test('account deletion removes subjects and all owned pickers and discloses configured retention', async t => {
  const f = await fixture(t, { backupRetentionMs: 86400000 }), a = await f.login('101');
  const id = await f.picker('101'), accountId = (await f.registry()).accounts[0].id;
  await f.note(a, 'Player 1', 0);
  const response = await f.send('/api/account/delete', a, { body: {} }); assert.equal(response.status, 200, response.text);
  assert.equal(response.json().backups.retentionMs, 86400000); assert.match(response.json().backups.message, /not erased immediately/);
  assert.equal((await f.registry()).accounts.some(row => row.id === accountId), false);
  assert.equal((await f.send('/api/state', a)).status, 401);
  const fresh = await f.login('101'), doc = await f.registry();
  assert.notEqual(doc.accounts[0].id, accountId); assert.notEqual(await f.picker('101'), id);
  assert.equal((await f.send('/api/state', fresh)).json().state.revision, 0);
  await f.restart(); assert.equal((await f.send('/api/state', a)).status, 401);
});

test('pre-deletion uploads and retained backups cannot restore old ownership, subjects or capabilities', async t => {
  const f = await fixture(t), a = await f.login('101');
  const id = await f.picker('101'); await f.note(a, 'Player 1', 0);
  const backup = (await f.send('/api/backup', a)).json();
  const retained = (await f.send('/api/backups', a)).json().backups;
  const key = (await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Player 1' } })).json().key;
  assert.equal((await f.send('/api/account/delete', a, { body: {} })).status, 200);
  assert.equal((await f.send('/api/restore', a, { body: { backup, expectedRevision: 1 } })).status, 403);
  const fresh = await f.login('101'), freshId = await f.picker('101'); assert.notEqual(freshId, id);
  assert.equal((await f.send('/api/restore', fresh, { body: { backup, expectedRevision: 0, pickerId: id } })).status, 403);
  for (const row of retained) {
    const response = await f.send('/api/restore', fresh, { body: { backupId: row.id, expectedRevision: 0 } });
    assert.notEqual(response.status, 200);
  }
  // A gameplay-only upload can recover the owner's own progress into the new
  // picker, but carries no service identity or capability records.
  const restored = await f.send('/api/restore', fresh, { body: { backup, expectedRevision: 0 } });
  assert.equal(restored.status, 200, restored.text);
  assert.equal(await f.picker('101'), freshId);
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  assert.equal((await f.registry()).pickers.find(row => row.id === id).lifecycle, 'deleted');
  assert.deepEqual((await f.send('/api/game-plugin', fresh)).json().keys, []);
});

test('a restored registry, directory, binding and issuer checkpoint are purged before any owned context opens', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const id = await f.picker('101'), directory = path.join(f.multiPicker.pickerRoot, id);
  const checkpoint = await readFile(path.join(f.multiPicker.registryDir, 'registry.json'));
  const issuer = await readFile(path.join(f.root, 'legacy', 'invites.json'));
  const copy = path.join(f.root, 'checkpoint'); await cp(directory, copy, { recursive: true });
  const binding = await readFile(directory + '.dataset.json');
  assert.equal((await f.send('/api/account/delete', a, { body: {} })).status, 200);
  await f.restart(async () => {
    await writeFile(path.join(f.multiPicker.registryDir, 'registry.json'), checkpoint);
    await writeFile(path.join(f.root, 'legacy', 'invites.json'), issuer);
    await cp(copy, directory, { recursive: true }); await writeFile(directory + '.dataset.json', binding);
  });
  assert.equal(await exists(directory), false); assert.equal(await exists(directory + '.dataset.json'), false);
  assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
  const doc = await f.registry(); assert.equal(doc.accounts.length, 1);
  assert.equal(doc.capabilities.some(c => c.pickerId === id), false);
});

test('legacy picker deletion is refused; deleting its member account preserves the shared game hash', async t => {
  const f = await fixture(t, { initiallyEnabled: false });
  const created = await f.private('/api/invites', { body: { label: 'Player 1', memberId: 'one' } });
  const invite = created.json(), join = await f.private(new URL(invite.link).pathname, { headers: { Authorization: '' } });
  const pending = join.headers['set-cookie'][0].split(';')[0], a = await f.login('101', pending);
  await f.restart();
  const before = hash((await f.private('/api/backup')).text);
  assert.equal((await f.send('/api/picker/delete', a, { body: {} })).status, 403);
  const stream = await f.send('/api/events', a, { stream: true }); t.after(() => stream.req.destroy());
  const ended = new Promise(resolve => stream.res.once('end', resolve));
  const deleted = await f.send('/api/account/delete', a, { body: {} }); assert.equal(deleted.status, 200, deleted.text); await ended;
  assert.equal(hash((await f.private('/api/backup')).text), before);
  assert.equal((await f.send('/api/state', a)).status, 401);
  assert.equal((await f.private(new URL(invite.link).pathname, { headers: { Authorization: '' } })).status, 401);
  const fresh = await f.login('101'); assert.equal((await f.send('/api/state', fresh)).json().state.members.length, 1);
  assert.equal(hash((await f.private('/api/backup')).text), before);
});

test('invites, plugin keys and overlay capabilities revoke durably before purge and overlay streams end', { timeout: 10000 }, async t => {
  let observe;
  const f = await fixture(t, { crashPoint: async (point, { pickerId }) => {
    if (observe && point === 'picker-purge-revoked') await observe(pickerId);
  } });
  const a = await f.login('101'), b = await f.login('102'), id = await f.picker('101');
  const doc = await f.registry(), account = doc.accounts.find(a => a.defaultPickerId === id);
  assert.equal((await f.send('/api/state', a)).status, 200);
  const directory = path.join(f.multiPicker.pickerRoot, id), overlayToken = 'x'.repeat(43), inviteToken = 'y'.repeat(43);
  await f.app().close();
  const at = '2026-10-21T12:00:00.000Z', uuid = '11111111-1111-4111-8111-111111111111';
  await writeFile(path.join(directory, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: [{ id: uuid, label: 'Player 1', widget: 'count', player: 'owner', createdAt: at, revoked: false, tokenHash: hash(overlayToken) }] }));
  await writeFile(path.join(directory, 'invites.json'), JSON.stringify({ schemaVersion: 1, invites: [{ id: uuid, label: 'Player 1', admin: false, memberId: 'owner', createdAt: at, lastUsedAt: null, revoked: false, tokenHash: hash(inviteToken) }], sessions: [] }));
  const registry = await openRegistry(f.multiPicker);
  await registry.setCapability({ kind: 'overlay-capability', hash: hash(overlayToken), pickerId: id, accountId: account.id, memberId: 'owner' }); await registry.close();
  await f.restart();
  const key = (await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Player 1' } })).json().key;
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  const overlayRoute = '/overlay/events?widget=count&player=owner';
  const overlay = await f.send(overlayRoute, a, { stream: true, headers: { Authorization: 'Bearer ' + overlayToken } });
  assert.equal(overlay.status, 200); t.after(() => { left.req.destroy(); right.req.destroy(); overlay.req.destroy(); });
  const ended = Promise.all([left, overlay].map(s => new Promise(resolve => s.res.once('end', resolve))));
  const before = Buffer.concat(right.chunks).length;
  let checked = false;
  observe = async pickerId => {
    assert.equal(pickerId, id); checked = true;
    for (const [file, field] of [['plugin-keys.json', 'keys'], ['invites.json', 'invites'], ['overlays.json', 'links']]) {
      const local = JSON.parse(await readFile(path.join(directory, file))); assert.ok(local[field].length); assert.ok(local[field].every(row => row.revoked));
    }
    const durable = await f.registry(); assert.equal(durable.capabilities.some(c => c.pickerId === id), false);
  };
  assert.equal((await f.send('/api/picker/delete', a, { body: {} })).status, 200); await ended; assert.equal(checked, true);
  await settle(); assert.equal(right.res.readableEnded, false); assert.equal(Buffer.concat(right.chunks).length, before);
  const lengths = [Buffer.concat(left.chunks).length, Buffer.concat(overlay.chunks).length];
  await f.note(b, 'Player 2', 0); await f.send('/api/tasks?memberId=owner', b); await settle();
  assert.deepEqual([Buffer.concat(left.chunks).length, Buffer.concat(overlay.chunks).length], lengths);
  assert.equal((await f.send('/api/plugin/v1/report', null, { headers: { Authorization: 'Bearer ' + key }, body: {} })).status, 401);
  assert.equal((await f.send('/overlay/data?widget=count&player=owner', a, { headers: { Authorization: 'Bearer ' + overlayToken } })).status, 401);
  assert.equal((await f.send('/join/' + inviteToken)).status, 401);
  observe = undefined; await f.restart(); assert.equal(await exists(directory), false);
});

test('deletion drains an already accepted write and fences new admission while B keeps saving', { timeout: 10000 }, async t => {
  const accepted = Promise.withResolvers(), release = Promise.withResolvers(); let armed = false;
  const f = await fixture(t, { beforeCommit: async ({ state }) => {
    if (armed && state.members[0].notes?.['12341'] === 'Player 1') { armed = false; accepted.resolve(); await release.promise; }
  } });
  const a = await f.login('101'), b = await f.login('102'), id = await f.picker('101');
  const stream = await f.send('/api/events', a, { stream: true }); t.after(() => { release.resolve(); stream.req.destroy(); });
  const ended = new Promise(resolve => stream.res.once('end', resolve));
  armed = true;
  const write = f.note(a, 'Player 1', 0); await accepted.promise;
  let completed = false;
  const deletion = f.send('/api/picker/delete', a, { body: {} }).then(value => { completed = true; return value; });
  await ended; await settle(); assert.equal(completed, false);
  assert.equal((await f.send('/api/state', a)).status, 401);
  release.resolve(); assert.equal((await write).status, 200); assert.equal((await deletion).status, 200);
  assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  assert.equal(await exists(path.join(f.multiPicker.pickerRoot, id)), false);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
});

test('routing absent exposes no deletion capability or retention policy', async t => {
  const f = await fixture(t, { initiallyEnabled: false, backupRetentionMs: -1 });
  const before = hash((await f.private('/api/backup')).text);
  for (const route of ['/api/picker/delete', '/api/account/delete']) assert.equal((await f.private(route, { body: {} })).status, 404);
  assert.equal(hash((await f.private('/api/backup')).text), before);
  assert.equal(await exists(f.multiPicker.registryDir), false);
});

test('deleting A cancels its pending MP3 job and drops its late result while B finishes', { timeout: 10000 }, async t => {
  const pending = [], waiting = [], workers = [];
  const next = () => pending.length ? Promise.resolve(pending.shift()) : new Promise(resolve => waiting.push(resolve));
  const workerFactory = () => {
    const worker = new EventEmitter(); workers.push(worker); worker.messages = [];
    worker.postMessage = message => {
      worker.messages.push(message);
      if (['cancel', 'supersede'].includes(message.type)) return;
      const item = { worker, message }; if (waiting.length) waiting.shift()(item); else pending.push(item);
    };
    worker.terminate = async () => { worker.emit('exit', 1); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'], compileMs: 0 }));
    return worker;
  };
  const finish = ({ worker, message }, marker) => worker.emit('message', { id: message.id, result: { tasks: [], marker, metrics: { availableCount: 0 }, presentation: { tasks: [] } }, evaluationMs: 0, timingMs: {} });
  const f = await fixture(t, { taskWorkerOptions: { workerFactory } }), a = await f.login('101'), b = await f.login('102');
  const aId = await f.picker('101'), bId = await f.picker('102');
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  t.after(() => { left.req.destroy(); right.req.destroy(); });
  const ended = new Promise(resolve => left.res.once('end', resolve));
  const aRequest = f.send('/api/tasks?memberId=owner', a), first = await next(); assert.equal(first.message.pickerId, aId);
  const bRequest = f.send('/api/tasks?memberId=owner', b); await settle();
  const deletion = f.send('/api/picker/delete', a, { body: {} }); await ended;
  assert.ok(workers.some(w => w.messages.some(m => m.type === 'cancel' && m.pickerId === aId)));
  const count = Buffer.concat(left.chunks).length;
  finish(first, 'Player 1'); // The result arrives after the account/picker fence.
  const second = await next(); assert.equal(second.message.pickerId, bId); finish(second, 'Player 2');
  assert.notEqual((await aRequest).status, 200); assert.equal((await bRequest).status, 200);
  assert.equal((await deletion).status, 200); await settle();
  assert.equal(Buffer.concat(left.chunks).length, count); assert.equal(right.res.readableEnded, false);
  assert.equal((await f.send('/api/state', b)).status, 200);
});

test('the durable tombstone fences streams and admission before registry cleanup can finish', { timeout: 10000 }, async t => {
  const tombstoned = Promise.withResolvers(), release = Promise.withResolvers(); let armed = false;
  const f = await fixture(t, { crashPoint: async point => {
    if (armed && point === 'picker-tombstoned') { tombstoned.resolve(); await release.promise; }
  } });
  t.after(() => release.resolve());
  const a = await f.login('101'), b = await f.login('102');
  const key = (await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Player 1' } })).json().key;
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  t.after(() => { left.req.destroy(); right.req.destroy(); });
  const ended = new Promise(resolve => left.res.once('end', resolve));
  armed = true; const deletion = f.send('/api/picker/delete', a, { body: {} });
  try {
    await tombstoned.promise; await ended;
    assert.equal((await f.send('/api/state', a)).status, 401);
    assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 401);
    const before = Buffer.concat(left.chunks).length;
    assert.equal((await f.note(b, 'Player 2', 0)).status, 200); await settle();
    assert.equal(right.res.readableEnded, false); assert.equal(Buffer.concat(left.chunks).length, before);
  } finally { release.resolve(); }
  assert.equal((await deletion).status, 200);
});

test('account deletion ends its sessions in other memberships without closing that picker or its owner streams', { timeout: 10000 }, async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  const aId = await f.picker('101'), bId = await f.picker('102'), doc = await f.registry();
  const accountId = doc.accounts.find(row => row.defaultPickerId === aId).id;
  assert.equal((await f.send('/api/state', b)).status, 200); await f.app().close();
  const registry = await openRegistry(f.multiPicker);
  await registry.attachMembership(accountId, { pickerId: bId, memberId: 'owner', role: 'player' }); await registry.close();
  const file = path.join(f.root, 'legacy', 'invites.json'), issuer = JSON.parse(await readFile(file)), token = 'z'.repeat(43);
  issuer.sessions.push({ tokenHash: hash(token), accountId, pickerId: bId, provider: 'discord', inviteId: null, expiresAt: '2099-01-01T00:00:00.000Z' });
  await writeFile(file, JSON.stringify(issuer)); await f.restart();
  const peer = 'duo_access=' + token;
  assert.equal((await f.send('/api/state', peer)).status, 200);
  const left = await f.send('/api/events', peer, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  t.after(() => { left.req.destroy(); right.req.destroy(); });
  const ended = new Promise(resolve => left.res.once('end', resolve));
  assert.equal((await f.send('/api/account/delete', a, { body: {} })).status, 200); await ended;
  assert.equal(right.res.readableEnded, false); assert.equal((await f.send('/api/state', peer)).status, 401);
  assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
  assert.equal((await f.registry()).pickers.find(row => row.id === bId).lifecycle, 'active');
});
