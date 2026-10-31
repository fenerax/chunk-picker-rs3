import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createLiveSwapCommandClient, commandOutboxKey } from '../app/web/live-swap-client.mjs';
import { createBackupUpload } from '../app/web/backup-transfer.mjs';
import { createAccountPanel } from '../app/web/account-panel.mjs';

const sources = await Promise.all(['screen-save-status'].map(name => readFile(new URL(`../app/web/${name}.mjs`, import.meta.url), 'utf8')));
const scopeA = 'p_' + 'a'.repeat(32), scopeB = 'p_' + 'b'.repeat(32);
const prefix = id => `picker.scope.${id}.`;
const accountA = 'account-a';
const session = (pickerId = scopeA, accountId = accountA) => ({ multiPicker: true, pickerId, pickerRoute: pickerId, accountId, kind: 'account', memberId: 'owner', readOnly: false });
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
const response = (value = {}, status = 200) => ({ ok: status < 400, status, json: async () => value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ local = storage(), tab = storage(), initial = session(), transport } = {}) {
  const notices = [], calls = [], listeners = {}, timers = [], disposed = [], rendered = { text: 'old view', replaceChildren() { this.text = ''; } };
  let current = initial, status = 200, reloads = 0, offline = false;
  const c = { state: { revision: 7, members: [{ id: 'owner' }] }, result: { memberId: 'owner', stateRevision: 7 },
    normalPlayResults: new Map([['owner', { stateRevision: 7, marker: 'old' }]]), planningResults: new Map([['owner:7', {}]]),
    viewerPreferences: { ids: true }, statePools: { owner: {} }, pendingChunkChanges: [{}], lastDuoResults: [{}],
    taskRequest: 0, taskRenderGeneration: 0, dialogGeneration: 0,
    usage: { stop: () => disposed.push('usage'), refreshPreference() {} }, backupStatus: { dispose: () => disposed.push('backup') },
    closeDialog: () => disposed.push('dialog'), refreshSaveRecovery: () => disposed.push('recovery'), taskController: { abort: () => disposed.push('tasks') },
  };
  const context = vm.createContext({ Headers, AbortController, Map, Set, clearTimeout, console,
    document: { querySelectorAll: () => [rendered], addEventListener: (type, listener) => { listeners[`document:${type}`] = listener; } },
    localStorage: local, sessionStorage: tab, addEventListener: (type, listener) => { listeners[type] = listener; },
  });
  const exports = vm.runInContext(`(() => { ${sources.join('\n').replace(/^import .*\n/gm, '').replace(/^export /gm, '')}\nreturn { createScreenPickerSession, gameStorage, configurePickerStorage, clearPickerStorage }; })()`, context);
  exports.createScreenPickerSession(c, { fetch: async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/session') { if (offline) throw new Error('Offline'); return response(current, status); }
    return transport ? transport(path, options) : response({ state: { revision: 7 } });
  }, storage: () => local, tabStorage: () => tab, notify: text => notices.push(text),
    location: { reload: () => { reloads++; } }, schedule: callback => { timers.push(callback); return 1; }, cancel: () => disposed.push('poll') });
  c.panelContext.pickerSession.initialize(initial);
  return { c, context, ...exports, siteStore: local, tab, calls, notices, timers, listeners, disposed, rendered,
    setSession: value => { current = value; }, disconnect: () => { offline = true; }, expire: () => { status = 401; }, get reloads() { return reloads; } };
}

