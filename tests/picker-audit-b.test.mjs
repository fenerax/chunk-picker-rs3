import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccountPanel } from '../app/web/account-panel.mjs';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT',
  'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const FIRST = 101, SECOND = 102;
const origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const definitions = { challenges: {}, chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const hash = value => createHash('sha256').update(value).digest('base64url');
const cookiePair = (response, name) => response.headers['set-cookie']?.find(value => value.startsWith(name + '='))?.split(';')[0];
function request(base, route, { body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + route, { method, agent: false, headers: {
      ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), Origin: origin }),
      ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Synthetic audit request timed out')));
    req.on('error', reject); req.end(bytes);
  });
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-audit-b-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
  const previous = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  process.env.RS3_GOOGLE_CLIENT_ID = 'synthetic-google-client'; process.env.RS3_GOOGLE_CLIENT_SECRET_FILE = secret;
  const grants = new Map(), access = new Map(); let sequence = 0, exchanges = 0;
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token') || url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant); assert.equal(hash(form.get('code_verifier')), grant.challenge);
      assert.equal(form.get('redirect_uri'), `${origin}/auth/${grant.provider}/callback`);
      exchanges++;
      if (grant.gate) { grant.entered.resolve(); await grant.gate.promise; }
      if (grant.provider === 'google') {
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const claims = { iss: 'https://accounts.google.com', aud: 'synthetic-google-client', sub: grant.subject,
          nonce: grant.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        return Response.json({ id_token: [encode({ alg: 'RS256' }), encode(claims), encode('synthetic-signature')].join('.') });
      }
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  let app;
  t.after(async () => {
    await app?.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of envKeys.entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  });
  app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    host: '127.0.0.1', port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin,
    signIn: 'optional', signInProvider: provider, predictionPrewarm: false, shutdownDeadlineMs: 500,
    multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'),
      tombstoneDir: path.join(root, 'tombstones'), registrationsPerAccount: 12, registrationsGlobal: 30 } });
  await app.listen();
  const send = (route, cookie, options = {}) => request(`http://127.0.0.1:${app.loopbackAddress().port}`, route,
    { ...options, headers: { ...proxy, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  const admin = (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route,
    { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } });
  async function begin(subject, cookie, route = '/auth/discord', block = false) {
    const started = await send(route, cookie); assert.equal(started.status, 303, started.text);
    const authorization = new URL(started.headers.location), code = String(++sequence);
    const grant = { subject: String(subject), provider: route.split('?')[0].endsWith('google') ? 'google' : 'discord',
      nonce: authorization.searchParams.get('nonce'), challenge: authorization.searchParams.get('code_challenge'),
      ...(block ? { gate: Promise.withResolvers(), entered: Promise.withResolvers() } : {}) };
    grants.set(code, grant);
    const callback = `/auth/${grant.provider}/callback?${new URLSearchParams({ state: authorization.searchParams.get('state'), code })}`;
    const cookies = [cookiePair(started, '__Host-rs3_preauth'), ...(cookie ?? '').split(';').filter(part => part.trim() && !part.trim().startsWith('__Host-rs3_preauth='))].join('; ');
    return { started, authorization, callback, cookies, grant, finish: () => send(callback, cookies) };
  }
  async function login(subject, cookie, route) {
    const flow = await begin(subject, cookie, route), completed = await flow.finish();
    assert.equal(completed.status, 303, completed.text); return cookiePair(completed, 'duo_access');
  }
  async function shared(subject, memberId) {
    const invitation = await admin('/api/invites', { body: { label: 'Player ' + (memberId === 'one' ? 1 : 2), memberId } });
    assert.equal(invitation.status, 201, invitation.text);
    const joined = await send(new URL(invitation.json().link).pathname);
    assert.equal(joined.status, 200, joined.text);
    return login(subject, cookiePair(joined, '__Host-rs3_preauth'));
  }
  return { send, admin, begin, login, shared, get exchanges() { return exchanges; }, masterToken: app.store.getAccessToken() };
}
class Element {
  constructor(tag, text = '') { Object.assign(this, { tag, textContent: text ?? '', children: [], listeners: {}, hidden: false, disabled: false }); }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(event, listener) { this.listeners[event] = listener; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const click = (node, label) => {
  const button = walk(node).find(item => item.tag === 'button' && item.textContent === label);
  assert.ok(button, label); return button.listeners.click();
};
function panel(session, fetch) {
  let dialog;
  const instance = createAccountPanel({ el: (...args) => new Element(...args), fetch,
    openDialog: (title, node) => { dialog = { title, node }; return 1; }, location: { assign() {} } });
  instance.setSession(session);
  return { instance, get dialog() { return dialog; }, open: () => click(instance.rows(), 'Delete account') };
}

test('MP12B: shared deletion stays bound to the account confirmed by the dialog', { todo: 'MP12B finding 1' }, async t => {
  const f = await fixture(t), firstCookie = await f.shared(FIRST, 'one'), secondCookie = await f.shared(SECOND, 'two');
  const first = (await f.send('/api/session', firstCookie)).json();
  const second = (await f.send('/api/session', secondCookie)).json();
  assert.notEqual(first.account.id, second.account.id);
  assert.equal(first.pickerRoute, second.pickerRoute); assert.equal(first.pickerRoute, 'legacy');
  let activeCookie = firstCookie, deletion;
  const ui = panel(first, async (route, options = {}) => {
    const result = await f.send(route, activeCookie, { method: options.method,
      ...(options.body ? { body: JSON.parse(options.body) } : {}), headers: options.headers });
    // A different tab completes sign-in after the server produces the preflight
    // response. Its cookie applies to the next request from this document too.
    if (route === '/api/session') activeCookie = secondCookie;
    if (route === '/api/account/delete') deletion = result;
    return new Response(result.text, { status: result.status, headers: result.headers });
  });
  ui.open();
  assert.ok(walk(ui.dialog.node).some(node => node.textContent.includes(first.account.id)));
  await click(ui.dialog.node, 'Delete account');
  const firstAfter = await f.send('/api/session', firstCookie), secondAfter = await f.send('/api/session', secondCookie);
  assert.deepEqual({ deletionRefused: [401, 403, 409].includes(deletion.status), first: firstAfter.status, second: secondAfter.status },
    { deletionRefused: true, first: 200, second: 200 }, 'A stale account confirmation must refuse deletion and preserve both accounts');
});


test('MP12B: OAuth callbacks bind cookie, state and provider, consume attempts, and ignore redirect input', async t => {
  const f = await fixture(t), missing = await f.begin(FIRST);
  assert.equal((await f.send(missing.callback)).status, 400); assert.equal(f.exchanges, 0);
  const wrong = await f.begin(FIRST);
  assert.equal((await f.send(wrong.callback.replace(/state=[^&]+/, 'state=wrong'), wrong.cookies)).status, 400);
  assert.equal((await wrong.finish()).status, 400); assert.equal(f.exchanges, 0);
  const mixed = await f.begin(FIRST);
  assert.equal((await f.send(mixed.callback.replace('/discord/', '/google/'), mixed.cookies)).status, 400);
  assert.equal((await mixed.finish()).status, 400); assert.equal(f.exchanges, 0);
  const duplicate = await f.begin(FIRST);
  assert.equal((await f.send(duplicate.callback + '&state=wrong', duplicate.cookies)).status, 400);
  assert.equal(f.exchanges, 0);
  const legitimate = await f.begin(FIRST, undefined, '/auth/discord?next=https://foreign.example');
  assert.equal(legitimate.authorization.origin, 'https://discord.com');
  assert.equal(legitimate.authorization.searchParams.get('redirect_uri'), origin + '/auth/discord/callback');
  assert.match(cookiePair(legitimate.started, '__Host-rs3_preauth'), /^__Host-rs3_preauth=[A-Za-z0-9_-]{43}$/);
  assert.match(legitimate.started.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
  const completed = await legitimate.finish(); assert.equal(completed.status, 303, completed.text);
  assert.equal(completed.headers.location, '/');
  assert.equal((await legitimate.finish()).status, 400); assert.equal(f.exchanges, 1);
});

test('MP12B: Google nonce mismatch issues no session', async t => {
  const f = await fixture(t), flow = await f.begin(FIRST, undefined, '/auth/google');
  flow.grant.nonce = 'synthetic-wrong-nonce';
  const completed = await flow.finish(); assert.equal(completed.status, 502);
  assert.equal(cookiePair(completed, 'duo_access'), undefined);
  assert.equal((await f.send('/api/session')).status, 401);
  assert.equal((await flow.finish()).status, 400);
});

test('MP12B: logout during a provider exchange prevents linking even if another session for that account survives', async t => {
  const f = await fixture(t), first = await f.login(FIRST), surviving = await f.login(FIRST);
  const flow = await f.begin(SECOND, first, '/auth/link/google', true);
  t.after(() => flow.grant.gate.resolve());
  const pending = flow.finish(); await flow.grant.entered.promise;
  assert.equal((await f.send('/auth/signout', first, { body: {} })).status, 303);
  flow.grant.gate.resolve(); const completed = await pending;
  assert.equal(completed.status, 401, completed.text); assert.equal(cookiePair(completed, 'duo_access'), undefined);
  const active = await f.send('/api/session', surviving); assert.equal(active.status, 200);
  assert.deepEqual(active.json().account.providers, ['discord']);
  assert.equal((await f.send('/api/session', first)).status, 401);
});

test('MP12B: issued sessions rotate, logout revokes its token, and account deletion invalidates all its old tokens', async t => {
  const f = await fixture(t), first = await f.login(FIRST), rotated = await f.login(FIRST), other = await f.login(SECOND);
  assert.notEqual(first, rotated); assert.notEqual(rotated, other);
  const session = (await f.send('/api/session', rotated)).json();
  assert.equal((await f.send('/auth/signout', first, { body: {} })).status, 303);
  assert.equal((await f.send('/api/session', first)).status, 401);
  assert.equal((await f.send('/api/session', rotated)).status, 200);
  const another = await f.login(FIRST);
  assert.equal((await f.send('/api/account/delete', rotated, { body: {}, headers: { 'X-Picker-Id': session.pickerRoute } })).status, 200);
  for (const cookie of [first, rotated, another]) {
    assert.equal((await f.send('/api/session', cookie)).status, 401);
    assert.equal((await f.send('/api/state', cookie)).status, 401);
    assert.equal((await f.send('/auth/link/google', cookie)).status, 401);
  }
  assert.equal((await f.send('/api/session', other)).status, 200);
});

test('MP12B: the public origin rejects raw and issued admin cookies and drops stale page cookies', async t => {
  const f = await fixture(t);
  const joined = await f.admin('/join/' + f.masterToken); assert.equal(joined.status, 303);
  for (const cookie of ['duo_access=' + f.masterToken, cookiePair(joined, 'duo_access')]) {
    assert.ok(cookie);
    for (const route of ['/api/session', '/api/state', '/api/admin/master-link']) {
      assert.equal((await f.send(route, cookie)).status, 403);
    }
    const page = await f.send('/', cookie); assert.equal(page.status, 303); assert.equal(page.headers.location, '/');
    assert.match(page.headers['set-cookie'][0], /Max-Age=0/);
    assert.equal((await f.send('/')).status, 200);
    assert.equal((await f.send('/auth/signout', cookie, { body: {} })).status, 403);
  }
  assert.equal((await f.send('/api/state', undefined, { headers: { Authorization: 'Bearer ' + f.masterToken } })).status, 403);
  assert.equal((await f.admin('/api/session')).status, 200);
});

test('MP12B: owner controls do not grant operator powers or accept a caller-supplied account target', async t => {
  const f = await fixture(t), owner = await f.login(FIRST), other = await f.login(SECOND);
  const ownSession = (await f.send('/api/session', owner)).json(), otherSession = (await f.send('/api/session', other)).json();
  assert.equal(ownSession.ownerControls.role, 'owner'); assert.equal(ownSession.admin, false);
  const before = hash((await f.send('/api/state', other)).text);
  for (const route of ['/api/accounts', '/api/invites', '/api/overlays', '/api/usage', '/api/admin/master-link', '/api/backup-status']) {
    assert.equal((await f.send(route, owner)).status, 403, route);
  }
  for (const route of ['/api/shutdown', '/api/worker-restart', '/api/operator/snapshot', '/api/invites', '/api/overlays',
    `/api/accounts/${otherSession.account.id}/delete`, `/api/accounts/${otherSession.account.id}/unlink`,
    `/api/accounts/${otherSession.account.id}/revoke-sessions`]) {
    assert.equal((await f.send(route, owner, { body: {} })).status, 403, route);
  }
  assert.equal((await f.send('/api/account/delete', owner, { body: { accountId: otherSession.account.id } })).status, 400);
  assert.equal((await f.send('/api/account/delete', owner, { body: {}, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal(hash((await f.send('/api/state', other)).text), before);
  assert.equal((await f.send('/api/session', owner)).status, 200);
});

test('MP12B: a forged shared-picker owner UI cannot delete the shared picker', async t => {
  const f = await fixture(t), cookie = await f.shared(FIRST, 'one');
  const session = (await f.send('/api/session', cookie)).json();
  assert.equal(session.ownerControls.shared, true); assert.equal(session.ownerControls.role, 'player');
  const ordinary = panel(session, () => { throw new Error('Opening controls must not send a request'); });
  assert.ok(!walk(ordinary.instance.rows()).some(node => node.textContent === 'Delete picker'));
  const forged = { ...session, ownerControls: { ...session.ownerControls, role: 'owner', shared: false } };
  let refused;
  const ui = panel(forged, async (route, options = {}) => {
    if (route === '/api/session') return Response.json(forged);
    refused = await f.send(route, cookie, { body: JSON.parse(options.body), headers: options.headers });
    return new Response(refused.text, { status: refused.status });
  });
  click(ui.instance.rows(), 'Delete picker'); await click(ui.dialog.node, 'Delete picker');
  assert.equal(refused.status, 403); assert.equal((await f.send('/api/state', cookie)).status, 200);
});

test('MP12B: a cookie switch between distinct owned pickers cannot redirect a stale deletion', async t => {
  const f = await fixture(t), firstCookie = await f.login(FIRST), secondCookie = await f.login(SECOND);
  const session = (await f.send('/api/session', firstCookie)).json();
  let cookie = firstCookie, refused;
  const ui = panel(session, async (route, options = {}) => {
    const result = await f.send(route, cookie, { method: options.method,
      ...(options.body ? { body: JSON.parse(options.body) } : {}), headers: options.headers });
    if (route === '/api/session') cookie = secondCookie;
    if (route.endsWith('/delete')) refused = result;
    return new Response(result.text, { status: result.status, headers: result.headers });
  });
  ui.open(); await click(ui.dialog.node, 'Delete account');
  assert.equal(refused.status, 403);
  assert.equal((await f.send('/api/session', firstCookie)).status, 200);
  assert.equal((await f.send('/api/session', secondCookie)).status, 200);
});
