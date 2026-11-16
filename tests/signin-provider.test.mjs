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
  await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), error => {
    assert.equal(error.status, 429); assert.equal(error.retryAfter, 60);
    assert.match(error.message, /Sign-in is temporarily busy/);
    assert.match(error.message, /minute/); assert.doesNotMatch(error.message, /1000|pending|allowance/);
    const res = response();
    assert.equal(flow.errorPage(request('/auth/discord'), res, security, error, 429), true);
    assert.equal(res.getHeader('retry-after'), 60); assert.match(res.body, /temporarily busy/);
    return true;
  });
  const preauth = first.getHeader('set-cookie')[0];
  assert.match(preauth, /^__Host-rs3_preauth=/); assert.match(preauth, /HttpOnly; Secure; SameSite=Lax; Max-Age=600$/); assert.doesNotMatch(preauth, /Domain=/);
  at += 600001;
  const state = new URL(first.getHeader('location')).searchParams.get('state');
  const callback = `/auth/discord/callback?state=${state}&code=fixture-code`;
  await assert.rejects(() => flow.handle(request(callback, preauth.split(';')[0]), response(), { route: '/auth/discord/callback', security }), { status: 400, message: /request has expired/ });
  const retry = response(); await flow.handle(request('/auth/discord'), retry, { route: '/auth/discord', security }); assert.equal(retry.status, 303);
  assert.equal(calls, 0);
  flow.close();
  await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), {
    status: 503, retryAfter: 60, message: /Sign-in is temporarily unavailable/,
  });
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

