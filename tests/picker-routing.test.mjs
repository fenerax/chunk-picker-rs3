import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
  let app;
  const start = async (multi) => {
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
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
  return { root, send, login, begin, picker, registry, multiPicker,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async () => { await app.close(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, expectedRevision: revision, ...extra } }),
  };
}

test('signed-in defaults start empty, reuse member/revision IDs, mutate, complete and reload independently', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  const ids = [await f.picker('101'), await f.picker('102')]; assert.notEqual(...ids);
  for (const cookie of [a, b]) {
    const state = (await f.send('/api/state', cookie)).json().state;
    assert.deepEqual(state.members.map(m => m.id), ['owner']); assert.deepEqual(state.members[0].unlocked, []);
    assert.deepEqual(state.members[0].completedTasks, []); assert.deepEqual(state.tasks, []);
  }
  for (const [cookie, text] of [[a, 'Player 1'], [b, 'Player 2']]) {
    let response = await f.note(cookie, text, 0); assert.equal(response.status, 200, response.text);
    response = await f.send('/api/command', cookie, { body: { expectedRevision: 1, command: { type: 'add-task', task: { id: 'rs3:task:synthetic', label: text, category: 'Custom' } } } });
    assert.equal(response.status, 200, response.text);
    response = await f.send('/api/command', cookie, { body: { expectedRevision: 2, command: { type: 'complete-task', memberId: 'owner', taskId: 'rs3:task:synthetic', completed: true } } });
    assert.equal(response.status, 200, response.text);
  }
  await f.restart();
  for (const [cookie, text] of [[a, 'Player 1'], [b, 'Player 2']]) {
    const response = await f.send('/api/state', cookie); assert.equal(response.status, 200, response.text);
    const state = response.json().state; assert.equal(state.revision, 3); assert.equal(state.members[0].notes['12341'], text);
    assert.deepEqual(state.members[0].completedTasks, ['rs3:task:synthetic']); assert.equal(state.tasks[0].label, text);
    const tasks = await f.send('/api/tasks?memberId=owner', cookie); assert.equal(tasks.status, 200, tasks.text);
  }
});

