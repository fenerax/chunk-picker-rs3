import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openInviteStore } from '../app/storage/invites.mjs';
import { clientAddress, isPrivateClient, requestContext, checkRequestOrigin, createRateLimits, normalizePublicOrigin } from '../app/security/request.mjs';

const root = fileURLToPath(new URL('../.local/invite-tests/', import.meta.url));
const masterToken = 'legacy-private-master-token';
const privateContext = { masterAllowed: true, secure: false };
const publicContext = { masterAllowed: false, publicRequest: true, secure: true };
const cookieRequest = token => ({ headers: { cookie: `duo_access=${token}` } });
const digest = token => createHash('sha256').update(token).digest('hex');
async function fixture(t, options = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'storage-'));
  let store = await openInviteStore({ dataDir, masterToken, masterLabel: 'Test administrator', ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, get store() { return store; }, async restart() {
    await store.close(); store = await openInviteStore({ dataDir, masterToken, masterLabel: 'Test administrator', ...options }); return store;
  } };
}

test('a dataset may supply its administrator display label without changing permissions', async t => {
  const f = await fixture(t, { masterLabel: 'Administrator' });
  const principal = f.store.authenticate({ headers: { authorization: `Bearer ${masterToken}` } }, privateContext);
  assert.equal(principal.label, 'Administrator');
  assert.equal(principal.actor.label, 'Administrator');
  assert.equal(principal.admin, true);
  assert.equal(principal.readOnly, false);
});

test('invite/session secrets are one-time, hashed, persisted and revoked across restart', async t => {
  const f = await fixture(t);
  const { invite, token } = await f.store.create({ label: ' Reed ' });
  assert.equal(invite.label, 'Reed'); assert.equal(invite.admin, false);
  assert.equal(invite.lastUsedAt, null); assert.equal(invite.revoked, false);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Object.hasOwn(invite, 'tokenHash'), false);
  assert.equal(JSON.stringify(f.store.list()).includes(token), false);
  const session = await f.store.join(token, publicContext);
  assert.match(session, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(token, session);
  const savedText = await readFile(path.join(f.dataDir, 'invites.json'), 'utf8');
  assert.equal(savedText.includes(token), false); assert.equal(savedText.includes(session), false);
  assert.equal(savedText.includes(masterToken), false);
  const saved = JSON.parse(savedText);
  assert.equal(saved.invites[0].tokenHash, digest(token));
  assert.equal(saved.sessions[0].tokenHash, digest(session));
  assert.ok(f.store.list()[0].lastUsedAt);
  await f.restart();
  const identity = f.store.authenticate(cookieRequest(session), publicContext);
  assert.deepEqual(identity.actor, { kind: 'invite', inviteId: invite.id, label: 'Reed' });
  assert.equal(identity.admin, false);
  assert.equal(f.store.authenticate(cookieRequest(token), publicContext), null);
  await f.store.revoke(invite.id);
  assert.equal(f.store.authenticate(cookieRequest(session), publicContext), null);
  assert.equal(f.store.active(identity, publicContext), false);
  assert.equal(await f.store.join(token, publicContext), null);
  await f.restart();
  assert.equal(f.store.list()[0].revoked, true);
  assert.equal(f.store.authenticate(cookieRequest(session), publicContext), null);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, 'invites.json'), 'utf8')).sessions, []);
});

test('master compatibility stays private and expired sessions cannot authenticate', async t => {
  let at = Date.parse('2026-10-08T00:00:00Z');
  const f = await fixture(t, { now: () => at });
  const master = f.store.authenticate({ headers: { authorization: `Bearer ${masterToken}` } }, privateContext);
  assert.equal(master.label, 'Test administrator');
  assert.equal(master.actor.label, 'Test administrator');
  await assert.rejects(() => f.store.join(masterToken, publicContext), { status: 403 });
  for (const request of [cookieRequest(masterToken), { headers: { authorization: `Bearer ${masterToken}` } }]) {
    assert.throws(() => f.store.authenticate(request, publicContext), { status: 403 });
    assert.equal(f.store.authenticate(request, privateContext).admin, true);
  }
  const masterSession = await f.store.join(masterToken, privateContext);
  assert.throws(() => f.store.authenticate(cookieRequest(masterSession), publicContext), { status: 403 });
  assert.equal(f.store.authenticate(cookieRequest(masterSession), privateContext).kind, 'master');
  const { token } = await f.store.create({ label: 'Admin', admin: true });
  await assert.rejects(() => f.store.join(token, publicContext), { status: 403 });
  const session = await f.store.join(token, privateContext);
  assert.throws(() => f.store.authenticate(cookieRequest(session), publicContext), { status: 403 });
  assert.equal(f.store.authenticate(cookieRequest(session), privateContext).admin, true);
  at += 30 * 24 * 60 * 60 * 1000;
  assert.equal(f.store.authenticate(cookieRequest(session), publicContext), null);
  assert.match(f.store.cookie(session, publicContext), /; Secure$/);
  assert.doesNotMatch(f.store.cookie(session, privateContext), /; Secure/);
});

