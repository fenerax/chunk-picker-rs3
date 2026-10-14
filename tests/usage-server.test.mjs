import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, apiPermission } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { openUsageRoute } from '../app/usage-route.mjs';

const now = () => new Date('2026-10-13T12:00:00Z');
const row = (extra = {}) => ({ id: usageEvents[0].id, actor: 'actor1', device: 'desktop', day: '2026-10-13', count: 1, ...extra });
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-usage-api-'));
  const app = await createServer({ dataDir, port: 0, now,
    definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] }, taskMap: {},
    initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]),
    predictionPrewarm: false, mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'), ...options });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const adminHeaders = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = (route, { headers = adminHeaders, body, raw, method, ...extra } = {}) => fetch(origin + route, {
    ...extra, redirect: 'manual', method: method ?? (body === undefined && raw === undefined ? 'GET' : 'POST'),
    headers: { ...headers, ...(body === undefined && raw === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    ...(raw === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: raw }),
  });
  async function join(input) {
    const created = await request('/api/invites', { body: input }); assert.equal(created.status, 201);
    const details = await created.json();
    const joined = await request(new URL(details.link).pathname, { headers: {} }); assert.equal(joined.status, 303);
    return { headers: { Cookie: joined.headers.get('set-cookie').split(';')[0] }, inviteId: details.invite.id, link: details.link };
  }
  return { app, dataDir, origin, adminHeaders, request, join };
}

async function gameplayFiles(directory, prefix = '') {
  const snapshot = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['usage.json', 'invites.json', 'assets', 'game-data'].includes(entry.name)) continue;
    const relative = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await gameplayFiles(file, relative + '/'));
    else snapshot[relative] = (await readFile(file)).toString('base64');
  }
  return snapshot;
}

test('usage accepts viewer aggregates, binds actor to sign-in and leaves gameplay and backups untouched', async t => {
  const f = await fixture(t, { usageRateLimits: { perIdentity: 100 } });
  const viewer = await f.join({ viewer: true, label: 'Viewer' });
  const player = await f.join({ memberId: 'reed', label: 'Reed' });
  const unlinked = await f.join({ label: 'Unlinked player' });
  const unlinkedAdmin = await f.join({ admin: true, label: 'Administrator' });
  const beforeState = f.app.store.getState(), beforeFiles = await gameplayFiles(f.dataDir);
  for (const [headers, actor, device] of [[viewer.headers, 'reed', 'phone'], [player.headers, 'actor1', 'desktop'],
    [unlinked.headers, 'reed', 'desktop'], [unlinkedAdmin.headers, 'reed', 'desktop'], [f.adminHeaders, 'reed', 'desktop']]) {
    const result = await f.request('/api/usage', { headers, body: { counts: [row({ actor, device })] } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { accepted: true });
  }
  const report = await f.request('/api/usage'); assert.equal(report.status, 200);
  assert.match(report.headers.get('cache-control'), /no-store/);
  assert.match(report.headers.get('content-security-policy'), /script-src 'self'/);
  const body = await report.json();
  assert.deepEqual(Object.keys(body).sort(), ['counts', 'schemaVersion']);
  assert.equal(body.schemaVersion, 1);
  assert.deepEqual(body.counts.find(item => item.actor === 'viewer'), row({ actor: 'viewer', device: 'phone' }));
  assert.deepEqual(body.counts.find(item => item.actor === 'reed'), row({ actor: 'reed' }));
  assert.deepEqual(body.counts.find(item => item.actor === 'actor1'), row());
  assert.deepEqual(body.counts.find(item => item.actor === 'unlinked'), row({ actor: 'unlinked', count: 2 }));
  assert.equal((await f.request('/api/usage', { headers: unlinkedAdmin.headers })).status, 200);
  for (const headers of [viewer.headers, player.headers, unlinked.headers]) {
    assert.equal((await f.request('/api/usage', { headers })).status, 403);
    assert.equal((await f.request('/api/usage', { headers, method: 'HEAD' })).status, 403);
  }
  const forbiddenCommand = await f.request('/api/command', { headers: viewer.headers,
    body: { expectedRevision: beforeState.revision, command: { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'unlocked' } } });
  assert.equal(forbiddenCommand.status, 403);
  for (const route of ['/api/usage/', '/api/usage/extra', '/api/feedback']) {
    assert.equal((await f.request(route, { headers: viewer.headers, body: { counts: [row()] } })).status, 403);
  }
  assert.deepEqual(f.app.store.getState(), beforeState);
  assert.deepEqual(await gameplayFiles(f.dataDir), beforeFiles);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, 'usage.json'), 'utf8')), body);
  assert.equal(apiPermission('POST', '/api/usage'), 'usage');
  assert.equal(apiPermission('GET', '/api/usage'), 'admin');
  assert.equal(apiPermission('POST', '/api/usage/extra'), undefined);
});