test('URL, header and body selectors cannot redirect command, reads, history, export, SSE or plugin credentials', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102'), other = await f.picker('102');
  for (const route of ['/api/tasks?memberId=owner&', '/api/history?', '/api/backup?', '/api/events?', '/api/state?']) {
    assert.equal((await f.send(route + 'pickerId=' + other, a)).status, 403);
  }
  assert.equal((await f.note(a, 'Player 1', 0, { pickerId: other })).status, 403);
  assert.equal((await f.send('/api/state', a, { headers: { 'X-Picker-Id': other } })).status, 403);
  const own = await f.picker('101');
  assert.equal((await f.send('/api/command?pickerId=' + own, a, { body: { pickerId: other } })).status, 403);
  assert.equal((await f.send('/api/state?pickerId=' + own + '&pickerId=' + other, a)).status, 403);
  assert.equal((await f.send('/api/pickers/' + other + '/state', a)).status, 403);
  for (const id of [own, other]) await assert.rejects(readFile(path.join(f.multiPicker.pickerRoot, id, 'state.json')), { code: 'ENOENT' });
  assert.equal((await f.send('/api/state?pickerId=' + own, a)).status, 200);
  assert.equal((await f.send('/api/state', b)).json().state.revision, 0);
  const created = await f.send('/api/game-plugin/keys', a, { body: { memberId: 'owner', label: 'Player 1' } });
  assert.equal(created.status, 201, created.text); const key = created.json().key;
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key, 'X-Picker-Id': other } })).status, 403);
  assert.equal((await f.send('/api/plugin/v1/status', b, { headers: { Authorization: 'Bearer ' + key } })).status, 403);
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  assert.equal((await f.send('/api/plugin/v1/report', null, { headers: { Authorization: 'Bearer ' + key }, body: { pickerId: other, memberId: 'owner' } })).status, 403);
  await f.restart();
  assert.equal((await f.send('/api/plugin/v1/status', null, { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  assert.equal((await f.send('/api/game-plugin', b)).json().keys.length, 0);
});

test('racing OAuth callbacks create exactly one account and owned picker without changing shared ownership', async t => {
  const f = await fixture(t), left = await f.begin('101'), right = await f.begin('101');
  const callbacks = await Promise.all([left(), right()]); assert.deepEqual(callbacks.map(r => r.status), [303, 303]);
  const doc = await f.registry(); assert.equal(doc.accounts.length, 1); assert.equal(doc.pickers.length, 2);
  assert.equal(doc.pickers.find(p => p.kind === 'legacy-shared').ownerAccountId, null);
  assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
});

test('LRU capacity closes only the evicted streams; cookies and durable games survive reopening', async t => {
  const f = await fixture(t, { maxOpenContexts: 3 }), a = await f.login('101'), b = await f.login('102'), c = await f.login('103');
  assert.equal((await f.note(a, 'Player 1', 0)).status, 200);
  assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  const left = await f.send('/api/events', a, { stream: true }), right = await f.send('/api/events', b, { stream: true });
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  const ended = new Promise(resolve => left.res.once('end', resolve));
  assert.equal((await f.send('/api/state', c)).status, 200); await ended;
  assert.equal(right.res.readableEnded, false);
  const count = Buffer.concat(right.chunks).toString().length;
  assert.equal((await f.note(c, 'Player 3', 0)).status, 200);
  assert.equal(Buffer.concat(right.chunks).toString().length, count);
  right.req.destroy(); right.res.destroy();
  assert.equal((await f.send('/api/state', a)).json().state.members[0].notes['12341'], 'Player 1');
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
});

test('idle eviction releases the writer and a following request reopens its durable state', async t => {
  const f = await fixture(t, { idleCloseMs: 25 }), cookie = await f.login('101'), id = await f.picker('101');
  assert.equal((await f.note(cookie, 'Player 1', 0)).status, 200);
  const lock = path.join(f.multiPicker.pickerRoot, id, 'store.lock');
  // Poll only the public lock lifecycle; do not use a timing assumption for success.
  let released = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    try { await readFile(lock); } catch (error) { if (error.code === 'ENOENT') { released = true; break; } throw error; }
  }
  assert.equal(released, true);
  assert.equal((await f.send('/api/state', cookie)).json().state.members[0].notes['12341'], 'Player 1');
});

for (const point of ['account-recorded', 'id-reserved', 'registry-reserved', 'directory-created', 'directory-synced', 'registry-ready']) {
  test(`an interrupted OAuth provisioning at ${point} recovers one empty owned picker`, async t => {
    let injected = false, armed = false;
    const f = await fixture(t, { crashPoint: name => { if (armed && !injected && name === point) { injected = true; throw new Error('Injected interruption'); } } });
    armed = true;
    const response = await (await f.begin('101'))(); assert.equal(response.status, 500); assert.equal(injected, true);
    await f.restart();
    const cookie = await f.login('101'), doc = await f.registry();
    assert.equal(doc.accounts.length, 1); assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
    assert.equal(doc.pickers.find(p => p.kind === 'legacy-shared').ownerAccountId, null);
    const state = (await f.send('/api/state', cookie)).json().state;
    assert.equal(state.revision, 0); assert.deepEqual(state.members.map(m => m.id), ['owner']);
    assert.deepEqual(state.members[0].completedTasks, []); assert.deepEqual(state.members[0].unlocked, []);
  });
}

test('legacy master, pre-existing invite sessions and established provider membership stay on legacy', async t => {
  const f = await fixture(t, { initiallyEnabled: false });
  const create = async memberId => {
    const result = await f.private('/api/invites', { body: { label: 'Player 1', memberId } });
    assert.equal(result.status, 201, result.text); return result.json();
  };
  const claimed = await create('one'), unclaimed = await create('two');
  const join = async token => {
    const response = await f.private(new URL(token).pathname, { headers: { Authorization: '' } }); assert.equal(response.status, 303, response.text);
    return response.headers['set-cookie'][0].split(';')[0];
  };
  const playerCookie = await join(claimed.link), inviteCookie = await join(unclaimed.link);
  const accountCookie = await f.login('101', playerCookie);
  await f.restart();
  const relogged = await f.login('101'), other = await f.login('102'), otherId = await f.picker('102');
  for (const cookie of [accountCookie, relogged, inviteCookie]) {
    const response = await f.send('/api/state', cookie); assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.json().state.members.map(m => m.id), ['one', 'two']);
    assert.equal((await f.send('/api/state?pickerId=' + otherId, cookie)).status, 403);
  }
  assert.deepEqual((await f.private('/api/state')).json().state.members.map(m => m.id), ['one', 'two']);
  assert.equal((await f.private('/api/state?pickerId=' + otherId)).status, 403);
  assert.deepEqual((await f.send('/api/state', other)).json().state.members.map(m => m.id), ['owner']);
  const conflict = await (await f.begin('102', relogged, '/auth/link/discord'))(); assert.equal(conflict.status, 409);
  const doc = await f.registry(); assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
  assert.equal(doc.accounts.find(a => a.identities.some(i => i.subject === '101')).defaultPickerId, null);
});