async function returnFixture(t, { legacy = false, issueSession = async () => 'fixture-session', ...provider } = {}) {
  const account = { id: 'fixture-account', memberships: [{ id: 'fixture-membership', inviteId: 'fixture-invite', memberId: 'player' }] };
  return fixture(t, {
    accounts: { findIdentity: () => legacy ? account : null },
    pickerRegistry: { firstLogin: async () => ({ account, picker: { id: 'fixture-picker' } }) },
    invites: { get: () => ({ memberId: 'player', claimedAccountId: account.id }),
      issueAccountSession: issueSession, issuePickerSession: issueSession, cookie: token => `duo_access=${token}` },
    provider: { fetch: async url => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'fixture-access' } : { id: '123456789' })), ...provider },
  });
}
async function startReturn(flow, target, direct = false) {
  const page = response();
  await flow.handle(request(`/auth/signin?${new URLSearchParams({ returnTo: target })}`), page, { route: '/auth/signin', security });
  const link = page.body.match(/href="(\/auth\/discord[^\"]*)"/)[1].replaceAll('&amp;', '&');
  assert.equal(pendingCookie(page), undefined, 'Rendering the page allocates no attempt');
  const started = response();
  await flow.handle(request(direct ? `/auth/discord?${new URLSearchParams({ returnTo: target })}` : link), started, { route: '/auth/discord', security });
  const state = new URL(started.getHeader('location')).searchParams.get('state');
  return { started, callback: `/auth/discord/callback?state=${state}&code=fixture-code` };
}
for (const legacy of [false, true]) {
  test(`OAuth returns to a deep link with ${legacy ? 'shared' : 'owned'} picker access`, async t => {
    const { flow } = await returnFixture(t, { legacy });
    const target = '/pickers/fixture-picker/?view=tasks&chunk=12341#task-fixture';
    const { started, callback } = await startReturn(flow, target);
    const completed = response();
    await flow.handle(request(callback + '&returnTo=https://foreign.example', pendingCookie(started)), completed, { route: '/auth/discord/callback', security });
    assert.equal(completed.status, 303); assert.equal(completed.getHeader('location'), target);
    await assert.rejects(() => flow.handle(request(callback, pendingCookie(started)), response(), { route: '/auth/discord/callback', security }), { status: 400 });
  });
}
test('return targets reject open redirects, encoded ambiguities and auth loops', async t => {
  const { flow } = await returnFixture(t);
  for (const target of ['', 'https://foreign.example/path', 'https://picker.example/path', 'javascript:alert(1)', 'tasks',
    '//foreign.example', '/\\foreign.example', '/path\\foreign.example', '/%2fforeign.example', '/%5cforeign.example',
    '%2f%2fforeign.example', '/%252fforeign.example', '/%255cforeign.example', '/%25252fforeign.example',
    '/a/..//foreign.example', '/%0d%0aLocation:https://foreign.example', '/%09/foreign.example', '/\t/foreign.example',
    '/auth', '/auth/signin', '/auth/discord', '/auth/google/callback', '/auth/signout', '/auth/reclaim?code=fixture',
    '/join/fixture', '/%61uth/signin', '/%2561uth/signin', '/auth%2fsignin', '/a/%2e%2e/auth/signin',
    '/pickers/fixture/auth/discord', '/pickers/fixture/%2561uth/signin', '/%', '/' + 'a'.repeat(4096)]) {
    for (const direct of [false, true]) {
      const { started, callback } = await startReturn(flow, target, direct), completed = response();
      await flow.handle(request(callback, pendingCookie(started)), completed, { route: '/auth/discord/callback', security });
      assert.equal(completed.getHeader('location'), '/', target);
    }
  }
});
test('sign-in page loads consume no pending capacity, including when all OAuth slots are full', async t => {
  const { flow } = await returnFixture(t), target = '/?view=tasks&chunk=12341';
  const loadPages = async cookie => {
    const signin = response(), fallback = response();
    await flow.handle(request(`/auth/signin?${new URLSearchParams({ returnTo: target })}`, cookie), signin, { route: '/auth/signin', security });
    await flow.join(request(target), fallback, { security });
    for (const page of [signin, fallback]) {
      assert.equal(page.status, 200); assert.equal(pendingCookie(page), undefined);
      const link = page.body.match(/href="(\/auth\/discord[^\"]*)"/)[1].replaceAll('&amp;', '&');
      assert.equal(new URL(link, security.origin).searchParams.get('returnTo'), target);
    }
  };
  for (let index = 0; index < 1100; index++) await loadPages();
  let first;
  for (let index = 0; index < 1000; index++) {
    const started = response();
    await flow.handle(request('/auth/discord'), started, { route: '/auth/discord', security });
    assert.equal(started.status, 303); first ??= started;
  }
  await loadPages();
  await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), { status: 429 });
  await loadPages(pendingCookie(first)); // Page visits still release their browser's old attempt.
  const { started, callback } = await startReturn(flow, target, true), completed = response();
  await flow.handle(request(callback, pendingCookie(started)), completed, { route: '/auth/discord/callback', security });
  assert.equal(completed.getHeader('location'), target);
});
test('return targets remain browser-bound, survive cancellation, and expire with OAuth', async t => {
  let at = 0;
  const { flow } = await returnFixture(t, { now: () => at });
  const target = '/?view=tasks&chunk=12341';
  const first = await startReturn(flow, target), cancelled = response();
  const cancel = first.callback.replace('code=fixture-code', 'error=access_denied');
  await flow.handle(request(cancel, pendingCookie(first.started)), cancelled, { route: '/auth/discord/callback', security });
  const retry = response();
  await flow.handle(request('/auth/discord', pendingCookie(cancelled)), retry, { route: '/auth/discord', security });
  const state = new URL(retry.getHeader('location')).searchParams.get('state');
  const callback = `/auth/discord/callback?state=${state}&code=fresh-code`;
  await assert.rejects(() => flow.handle(request(callback), response(), { route: '/auth/discord/callback', security }), { status: 400 });
  const completed = response();
  await flow.handle(request(callback, pendingCookie(retry)), completed, { route: '/auth/discord/callback', security });
  assert.equal(completed.getHeader('location'), target);
  const expired = await startReturn(flow, target);
  at += 600000;
  await assert.rejects(() => flow.handle(request(expired.callback, pendingCookie(expired.started)), response(), { route: '/auth/discord/callback', security }), { status: 400 });
  const fresh = response();
  await flow.handle(request('/auth/discord', pendingCookie(expired.started)), fresh, { route: '/auth/discord', security });
  const done = response();
  await flow.handle(request(`/auth/discord/callback?state=${new URL(fresh.getHeader('location')).searchParams.get('state')}&code=fresh-code`, pendingCookie(fresh)), done, { route: '/auth/discord/callback', security });
  assert.equal(done.getHeader('location'), '/');
});
test('session overload keeps the return target for a fresh OAuth attempt', async t => {
  let busy = true;
  const { flow } = await returnFixture(t, { issueSession: async () => {
    if (busy) throw Object.assign(new Error('Temporarily busy'), { code: 'SESSION_BUSY', status: 429 });
    return 'fixture-session';
  } });
  const target = '/?view=chunk&chunk=12341', first = await startReturn(flow, target), refused = response();
  await assert.rejects(() => flow.handle(request(first.callback, pendingCookie(first.started)), refused, { route: '/auth/discord/callback', security }), { code: 'SESSION_BUSY' });
  busy = false;
  const started = response();
  await flow.handle(request('/auth/discord', pendingCookie(refused)), started, { route: '/auth/discord', security });
  const state = new URL(started.getHeader('location')).searchParams.get('state'), completed = response();
  await flow.handle(request(`/auth/discord/callback?state=${state}&code=fresh-code`, pendingCookie(started)), completed, { route: '/auth/discord/callback', security });
  assert.equal(completed.getHeader('location'), target);
});
test('reclaim replaces an old return target and still opens its confirmation page', async t => {
  const account = { id: 'fixture-account' }, picker = { id: 'fixture-picker' };
  const { flow } = await fixture(t, { accounts: {}, pickerRegistry: { ensureDefaultPicker: async () => picker },
    reclaimIdentity: async () => account,
    invites: { issuePickerSession: async () => 'fixture-session', cookie: token => `duo_access=${token}` },
    provider: { fetch: async url => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'fixture-access' } : { id: '123456789' })) } });
  const old = response();
  await flow.handle(request('/auth/signin?returnTo=%2F%3Fview%3Dtasks'), old, { route: '/auth/signin', security });
  const claim = response();
  await flow.handle(request(`/auth/reclaim?code=${randomBytes(32).toString('base64url')}`, pendingCookie(old)), claim, { route: '/auth/reclaim', security });
  const started = response();
  await flow.handle(request('/auth/discord', pendingCookie(claim)), started, { route: '/auth/discord', security });
  const state = new URL(started.getHeader('location')).searchParams.get('state'), completed = response();
  await flow.handle(request(`/auth/discord/callback?state=${state}&code=fixture-code`, pendingCookie(started)), completed, { route: '/auth/discord/callback', security });
  assert.equal(completed.getHeader('location'), '/auth/reclaim/done');
});
for (const method of ['invite form', 'provider callback']) {
  test(`session overload preserves the ${method} continuation without replaying OAuth`, async t => {
    const invite = { id: randomUUID(), memberId: 'player', admin: false, viewer: false, revoked: false };
    let accounts, busy = true, calls = 0;
    const issue = async () => {
      if (busy) {
        for (let index = 0; index < 999; index++) await flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security });
        await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), { status: 429 });
        throw Object.assign(new Error('The picker is temporarily unable to open your game. Wait a minute, then try again.'), { status: 429, code: 'SESSION_BUSY', retryAfter: 60 });
      }
      return 'fixture-session';
    };
    const invites = { get: id => id === invite.id ? invite : null, joinById: issue, issueAccountSession: issue,
      claim: async (id, accountId) => { assert.equal(id, invite.id); invite.claimedAccountId = accountId; },
      cookie: token => `duo_access=${token}` };
    const { flow, directory } = await fixture(t, { mode: 'optional', invites,
      accounts: Object.fromEntries(['findIdentity', 'ensureIdentity', 'attachMembership', 'get', 'delete'].map(key => [key, (...args) => accounts[key](...args)])),
      checkRequestOrigin: () => {}, provider: { fetch: async url => {
        calls++;
        return new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'fixture-access' } : { id: '123456789' }));
      } } });
    accounts = await openAccountStore({ dataDir: directory }); t.after(() => accounts.close());
    const joined = response(); await flow.join(request('/join/fixture'), joined, { invite, security });
    let current = joined, route = '/auth/invite', req;
    if (method === 'provider callback') {
      current = response();
      await flow.handle(request('/auth/discord', pendingCookie(joined)), current, { route: '/auth/discord', security });
      const state = new URL(current.getHeader('location')).searchParams.get('state');
      route = `/auth/discord/callback?state=${state}&code=fixture-code`;
      req = request(route, pendingCookie(current));
    } else req = { ...request(route, pendingCookie(current)), method: 'POST', resume() {} };
    const refused = response();
    await assert.rejects(() => flow.handle(req, refused, { route: route.split('?')[0], security }), error => {
      assert.equal(error.code, 'SESSION_BUSY');
      assert.equal(flow.errorPage(req, refused, security, error, 429), true);
      assert.match(refused.body, /temporarily unable/); assert.equal(refused.getHeader('retry-after'), 60);
      if (method === 'invite form') assert.match(refused.body, /action="\/auth\/invite"/);
      return true;
    });
    busy = false;
    const retried = response();
    if (method === 'invite form') {
      await flow.handle({ ...request(route, pendingCookie(refused)), method: 'POST', resume() {} }, retried, { route, security });
    } else {
      await assert.rejects(() => flow.handle(req, response(), { route: '/auth/discord/callback', security }), { status: 400 });
      assert.equal(calls, 2, 'The old callback cannot exchange its code twice');
      const started = response();
      await flow.handle(request('/auth/discord', pendingCookie(refused)), started, { route: '/auth/discord', security });
      const state = new URL(started.getHeader('location')).searchParams.get('state');
      await flow.handle(request(`/auth/discord/callback?state=${state}&code=fresh-code`, pendingCookie(started)), retried, { route: '/auth/discord/callback', security });
      assert.equal(accounts.list().length, 1, 'Retry uses the same claimed invitation and account');
    }
    assert.equal(retried.status, 303); assert.match(retried.getHeader('set-cookie').join(';'), /duo_access=fixture-session/);
  });
}

