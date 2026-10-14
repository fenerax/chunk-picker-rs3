import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import http from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { resolveDataset } from '../app/datasets.mjs';

const root = fileURLToPath(new URL('../.local/invite-tests/', import.meta.url));
const selectedDataset = await resolveDataset();
const dataset = { ...selectedDataset, gameDefaults: { ...selectedDataset.gameDefaults, masterLabel: 'Player' } };
const definitions = { chunks: { '100': {}, '101': {} }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] };
const publicOrigin = 'https://picker.example';
const funnel = { Host: 'picker.example', 'Tailscale-Funnel-Request': '?1', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
const tokenFrom = link => new URL(link).pathname.split('/').at(-1);

async function fixture(t, options = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'server-'));
  let application, origin;
  async function start() {
    const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
    application = await createServer({ dataDir, dataset, definitions, taskMap: {}, initialState, host: '127.0.0.1', port: 0, predictionPrewarm: false, ...options });
    await application.listen(); origin = `http://127.0.0.1:${application.address().port}`;
  }
  await start();
  t.after(async () => { await application.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { cookie, body, headers = {}, ...extra } = {}) {
    // Node fetch intentionally replaces Host; use HTTP when exercising proxy hosts.
    if (Object.keys(headers).some(key => key.toLowerCase() === 'host')) {
      return new Promise((resolve, reject) => {
        const bytes = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(`${origin}${route}`, { method: bytes === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { Cookie: cookie } : {}), ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin, 'Content-Length': Buffer.byteLength(bytes) }), ...headers } }, res => {
          const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('error', reject);
          res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
        });
        req.on('error', reject); req.end(bytes);
      });
    }
    return fetch(`${origin}${route}`, { redirect: 'manual', ...extra,
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...headers } });
  }
  const master = await request(`/join/${application.store.getAccessToken()}`);
  assert.equal(master.status, 303);
  const masterCookie = cookieFrom(master);
  return { dataDir, get application() { return application; }, get origin() { return origin; }, masterCookie, request,
    admin: (route, body, headers) => request(route, { cookie: masterCookie, body, headers }),
    async invite(label = 'Reed', admin = false) {
      const response = await request('/api/invites', { cookie: masterCookie, body: { label, admin } });
      assert.equal(response.status, 201); return response.json();
    },
    async join(link, headers = {}) {
      const response = await request(new URL(link).pathname, { headers });
      assert.equal(response.status, 303); return { response, cookie: cookieFrom(response) };
    },
    async restart() { await application.close(); await start(); },
  };
}

