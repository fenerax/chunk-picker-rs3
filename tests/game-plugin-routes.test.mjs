import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { prepareGameStorage } from '../app/game-profile.mjs';

const sentAt = '2026-10-19T12:00:00Z';
const report = (seq = 0, extra = {}) => ({ v: 1, seq, sentAt, position: { x: 46, z: 49, floor: 0 }, ...extra });
const definitions = { chunks: { '11825': { Name: 'Port Sarim' }, '11569': { Name: 'Musa Point' } }, walkableChunks: ['11825', '11569'], walkableChunksF2P: ['11825', '11569'] };
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-test-'));
  let app, origin;
  async function start(initialState) {
    app = await createServer({ dataset: fixtureDataset, dataDir, definitions, taskMap: {}, initialState, host: '127.0.0.1', port: 0, publicOrigin: undefined, loopbackPort: undefined, predictionPrewarm: false, ...options });
    await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  }
  await start(createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['11825'], journal: 'Private journal' }, { id: 'reed', name: 'Reed', unlocked: ['11569'] }]));
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  function request(route, { body, headers = {}, ...rest } = {}) {
    const requestHeaders = Object.fromEntries(Object.entries({ ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...headers }).filter(([, value]) => value !== undefined));
    // Node fetch replaces Host; use native HTTP to exercise the real Funnel host boundary.
    if (Object.keys(requestHeaders).some(key => key.toLowerCase() === 'host')) {
      return new Promise((resolve, reject) => {
        const bytes = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(`${origin}${route}`, { method: bytes === undefined ? 'GET' : 'POST', headers: { ...(bytes === undefined ? {} : { 'Content-Length': Buffer.byteLength(bytes) }), ...requestHeaders } }, res => {
          const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('error', reject);
          res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
        });
        req.on('error', reject); req.end(bytes);
      });
    }
    return fetch(`${origin}${route}`, { redirect: 'manual', ...rest, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: requestHeaders });
  }
  const admin = (route, body, headers = {}) => request(route, { body, headers: { Authorization: `Bearer ${app.store.getAccessToken()}`, ...headers } });
  const plugin = (route, key, body, headers = {}) => request(route, { body, headers: { Authorization: `Bearer ${key}`, Origin: undefined, ...headers } });
  async function create(memberId = 'actor1', label = 'Test plugin') {
    const response = await admin('/api/game-plugin/keys', { memberId, label });
    assert.equal(response.status, 201, await response.clone().text()); return response.json();
  }
  async function invite(body) {
    const response = await admin('/api/invites', body); assert.equal(response.status, 201);
    const created = await response.json(), joined = await request(new URL(created.link).pathname);
    assert.equal(joined.status, 303); return { ...created, cookie: cookieFrom(joined) };
  }
  return { get app() { return app; }, get origin() { return origin; }, dataDir, request, admin, plugin, create, invite,
    async restart() { await app.close(); await start(); } };
}