test('picker switch stops admission before disposal and clears views, streams, preferences and recovery', async () => {
  const f = fixture(), order = [];
  f.siteStore.setItem(prefix(scopeA) + 'rs3:task-view', 'old');
  f.siteStore.setItem(prefix(scopeB) + 'rs3:task-view', 'new');
  f.siteStore.setItem('picker.map-display', 'layout');
  f.tab.setItem(prefix(scopeA) + commandOutboxKey, JSON.stringify({ unsent: '{}' }));
  f.c.panelContext.pickerSession.registerCommands({ pending: () => true, stop() { order.push(f.c.panelContext.pickerSession.stopped); } });
  f.c.panelContext.pickerSession.registerStop(() => { order.push('stream'); });
  f.setSession(session(scopeB, 'account-b'));
  await assert.rejects(f.c.panelContext.pickerSession.fetch('/api/command', { method: 'POST' }), { name: 'AbortError' });
  assert.deepEqual(order, [true, 'stream']);
  assert.equal(f.c.state, undefined); assert.equal(f.c.result, undefined);
  assert.equal(f.c.normalPlayResults.size, 0); assert.equal(f.c.planningResults.size, 0);
  assert.equal(Object.keys(f.c.viewerPreferences).length, 0); assert.equal(f.rendered.text, '');
  assert.ok(['usage', 'backup', 'dialog', 'recovery', 'tasks'].every(name => f.disposed.includes(name)));
  assert.equal(f.siteStore.getItem(prefix(scopeA) + 'rs3:task-view'), null);
  assert.equal(f.tab.getItem(prefix(scopeA) + commandOutboxKey), null);
  assert.equal(f.siteStore.getItem(prefix(scopeB) + 'rs3:task-view'), 'new');
  assert.equal(f.siteStore.getItem('picker.map-display'), 'layout');
  assert.equal(f.calls.filter(call => call.path === '/api/command').length, 0);
  assert.equal(f.notices.length, 1); assert.match(f.notices[0], /Queued changes were not sent/);
  assert.equal(f.reloads, 1);
});

test('same member and revision in two pickers never share local preferences or in-memory views', () => {
  const local = storage(), tab = storage();
  local.setItem(prefix(scopeA) + 'duo-member', 'owner');
  local.setItem(prefix(scopeA) + 'rs3:task-view', 'private-a');
  local.setItem(prefix(scopeB) + 'rs3:task-view', 'private-b');
  const a = fixture({ local, tab });
  assert.equal(a.gameStorage().getItem('rs3:task-view'), 'private-a');
  const b = fixture({ local, tab: storage(), initial: session(scopeB, 'account-b') });
  b.c.normalPlayResults.clear(); b.c.result = undefined;
  assert.equal(b.gameStorage().getItem('rs3:task-view'), 'private-b');
  assert.equal(b.gameStorage().getItem('duo-member'), null);
  assert.equal(b.c.normalPlayResults.get('owner'), undefined);
});

test('a page cannot rebind its storage scope to another picker', () => {
  const f = fixture();
  assert.throws(() => f.configurePickerStorage(scopeB), /Reload/);
});

test('queued but not yet persisted commands are reported on logout', () => {
  const f = fixture(), done = f.c.panelContext.pickerSession.queueCommand();
  f.c.panelContext.pickerSession.beforeSignOut(); done();
  assert.equal(f.notices.length, 1);
  assert.equal(f.c.panelContext.pickerSession.stopped, true);
  assert.throws(() => f.c.panelContext.pickerSession.queueCommand(), { name: 'AbortError' });
});

test('late preference callbacks cannot recreate cleared picker records', () => {
  const f = fixture(), adapter = f.gameStorage();
  adapter.setItem('picker.overlay', 'membership'); f.c.panelContext.pickerSession.stop();
  adapter.setItem('picker.overlay', 'membership');
  assert.equal(f.siteStore.getItem(prefix(scopeA) + 'picker.overlay'), null);
  assert.equal(adapter.getItem('picker.overlay'), null);
});