test('an owner has ordinary writes and export without operator, invitation or global administration powers', async t => {
  const f = await fixture(t), cookie = await f.login('101');
  const session = await f.send('/api/session', cookie); assert.equal(session.status, 200);
  assert.equal(session.json().admin, false); assert.equal(session.json().capabilities.canWrite, true);
  for (const route of ['/api/accounts', '/api/invites', '/api/overlays', '/api/admin/master-link']) assert.equal((await f.send(route, cookie)).status, 403);
  for (const route of ['/api/shutdown', '/api/worker-restart', '/api/operator/snapshot']) assert.equal((await f.send(route, cookie, { body: {} })).status, 403);
  assert.equal((await f.send('/api/backup', cookie)).status, 200);
  assert.equal((await f.note(cookie, 'Player 1', 0)).status, 200);
});

test('sign-out invalidates a picker-bound session before later stream delivery and cannot expose legacy', { timeout: 5000 }, async t => {
  const f = await fixture(t), cookie = await f.login('101'), otherSession = await f.login('101');
  const stream = await f.send('/api/events', cookie, { stream: true });
  const ended = new Promise(resolve => stream.res.once('end', resolve));
  assert.equal((await f.send('/auth/signout', cookie, { method: 'POST', headers: { Origin: origin } })).status, 303);
  assert.equal((await f.send('/api/state', cookie)).status, 401);
  assert.equal((await f.send('/api/game-plugin/keys', otherSession, { body: { memberId: 'owner', label: 'Player 1' } })).status, 201);
  await ended; assert.equal(Buffer.concat(stream.chunks).toString().includes('event: game-plugin'), false);
  await f.restart(); assert.equal((await f.send('/api/state', cookie)).status, 401);
});

test('capacity eviction drains an accepted write, refuses its queued successor and waits before reopening', { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  let held = false;
  const f = await fixture(t, { maxOpenContexts: 3, beforeCommit: async ({ state }) => {
    if (!held && state.members[0].notes?.['12341'] === 'Player 1') { held = true; entered.resolve(); await release.promise; }
  } });
  const a = await f.login('101'), b = await f.login('102'), c = await f.login('103');
  const stream = await f.send('/api/events', a, { stream: true });
  const ended = new Promise(resolve => stream.res.once('end', resolve));
  const accepted = f.note(a, 'Player 1', 0);
  try {
    await entered.promise;
    assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
    const queued = f.note(a, 'Player 1 next', 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.send('/api/state', b)).status, 200); // A is now LRU.
    const eviction = f.send('/api/state', c); await ended;
    let reopened = false;
    const reopening = f.send('/api/state', a).then(response => { reopened = true; return response; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reopened, false);
    release.resolve();
    const confirmed = await accepted; assert.equal(confirmed.status, 200, confirmed.text);
    assert.equal((await queued).status, 503);
    assert.equal((await eviction).status, 200);
    assert.equal((await reopening).json().state.members[0].notes['12341'], 'Player 1');
    await f.restart();
    assert.equal((await f.send('/api/state', a)).json().state.members[0].notes['12341'], 'Player 1');
    assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
  } finally { release.resolve(); }
});