test('plugin keys allow self/admin management, enforce three active keys per player, and persist only hashes and revocation', async t => {
  const f = await fixture(t), owner = await f.invite({ label: 'Player', memberId: 'actor1' }), viewer = await f.invite({ label: 'Viewer', viewer: true });
  const self = (route, body) => f.request(route, { body, headers: { Cookie: owner.cookie } });
  assert.deepEqual(await (await f.admin('/api/game-plugin')).json(), { keys: [], positions: [], active: false });
  assert.equal((await f.request('/api/game-plugin/keys', { body: {}, headers: { 'Content-Type': 'invalid' } })).status, 401);
  for (const body of [{ memberId: 'actor1', label: '' }, { memberId: 'actor1', label: 'x'.repeat(81) }, { memberId: 'actor1', label: 'Bad\nlabel' }, { memberId: 'missing', label: 'Plugin' }, { memberId: 'actor1', label: 'Plugin', token: 1 }]) {
    assert.ok([400, 403].includes((await f.admin('/api/game-plugin/keys', body)).status));
  }
  assert.equal((await self('/api/game-plugin/keys', { memberId: 'reed', label: 'Wrong owner' })).status, 403);
  assert.equal((await f.request('/api/game-plugin/keys', { body: { memberId: 'actor1', label: 'No access' }, headers: { Cookie: viewer.cookie } })).status, 403);
  const response = await self('/api/game-plugin/keys', { memberId: 'actor1', label: ' My plugin ' }); assert.equal(response.status, 201);
  const first = await response.json(); assert.match(first.key, /^gpk_[A-Za-z0-9_-]{43}$/); assert.equal(first.record.label, 'My plugin');
  await f.create(); await f.create();
  assert.equal((await self('/api/game-plugin/keys', { memberId: 'actor1', label: 'Fourth' })).status, 409);
  const other = await f.create('reed');
  assert.equal((await self(`/api/game-plugin/keys/${other.record.id}/revoke`, {})).status, 404);
  const ownList = await (await self('/api/game-plugin')).json(); assert.equal(ownList.keys.length, 3); assert.ok(ownList.keys.every(record => record.player === 'actor1'));
  const viewerList = await (await f.request('/api/game-plugin', { headers: { Cookie: viewer.cookie } })).json(); assert.deepEqual(viewerList.keys, []);
  const disk = await readFile(path.join(f.dataDir, 'plugin-keys.json'), 'utf8');
  assert.equal(disk.includes(first.key), false); assert.equal(JSON.stringify(ownList).includes('tokenHash'), false);
  assert.equal(JSON.parse(disk).keys.find(row => row.id === first.record.id).tokenHash, createHash('sha256').update(first.key).digest('hex'));
  const backup = await (await f.admin('/api/backup')).text(); assert.equal(backup.includes(first.record.id), false); assert.equal(backup.includes('tokenHash'), false);
  assert.equal(f.app.store.getInfo().revision, 0);
  await f.restart(); assert.equal((await f.plugin('/api/plugin/v1/status', first.key)).status, 200);
  assert.equal((await f.admin(`/api/game-plugin/keys/${first.record.id}/revoke`, {})).status, 200);
  await f.create();
  assert.equal((await f.plugin('/api/plugin/v1/status', first.key)).status, 401);
  await f.restart(); assert.equal((await f.plugin('/api/plugin/v1/status', first.key)).status, 401);
  const revoked = (await (await f.admin('/api/game-plugin')).json()).keys.find(row => row.id === first.record.id); assert.equal(revoked.revoked, true);
});

test('plugin credentials and picker credentials are isolated in both directions, including cookie fallback after revocation', async t => {
  const f = await fixture(t), created = await f.create();
  const owner = await f.invite({ label: 'Player', memberId: 'actor1' });
  const adminCookie = cookieFrom(await f.request(`/join/${f.app.store.getAccessToken()}`));
  const overlayResponse = await f.admin('/api/overlays', { label: 'OBS', widget: 'count', player: 'duo' }); assert.equal(overlayResponse.status, 201);
  const overlay = await overlayResponse.json(), overlayKey = new URLSearchParams(new URL(overlay.link).hash.slice(1)).get('key');
  for (const headers of [{}, { Cookie: owner.cookie }, { Cookie: adminCookie }, { Authorization: `Bearer ${f.app.store.getAccessToken()}` }, { Authorization: `Bearer ${overlayKey}` }, { Authorization: `Bearer ${new URL(owner.link).pathname.split('/').at(-1)}` }]) {
    assert.equal((await f.request('/api/plugin/v1/status', { headers })).status, 401);
    assert.equal((await f.request('/api/plugin/v1/report', { body: report(), headers })).status, 401);
  }
  for (const cookie of [owner.cookie, adminCookie]) {
    for (const [route, body] of [['/api/state'], ['/api/session'], ['/api/history'], ['/api/backup'], ['/api/events'], ['/api/game-plugin'], ['/api/game-plugin/review?memberId=actor1'], ['/api/command', {}], ['/api/game-plugin/keys', {}], ['/api/game-plugin/apply', {}], ['/api/unknown', {}], ['/overlay/data?widget=count&player=duo&variant=full']]) {
      assert.equal((await f.plugin(route, created.key, body, { Cookie: cookie })).status, 401, route);
    }
  }
  assert.equal((await f.request(`/api/plugin/v1/status?key=${created.key}`)).status, 401);
  assert.equal((await f.plugin('/api/plugin/v1/status?extra=1', created.key)).status, 400);
  assert.equal((await f.plugin('/api/plugin/v1/status', created.key, {})).status, 405);
  assert.equal((await f.admin(`/api/game-plugin/keys/${created.record.id}/revoke`, {})).status, 200);
  assert.equal((await f.plugin('/api/state', created.key, undefined, { Cookie: adminCookie })).status, 401);
  assert.equal((await f.plugin('/api/plugin/v1/status', created.key, undefined, { Cookie: adminCookie })).status, 401);
  assert.equal((await f.request('/api/state', { headers: { Cookie: adminCookie } })).status, 200);
});

