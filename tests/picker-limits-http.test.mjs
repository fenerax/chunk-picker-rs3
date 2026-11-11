import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm, writeFile, readFile, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createManualClock } from './helpers/manual-clock.mjs';
import { COLD_OPEN_ADMISSION } from '../app/picker-admission.mjs';
import { withDirectoryBarriers } from '../app/storage/snapshot.mjs';

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
// These tests measure quota decisions, not the shared PC's cold-open latency.
// Deadline behavior is exercised separately by advancing this same clock.
async function fixture(t, { initiallyEnabled = true, beforeCommit, taskWorkerOptions, schedulingClock = createManualClock(), ...limits } = {}) {
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
  const admissionEvents = [], observeAdmission = limits.onAdmission;
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'), ...limits,
    onAdmission(event) { admissionEvents.push(event); observeAdmission?.(event); } };
  let app, handler;
  const start = async (multi) => {
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      onRequestHandler: value => { handler = value; }, beforeCommit, taskWorkerOptions, schedulingClock, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
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
  return { root, send, login, begin, picker, registry, multiPicker, admissionEvents, clock: schedulingClock, handler: () => handler,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async edit => { await app.close(); await edit?.(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, expectedRevision: revision, ...extra } }),
  };
}

// Keep the HTTP/authentication/limiter/scheduler path, with deterministic task
// completion instead of native calculator startup and execution deadlines.
function quotaCalculator(calculations) {
  return () => {
    const worker = new EventEmitter();
    worker.postMessage = message => {
      if (message.id === undefined || message.type !== 'evaluate') return;
      calculations.push(message.pickerId);
      queueMicrotask(() => worker.emit('message', { id: message.id, evaluationMs: 0,
        result: { tasks: [], metrics: { availableCount: 0 }, syntheticPickerId: message.pickerId } }));
    };
    worker.terminate = async () => { worker.emit('exit', 0); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], supports: ['evaluate'] }));
    return worker;
  };
}

test('extra sessions share expensive account limits and unrelated accounts share the global budget', async t => {
  const calculations = [], clock = createManualClock();
  const f = await fixture(t, { expensivePerAccount: 2, expensivePerPicker: 10, expensiveGlobal: 3, registrationsPerAccount: 10,
    schedulingClock: clock, taskWorkerOptions: { workerFactory: quotaCalculator(calculations), idleClock: clock, deadlineClock: clock },
  });
  const a = await f.login('101'), a2 = await f.login('101'), b = await f.login('102');
  const aPicker = await f.picker('101'), bPicker = await f.picker('102');
  const expectTasks = async (cookie, expected, pickerId) => {
    const response = await f.send('/api/tasks?memberId=owner', cookie);
    assert.equal(response.status, expected, JSON.stringify({ text: response.text, admission: f.admissionEvents }));
    if (expected === 200) assert.equal(response.json().syntheticPickerId, pickerId);
    else assert.ok(Number(response.headers['retry-after']) >= 1);
  };
  for (const cookie of [a, a2]) {
    await expectTasks(cookie, 200, aPicker);
  }
  await expectTasks(a2, 429);
  await expectTasks(b, 200, bPicker);
  await expectTasks(b, 429);
  assert.deepEqual(new Set(calculations), new Set([aPicker, bPicker]));
  assert.equal(f.admissionEvents.filter(event => event.event === 'completed').length, 2);
  assert.equal(f.admissionEvents.some(event => event.event === 'deadline'), false);
});