test('matching session IDs, receipt IDs and backup IDs remain local to each picker', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  const clientId = '40000000-0000-4000-8000-000000000001';
  const left = await f.send('/api/action-session', a, { body: { clientId } });
  const right = await f.send('/api/action-session', b, { body: { clientId } });
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  const ids = [await f.picker('101'), await f.picker('102')];
  // Deliberately collide the two synthetic durable namespaces while writers are
  // closed. Principals remain distinct and owned by their original accounts.
  await f.app().close();
  const scope = left.json().scope;
  const file = path.join(f.multiPicker.pickerRoot, ids[1], 'state.json');
  const document = JSON.parse(await readFile(file)); document.actionReceipts.slots[0].scope = scope;
  await writeFile(file, JSON.stringify(document));
  await f.restart();
  const requestId = `v3.${scope}.0.1.1`;
  const savedA = await f.note(a, 'Player 1', 0, { requestId, requestAck: 0 });
  const savedB = await f.note(b, 'Player 2', 0, { requestId, requestAck: 0 });
  assert.equal(savedA.status, 200, savedA.text); assert.equal(savedB.status, 200, savedB.text);
  assert.equal(savedA.json().receipt.requestId, savedB.json().receipt.requestId);
  assert.equal((await f.note(a, 'Player 1', 0, { requestId, requestAck: 0 })).json().state.members[0].notes['12341'], 'Player 1');
  assert.equal((await f.note(b, 'Player 2', 0, { requestId, requestAck: 0 })).json().state.members[0].notes['12341'], 'Player 2');
  const ack = await f.send('/api/action-session', a, { body: { clientId, acknowledge: { ...left.json(), sequence: 1 } } });
  assert.equal(ack.status, 200, ack.text);
  assert.equal((await f.note(a, 'Player 1', 0, { requestId, requestAck: 0 })).json().code, 'REQUEST_ACKNOWLEDGED');
  assert.equal((await f.note(b, 'Player 2', 0, { requestId, requestAck: 0 })).status, 200);
  assert.equal((await f.note(a, 'Player 1 next', 1)).status, 200);
  assert.equal((await f.note(b, 'Player 2 next', 1)).status, 200);
  const backupA = await f.send('/api/backups', a), backupB = await f.send('/api/backups', b);
  assert.equal(backupA.status, 200); assert.equal(backupB.status, 200);
  const backups = response => response.json().backups;
  assert.ok(backups(backupA).length); assert.ok(backups(backupB).length);
  const idA = backups(backupA).find(row => row.revision === 1).id, idB = backups(backupB).find(row => row.revision === 1).id;
  await f.app().close();
  await rename(path.join(f.multiPicker.pickerRoot, ids[1], 'backups', idB), path.join(f.multiPicker.pickerRoot, ids[1], 'backups', idA));
  await f.restart();
  const exportedA = await f.send('/api/backups/' + idA, a);
  const exportedB = await f.send('/api/backups/' + idA, b);
  assert.equal(exportedA.status, 200); assert.equal(exportedB.status, 200);
  assert.equal(exportedA.json().state.members[0].notes['12341'], 'Player 1');
  assert.equal(exportedB.json().state.members[0].notes['12341'], 'Player 2');
  assert.equal((await f.send('/api/backup', a)).json().state.members[0].notes['12341'], 'Player 1 next');
  assert.equal((await f.send('/api/backup', b)).json().state.members[0].notes['12341'], 'Player 2 next');
});

test('picker-bound account linking stays one account and a sign-in identity cannot be stolen', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102');
  const conflict = await (await f.begin('102', a, '/auth/link/discord'))(); assert.equal(conflict.status, 409);
  const same = await (await f.begin('101', a, '/auth/link/discord'))(); assert.equal(same.status, 303);
  assert.equal((await f.send('/api/session', a)).json().pickerId, await f.picker('101'));
  assert.notEqual((await f.send('/api/session', a)).json().accountId, (await f.send('/api/session', b)).json().accountId);
  assert.equal((await f.registry()).accounts.length, 2);
});

