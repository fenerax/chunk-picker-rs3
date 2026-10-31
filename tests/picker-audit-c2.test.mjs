import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE',
  'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
  'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DEFAULTS_FILE']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const origin = 'https://picker.example';
const subjects = [101, 102, 103];
const definitions = { challenges: {}, chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const pending = Symbol('pending');
const within = (promise, ms = 250) => Promise.race([promise, delay(ms, pending)]);

async function fixture(t, limits = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-audit-c2-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE'];
  const previous = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  const grants = new Map(), access = new Map(), sockets = new Set(); let nextCode = 0, app;
  t.after(async () => {
    for (const req of sockets) req.destroy();
    await app?.close(); await rm(root, { recursive: true, force: true });
    for (const [index, key] of envKeys.entries()) {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }
  });
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant);
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), grant.challenge);
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'),
    tombstoneDir: path.join(root, 'tombstones'), ...limits };
  app = await createServer({ dataset: selectedDataset, dataDir: path.join(root, 'legacy'), definitions, taskMap: {},
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
    multiPicker, predictionPrewarm: false, shutdownDeadlineMs: 500 });
  await app.listen();
  function start(route, cookie, { body, raw, headers = {}, method = body === undefined && raw === undefined ? 'GET' : 'POST', hold = false, stream = false } = {}) {
    const bytes = raw ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
    let req;
    const result = new Promise((resolve, reject) => {
      req = http.request(`http://127.0.0.1:${app.loopbackAddress().port}${route}`, { method, agent: false, headers: {
        Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}), ...headers,
      } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        const value = () => ({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(),
          json: () => JSON.parse(Buffer.concat(chunks).toString()), res, req });
        if (stream) resolve(value()); else res.on('end', () => resolve(value()));
      });
      sockets.add(req); req.on('close', () => sockets.delete(req)); req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Synthetic audit request timed out')));
      if (hold) { req.flushHeaders(); if (bytes) req.write(bytes); } else req.end(bytes);
    });
    // Held uploads deliberately abort during cleanup; their rejection is observed.
    result.catch(() => {});
    return { req, result };
  }
  const send = (route, cookie, options) => start(route, cookie, options).result;
  async function login(subject) {
    const response = await send('/auth/discord'); assert.equal(response.status, 303, response.text);
    const auth = new URL(response.headers.location), code = String(++nextCode);
    grants.set(code, { subject: String(subject), challenge: auth.searchParams.get('code_challenge') });
    const callback = await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,
      response.headers['set-cookie'][0].split(';')[0]);
    assert.equal(callback.status, 303, callback.text);
    return callback.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  const registry = async () => JSON.parse(await readFile(path.join(multiPicker.registryDir, 'registry.json'), 'utf8'));
  return { app, root, start, send, login, registry };
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(10); }
  assert.fail(label);
}
async function slowImport(f, cookie, other) {
  const upload = f.start('/api/restore/preview', cookie, { method: 'POST', raw: Buffer.from('{'), hold: true,
    headers: { 'Content-Length': 2 } });
  // Same-picker admission is a barrier proving that its body reader is running.
  await waitFor(async () => {
    const response = await f.send('/api/restore/preview', cookie, { body: {} });
    return response.status === 503 && /Another backup/.test(response.json().message);
  },
    'the held upload must acquire picker-local admission');
  assert.equal((await f.send('/api/state', other)).status, 200, 'unrelated reads initially work');
  return upload;
}

test('C2 sizes: declared route limits refuse bodies before mutation', async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]);
  for (const [route, bytes, expected] of [
    ['/api/command', 1024 * 1024 + 1, 413], ['/api/game-plugin/keys', 8193, 413],
    ['/api/sandbox/evaluate', 64 * 1024 + 1, 413], ['/api/picker/delete', 8193, 413],
    ['/api/restore/preview', 256 * 1024 * 1024 + 1, 429],
  ]) {
    // Only the declared length is oversized: a peer that resets after an early 413 (Windows) must not race the reply.
    const response = await f.send(route, cookie, { raw: Buffer.alloc(1, 32),
      headers: { 'Content-Length': bytes } });
    assert.equal(response.status, expected, route);
  }
  assert.equal((await f.send('/api/state', cookie)).json().state.revision, 0);
});

