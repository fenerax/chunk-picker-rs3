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

test('affected picker and account deletions refuse without changing maps, sessions or keys', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  await f.note(a, 'Player 1', 0); await f.note(b, 'Player 2', 0);
  const id = await f.picker('101'), directory = path.join(f.multiPicker.pickerRoot, id);
  const key = (await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Sample' } })).json().key;
  const stream = await f.send('/api/events', a, { stream: true }); t.after(() => stream.req.destroy());
  const before = await Promise.all(['state.json', 'plugin-keys.json'].map(name => readFile(path.join(directory, name))));
  const registryBefore = await f.registry();
  for (const route of ['/api/picker/delete', '/api/account/delete']) {
    const response = await f.send(route, a, { body: {} }); assert.equal(response.status, 409, response.text);
    assert.match(response.json().message, /unavailable until character deletion/);
  }
  assert.deepEqual(await f.registry(), registryBefore);
  assert.deepEqual(await Promise.all(['state.json', 'plugin-keys.json'].map(name => readFile(path.join(directory, name)))), before);
  assert.equal(stream.res.readableEnded, false);
  assert.equal((await f.send('/api/state', a)).status, 200);
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
  assert.equal((await f.send('/api/session', a)).json().ownerControls.deletionPaused, true);
  await f.restart(); assert.equal((await f.send('/api/state', a)).json().state.members[0].notes['12341'], 'Player 1');
});

test('deletion retains credential, origin and target validation before any mutation', async t => {
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

test('legacy character account deletion is refused and preserves shared gameplay and access', async t => {
  const f = await fixture(t, { initiallyEnabled: false });
  const invite = (await f.private('/api/invites', { body: { label: 'Player 1', memberId: 'one' } })).json();
  const join = await f.private(new URL(invite.link).pathname, { headers: { Authorization: '' } });
  const a = await f.login('101', join.headers['set-cookie'][0].split(';')[0]); await f.restart();
  const before = hash((await f.private('/api/backup')).text);
  const response = await f.send('/api/account/delete', a, { body: {} }); assert.equal(response.status, 409, response.text);
  assert.equal(hash((await f.private('/api/backup')).text), before);
  assert.equal((await f.send('/api/state', a)).status, 200);
});

test('option-absent confirmation headers add no token, deletion route or retention requirement', async t => {
  const f = await fixture(t, { initiallyEnabled: false, backupRetentionMs: -1 });
  const before = await f.private('/api/session');
  const confirmed = await f.private('/api/session', { headers: { 'X-Account-Action': 'delete' } });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.text, before.text);
  assert.equal(Object.hasOwn(confirmed.json(), 'accountDeletionToken'), false);
  for (const route of ['/api/picker/delete', '/api/account/delete']) assert.equal((await f.private(route, { body: {} })).status, 404);
  assert.equal(await exists(f.multiPicker.registryDir), false);
});
