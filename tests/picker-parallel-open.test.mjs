// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPickerRouter } from '../app/picker-router.mjs';
import { createPickerLimits } from '../app/security/picker-limits.mjs';
import { withDirectoryBarriers, storeWriteBlocked } from '../app/storage/snapshot.mjs';

function receipts() {
  const rows = [], listeners = new Set();
  return {
    rows,
    push(row) { rows.push(row); for (const listener of [...listeners]) listener(row); },
    wait(predicate) {
      const found = rows.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise(resolve => {
        const listener = row => { if (predicate(row)) { listeners.delete(listener); resolve(row); } };
        listeners.add(listener);
      });
    },
  };
}

async function fixture(t, { coldStartsGlobal = 4, maxOpenContexts = 8, observeAdmission = () => {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'parallel-picker-'));
  const events = receipts(), gates = [], owners = new Set(), calls = [], contexts = [];
  const factories = new Map(), preparations = new Map(), closes = new Map(), pickers = new Map();
  const timers = new Map(); let timerId = 0;
  const clock = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const limits = createPickerLimits({ coldStartsGlobal });
  const registry = {
    getPicker: id => pickers.get(id), listPickers: () => [...pickers.values()],
    pickerDirectory: id => path.join(root, id), deletionDirectory: id => path.join(root, id),
    getAccount: accountId => ({ memberships: [...pickers.values()].map(p => ({ pickerId: p.id, role: 'owner' })) }),
    async beginPickerDeletion(id, { onTombstone }) {
      pickers.get(id).lifecycle = 'deleting'; onTombstone(); events.push({ event: 'tombstone', pickerId: id });
    },
    async reconcileTombstones() { return { blockedPickerIds: [...pickers.values()].filter(p => p.lifecycle === 'deleting').map(p => p.id), deletedAccountIds: [] }; },
    deletionRecords: () => ({ accounts: [] }),
    async advanceDeletion(_kind, id, phase) { events.push({ event: phase, pickerId: id }); },
    async completePickerDeletion(id) { pickers.get(id).lifecycle = 'deleted'; },
    withRecoveryCheckpoint: work => work({}),
  };
  const legacy = {
    authenticate: request => ({ kind: 'account', accountId: request.headers.account, pickerId: request.headers.picker,
      sessionId: request.headers.account, role: 'owner' }),
    fenceRevokedSessions() {}, async revokeDeletionSessions() {},
  };
  const router = createPickerRouter({ registry, legacy, pickerLimits: limits, maxOpenContexts, admissionClock: clock,
    onAdmission: row => { events.push(row); observeAdmission(row); },
    openContext: async id => {
      assert.equal(owners.has(id), false, 'one storage owner per picker'); owners.add(id); calls.push(id);
      events.push({ event: 'factory', pickerId: id });
      try { await factories.get(id)?.promise; }
      catch (error) { owners.delete(id); throw error; }
      events.push({ event: 'factory-returned', pickerId: id });
      let preparation, closing, fenced = false;
      const context = {
        prepare() {
          return preparation ??= (async () => {
            events.push({ event: 'prepare', pickerId: id });
            await preparations.get(id)?.promise;
            events.push({ event: 'prepared', pickerId: id });
          })();
        },
        fenceDeletion() { assert.equal(closing, undefined, 'closed sidecars cannot be fenced again'); fenced = true; },
        fenceRevokedSessions() {}, async revokeDeletion() { assert.equal(closing, undefined, 'closed sidecars cannot be revoked again'); fenced = true; },
        close() {
          if (closing) return closing;
          fenced = true;
          return closing = (async () => {
            events.push({ event: 'close', pickerId: id });
            await preparation?.catch(() => {}); await closes.get(id)?.promise;
            owners.delete(id); events.push({ event: 'closed', pickerId: id });
          })();
        },
        async handle(_request, response) {
          assert.equal(fenced, false, 'fenced contexts cannot deliver or write');
          events.push({ event: 'handle', pickerId: id }); response.writeHead(200); response.end('{}');
        },
      };
      contexts.push(context); return context;
    },
  });
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    await router.close(); await rm(root, { recursive: true, force: true });
  });
  function defer() { const gate = Promise.withResolvers(); gates.push(gate); return gate; }
  function hold(phase, id) {
    const gate = defer();
    ({ factory: factories, prepare: preparations, close: closes })[phase].set(id, gate); return gate;
  }
  function send(id, { account = id, route = '/api/state', body } = {}) {
    if (!pickers.has(id)) pickers.set(id, { id, kind: 'default', ownerAccountId: account, lifecycle: 'active', provisioning: 'ready' });
    const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const request = Readable.from(bytes.length ? [bytes] : []);
    Object.assign(request, { headers: { host: 'localhost', origin: 'http://localhost', picker: id, account,
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(bytes.length) }) },
    method: body === undefined ? 'GET' : 'POST', url: route, complete: true, socket: { remoteAddress: '127.0.0.1' } });
    const chunks = [], headers = new Map();
    const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    response.setHeader = (key, value) => headers.set(key.toLowerCase(), value);
    response.getHeader = key => headers.get(key.toLowerCase());
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    const done = router.handle(request, response, { host: '127.0.0.1' })
      .then(() => ({ status: response.statusCode, headers, text: Buffer.concat(chunks).toString() }));
    return { done, disconnect() { request.aborted = true; request.emit('aborted'); response.destroy(); } };
  }
  const wait = (event, id) => events.wait(row => row.event === event && row.pickerId === id);
  const expire = admissionId => { const callback = timers.get(admissionId); assert.ok(callback, 'live deadline'); timers.delete(admissionId); callback(); };
  return { root, router, limits, registry, events, calls, contexts, owners, timers, defer, hold, send, wait, expire };
}