test('MP12C2-1: a one-byte unfinished upload must not monopolise imports for other accounts',
  async t => {
    const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]);
    const beforeAt = performance.now(), baseline = await f.send('/api/restore/preview', b, { body: {} });
    const beforeMs = performance.now() - beforeAt; assert.equal(baseline.status, 422);
    const upload = await slowImport(f, a, b);
    const started = performance.now(); await delay(250);
    const deniedAt = performance.now(), denied = await f.send('/api/restore/preview', b, { body: {} });
    const duringMs = performance.now() - deniedAt, abortedAt = performance.now();
    upload.req.destroy();
    await waitFor(async () => (await f.send('/api/restore/preview', b, { body: {} })).status === baseline.status, 'import slot releases on abort');
    t.diagnostic(JSON.stringify({ bytesSent: 1, baseline: baseline.status, during: denied.status,
      beforeMs, duringMs, recoveryMs: performance.now() - abortedAt,
      heldMs: performance.now() - started, retryAfter: denied.headers['retry-after'] }));
    assert.equal(denied.status, baseline.status, 'one account must not exclude every other importer while waiting for bytes');
  });

test('MP14: two unfinished uploads leave the global parser available to a third account', async t => {
  const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]), c = await f.login(subjects[2]);
  for (const cookie of [a, b, c]) assert.equal((await f.send('/api/state', cookie)).status, 200);
  const uploads = [await slowImport(f, a, c), await slowImport(f, b, c)];
  const baseline = await f.send('/api/restore/preview', c, { body: {} });
  assert.equal(baseline.status, 422);
  // Complete each previously slow body; both must still enter the parser.
  for (const upload of uploads) {
    upload.req.end('}'); assert.equal((await upload.result).status, baseline.status);
  }
});

test('MP14: import bodies time out on idle, renew on bytes, and release picker admission', async t => {
  const idleMs = 200, f = await fixture(t, { importBodyIdleMs: idleMs }), a = await f.login(subjects[0]);
  for (const route of ['/api/import', '/api/restore/preview']) {
    const upload = f.start(route, a, { method: 'POST', hold: true, raw: Buffer.from('{'), headers: { 'Content-Length': 8 } });
    await waitFor(async () => (await f.send(route, a, { body: {} })).status === 503, 'body reader admitted');
    // Total upload time exceeds the idle limit; arriving bytes renew the lease.
    for (let index = 0; index < 3; index++) {
      await delay(idleMs * 0.6); upload.req.write(' ');
      assert.equal(await within(upload.result, 10), pending);
    }
    const response = await upload.result;
    assert.equal(response.status, 408); assert.equal(response.headers.connection, 'close');
    assert.notEqual((await f.send(route, a, { body: {} })).status, 503, 'timed-out reader releases the local guard');
  }
  const empty = f.start('/api/import/preview', a, { method: 'POST', hold: true,
    headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } });
  assert.equal((await empty.result).status, 408, 'the idle deadline also covers zero-byte chunked uploads');
  assert.notEqual((await f.send('/api/import/preview', a, { body: {} })).status, 503);
  assert.equal((await f.send('/api/state', a)).json().state.revision, 0);
});

