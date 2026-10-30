import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createPickerLimits, pickerLimitOptions, MP7_DEFAULTS } from '../app/security/picker-limits.mjs';
import { createPickerRouter } from '../app/picker-router.mjs';
const accountIds = { same: 'same-account', other: 'other', third: 'third', two: 'two', three: 'three' };

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const account = { accountId: accountIds.same };
const refused = operation => assert.throws(operation, error => [429, 503].includes(error.status) && error.retryAfter >= 1 && error.message.length > 20);

test('every MP7 bound has a validated configurable default', () => {
  assert.deepEqual(pickerLimitOptions(), MP7_DEFAULTS);
  for (const key of Object.keys(MP7_DEFAULTS)) for (const value of [0, -1, NaN, 1.5, '2', Infinity]) assert.throws(() => pickerLimitOptions({ [key]: value }), TypeError);
});

test('one account across memberships shares expensive and stream budgets; global quotas remain independent', () => {
  const limits = createPickerLimits({ expensivePerAccount: 2, expensiveGlobal: 3, streamsPerAccount: 1, streamsGlobal: 2 });
  limits.expensive(account, A); limits.expensive(account, B); refused(() => limits.expensive(account, A));
  limits.expensive({ accountId: accountIds.other }, B); refused(() => limits.expensive({ accountId: accountIds.third }, B));
  const first = new EventEmitter(), second = new EventEmitter();
  assert.equal(limits.stream(account, A, first), true);
  refused(() => limits.stream(account, B, new EventEmitter()));
  assert.equal(limits.stream({ accountId: accountIds.other }, B, second), true);
  refused(() => limits.stream({ accountId: accountIds.third }, A, new EventEmitter()));
  first.emit('finish'); first.emit('close');
  assert.equal(limits.stream(account, B, new EventEmitter()), true);
});

test('per-picker quotas stop extra accounts and rejected accounts do not consume global request tokens', () => {
  const limits = createPickerLimits({ expensivePerAccount: 1, expensivePerPicker: 2, expensiveGlobal: 3 });
  limits.expensive(account, A); refused(() => limits.expensive(account, B));
  limits.expensive({ accountId: accountIds.two }, A); refused(() => limits.expensive({ accountId: accountIds.three }, A));
  limits.expensive({ accountId: accountIds.three }, B);
});

test('invitation quotas apply per account across memberships, per picker, and globally, then expire', () => {
  let at = 0;
  const limits = createPickerLimits({ invitationsPerAccount: 1, invitationsPerPicker: 1, invitationsGlobal: 2 }, { now: () => at });
  limits.invitation(account, A); refused(() => limits.invitation(account, B));
  refused(() => limits.invitation({ accountId: accountIds.two }, A));
  limits.invitation({ accountId: accountIds.two }, B); refused(() => limits.invitation({ accountId: accountIds.three }, 'third'));
  at = 60001; limits.invitation(account, A);
});

test('key reservations span asynchronous issuance and extra memberships cannot reset account/global counts', () => {
  const limits = createPickerLimits({ pluginKeysPerAccount: 1, pluginKeysPerPicker: 2, pluginKeysGlobal: 2 });
  const first = limits.reserveKey(account, A, 'one');
  refused(() => limits.reserveKey(account, B, 'same-member'));
  const second = limits.reserveKey({ accountId: accountIds.two }, A, 'one');
  refused(() => limits.reserveKey({ accountId: accountIds.three }, B, 'one'));
  first.finish('gpk_synthetic'); first.finish();
  refused(() => limits.reserveKey(account, B, 'one'));
  second.finish();
  assert.ok(limits.reserveKey({ accountId: accountIds.three }, B, 'one'));
});

test('registration and provisioning enforce both layers without charging ready-picker sign-ins', async () => {
  const limits = createPickerLimits({ registrationsPerAccount: 1, registrationsGlobal: 2, provisioningPerAccount: 1, provisioningGlobal: 2 });
  limits.registration('client-one'); refused(() => limits.registration('client-one'));
  limits.registration('client-two'); refused(() => limits.registration('client-three'));
  let ready = false;
  const registry = limits.provisioningRegistry({ findIdentity: () => ({ id: 'one', defaultPickerId: A }), getPicker: () => ready ? { provisioning: 'ready' } : null, firstLogin: async () => ({}) });
  await registry.firstLogin('discord', 'synthetic');
  await assert.rejects(registry.firstLogin('discord', 'synthetic'), { status: 429 });
  ready = true; await registry.firstLogin('discord', 'synthetic');
});