test('held factories consume only the configured permits while unrelated warm and cold requests progress', async t => {
  const f = await fixture(t, { coldStartsGlobal: 2 });
  assert.equal((await f.send('warm').done).status, 200);
  const aGate = f.hold('factory', 'a'), bGate = f.hold('factory', 'b');
  const a = f.send('a'); await f.wait('factory', 'a');
  const b = f.send('b'); await f.wait('factory', 'b');
  const c = f.send('c'); await f.wait('queued', 'c');
  assert.deepEqual(f.calls, ['warm', 'a', 'b']);
  assert.equal(f.router.checkpoint.counts().openContexts, 2, 'reservations are not published contexts');
  assert.equal((await f.send('warm').done).status, 200);
  aGate.resolve(); assert.equal((await a.done).status, 200);
  assert.equal((await c.done).status, 200);
  assert.ok(f.events.rows.every(row => row.active === undefined || row.active <= 2));
  bGate.resolve(); assert.equal((await b.done).status, 200);
});

test('shared followers keep their request bounds and leave all remaining cold permits for other factories', async t => {
  const f = await fixture(t), gates = ['a', 'b', 'c', 'd'].map(id => f.hold('factory', id));
  const first = f.send('a'); await f.wait('factory', 'a');
  const followers = [f.send('a'), f.send('a', { account: 'other' })];
  await f.events.wait(row => row.event === 'started' && row.admissionId === 3);
  assert.equal((await f.send('a').done).status, 503, 'same pending per-account bound');
  const others = ['b', 'c', 'd'].map(id => f.send(id));
  for (const id of ['b', 'c', 'd']) await f.wait('factory', id);
  assert.equal(Math.max(...f.events.rows.map(row => row.active ?? 0)), 4);
  assert.deepEqual(f.calls, ['a', 'b', 'c', 'd']);
  for (const gate of gates) gate.resolve();
  for (const request of [first, ...followers, ...others]) assert.equal((await request.done).status, 200);
  assert.equal(f.calls.filter(id => id === 'a').length, 1);
});

