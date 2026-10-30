import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
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
async function fixture(t, { initiallyEnabled = true, beforeCommit, ...limits } = {}) {
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
      onRequestHandler: value => { handler = value; }, beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
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

test('extra sessions share expensive account limits and unrelated accounts share the global budget', async t => {
  const f = await fixture(t, { expensivePerAccount: 2, expensivePerPicker: 10, expensiveGlobal: 3, registrationsPerAccount: 10 });
  const a = await f.login('101'), a2 = await f.login('101'), b = await f.login('102');
  for (const cookie of [a, a2]) assert.equal((await f.send('/api/tasks?memberId=owner', cookie)).status, 200);
  let denied = await f.send('/api/tasks?memberId=owner', a2);
  assert.equal(denied.status, 429); assert.ok(Number(denied.headers['retry-after']) >= 1);
  assert.equal((await f.send('/api/tasks?memberId=owner', b)).status, 200);
  denied = await f.send('/api/tasks?memberId=owner', b); assert.equal(denied.status, 429);
});

test('event streams share account and global quotas across sessions and release on disconnect', async t => {
  const f = await fixture(t, { streamsPerAccount: 1, streamsPerPicker: 3, streamsGlobal: 2, registrationsPerAccount: 10 });
  const a = await f.login('101'), a2 = await f.login('101'), b = await f.login('102'), c = await f.login('103');
  const streams = [];
  t.after(() => { for (const stream of streams) { stream.req.destroy(); stream.res.destroy(); } });
  streams.push(await f.send('/api/events', a, { stream: true })); assert.equal(streams[0].status, 200);
  const denied = await f.send('/api/events', a2); assert.equal(denied.status, 429); assert.ok(denied.headers['retry-after']);
  streams.push(await f.send('/api/events', b, { stream: true }));
  assert.equal((await f.send('/api/events', c)).status, 429);
  streams[0].req.destroy(); streams[0].res.destroy();
  await new Promise(resolve => setTimeout(resolve, 20));
  streams.push(await f.send('/api/events', a2, { stream: true })); assert.equal(streams.at(-1).status, 200);
});

test('plugin key counts survive context eviction and server restart, and revocation frees the global slot', async t => {
  const f = await fixture(t, { pluginKeysPerAccount: 1, pluginKeysGlobal: 2, maxOpenContexts: 2 });
  const a = await f.login('101'), b = await f.login('102'), c = await f.login('103');
  const create = cookie => f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Synthetic' } });
  const first = await create(a); assert.equal(first.status, 201, first.text);
  assert.equal((await create(a)).status, 429);
  assert.equal((await create(b)).status, 201);
  await f.restart();
  assert.equal((await create(a)).status, 429);
  assert.equal((await create(c)).status, 429);
  const revoke = await f.send('/api/game-plugin/keys/' + first.json().record.id + '/revoke', a, { body: {} });
  assert.equal(revoke.status, 200, revoke.text);
  assert.equal((await create(c)).status, 201);
});

test('extra plugin keys cannot increase account traffic and another account cannot exceed the global traffic budget', async t => {
  const f = await fixture(t, { pluginRequestsPerAccount: 2, pluginRequestsGlobal: 3, pluginWindowMs: 60000 });
  const a = await f.login('101'), b = await f.login('102');
  const create = cookie => f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Synthetic' } });
  const keys = [(await create(a)).json().key, (await create(a)).json().key, (await create(b)).json().key];
  const status = key => f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } });
  assert.equal((await status(keys[0])).status, 200); assert.equal((await status(keys[1])).status, 200);
  const denied = await status(keys[1]); assert.equal(denied.status, 429); assert.ok(denied.headers['retry-after']);
  assert.equal((await status(keys[2])).status, 200); assert.equal((await status(keys[2])).status, 429);
});

test('registration and provisioning limits reject with actionable retry responses', async t => {
  const f = await fixture(t, { registrationsPerAccount: 10, registrationsGlobal: 10, provisioningGlobal: 1 });
  await f.login('101');
  const response = await (await f.begin('102'))();
  assert.equal(response.status, 429); assert.ok(response.headers['retry-after']);
  assert.match(response.text, /Wait|wait/);
});

test('request byte quotas reject oversized bodies and aggregate admitted bodies across requests', async t => {
  const f = await fixture(t, { bodyBytesPerRequest: 512, bodyBytesPerAccount: 250, bodyBytesGlobal: 500 });
  const a = await f.login('101');
  const first = await f.note(a, 'one', 0); assert.equal(first.status, 200, first.text);
  const second = await f.note(a, 'two', 1); assert.equal(second.status, 200, second.text);
  const denied = await f.note(a, 'three', 2); assert.equal(denied.status, 429); assert.ok(denied.headers['retry-after']);
  const oversized = await f.note(a, 'x'.repeat(1024), 2); assert.equal(oversized.status, 429); assert.ok(oversized.headers['retry-after']);
});

test('percent-encoded sign-in routes share the sign-in start budget', async t => {
  const f = await fixture(t, { registrationsPerAccount: 1, registrationsGlobal: 1 });
  assert.equal((await f.send('/auth/discord')).status, 303);
  for (const route of ['/auth/discord', '/auth/%64iscord', '/auth/%67oogle']) {
    const denied = await f.send(route);
    assert.equal(denied.status, 429, route); assert.ok(denied.headers['retry-after']);
  }
});

test('provider-linking starts share the sign-in start budget', async t => {
  const f = await fixture(t, { registrationsPerAccount: 2, registrationsGlobal: 2 });
  const a = await f.login('101');
  assert.equal((await f.send('/auth/link/discord', a)).status, 303);
  const own = (await f.send('/api/session', a)).json().pickerId;
  for (const route of ['/auth/link/google', '/auth/link/%64iscord', '/auth/discord', `/pickers/${own}/auth/discord`, `/pickers/${own}/auth/link/%2567oogle`]) {
    const denied = await f.send(route, a);
    assert.equal(denied.status, 429, route); assert.ok(denied.headers['retry-after']);
  }
});

test('deleting a picker or an account releases its plugin key quota', async t => {
  const f = await fixture(t, { pluginKeysPerAccount: 1, pluginKeysGlobal: 2, registrationsPerAccount: 20, registrationsGlobal: 20 });
  const create = cookie => f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Synthetic' } });
  let a = await f.login('101');
  assert.equal((await create(a)).status, 201); assert.equal((await create(a)).status, 429);
  assert.equal((await f.send('/api/picker/delete', a, { body: {} })).status, 200);
  a = await f.login('101');
  assert.equal((await create(a)).status, 201);
  const b = await f.login('102'); assert.equal((await create(b)).status, 201);
  assert.equal((await create(await f.login('103'))).status, 429);
  assert.equal((await f.send('/api/account/delete', b, { body: {} })).status, 200);
  assert.equal((await create(await f.login('103'))).status, 201);
});
