import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE',
  'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
  'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DEFAULTS_FILE']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const { snapshotPath } = await import('../app/storage/snapshot.mjs');
const { restoreServiceStopped } = await import('../scripts/linux/service-recovery.mjs');
const { readRelease } = await import('../scripts/linux/runtime.mjs');
const { inventory } = await import('../scripts/linux/files.mjs');
const origin = 'https://picker.example';
const proxy = { host: 'picker.example', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };
const subjects = [101, 102];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const definitions = { challenges: {}, chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] };

function request(base, route, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + route, { method: bytes === undefined ? 'GET' : 'POST', agent: false, headers: {
      ...(bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes), origin }), ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(),
        json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(bytes);
  });
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-audit-c1-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE'], previous = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  const grants = new Map(), access = new Map(); let codeId = 0, app, handler;
  const settings = { dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'),
    scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups'), minFreeBytes: 0,
    multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') } };
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant); assert.equal(hash(form.get('code_verifier')), Buffer.from(grant.challenge, 'base64url').toString('hex'));
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  async function start(target = settings) {
    app = await createServer({ ...target, dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      onRequestHandler: value => { handler = value; }, predictionPrewarm: false, shutdownDeadlineMs: 500,
      rateLimits: { unauthenticated: 10000, expensivePerIdentity: 10000 } });
    await app.listen();
  }
  t.after(async () => {
    await app?.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of envKeys.entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  });
  await start();
  const send = (route, cookie, options = {}) => request(`http://127.0.0.1:${app.loopbackAddress().port}`, route,
    { ...options, headers: { ...proxy, ...(cookie ? { cookie } : {}), ...options.headers } });
  const privateSend = (route, body) => request(`http://127.0.0.1:${app.address().port}`, route,
    { body, headers: { authorization: 'Bearer ' + app.store.getAccessToken(), origin: `http://127.0.0.1:${app.address().port}` } });
  async function begin(subject) {
    const response = await send('/auth/discord'); assert.equal(response.status, 303);
    const auth = new URL(response.headers.location), code = String(++codeId);
    grants.set(code, { subject: String(subject), challenge: auth.searchParams.get('code_challenge') });
    return async () => {
      const callback = await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,
        response.headers['set-cookie'][0].split(';')[0]);
      assert.equal(callback.status, 303, callback.text);
      return callback.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
    };
  }
  const login = async subject => (await begin(subject))();
  const session = async cookie => { const r = await send('/api/session', cookie); assert.equal(r.status, 200, r.text); return r.json(); };
  const note = (cookie, text) => send('/api/command', cookie, { body: { expectedRevision: 0,
    command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text } } });
  async function deleteAccount(cookie) {
    const confirmation = await send('/api/session', cookie, { headers: { 'x-account-action': 'delete' } });
    return send('/api/account/delete', cookie, { body: { accountDeletionToken: confirmation.json().accountDeletionToken } });
  }
  async function capture() {
    const id = randomUUID(), response = await privateSend('/api/operator/service-snapshot', { id });
    assert.equal(response.status, 200, response.text); return snapshotPath(settings.dataDir, id);
  }
  async function restore(backup) {
    await app.close();
    const targetRoot = path.join(root, 'restored'); await mkdir(targetRoot);
    const target = { ...settings, dataDir: path.join(targetRoot, 'legacy'), controlDir: path.join(targetRoot, 'control'),
      scratchRoot: path.join(targetRoot, 'scratch'), backupDir: path.join(targetRoot, 'backups'),
      multiPicker: { ...settings.multiPicker, registryDir: path.join(targetRoot, 'registry'), pickerRoot: path.join(targetRoot, 'pickers') } };
    // Pin a tiny synthetic release for the injected portable probe. The restarted
    // real server below validates the installed gameplay and dataset bindings.
    const coreRoot = path.join(root, 'release'); await mkdir(coreRoot);
    await writeFile(path.join(coreRoot, 'marker'), 'synthetic-release');
    const configFile = path.join(root, 'config.json'), configBytes = JSON.stringify({ coreRoot, dataDir: target.dataDir });
    await writeFile(configFile, configBytes);
    const pointerFile = path.join(root, 'current.json');
    await writeFile(pointerFile, JSON.stringify({ config: { path: configFile, sha256: hash(configBytes) } }));
    const release = await readRelease(pointerFile, target.dataDir);
    const result = await restoreServiceStopped({ settings: target, backup, release, assertStopped: async () => {},
      probe: async (_release, dir) => JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')) });
    await start(target); return { result, target };
  }
  return { root, settings, send, login, begin, session, note, deleteAccount, capture, restore, handler: () => handler };
}

for (const deletion of ['none', 'picker', 'account']) {
  test(`audit C1: service restore with ${deletion === 'none' ? 'no' : deletion} deletion never assigns old pickers by login order`, { timeout: 20000 }, async t => {
    const f = await fixture(t), cookies = await Promise.all(subjects.map(f.login));
    const sessions = [];
    for (const cookie of cookies) sessions.push(await f.session(cookie));
    for (const [i, cookie] of cookies.entries()) assert.equal((await f.note(cookie, 'Player ' + (i + 1))).status, 200);
    const key = (await f.send('/api/game-plugin/keys', cookies[0], { body: { memberId: 'owner', label: 'Player 1' } })).json().key;
    const backup = await f.capture();
    const checkpoint = JSON.parse(await readFile(path.join(backup, 'registry.json'), 'utf8'));
    assert(checkpoint.accounts.every(a => a.identities.length === 0)); assert.deepEqual(checkpoint.capabilities, []);
    const exported = await inventory(path.join(backup, 'pickers'));
    assert(!exported.some(row => /(?:accounts|invites|plugin-keys|overlays)\.json|access-token/.test(row.path)));
    if (deletion !== 'none') {
      const response = deletion === 'account' ? await f.deleteAccount(cookies[0]) : await f.send('/api/picker/delete', cookies[0], { body: {} });
      assert.equal(response.status, 200, response.text);
    }
    const { result, target } = await f.restore(backup);
    assert.equal(result.credentialsRestored, 0); assert.equal(result.excluded, deletion === 'none' ? 0 : 1);
    for (const cookie of cookies) assert.equal((await f.send('/api/state', cookie)).status, 401);
    assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { authorization: 'Bearer ' + key } })).status, 401);
    // Reverse the provider return order, and try explicit foreign selectors too.
    const fresh = [];
    for (const subject of [...subjects].reverse()) {
      const cookie = await f.login(subject), session = await f.session(cookie); fresh.push(session);
      assert(!sessions.some(old => old.accountId === session.accountId || old.pickerId === session.pickerId));
      const state = (await f.send('/api/state', cookie)).json().state;
      assert.equal(state.revision, 0); assert.equal(state.members[0].notes, undefined);
      for (const old of sessions) assert.equal((await f.send('/api/state?pickerId=' + old.pickerId, cookie)).status, 403);
    }
    assert.notEqual(fresh[0].accountId, fresh[1].accountId); assert.notEqual(fresh[0].pickerId, fresh[1].pickerId);
    const document = JSON.parse(await readFile(path.join(target.multiPicker.registryDir, 'registry.json'), 'utf8'));
    for (const old of sessions) {
      const picker = document.pickers.find(p => p.id === old.pickerId);
      assert.equal(picker.lifecycle, old === sessions[0] && deletion !== 'none' ? 'deleted' : 'active');
      if (picker.lifecycle === 'active') {
        const saved = JSON.parse(await readFile(path.join(target.multiPicker.pickerRoot, old.pickerId, 'state.json'), 'utf8'));
        assert.equal(saved.state.members[0].notes['12341'], 'Player ' + (sessions.indexOf(old) + 1));
      }
    }
    if (deletion !== 'none') await assert.rejects(readFile(path.join(target.multiPicker.pickerRoot, sessions[0].pickerId, 'state.json')), { code: 'ENOENT' });
    if (deletion === 'account') assert(!document.accounts.some(a => a.id === sessions[0].accountId));
  });
}