async function storedDocuments(directory) {
  const documents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) documents.push(...await storedDocuments(file));
    else if (/\.json(?:\.gz)?$/.test(entry.name)) {
      const bytes = await readFile(file);
      documents.push({ file, text: (entry.name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8') });
    }
  }
  return documents;
}

test('HTTP invitation lifecycle preserves sessions and stores only hashed invite/session credentials', async t => {
  const f = await fixture(t, { publicOrigin });
  const created = await f.invite();
  assert.equal(created.invite.label, 'Reed'); assert.equal(created.invite.admin, false);
  assert.equal(created.link.startsWith(`${publicOrigin}/join/`), true);
  const token = tokenFrom(created.link);
  const joined = await f.join(created.link, funnel);
  assert.match(joined.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(joined.response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(joined.response.headers.get('set-cookie'), /; Secure$/);
  assert.equal(joined.response.headers.get('strict-transport-security'), 'max-age=31536000');
  const session = joined.cookie.split('=')[1];
  const list = await (await f.admin('/api/invites')).json();
  assert.equal(list.invites.length, 1); assert.ok(list.invites[0].lastUsedAt);
  assert.equal(JSON.stringify(list).includes(token), false);
  assert.equal(Object.hasOwn(list.invites[0], 'tokenHash'), false);
  const saved = await f.request('/api/command', { cookie: joined.cookie, body: { expectedRevision: 0, command }, headers: { ...funnel, Origin: publicOrigin } });
  assert.equal(saved.status, 200, saved.status === 200 ? undefined : await saved.text());
  const state = (await saved.json()).state;
  assert.deepEqual(state.history.at(-1).actor, { kind: 'invite', inviteId: created.invite.id, label: 'Reed' });
  const backup = await (await f.admin('/api/backup')).json();
  assert.deepEqual(backup.state.history.at(-1).actor, state.history.at(-1).actor);
  for (const { file, text } of await storedDocuments(f.dataDir)) {
    for (const secret of [token, session]) assert.equal(text.includes(secret), false, `${file} has no plaintext credentials`);
    if (!file.endsWith('invites.json')) {
      for (const secret of [digest(token), digest(session)]) assert.equal(text.includes(secret), false, `${file} has no authentication hashes`);
      for (const key of ['tokenHash', 'sessions', 'invites']) assert.equal(Object.hasOwn(JSON.parse(text), key), false, `${file}: ${key}`);
    }
  }
  await f.restart();
  assert.deepEqual(await (await f.request('/api/session', { cookie: joined.cookie, headers: funnel })).json(), { admin: false, readOnly: false, capabilities: { canWrite: true }, label: 'Reed', kind: 'invite', memberId: null,
    actor: { kind: 'invite', inviteId: created.invite.id, label: 'Reed' } });
  assert.equal((await f.admin(`/api/invites/${created.invite.id}/revoke`, {})).status, 200);
  await f.restart();
  assert.equal((await f.request('/api/state', { cookie: joined.cookie, headers: funnel })).status, 401);
  assert.equal((await f.request(new URL(created.link).pathname, { headers: funnel })).status, 401);
  assert.equal((await (await f.admin('/api/invites')).json()).invites[0].revoked, true);
});

test('viewer identity stays stable across invite sessions and restart and follows the linked player', async t => {
  const f = await fixture(t);
  const playerId = f.application.store.getState().members[1].id;
  const created = await (await f.admin('/api/invites', { label: 'Reed', memberId: playerId })).json();
  const first = await f.join(created.link), second = await f.join(created.link);
  assert.notEqual(first.cookie, second.cookie);
  const viewer = cookie => f.request('/api/session', { cookie }).then(response => response.json());
  const expected = { admin: false, readOnly: false, capabilities: { canWrite: true }, kind: 'invite', label: 'Reed', memberId: playerId,
    actor: { kind: 'invite', inviteId: created.invite.id, label: 'Reed', memberId: playerId } };
  assert.deepEqual(await viewer(first.cookie), expected);
  assert.deepEqual(await viewer(second.cookie), expected);
  const saved = await f.request('/api/command', { cookie: first.cookie, body: { expectedRevision: 0, command } });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).state.history.at(-1).actor, expected.actor);
  await f.restart();
  assert.deepEqual(await viewer(first.cookie), expected);
  const duplicateLabel = await f.invite();
  const other = await f.join(duplicateLabel.link);
  assert.notEqual((await viewer(other.cookie)).actor.inviteId, expected.actor.inviteId, 'same label is not the same invite actor');
  const master = await viewer(f.masterCookie);
  assert.deepEqual(master, { admin: true, readOnly: false, capabilities: { canWrite: true }, kind: 'master', label: 'Player', memberId: null, actor: { kind: 'master', label: 'Player' } });
  assert.equal((await f.admin(`/api/invites/${created.invite.id}/player`, { memberId: null })).status, 200);
  const unlinked = await viewer(first.cookie);
  assert.equal(unlinked.memberId, null);
  assert.deepEqual(unlinked.actor, { kind: 'invite', inviteId: created.invite.id, label: 'Reed' });
});

test('coordination reads are authenticated, uncached, compact and preserve stale-write protection', async t => {
  const f = await fixture(t), [first, second] = f.application.store.getState().members;
  const ownLink = await (await f.admin('/api/invites', { label: 'Reed', memberId: second.id })).json();
  const partnerLink = await (await f.admin('/api/invites', { label: 'Player', memberId: first.id })).json();
  const own = await f.join(ownLink.link), partner = await f.join(partnerLink.link);
  for (const [cookie, memberId, expectedRevision] of [[own.cookie, second.id, 0], [partner.cookie, first.id, 1]]) {
    const saved = await f.request('/api/command', { cookie, body: { expectedRevision, command: { type: 'set-preference', memberId, preferenceId: 'taskSidebar', value: false } } });
    assert.equal(saved.status, 200, await saved.text());
  }
  assert.equal((await f.request('/api/coordination')).status, 401);
  const response = await f.request('/api/coordination', { cookie: own.cookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const result = await response.json();
  assert.equal(result.stateRevision, 2);
  assert.equal(result.latestUndo.event.revision, 2);
  assert.equal(result.ownUndo.event.revision, 1);
  assert.equal(result.ownUndo.canUndo, true, result.ownUndo.reason);
  assert.ok(result.history.every(event => !Object.hasOwn(event, 'undo') && !Object.hasOwn(event, 'hasUndo')));
  assert.equal((await f.request('/api/command', { cookie: own.cookie, body: { expectedRevision: 1, command: { type: 'undo', undoRevision: 1 } } })).status, 409);
  assert.equal(f.application.store.getInfo().revision, 2, 'neither a read nor stale undo writes gameplay');
  const head = await f.request('/api/coordination', { cookie: own.cookie, method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('cache-control'), /no-store/);
});

test('ordinary invitations cannot administer access; administrator invitations can manage and stop the fixture', async t => {
  const f = await fixture(t);
  const reed = await f.invite();
  const { cookie } = await f.join(reed.link);
  for (const route of ['/api/invites', '/api/admin/master-link']) assert.equal((await f.request(route, { cookie })).status, 403, route);
  for (const [route, body] of [['/api/invites', { label: 'Attacker', admin: true }], [`/api/invites/${reed.invite.id}/revoke`, {}], ['/api/shutdown', {}]]) {
    assert.equal((await f.request(route, { cookie, body })).status, 403, route);
  }
  assert.equal((await f.admin('/api/health')).status, 200);
  assert.equal((await (await f.admin('/api/invites')).json()).invites.length, 1);
  const administrator = await f.invite('Second administrator', true);
  const adminJoin = await f.join(administrator.link);
  assert.equal((await f.request('/api/invites', { cookie: adminJoin.cookie })).status, 200);
  assert.equal((await f.request('/api/admin/master-link', { cookie: adminJoin.cookie })).status, 200);
  const newInvite = await f.request('/api/invites', { cookie: adminJoin.cookie, body: { label: 'Another browser' } });
  assert.equal(newInvite.status, 201);
  assert.equal((await f.request(`/api/invites/${reed.invite.id}/revoke`, { cookie: adminJoin.cookie, body: {} })).status, 200);
  assert.equal((await f.request('/api/state', { cookie })).status, 401);
  assert.equal((await f.request('/api/shutdown', { cookie: adminJoin.cookie, body: {} })).status, 202);
  await f.application.close();
});

test('Funnel and public forwarding reject every master credential while invite sessions work', async t => {
  const f = await fixture(t, { publicOrigin });
  const master = f.application.store.getAccessToken();
  for (const headers of [funnel, { 'Tailscale-Funnel-Request': 'spoof' }, { 'X-Forwarded-For': '203.0.113.9' }, { 'X-Forwarded-For': '127.0.0.1, 203.0.113.9' }]) {
    assert.equal((await f.request(`/join/${master}`, { headers })).status, 401);
    assert.equal((await f.request('/api/state', { headers: { ...headers, Authorization: `Bearer ${master}` } })).status, 401);
    assert.equal((await f.request('/api/state', { cookie: `duo_access=${master}`, headers })).status, 401);
    assert.equal((await f.request('/api/state', { cookie: f.masterCookie, headers })).status, 401);
  }
  assert.equal((await f.request('/api/state', { headers: { Authorization: `Bearer ${master}` } })).status, 200);
  const { cookie } = await f.join((await f.invite()).link, funnel);
  assert.equal((await f.request('/api/state', { cookie, headers: funnel })).status, 200);
});

test('public mutations use the exact configured origin and refuse arbitrary Host, missing Origin or cross-site requests', async t => {
  const f = await fixture(t, { publicOrigin });
  const { cookie } = await f.join((await f.invite()).link, funnel);
  const mutation = { expectedRevision: 0, command };
  for (const headers of [
    { ...funnel, Origin: 'https://foreign.example' },
    { ...funnel, Host: 'foreign.example', Origin: 'https://foreign.example' },
    { ...funnel, Origin: '' },
    { ...funnel, Origin: publicOrigin, 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'arbitrary.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', Origin: 'https://arbitrary.example' },
    { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'http', Origin: publicOrigin },
  ]) assert.equal((await f.request('/api/command', { cookie, body: mutation, headers })).status, 403);
  assert.equal(f.application.store.getState().revision, 0);
  const accepted = await f.request('/api/command', { cookie, body: mutation, headers: { ...funnel, Origin: publicOrigin } });
  assert.equal(accepted.status, 200, accepted.status === 200 ? undefined : await accepted.text());
  const noMarker = await f.request('/api/command', { cookie, body: { expectedRevision: 1, command: { ...command, value: true } },
    headers: { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', Origin: publicOrigin } });
  assert.equal(noMarker.status, 200);
});

test('join and anonymous rate limits use forwarded clients separately and generic failures disclose no metadata', async t => {
  const f = await fixture(t, { publicOrigin, rateLimits: { failedJoins: 2, unauthenticated: 5 } });
  const created = await f.invite('Sensitive invitation label');
  const client = address => ({ ...funnel, 'X-Forwarded-For': address });
  for (let i = 0; i < 2; i++) assert.equal((await f.request(`/join/${'z'.repeat(43)}`, { headers: client('203.0.113.20') })).status, 401);
  const rejectedJoin = await f.request(new URL(created.link).pathname, { headers: client('203.0.113.20') });
  assert.equal(rejectedJoin.status, 429); assert.ok(Number(rejectedJoin.headers.get('retry-after')) > 0);
  assert.equal((await f.request(new URL(created.link).pathname, { headers: client('203.0.113.21') })).status, 303);
  for (const route of ['/', '/api/state', '/api/invites', '/api/admin/master-link', '/api/health']) {
    const response = await f.request(route, { headers: client('203.0.113.22') });
    assert.equal(response.status, 401);
    const text = await response.text();
    for (const forbidden of [created.invite.id, created.invite.label, tokenFrom(created.link), f.application.store.getAccessToken(), 'Player', 'unlocked', 'members', 'dataDir']) assert.equal(text.includes(forbidden), false, route);
  }
  const limited = await f.request('/', { headers: client('203.0.113.22') });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await f.request('/', { headers: client('203.0.113.23') })).status, 401);
});

test('gameplay restore preserves revoked authentication and closes the revoked invitation SSE stream', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const created = await f.invite();
  const joined = await f.join(created.link);
  const backup = await (await f.admin('/api/backup')).json();
  const abort = new AbortController();
  t.after(() => abort.abort());
  const events = await f.request('/api/events', { cookie: joined.cookie, signal: abort.signal });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":0/);
  assert.equal((await f.admin(`/api/invites/${created.invite.id}/revoke`, {})).status, 200);
  let timer;
  try {
    const ended = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Revoked SSE stream did not close')), 2000); })]);
    assert.equal(ended.done, true);
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  assert.equal((await f.admin('/api/restore', { expectedRevision: 0, backup })).status, 200);
  assert.equal((await f.request('/api/state', { cookie: joined.cookie })).status, 401);
  assert.equal((await f.request(new URL(created.link).pathname)).status, 401);
  await f.restart();
  assert.equal((await f.request('/api/state', { cookie: joined.cookie })).status, 401);
  assert.equal((await (await f.admin('/api/invites')).json()).invites[0].revoked, true);
});

test('concurrent failed joins cannot exceed a client allowance or consume another client allowance', async t => {
  const f = await fixture(t, { publicOrigin, rateLimits: { failedJoins: 2, unauthenticated: 100 } });
  const headers = { ...funnel, 'X-Forwarded-For': '203.0.113.30' };
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(`/join/${'x'.repeat(43)}`, { headers })));
  assert.deepEqual(responses.map(response => response.status).sort(), [401, 401, 429, 429, 429, 429, 429, 429]);
  const created = await f.invite();
  assert.equal((await f.request(new URL(created.link).pathname, { headers })).status, 429);
  assert.equal((await f.request(new URL(created.link).pathname, { headers: { ...headers, 'X-Forwarded-For': '203.0.113.31' } })).status, 303);
});

test('revocation queues after an in-flight save and rejects later queued commands and administrator invite creation', { timeout: 60000 }, async t => {
  let unblock, reached;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  let block = true;
  const f = await fixture(t, { beforeCommit: async ({ operation }) => {
    if (block && operation === 'command') { block = false; reached(); await barrier; }
  } });
  t.after(() => unblock());
  const created = await f.invite('Revocable administrator', true);
  const { cookie } = await f.join(created.link);
  const first = f.request('/api/command', { cookie, body: { expectedRevision: 0, command } });
  await entered;
  async function queued(route, options) {
    let listener;
    const received = new Promise(resolve => {
      listener = request => {
        if (request.url !== route) return;
        f.application.server.off('request', listener);
        request.once('end', () => { void nextTurn().then(resolve); });
      };
      f.application.server.on('request', listener);
    });
    const response = f.request(route, options);
    await received;
    return { response };
  }
  const revoke = await queued(`/api/invites/${created.invite.id}/revoke`, { cookie: f.masterCookie, body: {} });
  const create = await queued('/api/invites', { cookie, body: { label: 'Must not be created' } });
  const later = await queued('/api/command', { cookie, body: { expectedRevision: 1, command: { ...command, value: true } } });
  unblock();
  assert.equal((await first).status, 200);
  assert.equal((await revoke.response).status, 200);
  assert.equal((await create.response).status, 401);
  assert.equal((await later.response).status, 401);
  assert.equal(f.application.store.getState().revision, 1);
  assert.equal((await (await f.admin('/api/invites')).json()).invites.length, 1);
});

test('eldest invitation session eviction terminates its open SSE stream', { timeout: 60000 }, async t => {
  const f = await fixture(t, { rateLimits: { failedJoins: 100, unauthenticated: 100 } });
  const created = await f.invite();
  const eldest = await f.join(created.link);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const events = await f.request('/api/events', { cookie: eldest.cookie, signal: abort.signal });
  const reader = events.body.getReader();
  await reader.read();
  const newest = await Promise.all(Array.from({ length: 32 }, () => f.join(created.link)));
  let timer;
  try {
    const ended = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Evicted session SSE stream did not close')), 2000); })]);
    assert.equal(ended.done, true);
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  assert.equal((await f.request('/api/state', { cookie: eldest.cookie })).status, 401);
  assert.equal((await f.request('/api/state', { cookie: newest.at(-1).cookie })).status, 200);
});

test('optional loopback listener serves Funnel with the same invite rules and closes with the server', async t => {
  const app = await fixture(t, { publicOrigin, loopbackPort: 0 });
  const created = await app.invite('Reed');
  const loopback = `http://127.0.0.1:${app.application.loopbackAddress().port}`;
  const get = (route, headers) => new Promise((resolve, reject) => {
    http.get(`${loopback}${route}`, { headers }, res => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
  });
  assert.equal((await get('/', funnel)).statusCode, 401);
  assert.equal((await get(`/join/${app.application.store.getAccessToken()}`, funnel)).statusCode, 401, 'master link is refused through Funnel');
  const joined = await get(new URL(created.link).pathname, funnel);
  assert.equal(joined.statusCode, 303);
  assert.match(joined.headers['set-cookie'][0], /; Secure/);
  await app.application.close();
  await assert.rejects(get('/', {}), /ECONNREFUSED/);
});

test('native restore replaces the whole save, so it is administrator-only', async t => {
  const f = await fixture(t);
  const joined = await f.join((await f.invite('Reed')).link);
  const backup = await (await f.admin('/api/backup')).json();
  for (const route of ['/api/restore/preview', '/api/restore']) {
    assert.equal((await f.request(route, { cookie: joined.cookie, body: { expectedRevision: 0, backup } })).status, 403, route);
  }
  assert.equal((await f.admin('/api/restore/preview', { backup })).status, 200);
  assert.equal((await f.request('/api/backup', { cookie: joined.cookie })).status, 200, 'invites can still download a backup');
});


test('an invite linked to a player can restore only that player’s map, keeping History and Undo', async t => {
  const f = await fixture(t);
  const loaded = await (await f.admin('/api/state')).json();
  const [first, second] = loaded.state.members;
  const created = await f.invite('Reed');
  assert.equal((await f.admin(`/api/invites/${created.invite.id}/player`, { memberId: 'nobody' })).status, 400);
  assert.equal((await f.admin(`/api/invites/${created.invite.id}/player`, { memberId: second.id })).status, 200);
  const joined = await f.join(created.link);
  assert.equal((await (await f.request('/api/session', { cookie: joined.cookie })).json()).memberId, second.id);
  // A backup in which both maps have an extra unlocked chunk.
  const backup = await (await f.admin('/api/backup')).json();
  for (const member of backup.state.members) member.unlocked = [...new Set([...member.unlocked, '101'])];
  const reed = (route, body) => f.request(route, { cookie: joined.cookie, body });
  assert.equal((await reed('/api/member-restore/preview', { memberId: first.id, backup })).status, 403, 'not the other player’s map');
  assert.equal((await reed('/api/member-restore/preview', { memberId: second.id, backup })).status, 200);
  assert.equal((await reed('/api/command', { expectedRevision: loaded.state.revision, command: { type: 'replace-member', memberId: second.id, member: backup.state.members[1] } })).status, 400, 'only through the reviewed route');
  const applied = await reed('/api/member-restore', { memberId: second.id, backup, expectedRevision: loaded.state.revision });
  assert.equal(applied.status, 200);
  const after = (await applied.json()).state;
  assert.ok(after.members.find(member => member.id === second.id).unlocked.includes('101'));
  assert.deepEqual(after.members.find(member => member.id === first.id).unlocked, first.unlocked, 'the other map is untouched');
  const event = after.history.at(-1);
  assert.equal(event.type, 'replace-member'); assert.equal(event.actor.label, 'Reed'); assert.equal(event.command.member, undefined);
  assert.ok(after.history.length > 1 || loaded.state.history.length === 0, 'History is kept');
  const undone = await f.admin('/api/command', { expectedRevision: after.revision, command: { type: 'undo' } });
  assert.equal(undone.status, 200);
  const state = (await (await f.admin('/api/state')).json()).state;
  assert.deepEqual(state.members.find(member => member.id === second.id).unlocked, second.unlocked);
});

test('feedback: players send their own notes; only admins read all or handle them; it never enters History', async t => {
  const f = await fixture(t);
  const joined = await f.join((await f.invite('Reed')).link);
  const reed = (route, body) => f.request(route, { cookie: joined.cookie, body });
  const before = (await (await f.admin('/api/state')).json()).state.revision;
  const sent = await reed('/api/feedback', { kind: 'bug', text: '  The map flickers when I tick a task.  ', context: { chunk: '12850 Lumbridge', screen: '390x844', 'bad key!': 'x' } });
  assert.equal(sent.status, 201);
  const item = (await sent.json()).item;
  assert.equal(item.text, 'The map flickers when I tick a task.'); assert.equal(item.from.label, 'Reed'); assert.deepEqual(item.context, { chunk: '12850 Lumbridge', screen: '390x844' });
  assert.equal((await reed('/api/feedback', { kind: 'nope', text: 'x' })).status, 400);
  assert.equal((await reed('/api/feedback', { kind: 'idea', text: '   ' })).status, 400);
  assert.equal((await f.request('/api/feedback', { cookie: joined.cookie })).status, 403, 'invites cannot read feedback');
  const listed = await (await f.admin('/api/feedback')).json();
  assert.equal(listed.items.length, 1); assert.equal(listed.open, 1);
  assert.equal((await reed(`/api/feedback/${item.id}/status`, { status: 'done' })).status, 403);
  assert.equal((await f.admin(`/api/feedback/${item.id}/status`, { status: 'done' })).status, 200);
  assert.equal((await (await f.admin('/api/feedback')).json()).open, 0);
  assert.equal((await (await f.admin('/api/state')).json()).state.revision, before, 'feedback does not change the save');
  await f.restart();
  assert.equal((await (await f.admin('/api/feedback')).json()).items[0].status, 'done', 'feedback survives a restart');
});

test('feedback unread IDs persist across owner devices and restart without consuming racing arrivals', async t => {
  const f = await fixture(t);
  const author = await f.join((await f.invite()).link);
  const send = text => f.request('/api/feedback', { cookie: author.cookie, body: { kind: 'bug', text } }).then(response => response.json());
  const first = (await send('First report')).item;
  assert.deepEqual(await (await f.admin('/api/feedback/summary')).json(), { unread: 1 });
  const displayed = (await (await f.admin('/api/feedback')).json()).items.map(item => item.id);
  const second = (await send('Arrived while opening')).item;
  assert.deepEqual(await (await f.admin('/api/feedback/seen', { ids: displayed })).json(), { unread: 1 });
  const secondDevice = await f.join(f.application.inviteUrl);
  assert.deepEqual(await (await f.request('/api/feedback/summary', { cookie: secondDevice.cookie })).json(), { unread: 1 });
  await f.restart();
  assert.deepEqual(await (await f.request('/api/feedback/summary', { cookie: secondDevice.cookie })).json(), { unread: 1 });
  assert.deepEqual(await (await f.admin('/api/feedback/seen', { ids: [second.id] })).json(), { unread: 0 });
  assert.equal((await f.admin('/api/feedback/seen', { ids: ['unknown'] })).status, 400);
  assert.notEqual(first.id, second.id);
});

test('feedback authors see only their handled notes across linked player devices; viewers are denied', async t => {
  const f = await fixture(t);
  const memberId = f.application.store.getState().members[1].id;
  const create = async body => (await f.admin('/api/invites', body)).json();
  const first = await f.join((await create({ label: 'Reed', memberId })).link);
  const linked = await f.join((await create({ label: 'Another device', memberId })).link);
  const unrelated = await f.join((await f.invite('Reed')).link);
  const viewer = await f.join((await create({ label: 'Spectator', viewer: true })).link);
  const request = (cookie, route, body) => f.request(route, { cookie, body });
  const sent = await request(first.cookie, '/api/feedback', { kind: 'idea', text: 'Linked player report' });
  const item = (await sent.json()).item;
  await f.admin(`/api/feedback/${item.id}/status`, { status: 'done' });
  const own = await (await request(linked.cookie, '/api/feedback/own')).json();
  assert.equal(own.items.length, 1); assert.equal(own.items[0].status, 'done'); assert.ok(own.items[0].doneAt);
  assert.deepEqual(await (await request(unrelated.cookie, '/api/feedback/own')).json(), { items: [] });
  assert.equal((await request(unrelated.cookie, '/api/feedback/seen', { ids: [item.id] })).status, 400);
  assert.equal((await request(first.cookie, `/api/feedback/${item.id}/status`, { status: 'new' })).status, 403);
  assert.deepEqual(await (await request(linked.cookie, '/api/feedback/summary')).json(), { unread: 0 });
  for (const route of ['/api/feedback', '/api/feedback/summary', '/api/feedback/own']) assert.equal((await request(viewer.cookie, route)).status, 403);
  for (const [route, body] of [['/api/feedback', { kind: 'bug', text: 'Denied' }], ['/api/feedback/seen', { ids: [item.id] }], [`/api/feedback/${item.id}/status`, { status: 'done' }]]) assert.equal((await request(viewer.cookie, route, body)).status, 403);
  await f.restart();
  assert.equal((await (await request(linked.cookie, '/api/feedback/own')).json()).items[0].status, 'done');
});

test('feedback master owner and linked owner admin invitations share seen and author state', async t => {
  const f = await fixture(t);
  const ownerId = f.application.store.getState().members[0].id;
  const linkedInvite = await (await f.admin('/api/invites', { label: 'Phone owner', memberId: ownerId, admin: true })).json();
  const phone = await f.join(linkedInvite.link);
  const request = (route, body) => f.request(route, { cookie: phone.cookie, body });
  const item = (await (await f.admin('/api/feedback', { kind: 'idea', text: 'Owner note' })).json()).item;
  assert.equal(item.from.memberId, ownerId);
  assert.deepEqual(await (await request('/api/feedback/summary')).json(), { unread: 1 });
  await f.admin('/api/feedback/seen', { ids: [item.id] });
  assert.deepEqual(await (await request('/api/feedback/summary')).json(), { unread: 0 });
  assert.equal((await (await request('/api/feedback/own')).json()).items[0].id, item.id);
  const next = (await (await request('/api/feedback', { kind: 'bug', text: 'Phone note' })).json()).item;
  await request('/api/feedback/seen', { ids: [next.id] });
  assert.deepEqual(await (await f.admin('/api/feedback/summary')).json(), { unread: 0 });
  await f.restart();
  assert.deepEqual(await (await f.admin('/api/feedback/summary')).json(), { unread: 0 });
  assert.deepEqual(await (await request('/api/feedback/summary')).json(), { unread: 0 });
});