test('body bytes include chunked iterator and piped readers and share global/account/picker budgets', async () => {
  const limits = createPickerLimits({ bodyBytesPerRequest: 10, bodyBytesPerAccount: 8, bodyBytesPerPicker: 12, bodyBytesGlobal: 15 });
  const read = async (text, id, pickerId, pipe = false) => {
    const request = Readable.from([Buffer.from(text.slice(0, 3)), Buffer.from(text.slice(3))]); request.headers = {};
    const bind = limits.body(request); bind(limits.scope({ accountId: id }, pickerId));
    if (pipe) {
      const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      await new Promise((resolve, reject) => { request.on('error', reject); sink.on('finish', resolve); request.pipe(sink); });
    } else for await (const _chunk of request.iterator({ destroyOnReturn: false })) {}
  };
  await read('123456', 'one', A);
  await assert.rejects(read('123', 'one', B), { status: 429 });
  await read('123456', 'two', B, true);
  await assert.rejects(read('123456', 'three', B, true), { status: 429 });
  const oversized = new Readable({ read() {} }); oversized.headers = { 'content-length': '11' };
  refused(() => limits.body(oversized));
});

test('cold-start leases enforce account and global bounds and release exactly once', () => {
  const limits = createPickerLimits({ coldStartsPerAccount: 1, coldStartsGlobal: 2 });
  const first = limits.coldStart(limits.scope(account, A));
  refused(() => limits.coldStart(limits.scope(account, B)));
  const second = limits.coldStart(limits.scope({ accountId: accountIds.two }, B));
  refused(() => limits.coldStart(limits.scope({ accountId: accountIds.three }, B)));
  first(); first(); assert.ok(limits.coldStart(limits.scope(account, B))); second();
});

test('router refuses a second cold context before calling its factory, with retry advice', async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const pickerLimits = createPickerLimits({ coldStartsGlobal: 1 });
  const calls = [];
  const router = createPickerRouter({ pickerLimits, registry: { getPicker: () => ({ lifecycle: 'active', provisioning: 'ready' }) },
    legacy: { authenticate: request => ({ kind: 'account', accountId: request.headers.account, pickerId: request.headers.picker }) },
    openContext: async id => { calls.push(id); entered.resolve(); await gate.promise; return { close: async () => {}, handle: async (_req, res) => { res.writeHead(200); res.end('{}'); } }; },
  });
  t.after(() => router.close()); t.after(() => gate.resolve());
  async function send(id, name) {
    const request = Readable.from([]); Object.assign(request, { headers: { host: 'localhost', picker: id, account: name }, method: 'GET', url: '/api/state', complete: true, socket: { remoteAddress: '127.0.0.1' } });
    const headers = new Map(), response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value); response.getHeader = name => headers.get(name.toLowerCase());
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    await router.handle(request, response, { host: '127.0.0.1' }); return { status: response.statusCode, headers };
  }
  const first = send(A, 'one'); await entered.promise;
  const refused = await send(B, 'two'); assert.equal(refused.status, 503); assert.ok(refused.headers.get('retry-after'));
  assert.deepEqual(calls, [A]); gate.resolve(); assert.equal((await first).status, 200);
  assert.equal((await send(B, 'two')).status, 200); assert.deepEqual(calls, [A, B]);
});


test('unfinished upload reservations survive rate-window rollover and release unused bytes on refusal or finish', () => {
  let at = 0;
  const limits = createPickerLimits({ bodyBytesPerAccount: 8, bodyBytesPerPicker: 8, bodyBytesGlobal: 10 }, { now: () => at });
  const request = size => { const req = new Readable({ read() {} }); req.headers = { 'content-length': String(size) }; return req; };
  const first = limits.body(request(6)); first(limits.scope(account, A));
  at = 60001;
  refused(() => limits.body(request(6)));
  const second = limits.body(request(4));
  refused(() => second(limits.scope(account, B)));
  second.release(); second.release();
  first.release();
  const third = limits.body(request(8)); third(limits.scope(account, A)); third.release();
  // Refund unused bytes even when the request did not consume its declared body.
  const fourth = limits.body(request(8)); fourth(limits.scope(account, A)); fourth.release();
});

test('restarted legacy keys retain issuer quotas and old ambiguous keys charge every possible owner', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { openPluginKeys } = await import('../app/plugin-keys.mjs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'picker-limits-legacy-'));
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const registry = { listPickers: () => [{ id: A, kind: 'legacy-shared', lifecycle: 'active' }], pickerDirectory: () => directory,
    listAccounts: () => ids.map(id => ({ id, memberships: [{ pickerId: A, memberId: 'one' }] })), resolveCapability: () => null };
  const keys = await openPluginKeys({ dataDir: directory });
  t.after(async () => { await keys.close(); await rm(directory, { recursive: true, force: true }); });
  const old = await keys.create('one', 'Synthetic old');
  let limits = createPickerLimits({ pluginKeysPerAccount: 1 }); await limits.initialize(registry);
  for (const id of ids) refused(() => limits.reserveKey({ accountId: id }, 'legacy', 'one'));
  await keys.revoke(old.record.id, 'one');
  const bound = await keys.create('one', 'Synthetic bound', ids[1]);
  assert.equal(Object.hasOwn(bound.record, 'accountId'), false);
  limits = createPickerLimits({ pluginKeysPerAccount: 1 }); await limits.initialize(registry);
  refused(() => limits.reserveKey({ accountId: ids[1] }, B, 'one'));
  const allowed = limits.reserveKey({ accountId: ids[0] }, 'legacy', 'one'); allowed.finish();
});