test('authenticated activity persists last-used time at one-minute intervals and never revives a revoked invite', async t => {
  let at = Date.parse('2026-10-08T00:00:00Z');
  const startedAt = at;
  const f = await fixture(t, { now: () => at });
  const { invite, token } = await f.store.create({ label: 'Reed' });
  const session = await f.store.join(token, publicContext);
  const identity = f.store.authenticate(cookieRequest(session), publicContext);
  const joinedAt = new Date(startedAt).toISOString();
  assert.equal(f.store.list()[0].lastUsedAt, joinedAt);
  at = startedAt + 59999;
  await f.store.touch(identity);
  assert.equal(f.store.list()[0].lastUsedAt, joinedAt);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir, 'invites.json'), 'utf8')).invites[0].lastUsedAt, joinedAt);
  at = startedAt + 60000;
  await f.store.touch(identity);
  const usedAt = new Date(at).toISOString();
  assert.equal(f.store.list()[0].lastUsedAt, usedAt);
  await f.restart();
  assert.equal(f.store.list()[0].lastUsedAt, usedAt);
  await f.store.revoke(invite.id);
  at += 60000;
  await f.store.touch(identity);
  await f.restart();
  assert.equal(f.store.list()[0].revoked, true);
  assert.equal(f.store.list()[0].lastUsedAt, usedAt);
  assert.equal(f.store.authenticate(cookieRequest(session), publicContext), null);
  assert.equal(await f.store.join(token, publicContext), null);
});

test('session cap evicts exactly the eldest session and expiry occurs at the fake-clock boundary', async t => {
  let at = Date.parse('2026-10-08T00:00:00Z');
  const startedAt = at;
  const f = await fixture(t, { now: () => at });
  const { token } = await f.store.create({ label: 'Reed' });
  const sessions = [];
  for (let index = 0; index < 32; index++) {
    sessions.push(await f.store.join(token, publicContext)); at++;
  }
  assert.ok(f.store.authenticate(cookieRequest(sessions[0]), publicContext));
  sessions.push(await f.store.join(token, publicContext));
  assert.equal(f.store.authenticate(cookieRequest(sessions[0]), publicContext), null);
  assert.ok(f.store.authenticate(cookieRequest(sessions[1]), publicContext));
  assert.ok(f.store.authenticate(cookieRequest(sessions[32]), publicContext));
  const lifetime = 30 * 24 * 60 * 60 * 1000;
  at = startedAt + lifetime;
  assert.ok(f.store.authenticate(cookieRequest(sessions[1]), publicContext));
  at++;
  assert.equal(f.store.authenticate(cookieRequest(sessions[1]), publicContext), null);
  assert.ok(f.store.authenticate(cookieRequest(sessions[2]), publicContext));
  await f.store.join(token, publicContext);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'invites.json'), 'utf8'));
  assert.equal(saved.sessions.length, 32);
  assert.equal(saved.sessions.some(session => session.tokenHash === digest(sessions[1])), false);
});

test('malformed invite inputs and sidecar fail closed without replacing valid records', async t => {
  const f = await fixture(t);
  await f.store.create({ label: 'Reed' });
  for (const input of [{ label: '' }, { label: 'x\n' }, { label: 'x\u0085' }, { label: 'x\u009f' }, { label: 'x'.repeat(81) }, { label: 'Reed', admin: 'true' }, { label: 'Reed', token: 'injected' }]) {
    await assert.rejects(async () => f.store.create(input), { status: 400 });
  }
  assert.equal(f.store.list().length, 1);
  await assert.rejects(() => f.store.revoke('missing'), { status: 404 });
  await f.store.close();
  const invalid = { schemaVersion: 1, invites: [], sessions: [], token: masterToken };
  await writeFile(path.join(f.dataDir, 'invites.json'), JSON.stringify(invalid));
  await assert.rejects(() => openInviteStore({ dataDir: f.dataDir, masterToken }), /Invalid invite store/);
});

const request = (peer, headers = {}, encrypted = false) => ({ socket: { remoteAddress: peer, encrypted }, headers: { host: 'picker.example', ...headers } });
test('private network boundaries canonicalize mapped IPv4 and enforce IPv6 prefix edges', () => {
  for (const ip of ['127.0.0.1', '127.255.255.255', '::1', '100.64.0.0', '100.127.255.255', '::ffff:100.64.0.1', 'fd7a:115c:a1e0::', 'fd7a:115c:a1e0:ffff:ffff:ffff:ffff:ffff']) assert.equal(isPrivateClient(ip), true, ip);
  for (const ip of ['100.63.255.255', '100.128.0.0', '192.168.1.1', '10.0.0.1', 'fd7a:115c:a1df:ffff::1', 'fd7a:115c:a1e1::', '::', '2001:db8::1', 'fd7a:115c:a1e0::1%Ethernet', 'invalid']) assert.equal(isPrivateClient(ip), false, ip);
  assert.equal(clientAddress('::ffff:6440:1'), '100.64.0.1');
  assert.equal(clientAddress('2001:0db8:0000::1'), '2001:db8::1');
});