test('audit C1: a plugin report whose body started before key revocation cannot update progress', { timeout: 10000 }, async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]);
  const created = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 1' } });
  assert.equal(created.status, 201); const { key, record } = created.json();
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const body = Buffer.from(JSON.stringify({ v: 1, seq: 1, sentAt: new Date().toISOString(), position: { x: 50, z: 50, floor: 0 }, skills: { attack: { level: 50, xp: 101333 } } }));
  const incoming = Readable.from((async function* () { yield body.slice(0, 1); started.resolve(); await release.promise; yield body.slice(1); })());
  Object.assign(incoming, { method: 'POST', url: '/api/plugin/v1/report', socket: { remoteAddress: '127.0.0.1' },
    headers: { ...proxy, authorization: 'Bearer ' + key, 'content-type': 'application/json', origin } });
  const chunks = [], headers = new Map();
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.getHeader = name => headers.get(name.toLowerCase());
  response.writeHead = (status, values = {}) => { response.statusCode = status; response.headersSent = true;
    for (const [name, value] of Object.entries(values)) response.setHeader(name, value); return response; };
  const pending = f.handler()(incoming, response, { host: '127.0.0.1', ingressRole: 'public' });
  try {
    await Promise.race([started.promise, pending.then(() => { throw new Error('Report ended before its body was read.'); })]);
    const revoked = await f.send('/api/game-plugin/keys/' + record.id + '/revoke', cookie, { body: {} });
    assert.equal(revoked.status, 200, revoked.text);
  } finally { release.resolve(); }
  await pending;
  assert.equal(response.statusCode, 401, Buffer.concat(chunks).toString());
  const state = (await f.send('/api/state', cookie)).json().state;
  assert.equal(state.revision, 0);
  const progress = (await f.send('/api/game-plugin', cookie)).json();
  assert.deepEqual(progress.positions, []);
  assert.equal((await f.send('/api/game-plugin/review?memberId=owner', cookie)).json().preview, null);
  const replacement = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 1' } });
  assert.equal(replacement.status, 201);
  const accepted = await f.send('/api/plugin/v1/report', null, { body: JSON.parse(body), headers: { authorization: 'Bearer ' + replacement.json().key } });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal((await f.send('/api/game-plugin', cookie)).json().positions.length, 1);
});

test('audit C1: an OAuth flow begun before account deletion creates a fresh principal', { timeout: 10000 }, async t => {
  const f = await fixture(t), cookie = await f.login(subjects[0]), old = await f.session(cookie);
  assert.equal((await f.note(cookie, 'Player 1')).status, 200);
  const finish = await f.begin(subjects[0]);
  assert.equal((await f.deleteAccount(cookie)).status, 200);
  const freshCookie = await finish(), fresh = await f.session(freshCookie);
  assert.notEqual(fresh.accountId, old.accountId); assert.notEqual(fresh.pickerId, old.pickerId);
  assert.equal((await f.send('/api/state', cookie)).status, 401);
  const state = (await f.send('/api/state', freshCookie)).json().state;
  assert.equal(state.revision, 0); assert.equal(state.members[0].notes, undefined);
});