test('same-picker authorized waiters share a factory without bypassing per-account pending bounds', async t => {
  const f = await fixture(t), gate = f.hold('factory', 'a');
  const first = f.send('a'); await f.wait('factory', 'a');
  const second = f.send('a');
  await f.events.wait(row => row.event === 'queued' && row.pickerId === 'a' && row.admissionId === 2);
  const refused = await f.send('a').done;
  assert.equal(refused.status, 503); assert.match(refused.text, /account-full/);
  assert.equal((await f.send('b').done).status, 200);
  gate.resolve(); assert.equal((await first.done).status, 200); assert.equal((await second.done).status, 200);
  assert.equal(f.calls.filter(id => id === 'a').length, 1);
});

test('shared factory failures drain one generation before a fresh request can open the picker again', async t => {
  const f = await fixture(t), factory = f.hold('factory', 'a');
  const a = f.send('a', { account: 'synthetic-first' }); await f.wait('factory', 'a');
  const same = f.send('a', { account: 'synthetic-second' }); await f.events.wait(row => row.event === 'started' && row.admissionId === 2);
  factory.reject(new Error('Synthetic factory failure'));
  assert.equal((await a.done).status, 503); assert.equal((await same.done).status, 503);
  assert.equal(f.owners.has('a'), false); assert.deepEqual(f.calls, ['a']);
  f.hold('factory', 'a').resolve();
  assert.equal((await f.send('a').done).status, 200); assert.deepEqual(f.calls, ['a', 'a']);
});

for (const cancellation of ['deadline', 'disconnect']) test(`${cancellation} detaches one waiter while another account completes the shared open`, async t => {
  const f = await fixture(t), gate = f.hold('factory', 'a');
  const first = f.send('a', { account: 'synthetic-first' }); await f.wait('factory', 'a');
  const second = f.send('a', { account: 'synthetic-second' }); await f.events.wait(row => row.event === 'started' && row.admissionId === 2);
  if (cancellation === 'deadline') {
    f.expire(1); const result = await first.done;
    assert.equal(result.status, 503); assert.equal(result.headers.get('retry-after'), 1);
  } else { first.disconnect(); await first.done; }
  assert.equal((await f.send('b').done).status, 200);
  assert.equal(f.owners.has('a'), true);
  gate.resolve(); assert.equal((await second.done).status, 200);
  assert.deepEqual(f.calls, ['a', 'b']);
  assert.equal(f.events.rows.some(row => row.event === 'closed' && row.pickerId === 'a'), false);
});

test('a same-account follower keeps the shared open alive after the starter expires', async t => {
  const f = await fixture(t), gate = f.hold('factory', 'a');
  const first = f.send('a'); await f.wait('factory', 'a');
  const second = f.send('a'); await f.events.wait(row => row.event === 'queued' && row.admissionId === 2);
  f.expire(1); assert.equal((await first.done).status, 503);
  gate.resolve(); assert.equal((await second.done).status, 200); assert.deepEqual(f.calls, ['a']);
});

test('disconnect at admission completion leaves a published context usable without a second factory', async t => {
  let request;
  const f = await fixture(t, { observeAdmission: row => { if (row.event === 'completed' && row.admissionId === 1) request.disconnect(); } });
  const factory = f.hold('factory', 'a'); request = f.send('a'); await f.wait('factory', 'a');
  factory.resolve(); await request.done;
  assert.equal((await f.send('a').done).status, 200); assert.deepEqual(f.calls, ['a']);
  assert.equal(f.events.rows.some(row => row.event === 'close' && row.pickerId === 'a'), false);
});

test('abandoned factories and late closes retain their cold permit and directory ownership until drained', async t => {
  const f = await fixture(t, { coldStartsGlobal: 1 });
  const factory = f.hold('factory', 'a'), close = f.hold('close', 'a');
  const a = f.send('a'); await f.wait('factory', 'a'); f.expire(1);
  assert.equal((await a.done).status, 503);
  const b = f.send('b'); await f.wait('queued', 'b');
  const retry = await f.send('a', { account: 'synthetic-fresh' }).done;
  assert.equal(retry.status, 503); assert.equal(retry.headers.get('retry-after'), 1);
  assert.match(retry.text, /draining/);
  assert.throws(() => f.limits.coldStart({ accountId: 'synthetic-probe', pickerId: 'probe' }), { status: 503 });
  assert.deepEqual(f.calls, ['a']);
  factory.resolve(); await f.wait('close', 'a');
  assert.throws(() => f.limits.coldStart({ accountId: 'synthetic-probe', pickerId: 'probe' }), { status: 503 });
  assert.equal(f.owners.has('a'), true); assert.deepEqual(f.calls, ['a']);
  close.resolve(); assert.equal((await b.done).status, 200);
  assert.equal(f.owners.has('a'), false); assert.deepEqual(f.calls, ['a', 'b']);
  assert.equal(f.events.rows.some(row => row.event === 'prepare' && row.pickerId === 'a'), false);
});