test('usage enforces authentication, origin, schema and the narrow 32 KiB body limit', async t => {
  const f = await fixture(t, { usageRateLimits: { perIdentity: 100 } });
  assert.equal((await f.request('/api/usage', { headers: {} })).status, 401);
  assert.equal((await f.request('/api/usage', { headers: {}, body: { counts: [row()] } })).status, 401);
  const rejectedOrigin = await fetch(f.origin + '/api/usage', { method: 'POST',
    headers: { ...f.adminHeaders, Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ counts: [row()] }) });
  assert.equal(rejectedOrigin.status, 403);
  for (const raw of ['{', '[]', JSON.stringify({ counts: [row()], events: [] }), JSON.stringify({ counts: [row({ url: 'private' })] }),
    JSON.stringify({ counts: [row({ id: 'unknown' })] }), JSON.stringify({ counts: [row({ actor: 'unknown' })] }),
    JSON.stringify({ counts: Array(201).fill(row()) }), JSON.stringify({ counts: [row({ day: '2026-10-14' })] })]) {
    assert.equal((await f.request('/api/usage', { raw })).status, 400);
  }
  assert.equal((await f.request('/api/usage', { raw: ' '.repeat(32 * 1024 + 1) })).status, 413);
  assert.equal((await f.request('/api/usage', { body: { counts: [row()] } })).status, 200, 'a rejected body does not corrupt storage');
  assert.equal((await f.request('/api/usage', { method: 'PUT' })).status, 405);
});

test('usage rate limits apply across sessions for one invitation and across identities globally', async t => {
  const f = await fixture(t, { usageRateLimits: { perIdentity: 1, global: 2 } });
  const viewer = await f.join({ viewer: true, label: 'Viewer' });
  assert.equal((await f.request('/api/usage', { headers: viewer.headers, body: { counts: [row()] } })).status, 200);
  const secondSession = await f.request(new URL(viewer.link).pathname, { headers: {} });
  assert.equal(secondSession.status, 303);
  const otherCookie = secondSession.headers.get('set-cookie').split(';')[0];
  assert.notEqual(otherCookie, viewer.headers.Cookie);
  const limited = await f.request('/api/usage', { headers: { Cookie: otherCookie }, body: { counts: [row()] } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await f.request('/api/usage', { body: { counts: [row()] } })).status, 200);
  const other = await f.join({ memberId: 'reed', label: 'Reed' });
  assert.equal((await f.request('/api/usage', { headers: other.headers, body: { counts: [row()] } })).status, 429);
  assert.equal((await f.request('/api/usage')).status, 200, 'rate limits do not block administrator reads');
  assert.equal((await f.request('/api/command', { body: { expectedRevision: f.app.store.getInfo().revision,
    command: { type: 'set-rule', ruleId: 'access.shared', value: false } } })).status, 200, 'usage rate limits do not affect gameplay saves');
});

test('usage reauthenticates after receiving a slow body before persisting any counts', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-usage-revoke-'));
  let release, received;
  const entered = new Promise(resolve => { received = resolve; });
  const body = new Promise(resolve => { release = resolve; });
  let authenticated = { kind: 'invite', inviteId: 'test-invite', readOnly: true, admin: false };
  const route = await openUsageRoute({ dataDir, members: [{ id: 'actor1' }, { id: 'reed' }], now,
    authenticate: () => authenticated,
    bodyJSON: async () => { received(); return body; },
    json: () => assert.fail('A revoked session must not receive an accepted response'),
  });
  t.after(async () => { await route.close(); await rm(dataDir, { recursive: true, force: true }); });
  const pending = route.handle({ method: 'POST' }, {}, { route: '/api/usage', identity: authenticated,
    security: {}, closed: () => false, checkRequestOrigin: () => {} });
  const rejection = assert.rejects(pending, { status: 401 });
  await entered; authenticated = null; release({ counts: [row()] });
  await rejection;
  assert.deepEqual(await readdir(dataDir), []);
});