test('a held cold open returns the admission deadline 503 before charging task quota and releases its lease', async t => {
  const release = Promise.withResolvers(), held = Promise.withResolvers(), started = Promise.withResolvers(), released = Promise.withResolvers();
  t.after(() => release.resolve());
  const clock = createManualClock(), calculations = [];
  const f = await fixture(t, { expensivePerAccount: 1, expensiveGlobal: 1, schedulingClock: clock,
    taskWorkerOptions: { workerFactory: quotaCalculator(calculations), idleClock: clock, deadlineClock: clock },
    onAdmission(event) {
      if (event.event === 'started') started.resolve();
      if (event.event === 'released') released.resolve();
    },
  });
  const cookie = await f.login('101'), pickerId = await f.picker('101'), before = await f.registry();
  const directory = await realpath(path.join(f.multiPicker.pickerRoot, pickerId));
  const barrier = withDirectoryBarriers([directory], async () => { held.resolve(); await release.promise; });
  try {
    await Promise.race([held.promise, barrier.then(() => { throw new Error('Cold-open barrier was not held.'); })]);
    const request = f.send('/api/tasks?memberId=owner', cookie);
    await Promise.race([started.promise, request.then(response => { throw new Error(`Request bypassed the barrier: ${response.status} ${response.text}`); })]);
    await clock.advance(COLD_OPEN_ADMISSION.deadlineMs);
    const response = await request;
    assert.equal(response.status, 503, response.text);
    assert.match(response.text, /Picker admission deadline/);
    assert.equal(response.headers['retry-after'], '1');
    assert.deepEqual(calculations, []);
    assert.deepEqual(await f.registry(), before);
    assert.equal(f.admissionEvents.filter(event => event.event === 'deadline').length, 1);
  } finally {
    release.resolve(); await barrier;
    if (f.admissionEvents.some(event => event.event === 'started')) await released.promise;
  }
  const success = await f.send('/api/tasks?memberId=owner', cookie);
  assert.equal(success.status, 200, success.text);
  assert.deepEqual(calculations, [pickerId]);
  assert.equal((await f.send('/api/tasks?memberId=owner', cookie)).status, 429);
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

for (const [name, options, message] of [
  ['beta', { betaPickerCap: 2 }, /beta is full/],
  ['login', { caps: { accounts: 1 } }, /login account limit/],
  ['picker', { caps: { pickers: 2 } }, /picker limit/],
]) test(`${name} capacity refusal reaches sign-in clearly and preserves existing maps and registry across restart`, async t => {
  const f = await fixture(t, { ...options, registrationsPerAccount: 20, registrationsGlobal: 20 });
  const existing = await f.login('101');
  assert.equal((await f.note(existing, 'Synthetic retained map', 0)).status, 200);
  const before = await f.registry(), ledgerFile = path.join(f.multiPicker.tombstoneDir, 'ledger.json');
  const ledger = await readFile(ledgerFile, 'utf8');
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const response = await (await f.begin('102'))();
    assert.equal(response.status, 409, response.text); assert.match(response.text, message);
    assert.deepEqual(await f.registry(), before); assert.equal(await readFile(ledgerFile, 'utf8'), ledger);
    const state = await f.send('/api/state', existing);
    assert.equal(state.status, 200); assert.match(state.text, /Synthetic retained map/);
  }
});

test('the member key limit remains three when the login allowance is thirty', async t => {
  const f = await fixture(t, { pluginKeysPerAccount: 30 });
  const cookie = await f.login('101');
  const create = () => f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Synthetic' } });
  const records = [];
  for (let n = 0; n < 3; n++) { const response = await create(); assert.equal(response.status, 201, response.text); records.push(response.json()); }
  await f.restart();
  const denied = await create(); assert.equal(denied.status, 429); assert.match(denied.text, /character.*plugin key limit/);
  for (const { key } of records) {
    assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  }
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

test('key create/revoke attempts share a login budget before any durable mutation, including duplicate revokes', async t => {
  const f = await fixture(t, { keyChangesPerAccount: 4, keyChangesPerMember: 4 });
  const cookie = await f.login('101');
  const create = () => f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Synthetic' } });
  const first = await create(); assert.equal(first.status, 201);
  const id = first.json().record.id;
  const revoke = () => f.send(`/api/game-plugin/keys/${id}/revoke`, cookie, { body: {} });
  assert.equal((await revoke()).status, 200);
  assert.equal((await revoke()).status, 200);
  assert.equal((await create()).status, 201);
  const before = await f.registry();
  const keyFile = path.join(f.multiPicker.pickerRoot, await f.picker('101'), 'plugin-keys.json');
  const keyBytes = await readFile(keyFile, 'utf8');
  for (const send of [create, revoke]) {
    const denied = await send(); assert.equal(denied.status, 429);
    assert.ok(denied.headers['retry-after']); assert.match(denied.text, /Wait before creating or revoking/);
    assert.deepEqual(await f.registry(), before);
    assert.equal(await readFile(keyFile, 'utf8'), keyBytes);
  }
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
  assert.equal((await f.send('/api/account/delete', b, { body: { accountDeletionToken: (await f.send('/api/session', b, { headers: { 'X-Account-Action': 'delete' } })).json().accountDeletionToken } })).status, 200);
  assert.equal((await create(await f.login('103'))).status, 201);
});