test('an owner can preview and restore a compatible gameplay backup only within its own picker', async t => {
  const f = await fixture(t), a = await f.login('101'), b = await f.login('102'), other = await f.picker('102');
  assert.equal((await f.note(a, 'Player 1', 0)).status, 200);
  assert.equal((await f.note(b, 'Player 2', 0)).status, 200);
  const backup = (await f.send('/api/backup', a)).json();
  assert.equal((await f.send('/api/restore/preview', a, { body: { backup } })).status, 200);
  const wrongDataset = structuredClone(backup); wrongDataset.state.provenance.dataset.digest = '0'.repeat(64);
  assert.equal((await f.send('/api/restore/preview', a, { body: { backup: wrongDataset } })).status, 422);
  const binding = JSON.parse(await readFile(path.join(f.multiPicker.pickerRoot, await f.picker('101')) + '.dataset.json'));
  assert.equal(binding.digest, selectedDataset.digest);
  assert.equal((await f.send('/api/restore/preview', a, { body: { backup, pickerId: other } })).status, 403);
  assert.equal((await f.send('/api/restore', a, { body: { backup, expectedRevision: 1 } })).status, 200);
  assert.equal((await f.send('/api/state', b)).json().state.members[0].notes['12341'], 'Player 2');
});

async function duoInvite(f, memberId = 'one') {
  const created = await f.private('/api/invites', { body: { label: 'Player 1', memberId } });
  assert.equal(created.status, 201, created.text);
  return created.json();
}
async function invitePending(f, invitation) {
  const joined = await f.send(new URL(invitation.link).pathname);
  assert.equal(joined.status, 200, joined.text);
  return joined.headers['set-cookie'][0].split(';')[0];
}
const sessionCookie = response => response.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
const legacyAccounts = async f => {
  try { return JSON.parse(await readFile(path.join(f.root, 'legacy/accounts.json'))).accounts; }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

test('an explicit duo invite provisions a shared membership immediately and no default picker', async t => {
  const f = await fixture(t), invitation = await duoInvite(f);
  const callback = await (await f.begin('101', await invitePending(f, invitation)))();
  assert.equal(callback.status, 303, callback.text);
  const cookie = sessionCookie(callback), doc = await f.registry();
  assert.equal(doc.accounts.length, 1); assert.equal(doc.accounts[0].defaultPickerId, null);
  assert.deepEqual(doc.accounts[0].memberships.map(m => [m.role, m.memberId]), [['player', 'one']]);
  assert.equal(doc.pickers.length, 1); assert.equal(doc.pickers[0].kind, 'legacy-shared');
  assert.equal((await f.private('/api/invites')).json().invites.find(i => i.id === invitation.invite.id).claimedAccountId, doc.accounts[0].id);
  for (const active of [cookie, await f.login('101')]) assert.deepEqual((await f.send('/api/state', active)).json().state.members.map(m => m.id), ['one', 'two']);
  await f.restart();
  assert.deepEqual((await f.send('/api/state', await f.login('101'))).json().state.members.map(m => m.id), ['one', 'two']);
});

test('a revoked duo member returning through a fresh invite rejoins legacy without a default picker', async t => {
  const f = await fixture(t), invitation = await duoInvite(f);
  const callback = await (await f.begin('101', await invitePending(f, invitation)))(); assert.equal(callback.status, 303);
  const accountId = (await f.registry()).accounts[0].id;
  assert.equal((await f.private('/api/invites/' + invitation.invite.id + '/revoke', { body: {} })).status, 200);
  const replacement = await duoInvite(f);
  const rejoined = await (await f.begin('101', await invitePending(f, replacement)))(); assert.equal(rejoined.status, 303, rejoined.text);
  assert.equal((await f.registry()).accounts[0].id, accountId);
  assert.equal((await f.registry()).accounts[0].defaultPickerId, null);
  assert.deepEqual((await f.send('/api/state', sessionCookie(rejoined))).json().state.members.map(m => m.id), ['one', 'two']);
  await f.restart();
  assert.equal((await f.registry()).pickers.length, 1);
});

test('a subject with a default picker cannot create a conflicting duo account and restart remains usable', async t => {
  const f = await fixture(t), cookie = await f.login('101'), invitation = await duoInvite(f);
  assert.equal((await f.note(cookie, 'Player 1', 0)).status, 200);
  const before = await f.registry();
  const callback = await (await f.begin('101', await invitePending(f, invitation)))();
  assert.equal(callback.status, 409); assert.match(callback.text, /This sign-in already has its own picker/);
  assert.deepEqual(await legacyAccounts(f), []); assert.deepEqual(await f.registry(), before);
  const signedInJoin = await f.send(new URL(invitation.link).pathname, cookie);
  assert.equal(signedInJoin.status, 409); assert.match(signedInJoin.text, /This sign-in already has its own picker/);
  assert.equal((await f.private('/api/invites')).json().invites.find(i => i.id === invitation.invite.id).claimedAccountId, undefined);
  await f.restart();
  assert.equal((await f.send('/api/state', cookie)).json().state.members[0].notes['12341'], 'Player 1');
  assert.deepEqual(await legacyAccounts(f), []);
});

test('a duo account created after startup links a second provider immediately and after restart', async t => {
  const f = await fixture(t), invitation = await duoInvite(f);
  const joined = await (await f.begin('101', await invitePending(f, invitation)))(); assert.equal(joined.status, 303);
  const cookie = sessionCookie(joined), accountId = (await f.registry()).accounts[0].id;
  const linked = await (await f.begin('201', cookie, '/auth/link/google'))(); assert.equal(linked.status, 303, linked.text);
  const registered = (await f.registry()).accounts;
  assert.equal(registered.length, 1); assert.equal(registered[0].id, accountId);
  assert.deepEqual(registered[0].identities.map(i => i.provider).sort(), ['discord', 'google']);
  assert.equal(registered[0].defaultPickerId, null);
  for (let i = 0; i < 2; i++) {
    for (const active of [cookie, await f.login('101'), await f.login('201', undefined, '/auth/google')]) {
      assert.deepEqual((await f.send('/api/state', active)).json().state.members.map(m => m.id), ['one', 'two']);
    }
    if (!i) await f.restart();
  }
});

test('linking a provider owned by a default picker writes no legacy identity and restart succeeds', async t => {
  const f = await fixture(t), invitation = await duoInvite(f);
  const joined = await (await f.begin('101', await invitePending(f, invitation)))(); assert.equal(joined.status, 303);
  const cookie = sessionCookie(joined), solo = await f.login('201', undefined, '/auth/google');
  const beforeAccounts = await readFile(path.join(f.root, 'legacy/accounts.json'));
  const beforeRegistry = await f.registry();
  const denied = await (await f.begin('201', cookie, '/auth/link/google'))();
  assert.equal(denied.status, 409); assert.match(denied.text, /This sign-in already has its own picker/);
  assert.deepEqual(await readFile(path.join(f.root, 'legacy/accounts.json')), beforeAccounts);
  assert.deepEqual(await f.registry(), beforeRegistry);
  await f.restart();
  assert.deepEqual((await f.send('/api/state', await f.login('101'))).json().state.members.map(m => m.id), ['one', 'two']);
  assert.deepEqual((await f.send('/api/state', solo)).json().state.members.map(m => m.id), ['owner']);
});

test('revoking an owned picker plugin key removes exactly its capability across restart', async t => {
  const f = await fixture(t), cookie = await f.login('101');
  const first = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 1' } });
  const second = await f.send('/api/game-plugin/keys', cookie, { body: { memberId: 'owner', label: 'Player 2' } });
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const hash = key => createHash('sha256').update(key).digest('hex');
  assert.equal((await f.registry()).capabilities.length, 2);
  const revoke = () => f.send('/api/game-plugin/keys/' + first.json().record.id + '/revoke', cookie, { body: {} });
  assert.equal((await revoke()).status, 200);
  assert.deepEqual((await f.registry()).capabilities.map(c => c.hash), [hash(second.json().key)]);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + first.json().key } })).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + second.json().key } })).status, 200);
  assert.equal((await revoke()).status, 200);
  await f.restart();
  assert.deepEqual((await f.registry()).capabilities.map(c => c.hash), [hash(second.json().key)]);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + first.json().key } })).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', undefined, { headers: { Authorization: 'Bearer ' + second.json().key } })).status, 200);
});