test('session overload after an account claim retries sign-in without reusing the consumed claim link', async t => {
  let busy = true, claims = 0;
  const account = { id: randomUUID() }, picker = { id: `p_${randomBytes(16).toString('hex')}` };
  const { flow } = await fixture(t, { accounts: { findIdentity: () => null },
    pickerRegistry: { ensureDefaultPicker: async () => picker, firstLogin: async () => ({ account, picker }) },
    reclaimIdentity: async () => { assert.equal(++claims, 1); return account; },
    invites: { issuePickerSession: async () => {
      if (busy) throw Object.assign(new Error('Temporarily busy'), { status: 429, code: 'SESSION_BUSY', retryAfter: 60 });
      return 'fixture-session';
    }, cookie: token => `duo_access=${token}` },
    provider: { fetch: async url => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'fixture-access' } : { id: '123456789' })) } });
  const joined = response();
  await flow.handle(request(`/auth/reclaim?code=${randomBytes(32).toString('base64url')}`), joined, { route: '/auth/reclaim', security });
  let current = joined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = response();
    await flow.handle(request('/auth/discord', pendingCookie(current)), started, { route: '/auth/discord', security });
    const state = new URL(started.getHeader('location')).searchParams.get('state');
    current = response();
    const complete = () => flow.handle(request(`/auth/discord/callback?state=${state}&code=fixture-code`, pendingCookie(started)), current, { route: '/auth/discord/callback', security });
    if (busy) { await assert.rejects(complete, { code: 'SESSION_BUSY' }); busy = false; }
    else { await complete(); assert.equal(current.status, 303); }
  }
  assert.equal(claims, 1);
});

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
