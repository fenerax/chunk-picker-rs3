import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createAccountPanel } from '../app/web/account-panel.mjs';
import { createLiveSwapCommandClient, commandOutboxKey } from '../app/web/live-swap-client.mjs';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { openRegistry } = await import('../app/storage/registry.mjs');
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
async function fixture(t, { initiallyEnabled = true, beforeCommit, backupRetentionMs, taskWorkerOptions, ...limits } = {}) {
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
  let app, handler;
  const start = async (multi) => {
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      backupRetentionMs, taskWorkerOptions, onRequestHandler: value => { handler = value; }, beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
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
  return { root, send, login, begin, picker, registry, multiPicker, handler: () => handler,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async edit => { await app.close(); await edit?.(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, expectedRevision: revision, ...extra } }),
  };
}

const hash = value => createHash('sha256').update(value).digest('hex');
const exists = async file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

// These browser fixtures exercise real account routes with synthetic providers.
const ACCOUNT = 101, OTHER_ACCOUNT = 102;
const scope = 'p_' + 'a'.repeat(32);
const missingRetention = 'Retained backups are not erased immediately. The retention period is not configured.';
const defaultSession = () => ({ multiPicker: true, pickerId: scope, pickerRoute: scope, accountId: ACCOUNT,
  account: { id: ACCOUNT, provider: 'discord', providers: ['discord'] }, kind: 'account', memberId: 'owner', readOnly: false,
  capabilities: { canWrite: true }, ownerControls: { role: 'owner', shared: false, ownsDefaultPicker: true,
    backups: { retentionMs: null, message: missingRetention } } });