test('only local or exact bound-host proxies influence client address and HTTPS', () => {
  const options = { host: '100.80.1.2', publicOrigin: 'https://picker.example' };
  const spoof = requestContext(request('100.80.1.3', { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' }), options);
  assert.equal(spoof.trustedProxy, false); assert.equal(spoof.address, '100.80.1.3'); assert.equal(spoof.secure, false);
  for (const peer of ['127.0.0.1', '::1', '100.80.1.2', '::ffff:100.80.1.2']) {
    const context = requestContext(request(peer, { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' }), options);
    assert.equal(context.trustedProxy, true, peer); assert.equal(context.address, '203.0.113.7');
    assert.equal(context.masterAllowed, false); assert.equal(context.secure, true);
  }
  for (const forwarded of ['127.0.0.1, 203.0.113.7', 'unknown', '', '[::1]', '127.0.0.1:123']) {
    const context = requestContext(request('127.0.0.1', { 'x-forwarded-for': forwarded }), options);
    assert.equal(context.address, null, forwarded); assert.equal(context.masterAllowed, false);
  }
  assert.equal(requestContext(request('127.0.0.1', { 'tailscale-funnel-request': 'false' }), options).masterAllowed, false);
  assert.equal(requestContext(request('100.80.1.3', { 'tailscale-funnel-request': 'spoof' }), options).masterAllowed, false);
  assert.equal(requestContext(request('100.80.1.3', {}, true), options).secure, true);
});

test('Funnel mutations require exact configured HTTPS host, same Origin and same-site fetch', () => {
  const options = { host: '127.0.0.1', publicOrigin: 'https://picker.example' };
  const headers = { 'tailscale-funnel-request': 'true', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https', origin: options.publicOrigin };
  const good = request('127.0.0.1', headers);
  assert.doesNotThrow(() => checkRequestOrigin(good, requestContext(good, options)));
  for (const extra of [{ origin: undefined }, { origin: 'https://foreign.example' }, { host: 'arbitrary.example', origin: 'https://arbitrary.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const bad = request('127.0.0.1', { ...headers, ...extra });
    assert.throws(() => checkRequestOrigin(bad, requestContext(bad, options)), { status: 403 });
  }
  const untrusted = request('203.0.113.7', { origin: options.publicOrigin, 'x-forwarded-proto': 'https' });
  const untrustedContext = requestContext(untrusted, options);
  assert.equal(untrustedContext.secure, false);
  assert.throws(() => checkRequestOrigin(untrusted, untrustedContext), { status: 403 });
  for (const value of ['http://picker.example', 'https://picker.example/', 'https://picker.example/path', 'https://user:pass@picker.example']) assert.throws(() => normalizePublicOrigin(value));
});

test('default abuse limits are ten failed joins per fifteen minutes and sixty unauthenticated requests per minute', () => {
  let at = 1000;
  const limits = createRateLimits({ now: () => at });
  for (let i = 0; i < 10; i++) { limits.joinAllowed('A'); limits.joinFailed('A'); }
  assert.throws(() => limits.joinAllowed('A'), { status: 429, retryAfter: 900 });
  assert.doesNotThrow(() => limits.joinAllowed('B'));
  for (let i = 0; i < 60; i++) limits.unauthenticated('A');
  assert.throws(() => limits.unauthenticated('A'), { status: 429, retryAfter: 60 });
  at += 60000;
  assert.doesNotThrow(() => limits.unauthenticated('A'));
  assert.throws(() => limits.joinAllowed('A'), { status: 429, retryAfter: 840 });
  at += 840000;
  assert.doesNotThrow(() => limits.joinAllowed('A'));
});

test('rate limiter capacity cannot evict an active bucket to bypass a limit', () => {
  const limits = createRateLimits({ now: () => 0, unauthenticated: 1, maxClients: 1 });
  limits.unauthenticated('A'); limits.unauthenticated('B');
  assert.throws(() => limits.unauthenticated('A'), { status: 429 });
  assert.throws(() => limits.unauthenticated('C'), { status: 429 });
});

test('in-flight join reservations prevent parallel brute force and successful joins refund only once', () => {
  const limits = createRateLimits({ failedJoins: 2 });
  const success = limits.beginJoin('A');
  const failure = limits.beginJoin('A');
  assert.throws(() => limits.beginJoin('A'), { status: 429 });
  success(true); success(true); failure(false);
  const another = limits.beginJoin('A');
  assert.throws(() => limits.beginJoin('A'), { status: 429 });
  another(false);
  assert.doesNotThrow(() => limits.beginJoin('B'));
});