test('expiry of the last follower abandons the shared factory without releasing its starter permit early', async t => {
  const f = await fixture(t, { coldStartsGlobal: 1 }), factory = f.hold('factory', 'a'), close = f.hold('close', 'a');
  const first = f.send('a'); await f.wait('factory', 'a');
  const queued = f.send('a'); await f.events.wait(row => row.event === 'queued' && row.admissionId === 2);
  f.expire(1); f.expire(2);
  assert.equal((await first.done).status, 503); assert.equal((await queued.done).status, 503);
  factory.resolve(); await f.wait('close', 'a');
  assert.throws(() => f.limits.coldStart({ accountId: 'synthetic-probe', pickerId: 'probe' }), { status: 503 });
  close.resolve(); await f.wait('released', 'a'); assert.equal(f.owners.has('a'), false);
  assert.equal(f.events.rows.some(row => row.event === 'prepare' && row.pickerId === 'a'), false);
});

test('optional preparation holds neither opening, warm reads, other factories nor its directory checkpoint', async t => {
  const f = await fixture(t, { coldStartsGlobal: 1 }), preparation = f.hold('prepare', 'a');
  const first = f.send('a'); await f.wait('prepare', 'a');
  assert.equal((await first.done).status, 200);
  assert.equal((await f.send('a').done).status, 200);
  assert.equal((await f.send('b').done).status, 200);
  await withDirectoryBarriers([f.registry.pickerDirectory('a')], () => assert.equal(f.owners.has('a'), true));
  preparation.reject(new Error('Synthetic optional failure'));
  assert.equal((await f.send('a').done).status, 200); assert.deepEqual(f.calls, ['a', 'b']);
});

test('a held eviction close fences its picker while unrelated warm reads and other capacity evictions progress', async t => {
  const f = await fixture(t, { maxOpenContexts: 4 });
  for (const id of ['a', 'warm', 'victim']) assert.equal((await f.send(id).done).status, 200);
  const close = f.hold('close', 'a');
  const replacement = f.send('replacement'); await f.wait('close', 'a');
  assert.equal((await f.send('warm').done).status, 200);
  assert.equal((await f.send('other').done).status, 200);
  const blocked = f.send('a', { account: 'synthetic-returning' }); await f.wait('queued', 'a');
  // Finish this waiter explicitly rather than depending on residency retry time.
  const admission = await f.events.wait(row => row.event === 'queued' && row.pickerId === 'a' && row.admissionId > 3);
  f.expire(admission.admissionId); assert.equal((await blocked.done).status, 503);
  assert.equal(f.calls.filter(id => id === 'a').length, 1); assert.equal(f.owners.has('a'), true);
  close.resolve(); assert.equal((await replacement.done).status, 200);
  assert.equal((await f.send('a').done).status, 200); assert.equal(f.calls.filter(id => id === 'a').length, 2);
});

test('idle close drains outside residency while its picker stays fenced', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t), close = f.hold('close', 'a');
  assert.equal((await f.send('a').done).status, 200); assert.equal((await f.send('warm').done).status, 200);
  t.mock.timers.tick(599999); assert.equal((await f.send('warm').done).status, 200);
  t.mock.timers.tick(1); await f.wait('close', 'a');
  assert.equal((await f.send('warm').done).status, 200); assert.equal((await f.send('b').done).status, 200);
  assert.equal(f.owners.has('a'), true); assert.equal(f.calls.filter(id => id === 'a').length, 1);
  close.resolve(); await f.wait('closed', 'a');
  assert.equal((await f.send('a').done).status, 200); assert.equal(f.calls.filter(id => id === 'a').length, 2);
});