test('MP12C2-2: deleting a picker with an unfinished upload must not block unrelated picker reads',
  async t => {
    const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]);
    const id = (await f.send('/api/session', a)).json().pickerId;
    const beforeAt = performance.now(), baseline = await f.send('/api/state', b);
    const beforeMs = performance.now() - beforeAt; assert.equal(baseline.status, 200);
    const upload = await slowImport(f, a, b);
    const deletion = f.send('/api/picker/delete', a, { body: {} });
    await waitFor(async () => (await f.registry()).pickers.find(p => p.id === id)?.lifecycle !== 'active', 'deletion must be durably fenced');
    // Deletion must finish without the attacker voluntarily ending the upload.
    assert.equal((await within(deletion, 1000)).status, 200);
    assert.equal(await upload.result.then(() => false, () => true), true, 'the fenced picker upload is cancelled');
    const started = performance.now(), reading = f.send('/api/state', b);
    const during = await within(reading), abortedAt = performance.now();
    upload.req.destroy();
    assert.equal((await deletion).status, 200);
    const recovered = await reading, recoveryMs = performance.now() - abortedAt; assert.equal(recovered.status, 200);
    assert.equal((await f.send('/api/state', b)).status, 200);
    t.diagnostic(JSON.stringify({ bytesSent: 1, blocked: during === pending, recovered: recovered.status,
      beforeMs, blockedMs: abortedAt - started, recoveryMs }));
    assert.notEqual(during, pending, 'deletion must not hold the server-wide acquisition queue behind its upload');
  });

test('C2 streams: sixteen SSE leases span sessions, refuse excess, release, and leave another account room', async t => {
  const f = await fixture(t), a = await f.login(subjects[0]), second = await f.login(subjects[0]), b = await f.login(subjects[1]);
  const streams = [];
  for (let index = 0; index < 16; index++) {
    const response = await f.send('/api/events', index % 2 ? second : a, { stream: true });
    assert.equal(response.status, 200); streams.push(response);
  }
  const denied = await f.send('/api/events', second);
  assert.equal(denied.status, 429); assert.ok(Number(denied.headers['retry-after']) >= 1);
  const other = await f.send('/api/events', b, { stream: true }); assert.equal(other.status, 200);
  assert.equal((await f.send('/api/state', b)).status, 200);
  streams[0].req.destroy(); streams[0].res.destroy();
  let reopened;
  await waitFor(async () => { reopened = await f.send('/api/events', second, { stream: true }); return reopened.status === 200; }, 'disconnect releases one stream lease');
  assert.equal((await f.send('/api/events', a)).status, 429);
  // Overlay creation requires private administrator authority, unavailable to this attacker.
  assert.equal((await f.send('/api/overlays', a, { body: { widget: 'count', player: 'owner' } })).status, 403);
});

test('C2 context churn: one account cannot turn selectors or repeated sessions into additional resident pickers', async t => {
  const f = await fixture(t, { maxOpenContexts: 3 });
  const a = await f.login(subjects[0]), b = await f.login(subjects[1]), again = await f.login(subjects[0]);
  const own = (await f.send('/api/session', a)).json().pickerId;
  const other = await f.send('/api/events', b, { stream: true }); assert.equal(other.status, 200);
  for (let index = 0; index < 20; index++) {
    assert.equal((await f.send('/api/state', index % 2 ? a : again)).status, 200);
    const fake = 'p_' + index.toString(16).padStart(32, '0');
    assert.equal((await f.send('/api/state?pickerId=' + fake, a)).status, 403);
    assert.equal(other.res.readableEnded, false, 'the other picker stream survives request churn');
  }
  const document = await f.registry();
  assert.equal(document.pickers.length, 3, 'one legacy picker and two defaults');
  assert.equal(document.accounts.find(account => account.defaultPickerId === own).memberships.length, 1);
  assert.equal((await f.send('/api/session', again)).json().pickerId, own);
});

test('C2 sign-in: default client budget covers encoded, linking and picker-prefixed start routes', async t => {
  const f = await fixture(t), a = await f.login(subjects[0]), b = await f.login(subjects[1]);
  const id = (await f.send('/api/session', a)).json().pickerId;
  assert.equal((await f.send('/auth/discord', a)).status, 303, 'third sign-in start fits default client budget');
  for (const route of ['/auth/discord', '/auth/%64iscord', '/auth/google', '/auth/link/discord',
    `/pickers/${id}/auth/discord`, `/pickers/${id}/auth/link/%64iscord`]) {
    const denied = await f.send(route, a);
    assert.equal(denied.status, 429, route); assert.ok(Number(denied.headers['retry-after']) >= 1);
  }
  assert.equal((await f.send('/api/state', b)).status, 200, 'sign-in exhaustion does not block another signed-in picker');
  assert.equal((await f.registry()).accounts.length, 2);
});
