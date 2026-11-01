import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSignIn } from '../app/signin.mjs';
import { openAccountStore } from '../app/storage/accounts.mjs';

const security = { ingressRole: 'public', publicRequest: true, secure: true, origin: 'https://picker.example', rateKey: 'fixture' };
function response() {
  return { headers: {}, status: 0, body: '', setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    getHeader(key) { return this.headers[key.toLowerCase()]; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers ?? {})) this.setHeader(key, value); },
    end(value = '') { this.body = String(value); } };
}
const request = (url, cookie) => ({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}) } });
async function fixture(t, input) {
  const root = fileURLToPath(new URL('../.local/signin-provider-tests/', import.meta.url)); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')), file = path.join(directory, 'secret');
  await writeFile(file, randomBytes(32).toString('base64url'));
  const keys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.RS3_DISCORD_CLIENT_ID = 'fixture-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = file;
  delete process.env.RS3_GOOGLE_CLIENT_ID; delete process.env.RS3_GOOGLE_CLIENT_SECRET_FILE;
  let flow;
  t.after(async () => { flow?.close(); for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await rm(directory, { recursive: true, force: true }); });
  flow = await openSignIn({ mode: 'required', publicOrigin: security.origin, ...input });
  return { flow, directory };
}
test('pending sign-in attempts have a hard capacity, expire, and do not call a provider before a valid callback', async t => {
  let at = Date.now(), calls = 0;
  const { flow } = await fixture(t, { provider: { now: () => at, fetch: async () => { calls++; throw Error('Unexpected provider call'); } } });
  let first;
  for (let index = 0; index < 1000; index++) {
    const res = response(); await flow.handle(request('/auth/discord'), res, { route: '/auth/discord', security });
    assert.equal(res.status, 303); first ??= res;
  }
  await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), { status: 429 });
  const preauth = first.getHeader('set-cookie')[0];
  assert.match(preauth, /^__Host-rs3_preauth=/); assert.match(preauth, /HttpOnly; Secure; SameSite=Lax; Max-Age=600$/); assert.doesNotMatch(preauth, /Domain=/);
  at += 600001;
  const state = new URL(first.getHeader('location')).searchParams.get('state');
  const callback = `/auth/discord/callback?state=${state}&code=fixture-code`;
  await assert.rejects(() => flow.handle(request(callback, preauth.split(';')[0]), response(), { route: '/auth/discord/callback', security }), { status: 400 });
  const retry = response(); await flow.handle(request('/auth/discord'), retry, { route: '/auth/discord', security }); assert.equal(retry.status, 303);
  assert.equal(calls, 0);
});

test('a failed new-account claim rolls back the account and its prepared membership', async t => {
  let accounts, prepared = false;
  const invite = { id: randomUUID(), memberId: 'player', admin: false, viewer: false, revoked: false };
  const invites = { get: id => id === invite.id ? invite : null,
    async claim(id, accountId) {
      assert.equal(id, invite.id);
      assert.equal(accounts.get(accountId).memberships[0].inviteId, id);
      prepared = true;
      throw Object.assign(new Error('Fixture claim write failed'), { status: 503 });
    } };
  const accountProxy = { findIdentity: (...args) => accounts.findIdentity(...args), ensureIdentity: (...args) => accounts.ensureIdentity(...args),
    attachMembership: (...args) => accounts.attachMembership(...args), delete: (...args) => accounts.delete(...args) };
  const { flow, directory } = await fixture(t, { accounts: accountProxy, invites, provider: { fetch: async url => {
    if (url === 'https://discord.com/api/oauth2/token') return new Response(JSON.stringify({ access_token: 'fixture-access' }));
    assert.equal(url, 'https://discord.com/api/users/@me');
    return new Response(JSON.stringify({ id: '123456789' }));
  } } });
  accounts = await openAccountStore({ dataDir: directory });
  t.after(() => accounts.close());
  const joined = response();
  await flow.join(request('/join/fixture'), joined, { invite, security });
  const started = response();
  await flow.handle(request('/auth/discord', joined.getHeader('set-cookie')[0].split(';')[0]), started, { route: '/auth/discord', security });
  const authorization = new URL(started.getHeader('location'));
  const route = `/auth/discord/callback?${new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' })}`;
  const preauth = started.getHeader('set-cookie')[0].split(';')[0];
  await assert.rejects(() => flow.handle(request(route, preauth), response(), { route: '/auth/discord/callback', security }), { status: 503 });
  assert.equal(prepared, true); assert.deepEqual(accounts.list(), []);
  await accounts.close(); accounts = await openAccountStore({ dataDir: directory });
  assert.deepEqual(accounts.list(), [], 'Rollback persists across reopening');
  await assert.rejects(() => flow.handle(request(route, preauth), response(), { route: '/auth/discord/callback', security }), { status: 400 });
});

const pendingCookie = res => res.getHeader('set-cookie').filter(value => !value.startsWith('__Host-rs3_preauth=;')).at(-1)?.split(';')[0];
for (const scenario of ['unclaimed', 'unassigned', 'claimed', 'revoked', 'removed', 'admin', 'viewer', 'account', 'picker', 'no invite']) {
  test(`optional cancellation rechecks live invite eligibility: ${scenario}`, async t => {
    let invite = { id: randomUUID(), memberId: 'player', admin: false, viewer: false, revoked: false };
    const { flow } = await fixture(t, { mode: 'optional', invites: { get: id => id === invite?.id ? invite : null } });
    const joined = response();
    if (scenario !== 'no invite') await flow.join(request('/join/fixture'), joined, { invite, security });
    const started = response();
    await flow.handle(request('/auth/discord', scenario === 'no invite' ? undefined : pendingCookie(joined)), started, { route: '/auth/discord', security });
    if (scenario === 'unassigned') invite.memberId = null;
    if (scenario === 'claimed') invite.claimedAccountId = randomUUID();
    if (scenario === 'revoked') invite.revoked = true;
    if (scenario === 'admin') invite.admin = true;
    if (scenario === 'viewer') invite.viewer = true;
    if (scenario === 'removed') invite = null;
    const identity = scenario === 'account' ? { kind: 'account' } : scenario === 'picker' ? { pickerId: randomUUID() } : undefined;
    const state = new URL(started.getHeader('location')).searchParams.get('state');
    const route = `/auth/discord/callback?${new URLSearchParams({ state, error: 'access_denied' })}`;
    const cancelled = response();
    await flow.handle(request(route, pendingCookie(started)), cancelled, { route: '/auth/discord/callback', security, identity });
    assert.equal(cancelled.status, 400);
    assert.match(cancelled.body, /href="\/auth\/discord"/);
    assert.equal(cancelled.body.includes('action="/auth/invite"'), ['unclaimed', 'unassigned'].includes(scenario));
    assert.doesNotMatch(cancelled.body, /action="\/auth\/claim"/);
  });
}