test('checkpoint during a factory waits through publication and fences same-picker delivery while other pickers progress', async t => {
  const f = await fixture(t), factory = f.hold('factory', 'a'), checkpointGate = f.defer(), captured = f.defer();
  const a = f.send('a'); await f.wait('factory', 'a');
  let capturing = false, delivered = false;
  const checkpoint = withDirectoryBarriers([f.registry.pickerDirectory('a')], async () => {
    capturing = true; captured.resolve(); assert.equal(f.owners.has('a'), true); await checkpointGate.promise;
  });
  assert.equal(storeWriteBlocked(f.registry.pickerDirectory('a')), true); assert.equal(capturing, false);
  a.done.then(() => { delivered = true; });
  assert.equal((await f.send('b').done).status, 200);
  factory.resolve(); await captured.promise;
  assert.equal(delivered, false);
  assert.equal(f.router.checkpoint.counts().openContexts, 2, 'publication waits for its checkpoint');
  assert.equal(f.events.rows.some(row => row.event === 'prepare' && row.pickerId === 'a'), false);
  checkpointGate.resolve(); await checkpoint; assert.equal((await a.done).status, 200);
  assert.equal(capturing, true); assert.equal(f.calls.filter(id => id === 'a').length, 1);
});

test('checkpoint before a factory holds its initialization without blocking another picker', async t => {
  const f = await fixture(t), gate = f.defer(), entered = Promise.withResolvers();
  const checkpoint = withDirectoryBarriers([f.registry.pickerDirectory('a')], async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  const a = f.send('a'); await f.wait('started', 'a');
  assert.equal((await f.send('b').done).status, 200); assert.deepEqual(f.calls, ['b']);
  gate.resolve(); await checkpoint; assert.equal((await a.done).status, 200); assert.deepEqual(f.calls, ['b', 'a']);
});

test('a checkpoint at the cold admission handoff retains the waiter deadline and pending charge through its final pin', async t => {
  const f = await fixture(t, { coldStartsGlobal: 1 }), gate = f.defer(), captured = f.defer();
  const original = f.router.checkpoint.open;
  let opens = 0, checkpoint;
  f.router.checkpoint.open = (id, work) => {
    // Initialization and publication have finished. Start the checkpoint at
    // the final pin, which used to occur after admission completed/released.
    if (id === 'a' && ++opens === 3) checkpoint = withDirectoryBarriers([f.registry.pickerDirectory(id)], async () => {
      captured.resolve(); await gate.promise;
    });
    return original(id, work);
  };
  const a = f.send('a'); await captured.promise;
  assert.equal(f.events.rows.some(row => row.pickerId === 'a' && ['completed', 'released'].includes(row.event)), false,
    'acquisition has not finished at its checkpoint-protected pin');
  assert.equal(f.timers.size, 1, 'the cold waiter still owns its original deadline');
  assert.equal((await f.send('b').done).status, 200, 'the factory permit is independent of the blocked pin');
  const released = await f.wait('released', 'b');
  assert.equal(released.pending, 1, 'the blocked acquisition still consumes its pending charge');
  assert.equal(f.timers.size, 1);
  f.expire(1);
  const result = await a.done;
  assert.equal(result.status, 503); assert.match(result.text, /admission deadline/);
  assert.equal(result.headers.get('retry-after'), 1);
  assert.equal(f.events.rows.some(row => row.event === 'handle' && row.pickerId === 'a'), false);
  gate.resolve(); await checkpoint; await f.wait('released', 'a');
  assert.equal(f.events.rows.some(row => row.event === 'completed' && row.pickerId === 'a'), false);
  assert.equal(f.events.rows.some(row => row.event === 'handle' && row.pickerId === 'a'), false, 'the expired waiter cannot pin after checkpoint release');
  assert.equal(f.events.rows.at(-1).pending, 0);
  assert.equal((await f.send('a').done).status, 200, 'expiry leaves the published save usable');
  assert.deepEqual(f.calls, ['a', 'b']);
});

test('deletion during opening waits for its late close before revocation and directory purge', async t => {
  const f = await fixture(t), factory = f.hold('factory', 'a'), close = f.hold('close', 'a');
  await mkdir(f.registry.pickerDirectory('a')); const sentinel = path.join(f.registry.pickerDirectory('a'), 'synthetic');
  await writeFile(sentinel, 'owned');
  const a = f.send('a'); await f.wait('factory', 'a');
  const deletion = f.send('a', { route: '/api/picker/delete', body: {} });
  await Promise.race([f.wait('tombstone', 'a'), deletion.done.then(result => assert.fail(`Deletion returned before tombstone: ${result.status} ${result.text}`))]);
  assert.equal((await f.send('b').done).status, 200);
  assert.equal((await f.send('a').done).status, 403);
  factory.resolve(); await f.wait('close', 'a');
  assert.equal(await readFile(sentinel, 'utf8'), 'owned'); assert.equal(f.owners.has('a'), true);
  assert.equal(f.events.rows.some(row => row.event === 'revoked' && row.pickerId === 'a'), false);
  close.resolve(); assert.equal((await deletion.done).status, 200); assert.equal((await a.done).status, 403);
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' }); assert.equal(f.owners.has('a'), false);
  assert.equal(f.events.rows.some(row => row.event === 'handle' && row.pickerId === 'a'), false);
  assert.equal(f.calls.filter(id => id === 'a').length, 1);
});

test('deletion during a published eviction close drains it without reopening its closed sidecars', async t => {
  const f = await fixture(t, { maxOpenContexts: 3 }), close = f.hold('close', 'a');
  await mkdir(f.registry.pickerDirectory('a')); const sentinel = path.join(f.registry.pickerDirectory('a'), 'synthetic');
  await writeFile(sentinel, 'owned');
  assert.equal((await f.send('a').done).status, 200); assert.equal((await f.send('b').done).status, 200);
  const replacement = f.send('replacement'); await f.wait('close', 'a');
  const deletion = f.send('a', { route: '/api/picker/delete', body: {} });
  await Promise.race([f.wait('tombstone', 'a'), deletion.done.then(result => assert.fail(`Deletion returned before tombstone: ${result.status} ${result.text}`))]);
  await f.wait('revoked', 'a');
  assert.equal(await readFile(sentinel, 'utf8'), 'owned'); assert.equal(f.owners.has('a'), true);
  assert.equal((await f.send('b').done).status, 200);
  close.resolve(); assert.equal((await deletion.done).status, 200); assert.equal((await replacement.done).status, 200);
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' }); assert.equal(f.calls.filter(id => id === 'a').length, 1);
});

test('shutdown cancels shared waiters and drains all late factories and closes before releasing ownership', async t => {
  const f = await fixture(t), aFactory = f.hold('factory', 'a'), bFactory = f.hold('factory', 'b'), aClose = f.hold('close', 'a');
  const a = f.send('a'); await f.wait('factory', 'a');
  const same = f.send('a', { account: 'synthetic-another' }); await f.events.wait(row => row.event === 'started' && row.admissionId === 2);
  const b = f.send('b'); await f.wait('factory', 'b');
  let stopped = false; const stopping = f.router.close().then(() => { stopped = true; });
  for (const request of [a, same, b]) assert.equal((await request.done).status, 503);
  assert.equal((await f.send('c').done).status, 503);
  aFactory.resolve(); bFactory.resolve(); await f.wait('close', 'a'); await f.wait('closed', 'b');
  assert.equal(stopped, false); assert.equal(f.owners.has('a'), true);
  assert.equal(f.events.rows.some(row => row.event === 'released' && row.pickerId === 'a'), false);
  aClose.resolve(); await stopping; assert.equal(f.owners.size, 0);
  assert.deepEqual(f.calls, ['a', 'b']);
  assert.equal(f.events.rows.filter(row => row.event === 'closed').length, 2);
  assert.equal(f.events.rows.filter(row => row.event === 'released').length, 3);
});