class Node {
  constructor(tag, text = '', className = '') { Object.assign(this, { tag, textContent: text ?? '', className, children: [], listeners: {}, attributes: {}, hidden: false, disabled: false }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() {}
}
const el = (...args) => new Node(...args);
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(item => item.textContent).join(' ');
const click = (node, label) => { const target = walk(node).find(item => item.tag === 'button' && item.textContent === label); assert.ok(target, label); return target.listeners.click(); };
const response = (value, status = 200, headers = {}) => Response.json(value, { status, headers });
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
const coordinatorSource = (await readFile(new URL('../app/web/screen-save-status.mjs', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '');
function browser(initial = defaultSession(), transport) {
  let session = initial, dialog, generation = 0;
  const calls = [], destinations = [], notices = [], local = storage(), tab = storage(), monitors = [], disposals = [];
  const c = { panelContext: {}, state: { revision: 7 }, result: { private: true }, normalPlayResults: new Map([['owner', {}]]),
    viewerPreferences: { ids: true }, taskRequest: 0, taskRenderGeneration: 0, dialogGeneration: 0,
    closeDialog: () => { generation++; dialog = undefined; }, notice: message => notices.push(message) };
  const rawFetch = async (route, options) => {
    calls.push([route, options]);
    return transport ? transport(route, options, session) : response(route === '/api/session' ? session : { status: 'deleted', backups: session.ownerControls.backups });
  };
  const rendered = el('div'); rendered.append(el('p', 'private game'));
  const context = vm.createContext({ Headers, AbortController, Map, Set, clearTimeout,
    document: { querySelectorAll: () => [rendered], addEventListener() {} }, addEventListener() {} });
  const make = vm.runInContext(coordinatorSource + '\ncreateScreenPickerSession;', context);
  make(c, { fetch: rawFetch, location: { reload: () => destinations.push('reload') }, storage: () => local, tabStorage: () => tab,
    notify: message => notices.push(message), schedule: callback => { monitors.push(callback); return 1; }, cancel: () => disposals.push('monitor') });
  const coordinator = c.panelContext.pickerSession; coordinator.initialize(session);
  const actions = [];
  const panel = createAccountPanel({ el, fetch: rawFetch, beforeSignOut: coordinator.beforeSignOut, beginAccountAction: coordinator.beginAccountAction,
    dialogCurrent: value => generation === value && !!dialog, location: { assign: path => destinations.push(path) },
    openDialog: (title, node) => { dialog = { title, node }; return ++generation; },
    ownerActions: Object.fromEntries(['Rules', 'Preferences', 'Export or restore gameplay', 'Plugin keys'].map(label => [label, () => actions.push(label)])) });
  panel.setSession(session);
  return { panel, c, coordinator, calls, destinations, notices, siteStore: local, tab, monitors, disposals, rendered, actions,
    get dialog() { return dialog; }, close: () => { generation++; dialog = undefined; },
    setSession: value => { session = value; }, open: target => click(panel.rows(), target) };
}
function serverTransport(f, cookie) {
  return async (route, options = {}) => {
    const value = await f.send(route, cookie, { method: options.method, ...(options.body ? { body: JSON.parse(options.body) } : {}),
      headers: Object.fromEntries(new Headers(options.headers)) });
    return new Response(value.text, { status: value.status, headers: value.headers });
  };
}
for (const target of ['picker', 'account']) test(`owner deletes ${target} through dialog, reauthentication, cleanup and signed-out landing`, async t => {
  const f = await fixture(t, target === 'account' ? { backupRetentionMs: 86400000 } : {});
  const cookie = await f.login(String(ACCOUNT)), session = (await f.send('/api/session', cookie)).json();
  assert.equal(session.ownerControls.role, 'owner'); assert.equal(session.ownerControls.shared, false);
  const b = browser(session, serverTransport(f, cookie));
  const prefix = `picker.scope.${session.pickerId}.`;
  b.siteStore.setItem(prefix + 'duo-member', 'owner');
  const clientCalls = [], gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const client = createLiveSwapCommandClient({ storage: b.tab, pickerId: session.pickerId,
    uuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', acquireSession: () => () => {}, maxAttempts: 1,
    fetch: async path => { clientCalls.push(path); entered.resolve(); return gate.promise; } });
  t.after(() => client.stop()); b.coordinator.registerCommands(client);
  const command = { expectedRevision: 7, command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Player 1' } };
  const first = client.send(command), second = client.send(command);
  const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  await entered.promise;
  const finishQueue = b.coordinator.queueCommand();
  assert.ok(b.tab.getItem(prefix + commandOutboxKey));
  assert.equal(b.rendered.children.length, 1);
  b.open(`Delete ${target}`);
  assert.match(text(b.dialog.node), /cannot be undone/);
  assert.ok(text(b.dialog.node).includes(target === 'account' ? session.account.id : session.pickerId));
  assert.ok(text(b.dialog.node).includes(session.ownerControls.backups.message));
  assert.deepEqual(b.calls, [], 'opening the dialog makes no requests');
  await click(b.dialog.node, `Delete ${target}`);
  assert.deepEqual(b.calls.map(([route]) => route), ['/api/session', `/api/${target}/delete`]);
  assert.equal(b.calls[1][1].body, '{}'); assert.equal(b.calls[1][1].headers['X-Picker-Id'], session.pickerRoute);
  assert.equal(b.coordinator.stopped, true); assert.equal(b.c.state, undefined); assert.equal(b.c.result, undefined);
  assert.equal(b.c.normalPlayResults.size, 0); assert.equal(b.rendered.children.length, 0);
  assert.equal(b.siteStore.getItem(prefix + 'duo-member'), null); assert.equal(b.tab.getItem(prefix + commandOutboxKey), null);
  assert.equal(b.notices.length, 1); assert.match(b.notices[0], /Queued changes were not sent/);
  gate.resolve(response({ slot: 0, generation: 1, sequence: 0, acknowledged: 0 })); await rejected; finishQueue();
  assert.deepEqual(clientCalls, ['/api/action-session'], 'neither command was replayed');
  assert.equal(b.dialog.title, 'Deletion complete'); assert.ok(text(b.dialog.node).includes(session.ownerControls.backups.message));
  assert.deepEqual(b.destinations, []); await click(b.dialog.node, 'Continue to sign in');
  assert.deepEqual(b.destinations, ['/auth/signin']); assert.equal((await f.send('/api/state', cookie)).status, 401);
});

test('shared account deletion has no picker deletion, discloses preserved game, and preserves its hash after restart', async t => {
  const f = await fixture(t, { initiallyEnabled: false });
  const invite = (await f.private('/api/invites', { body: { label: 'Player 1', memberId: 'one' } })).json();
  const joined = await f.private(new URL(invite.link).pathname, { headers: { Authorization: '' } });
  const cookie = await f.login(String(ACCOUNT), joined.headers['set-cookie'][0].split(';')[0]); await f.restart();
  const session = (await f.send('/api/session', cookie)).json();
  assert.equal(session.ownerControls.shared, true); assert.equal(session.ownerControls.role, 'player'); assert.equal(session.ownerControls.ownsDefaultPicker, false);
  const b = browser(session, serverTransport(f, cookie));
  assert.doesNotMatch(text(b.panel.rows()), /Delete picker|Leave|Rules|Plugin keys/);
  b.open('Delete account');
  assert.match(text(b.dialog.node), /removes this account's access and claimed invitations/);
  assert.match(text(b.dialog.node), /shared game and the other player are not changed/);
  const before = hash((await f.private('/api/backup')).text);
  await click(b.dialog.node, 'Delete account');
  assert.equal(hash((await f.private('/api/backup')).text), before);
  assert.equal((await f.send('/api/state', cookie)).status, 401);
  assert.equal((await f.private(new URL(invite.link).pathname, { headers: { Authorization: '' } })).status, 401);
  await click(b.dialog.node, 'Continue to sign in'); assert.deepEqual(b.destinations, ['/auth/signin']);
  await f.restart(); assert.equal(hash((await f.private('/api/backup')).text), before);
});

test('owner actions reuse gameplay tools and never offer operator powers', () => {
  const b = browser(); const rows = b.panel.rows();
  assert.match(text(rows), /Role: owner/);
  for (const label of ['Rules', 'Preferences', 'Export or restore gameplay', 'Plugin keys']) click(rows, label);
  assert.deepEqual(b.actions, ['Rules', 'Preferences', 'Export or restore gameplay', 'Plugin keys']);
  assert.doesNotMatch(text(rows), /shutdown|restart|snapshot|global|admin/i);
  b.panel.setSession({ ...defaultSession(), ownerControls: { ...defaultSession().ownerControls, role: 'player' } });
  assert.doesNotMatch(text(b.panel.rows()), /Delete picker|Export or restore|Rules|Plugin keys/);
});
for (const status of [403, 409, 503]) test(`${status} displays server refusal, preserves usability, and retries only on request`, async () => {
  let attempts = 0;
  const message = `Refusal ${status}`;
  const b = browser(defaultSession(), (route, options, session) => {
    if (route === '/api/session') return response(session);
    if (route === '/api/state') return response({ usable: true });
    attempts++; return attempts === 1 ? response({ message }, status, status === 503 ? { 'Retry-After': '1' } : {}) : response({ status: 'deleted', backups: session.ownerControls.backups });
  });
  b.open('Delete account'); await click(b.dialog.node, 'Delete account');
  assert.ok(text(b.dialog.node).includes(message)); assert.equal(b.coordinator.stopped, false); assert.ok(b.c.state);
  assert.equal((await b.coordinator.fetch('/api/state')).ok, true);
  if (status === 503) {
    const button = walk(b.dialog.node).find(item => item.textContent === 'Retry deletion'); assert.equal(button.disabled, true);
    await click(b.dialog.node, 'Retry deletion'); assert.equal(attempts, 1);
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal(button.disabled, false); assert.equal(attempts, 1, 'Retry-After never starts an automatic retry');
  }
  await click(b.dialog.node, status === 503 ? 'Retry deletion' : 'Delete account');
  assert.equal(attempts, 2); assert.equal(b.coordinator.stopped, true);
});
for (const changed of ['account', 'picker', 'role']) test(`reauthentication refuses a changed ${changed} without deleting`, async () => {
  const b = browser(); b.open('Delete picker'); const next = defaultSession();
  if (changed === 'account') next.accountId = OTHER_ACCOUNT;
  if (changed === 'picker') next.pickerId = 'p_' + 'b'.repeat(32);
  if (changed === 'role') next.ownerControls.role = 'player';
  b.setSession(next); await click(b.dialog.node, 'Delete picker');
  assert.deepEqual(b.calls.map(([route]) => route), ['/api/session']); assert.match(text(b.dialog.node), /changed/);
  assert.equal(b.coordinator.stopped, false); assert.ok(b.c.state);
});
test('failed reauthentication keeps the dialog usable and never dispatches deletion', async () => {
  const b = browser(defaultSession(), () => response({ message: 'Access required.' }, 401));
  b.open('Delete account'); await click(b.dialog.node, 'Delete account');
  assert.match(text(b.dialog.node), /sign in again/); assert.equal(b.calls.length, 1); assert.ok(b.c.state);
  click(b.dialog.node, 'Cancel'); assert.equal(b.dialog.title, 'Account');
});
test('cancel and a closed dialog never dispatch a stale confirmation', async () => {
  const b = browser(); b.open('Delete account'); const old = b.dialog.node;
  click(old, 'Cancel'); await click(old, 'Delete account'); assert.equal(b.calls.length, 0);
  b.open('Delete account'); const closed = b.dialog.node; b.close(); await click(closed, 'Delete account'); assert.equal(b.calls.length, 0);
});
test('closing a dialog during reauthentication prevents deletion', async () => {
  const gate = Promise.withResolvers(); const b = browser(defaultSession(), () => gate.promise);
  b.open('Delete picker'); const sending = click(b.dialog.node, 'Delete picker'); await settle();
  b.close(); gate.resolve(response(defaultSession())); await sending;
  assert.deepEqual(b.calls.map(([route]) => route), ['/api/session']); assert.equal(b.coordinator.stopped, false);
});
test('an active deletion excludes other requests and session monitors until a refusal releases it', async () => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const b = browser(defaultSession(), (route, options, session) => {
    if (route === '/api/session') return response(session);
    entered.resolve(); return gate.promise;
  });
  b.open('Delete picker'); const node = b.dialog.node; const first = click(node, 'Delete picker'); await entered.promise;
  await click(node, 'Delete picker');
  await assert.rejects(b.coordinator.fetch('/api/command', { method: 'POST' }), /account change is in progress/);
  b.monitors[0](); await settle(); assert.equal(b.calls.length, 2); assert.deepEqual(b.destinations, []);
  gate.resolve(response({ message: 'Conflict' }, 409)); await first;
  assert.equal(b.coordinator.stopped, false); await b.coordinator.check(); assert.equal(b.calls.length, 3);
});
test('storage cleanup failure after deletion blocks landing and retries cleanup without another delete', async () => {
  const b = browser(), remove = b.tab.removeItem; let denied = true;
  b.tab.setItem(`picker.scope.${scope}.` + commandOutboxKey, '{}');
  b.tab.removeItem = key => { if (denied) throw new Error('Denied'); remove(key); };
  b.open('Delete account'); await click(b.dialog.node, 'Delete account');
  assert.equal(b.coordinator.stopped, true); assert.match(text(b.dialog.node), /storage could not be cleared/);
  await click(b.dialog.node, 'Continue to sign in'); assert.deepEqual(b.destinations, []);
  denied = false; await click(b.dialog.node, 'Continue to sign in'); assert.deepEqual(b.destinations, ['/auth/signin']);
  assert.equal(b.calls.filter(([route]) => route.endsWith('/delete')).length, 1);
});

// Fixed synthetic markup hashes captured from the untouched MP9 START module.
const markup = node => ({ tag: node.tag, text: node.textContent, className: node.className, attributes: node.attributes,
  ...(node.href ? { href: node.href } : {}), ...(node.action ? { action: node.action, method: node.method } : {}),
  ...(node.type ? { type: node.type } : {}), hidden: node.hidden, disabled: node.disabled, children: node.children.map(markup) });
test('without multiPicker, account markup and sign-out requests match START', async () => {
  const calls = [], destinations = [], outputs = [];
  const panel = createAccountPanel({ el, openDialog() {}, fetch: async (...args) => { calls.push(args); return response({}); }, location: { assign: path => destinations.push(path) } });
  for (const value of [{ account: { id: ACCOUNT, provider: 'discord', providers: ['discord'] }, signIn: { providers: ['discord', 'google'] } },
    { kind: 'invite', memberId: 'one', signIn: { providers: ['google'] } }, { kind: 'master', admin: true }]) {
    panel.setSession(value);
    for (const compact of [false, true]) outputs.push(markup(panel.rows({ compact })));
  }
  assert.equal(hash(JSON.stringify(outputs)), 'd121d3d083324a6002033891276bb19a1ebe0e436175251fec24e49545946643');
  panel.setSession({ account: { id: ACCOUNT, provider: 'discord' } });
  const form = walk(panel.rows()).find(node => node.tag === 'form'); await form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(calls, [['/auth/signout', { method: 'POST', credentials: 'same-origin' }]]); assert.deepEqual(destinations, ['/auth/signin']);
});