for (const trigger of ['timer', 'focus', 'pageshow', 'storage']) test(`open-tab picker changes reload cleanly on ${trigger}`, async () => {
  const f = fixture(); f.setSession(session(scopeB, 'account-b'));
  if (trigger === 'timer') f.timers[0](); else f.listeners[trigger]({ key: 'picker.session-change.v1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reloads, 1); assert.equal(f.c.state, undefined);
});

test('expired sessions stop old commands and reload before another game read', async () => {
  const f = fixture(); f.expire();
  await assert.rejects(f.c.panelContext.pickerSession.fetch('/api/state'), { name: 'AbortError' });
  assert.equal(f.reloads, 1); assert.equal(f.calls.filter(call => call.path === '/api/state').length, 0);
});

test('account switch inside the same picker still clears the old command namespace', async () => {
  const f = fixture(); f.setSession(session(scopeA, 'account-b'));
  await assert.rejects(f.c.panelContext.pickerSession.check(), { name: 'AbortError' });
  assert.equal(f.reloads, 1); assert.equal(f.c.state, undefined);
});

test('network failure checking session fails closed without deleting queued work', async () => {
  const f = fixture();
  f.tab.setItem(prefix(scopeA) + commandOutboxKey, 'retained'); f.disconnect();

  await assert.rejects(f.c.panelContext.pickerSession.fetch('/api/command', { method: 'POST' }));
  assert.equal(f.calls.filter(call => call.path === '/api/command').length, 0);
  assert.equal(f.tab.getItem(prefix(scopeA) + commandOutboxKey), 'retained');
  assert.equal(f.c.panelContext.pickerSession.stopped, false);
});

test('every game request and stream carries its trusted routing selector', async () => {
  const f = fixture();
  await f.c.panelContext.pickerSession.fetch('/api/state');
  assert.equal(f.calls.at(-1).options.headers.get('X-Picker-Id'), scopeA);
  assert.equal(f.c.panelContext.pickerSession.streamPath(), '/api/events?picker=' + scopeA);
  const legacy = fixture({ initial: { ...session(), pickerRoute: 'legacy' } });
  await legacy.c.panelContext.pickerSession.fetch('/api/state');
  assert.equal(legacy.calls.at(-1).options.headers.get('X-Picker-Id'), 'legacy');
});

test('delayed transport and response readers cannot deliver old views after a switch', async () => {
  const delayed = deferred(), f = fixture({ transport: () => delayed.promise });
  const request = f.c.panelContext.pickerSession.fetch('/api/state');
  await new Promise(resolve => setImmediate(resolve));
  f.c.panelContext.pickerSession.stop(); delayed.resolve(response({ old: true }));
  await assert.rejects(request, { name: 'AbortError' });
  const body = deferred(), g = fixture({ transport: () => ({ ...response(), json: () => body.promise }) });
  const answer = await g.c.panelContext.pickerSession.fetch('/api/state'), reading = answer.json();
  g.c.panelContext.pickerSession.stop(); body.resolve({ old: true });
  await assert.rejects(reading, { name: 'AbortError' });
});

test('new document after OAuth clears the previous picker recovery and warns instead of replaying', () => {
  const local = storage(), tab = storage();
  fixture({ local, tab });
  local.setItem(prefix(scopeA) + 'rs3:task-view', 'old');
  tab.setItem(prefix(scopeA) + commandOutboxKey, JSON.stringify({ body: '{}' }));
  const next = fixture({ local, tab, initial: session(scopeB, 'account-b') });
  assert.equal(tab.getItem(prefix(scopeA) + commandOutboxKey), null);
  assert.equal(local.getItem(prefix(scopeA) + 'rs3:task-view'), null);
  assert.equal(next.notices.length, 1); assert.equal(next.calls.length, 0);
});

test('without multiPicker no storage keys, permissions, stream path or transport behavior change', async () => {
  const local = storage(), tab = storage(); local.setItem('duo-member', 'owner'); local.setItem('rs3:task-view', 'remembered');
  tab.setItem(commandOutboxKey, 'kept');
  const f = fixture({ local, tab, initial: { kind: 'invite' } });
  assert.equal(f.gameStorage().getItem('rs3:task-view'), 'remembered');
  f.gameStorage().setItem('duo-member', 'peer');
  assert.equal(local.getItem('duo-member'), 'peer');
  const options = { method: 'POST', body: '{}' }; await f.c.panelContext.pickerSession.fetch('/api/command', options);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options, options);
  assert.equal(f.c.panelContext.pickerSession.streamPath(), '/api/events');
  f.c.panelContext.pickerSession.beforeSignOut();
  assert.equal(f.c.state.revision, 7); assert.equal(tab.getItem(commandOutboxKey), 'kept');
  assert.equal(f.timers.length, 0); assert.equal(tab.length, 1); assert.equal(local.length, 2);
});

const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function commandClient(pickerId, sharedStorage, options = {}) {
  return createLiveSwapCommandClient({ pickerId, storage: sharedStorage, uuid: () => clientId, acquireSession: () => () => {},
    maxAttempts: 1, ackDelayMs: 100000, ...options });
}
const command = { expectedRevision: 7, command: { type: 'set-note', memberId: 'owner' } };
const registration = { slot: 0, generation: 1, sequence: 0, acknowledged: 0 };

test('live-swap outboxes and HTTP/Web Lock ownership use picker plus client id', async () => {
  const tab = storage(), owners = [];
  const transport = async () => { throw new Error('offline'); };
  const a = commandClient(scopeA, tab, { acquireSession: id => { owners.push(id); return () => {}; }, fetch: transport });
  await assert.rejects(a.send(command));
  const b = commandClient(scopeB, tab, { acquireSession: id => { owners.push(id); return () => {}; }, fetch: transport });
  assert.equal(b.pending(), null); await assert.rejects(b.send(command));
  assert.deepEqual(owners, [scopeA + '.' + clientId, scopeB + '.' + clientId]);
  assert.ok(tab.getItem(prefix(scopeA) + commandOutboxKey)); assert.ok(tab.getItem(prefix(scopeB) + commandOutboxKey));
  assert.equal(tab.getItem(commandOutboxKey), null); a.stop(); b.stop();
});

test('stopping a client cancels an in-flight registration and queued send without recreating recovery', async () => {
  const tab = storage(), delayed = deferred(), entered = deferred(), calls = [];
  const client = commandClient(scopeA, tab, { fetch: async path => { calls.push(path); entered.resolve(); return delayed.promise; } });
  const first = client.send(command), second = client.send(command);
  const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  await entered.promise; client.stop(); delayed.resolve(response(registration)); await rejected;
  assert.deepEqual(calls, ['/api/action-session']); assert.equal(tab.getItem(prefix(scopeA) + commandOutboxKey), null);
  assert.equal(client.pending(), null);
});

test('stopping during retry backoff prevents another registration or command dispatch', async () => {
  const tab = storage(), sleeping = deferred(), resume = deferred(), calls = [];
  const client = commandClient(scopeA, tab, { maxAttempts: 3, fetch: async path => { calls.push(path); throw new Error('offline'); },
    sleep: async () => { sleeping.resolve(); await resume.promise; } });
  const request = client.send(command), rejected = assert.rejects(request, { name: 'AbortError' });
  await sleeping.promise; client.stop(); resume.resolve(); await rejected;
  assert.equal(calls.length, 1); assert.equal(tab.getItem(prefix(scopeA) + commandOutboxKey), null);
});

class Node {
  constructor(tag, text = '') { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute() {}
  addEventListener(name, handler) { this.listeners[name] = handler; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
test('account panel displays active scope and stops browser work before sign-out POST', async () => {
  const order = [], f = fixture(); f.c.panelContext.pickerSession.queueCommand();
  const panel = createAccountPanel({ el: (...args) => new Node(...args), openDialog() {},
    beforeSignOut: () => { f.c.panelContext.pickerSession.beforeSignOut(); order.push('stop'); },
    fetch: async () => { assert.equal(f.c.panelContext.pickerSession.stopped, true); order.push('post'); return response(); },
    location: { assign: () => order.push('navigate') } });
  panel.setSession({ ...session(), account: { id: 'account-a', provider: 'discord' } });
  const nodes = walk(panel.rows()), text = nodes.map(node => node.textContent).join(' ');
  assert.match(text, /Account: account-a/); assert.ok(text.includes('Picker: ' + scopeA));
  await nodes.find(node => node.tag === 'form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(order, ['stop', 'post', 'navigate']); assert.equal(f.notices.length, 1);
});

test('storage failure during command disposal still aborts requests and clears old views', () => {
  const f = fixture();
  f.c.panelContext.pickerSession.registerCommands({ pending: () => true, stop() { throw new Error('storage denied'); } });
  let closed = false; f.c.panelContext.pickerSession.registerStop(() => { closed = true; });
  f.c.panelContext.pickerSession.stop();
  assert.equal(closed, true); assert.equal(f.c.state, undefined); assert.equal(f.notices.length, 1);
});

test('screen-level command closures held behind a queue cannot execute after logout', async () => {
  const f = fixture(), gate = deferred();
  Object.assign(f.c, { queue: gate.promise, canWrite: () => !f.c.sessionReadOnly, sandbox: { active: false }, saved() {}, showError() {}, $: () => ({}),
    rememberUnchangedTaskRevisions() {} });
  Object.assign(f.context, { document: {}, createRequestReader: () => () => { throw new Error('unexpected transport'); },
    createLiveSwapCommandClient: () => ({ pending: () => null, stop() {} }), createSaveRecovery: () => () => {},
    createCalculationFeedback: () => ({ begin: () => () => {} }) });
  const source = await readFile(new URL('../app/web/screen-commands.mjs', import.meta.url), 'utf8');
  const create = vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/^export /gm, '') + '\ncreateScreenCommands;', f.context);
  create(f.c);
  const queued = f.c.command(command.command), rejected = assert.rejects(queued, { name: 'AbortError' });
  f.c.panelContext.pickerSession.beforeSignOut(); gate.resolve(); await rejected; await f.c.queue;
  assert.equal(f.calls.length, 0); assert.equal(f.notices.length, 1); assert.equal(f.c.state, undefined);
});

test('actual stream disposal closes SSE and prevents a scheduled reconnect', async () => {
  const f = fixture(), streams = [], timers = new Map(); let sequence = 0;
  Object.assign(f.c, { queue: Promise.resolve(), recoverPendingCommand: async () => {}, saved() {}, showError() {} });
  Object.assign(f.context, { setTimeout: callback => { timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id),
    EventSource: class { constructor(path) { this.path = path; this.readyState = 2; this.listeners = {}; streams.push(this); }
      addEventListener(name, listener) { this.listeners[name] = listener; } close() { this.closed = true; } } });
  const source = await readFile(new URL('../app/web/screen-live.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^export /gm, '') + '\ncreateScreenLive;', f.context)(f.c);
  f.c.connectEvents(); streams[0].listeners.error();
  const reconnect = [...timers.values()][0]; assert.ok(reconnect);
  f.c.panelContext.pickerSession.stop(); reconnect();
  assert.equal(streams.length, 1); assert.equal(streams[0].closed, true); assert.equal(timers.size, 0);
});

test('retired document clears recovery before reloading even into the same account and picker', () => {
  const local = storage(), tab = storage(), old = fixture({ local, tab });
  old.c.panelContext.pickerSession.stop();
  tab.setItem(prefix(scopeA) + commandOutboxKey, JSON.stringify({ unsent: '{}' }));
  const next = fixture({ local, tab });
  assert.equal(next.notices.length, 1); assert.equal(tab.getItem(prefix(scopeA) + commandOutboxKey), null);
});

test('failed storage cleanup blocks sign-out POST until cleanup succeeds', async () => {
  const f = fixture(); let deny = true;
  const remove = f.tab.removeItem; f.tab.setItem(prefix(scopeA) + commandOutboxKey, 'pending');
  f.tab.removeItem = key => { if (deny) throw new Error('Denied'); remove(key); };
  assert.throws(() => f.c.panelContext.pickerSession.beforeSignOut(), /Denied/);
  assert.equal(f.c.panelContext.pickerSession.stopped, true);
  deny = false; f.c.panelContext.pickerSession.beforeSignOut();
  assert.equal(f.tab.getItem(prefix(scopeA) + commandOutboxKey), null);
});

test('enabling picker isolation warns and clears an older unscoped intention without importing it', () => {
  const tab = storage(); tab.setItem(commandOutboxKey, JSON.stringify({ unsent: JSON.stringify(command) }));
  const f = fixture({ tab });
  assert.equal(f.notices.length, 1); assert.match(f.notices[0], /no picker identity and was not sent/);
  assert.equal(tab.getItem(commandOutboxKey), null);
  assert.equal(tab.getItem(prefix(scopeA) + commandOutboxKey), null);
  assert.equal(f.calls.length, 0);
});

test('a retired document restored from the back-forward cache reloads instead of checking', () => {
  const f = fixture(); f.c.panelContext.pickerSession.stop({ announce: false });
  f.listeners.pageshow({ persisted: true });
  assert.equal(f.reloads, 1); assert.equal(f.calls.length, 0);
});

test('sign-in links opened in another window leave the current document running', () => {
  const f = fixture(), link = target => ({ getAttribute: name => name === 'href' ? '/auth/discord' : name === 'target' ? target : null });
  const click = (extra, target = null) => f.listeners['document:click']({ target: { closest: () => link(target) }, button: 0, preventDefault() {}, ...extra });
  click({ shiftKey: true }); click({ altKey: true }); click({ button: 1 }); click({}, '_blank');
  assert.equal(f.c.panelContext.pickerSession.stopped, false);
  click({});
  assert.equal(f.c.panelContext.pickerSession.stopped, true);
});

test('a different invite for the same member retires the document', async () => {
  const invite = inviteId => ({ multiPicker: true, pickerId: scopeA, pickerRoute: scopeA, kind: 'invite', memberId: 'owner', readOnly: false, actor: { kind: 'invite', inviteId } });
  const f = fixture({ initial: invite('invite-1') }); f.setSession(invite('invite-2'));
  await assert.rejects(f.c.panelContext.pickerSession.check(), { name: 'AbortError' });
  assert.equal(f.reloads, 1); assert.equal(f.c.state, undefined);
});

test('keepalive unload flushes dispatch at once with the picker header', () => {
  const f = fixture(); f.disconnect();
  void f.c.panelContext.pickerSession.fetch('/api/usage', { method: 'POST', keepalive: true, body: '{}' });
  assert.deepEqual(f.calls.map(call => call.path), ['/api/usage']);
  assert.equal(f.calls[0].options.keepalive, true); assert.equal(f.calls[0].options.headers.get('X-Picker-Id'), scopeA);
});


test('backup XHR uploads retain picker binding and stop on a changed session', async () => {
  const previous = globalThis.XMLHttpRequest;
  let xhr;
  class FakeXHR {
    constructor() { xhr = this; this.upload = {}; this.headers = new Headers(); }
    open(method, path) { this.method = method; this.path = path; }
    setRequestHeader(name, value) { this.headers.set(name, value); }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort(); }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  try {
    const f = fixture(), stages = [];
    const upload = createBackupUpload(new File(['{}'], 'backup.json'), {}, { onStage: value => stages.push(value) });
    const pending = upload.sendBackupRequest('/api/restore/preview', undefined, undefined,
      (...args) => f.c.panelContext.pickerSession.fetch(...args));
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    while (!xhr?.body) await new Promise(resolve => setImmediate(resolve));
    assert.equal(xhr.headers.get('X-Picker-Id'), scopeA);
    assert.equal(xhr.headers.get('Content-Type'), 'application/vnd.rs3-backup-upload+json');
    assert.deepEqual(f.calls.map(call => call.path), ['/api/session']);
    xhr.upload.onload(); assert.equal(stages.at(-1), 'Checking replacement…');
    f.c.panelContext.pickerSession.stop(); await rejected;
    assert.equal(xhr.aborted, true);
    const g = fixture(); g.setSession(session(scopeB)); xhr = undefined;
    await assert.rejects(upload.sendBackupRequest('/api/restore', undefined, undefined,
      (...args) => g.c.panelContext.pickerSession.fetch(...args)), { name: 'AbortError' });
    assert.equal(xhr, undefined, 'a changed session refuses before XHR dispatch');
  } finally { globalThis.XMLHttpRequest = previous; }
});