test('plugin exact routes allow no-Origin native clients through Funnel while preserving browser Origin and master-key restrictions', async t => {
  const publicOrigin = 'https://picker.example', f = await fixture(t, { publicOrigin });
  const first = await f.create(), second = await f.create();
  const funnel = { Host: 'picker.example', 'Tailscale-Funnel-Request': '?1', 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https' };
  assert.equal((await f.plugin('/api/plugin/v1/status', first.key, undefined, funnel)).status, 200);
  const native = await f.plugin('/api/plugin/v1/report', first.key, report(), funnel);
  assert.equal(native.status, 200);
  assert.equal((await f.plugin('/api/plugin/v1/status', first.key, undefined, { ...funnel, Origin: publicOrigin })).status, 200);
  assert.equal((await f.plugin('/api/plugin/v1/status', first.key, undefined, { ...funnel, Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.plugin('/api/plugin/v1/report', second.key, report(), { ...funnel, Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.plugin('/api/plugin/v1/status', second.key, undefined, { ...funnel, Origin: publicOrigin, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.admin('/api/state', undefined, funnel)).status, 401);
  assert.equal((await f.admin('/api/command', { expectedRevision: 0, command: { type: 'set-journal', memberId: 'actor1', note: 'Wrong origin' } }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.plugin('/api/plugin/v1/status/extra', second.key)).status, 401);
});

test('position stays ephemeral, optional progress deltas wait for explicit review/apply, and dismissed observations never reach History', async t => {
  const f = await fixture(t), created = await f.create(), owner = await f.invite({ label: 'Player', memberId: 'actor1' }), other = await f.invite({ label: 'Reed', memberId: 'reed' });
  const baseline = f.app.store.getState(), backupBefore = await (await f.admin('/api/backup')).text();
  const first = await f.plugin('/api/plugin/v1/report', created.key, report(0, { world: { id: 84, beta: false }, skills: { ATTACK: { level: 20, xp: 4470.5 } } }));
  assert.equal(first.status, 200); const status = await first.json();
  assert.equal(status.chunkId, '11825'); assert.equal(status.state, 'unlocked'); assert.equal(status.pendingProgress, true);
  assert.equal(status.nearby.length, 25); assert.deepEqual(status.nearby[12], { chunkId: '11825', state: 'unlocked', by: 'me' });
  for (const row of status.nearby) assert.deepEqual(Object.keys(row), row.state === 'unlocked' ? ['chunkId', 'state', 'by'] : ['chunkId', 'state']);
  assert.deepEqual(status.pendingRoll, []); assert.ok(Array.isArray(status.partners));
  for (const partner of status.partners) assert.deepEqual(Object.keys(partner), ['name', 'chunkId', 'chunkName', 'seenAt']);
  for (const privateField of ['Private journal', 'completedTasks', 'skillProgress', 'tokenHash', 'history']) assert.equal(JSON.stringify(status).includes(privateField), false);
  assert.equal((await f.plugin('/api/plugin/v1/report', created.key, report(1, { quests: { finished: ['Unrecognized quest'], started: ['Unrecognized started quest'] } }))).status, 200);
  assert.equal((await f.plugin('/api/plugin/v1/report', created.key, report(2))).status, 200);
  assert.deepEqual(f.app.store.getState(), baseline);
  assert.equal(await (await f.admin('/api/backup')).text(), backupBefore);
  const list = await (await f.admin('/api/game-plugin')).json(); assert.equal(list.active, true); assert.equal(list.positions[0].chunkId, '11825');
  const preview = await (await f.request('/api/game-plugin/review?memberId=actor1', { headers: { Cookie: owner.cookie } })).json();
  assert.equal(preview.skills[0].after.xp, 4470.5); assert.equal(preview.unmatched.quests.length, 2); assert.deepEqual(preview.world, { id: 84, beta: false });
  assert.equal((await f.request('/api/game-plugin/apply', { body: { previewId: preview.previewId, expectedRevision: preview.stateRevision }, headers: { Cookie: other.cookie } })).status, 403);
  assert.equal((await f.admin('/api/game-plugin/apply', { previewId: preview.previewId, expectedRevision: preview.stateRevision + 1 })).status, 409);
  const applied = await f.request('/api/game-plugin/apply', { body: { previewId: preview.previewId, expectedRevision: preview.stateRevision }, headers: { Cookie: owner.cookie } });
  assert.equal(applied.status, 200, await applied.clone().text());
  const progress = f.app.store.getState().members[0].skillProgress.Attack;
  assert.deepEqual(progress, { level: 20, xp: 4470.5, source: 'game-plugin', memberId: 'actor1', fetchedAt: sentAt });
  assert.equal(f.app.store.getInfo().revision, 1); assert.equal(f.app.store.getState().history.at(-1).type, 'apply-game-progress');
  assert.deepEqual(await (await f.admin('/api/game-plugin/review?memberId=actor1')).json(), { preview: null });
  assert.equal((await f.admin('/api/game-plugin/apply', { previewId: preview.previewId, expectedRevision: 1 })).status, 410);
  assert.equal((await f.plugin('/api/plugin/v1/report', created.key, report(3, { skills: { ATTACK: { level: 21, xp: 5018 } } }))).status, 200);
  const dismissed = await (await f.admin('/api/game-plugin/review?memberId=actor1')).json();
  assert.equal((await f.admin('/api/game-plugin/dismiss', { previewId: dismissed.previewId })).status, 200);
  assert.equal(f.app.store.getInfo().revision, 1);
  await f.restart(); const after = await (await f.admin('/api/game-plugin')).json(); assert.deepEqual(after.positions, []); assert.equal(after.active, false);
  const persistedKey = after.keys.find(record => record.id === created.record.id);
  assert.deepEqual(persistedKey.lastWorld, { id: 84, beta: false }); assert.ok(Number.isFinite(Date.parse(persistedKey.lastUsedAt)));
  assert.deepEqual(await (await f.admin('/api/game-plugin/review?memberId=actor1')).json(), { preview: null });
  assert.equal(f.app.store.getState().members[0].skillProgress.Attack.xp, 4470.5);
});

test('plugin sequence ordering is per key and stale reports do not overwrite the observed position', async t => {
  const f = await fixture(t), first = await f.create(), second = await f.create();
  assert.equal((await f.plugin('/api/plugin/v1/report', first.key, report(5))).status, 200);
  assert.equal((await f.plugin('/api/plugin/v1/report', first.key, report(5, { position: { x: 0, z: 0, floor: 0 } }))).status, 409);
  assert.equal((await f.plugin('/api/plugin/v1/report', first.key, report(4))).status, 409);
  const status = await (await f.plugin('/api/plugin/v1/status', first.key)).json(); assert.equal(status.chunkId, '11825');
  assert.equal((await f.plugin('/api/plugin/v1/report', second.key, report(0, { position: { x: 45, z: 49, floor: 1 } }))).status, 200);
  assert.equal((await (await f.plugin('/api/plugin/v1/status', second.key)).json()).chunkId, '11569');
  assert.equal(f.app.store.getInfo().revision, 0);
});

test('plugin diagnostics stay in memory and are listed only with their own key', async t => {
  const f = await fixture(t), mine = await f.create(), other = await f.create('reed');
  const owner = await f.invite({ label: 'Player', memberId: 'actor1' }), viewer = await f.invite({ label: 'Viewer', viewer: true });
  const lines = ['Skills: 29/29', 'Quests: config.Quest; count=360'];
  assert.equal((await f.plugin('/api/plugin/v1/report', mine.key, report(0, { diagnostics: lines }))).status, 200);
  const own = await (await f.request('/api/game-plugin', { headers: { Cookie: owner.cookie } })).json();
  assert.deepEqual(own.keys.map(row => row.diagnostics?.lines ?? null), [lines]);
  const admin = await (await f.admin('/api/game-plugin')).json();
  assert.equal(admin.keys.find(row => row.id === other.record.id).diagnostics, null);
  assert.deepEqual((await (await f.request('/api/game-plugin', { headers: { Cookie: viewer.cookie } })).json()).keys, []);
  assert.equal(f.app.store.getInfo().revision, 0);
  await f.restart();
  assert.equal((await (await f.admin('/api/game-plugin')).json()).keys.find(row => row.id === mine.record.id).diagnostics, null);
});

test('plugin GET and POST share a four-request-per-second key bucket and report bodies have a 16 KiB limit', async t => {
  const f = await fixture(t), first = await f.create(), second = await f.create();
  for (let seq = 0; seq < 2; seq++) {
    assert.equal((await f.plugin('/api/plugin/v1/status', first.key)).status, 200);
    assert.equal((await f.plugin('/api/plugin/v1/report', first.key, report(seq))).status, 200);
  }
  const limited = await f.plugin('/api/plugin/v1/status', first.key); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
  assert.equal((await f.plugin('/api/plugin/v1/status', second.key)).status, 200, 'Separate keys have separate rate buckets');
  const oversized = await f.plugin('/api/plugin/v1/report', second.key, report(0, { padding: 'x'.repeat(16384) })); assert.equal(oversized.status, 413);
  assert.equal((await f.plugin('/api/plugin/v1/report', second.key, report(0, { position: { x: 200, z: 49, floor: 0 } }))).status, 400);
  assert.equal(f.app.store.getInfo().revision, 0);
  await delay(1050);
  assert.equal((await f.plugin('/api/plugin/v1/status', first.key)).status, 200);
});

test('invalid plugin key sidecars fail startup and release the gameplay directory lock for recovery', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-invalid-'));
  let app;
  t.after(async () => { await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  await prepareGameStorage(dataDir, fixtureDataset);
  const sidecar = path.join(dataDir, 'plugin-keys.json');
  await writeFile(sidecar, JSON.stringify({ schemaVersion: 1, keys: [{ id: 'malformed' }] }));
  const options = { dataset: fixtureDataset, dataDir, definitions, taskMap: {}, host: '127.0.0.1', port: 0, publicOrigin: undefined, loopbackPort: undefined, predictionPrewarm: false };
  await assert.rejects(createServer(options), /Invalid plugin key record/);
  await writeFile(sidecar, JSON.stringify({ schemaVersion: 1, keys: [] }));
  app = await createServer(options); await app.listen();
  assert.ok(app.address().port > 0);
});
