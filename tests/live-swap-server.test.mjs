import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLiveSwapAdmission } from '../app/live-swap-admission.mjs';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { emptyMetadataDataset } from './helpers/server-dataset.mjs';

test('excluded requests and freeze refuse each other at their synchronous START boundaries', async () => {
  const admission = createLiveSwapAdmission(), review = admission.begin();
  await assert.rejects(admission.freeze(), { code: 'LIVE_SWAP_BUSY' });
  assert.equal(admission.frozen, false);
  review.finish(); review.finish();
  await admission.freeze();
  assert.throws(() => admission.begin(), { code: 'PICKER_UPDATING', message: 'Please try again in a moment.' });
});

test('ordinary admitted commands drain; deadline refusal retains admission and removes waiter', async () => {
  const admission = createLiveSwapAdmission(), command = admission.begin();
  command.ordinary(); command.ordinary();
  const freeze = admission.freeze(1000);
  assert.equal(admission.frozen, true);
  assert.throws(() => admission.begin(), { code: 'PICKER_UPDATING' });
  command.finish(); await freeze;
  const stalled = createLiveSwapAdmission(), lease = stalled.begin(); lease.ordinary();
  await assert.rejects(stalled.freeze(5), { code: 'LIVE_SWAP_DRAIN_TIMEOUT' });
  assert.equal(stalled.frozen, false);
  lease.finish(); await stalled.freeze();
});

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-live-swap-server-'));
  const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]);
  // Refuse a busy reserved test port before creating any application state.
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(18780, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await rm(dataDir, { recursive: true, force: true }); await rm(`${dataDir}.dataset.json`, { force: true }); } });
  const config = { dataset: await emptyMetadataDataset(), dataDir, definitions, taskMap: {}, initialState,
    port: 18780, loopbackPort: undefined, predictionPrewarm: false, retention: false, shutdownDeadlineMs: 250,
    mapAssetsDir: path.join(dataDir, 'absent-map'), gameDataDir: path.join(dataDir, 'absent-game'), ...options };
  app = await createServer(config);
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const auth = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = (route, body, headers = auth) => fetch(origin + route, { headers: { ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  return { app, request, origin, auth, dataDir, config,
    async reopen(options) { await app.close(); app = await createServer({ ...config, ...options }); await app.listen(); return app; } };
}

test('every sidecar/review/upload mutation is excluded before its first handler await; frozen routes refuse START', async t => {
  const { app, origin, auth, request } = await fixture(t);
  const routes = [
    '/api/action-session', '/api/runemetrics/preview', '/api/runemetrics/apply', '/api/original-sync/preview', '/api/profile/preview',
    '/api/member-restore/preview', '/api/member-restore', '/api/restore/preview', '/api/restore', '/api/import/preview', '/api/import',
    '/api/feedback', '/api/feedback/seen', '/api/feedback/00000000-0000-4000-8000-000000000000/status',
    '/api/invites', '/api/invites/00000000-0000-4000-8000-000000000000/player', '/api/invites/00000000-0000-4000-8000-000000000000/revoke',
    '/api/overlays', '/api/overlays/00000000-0000-4000-8000-000000000000/revoke', '/api/usage',
    '/api/shutdown', '/api/worker-restart', '/api/prediction-intent', '/api/pool-ranking-intent', '/api/sandbox/evaluate', '/api/command',
  ];
  for (const { route, method } of [...routes.map(route => ({ route, method: 'POST' })),
    ...['/join/', '/api/usage', '/api/state', '/api/tasks'].map(route => ({ route, method: 'GET' }))]) {
    let attempt;
    app.server.once('request', () => { attempt = app.freeze(); attempt.catch(() => {}); });
    // Invalid JSON cannot perform even the shutdown route after the boundary check.
    await new Promise((resolve, reject) => {
      const req = http.request(origin + route, { method, headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' } }, res => {
        res.resume(); res.once('end', resolve);
      });
      req.once('error', reject); req.end(method === 'POST' ? '{invalid' : undefined);
    });
    await assert.rejects(attempt, { code: 'LIVE_SWAP_BUSY' }, route);
  }
  const checkpoint = await app.freeze(); assert.equal(checkpoint.revision, 0);
  for (const route of routes) {
    const response = await request(route, {});
    assert.equal(response.status, 503, route);
    assert.deepEqual(await response.json(), { message: 'Please try again in a moment.', code: 'PICKER_UPDATING' });
  }
  const health = await (await request('/api/health')).json();
  assert.equal(health.savesReady, false); assert.equal(health.ready, false);
  assert.equal(health.liveSwapProtocol, 2); assert.equal(health.actionReceiptFormat, 2);
});

test('a fully parsed ordinary command finishes before checkpoint while later routes refuse START', async t => {
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  const { app, request } = await fixture(t, { beforeCommit: async ({ state }) => { if (state.revision) { entered.resolve(); await proceed.promise; } } });
  const saving = request('/api/command', { expectedRevision: 0, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Admitted' } });
  await entered.promise;
  await assert.rejects(app.freeze({ requireIdle: true }), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  let finished = false;
  const freezing = app.freeze().then(checkpoint => { finished = true; return checkpoint; });
  assert.equal(finished, false);
  const blocked = await request('/api/action-session', { clientId: '20000000-0000-4000-8000-000000000001' });
  assert.equal(blocked.status, 503); await blocked.arrayBuffer();
  proceed.resolve();
  const response = await saving; assert.equal(response.status, 200); await response.arrayBuffer();
  const checkpoint = await freezing; assert.equal(checkpoint.revision, 1);
  assert.equal(app.store.getState().members[0].notes['12341'], 'Admitted');
});

test('a fully parsed member restore refuses freeze until its durable replacement finishes', async t => {
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  const { app, request } = await fixture(t, { beforeCommit: async ({ state }) => { if (state.revision) { entered.resolve(); await proceed.promise; } } });
  const backup = await (await request('/api/backup')).json();
  const saving = request('/api/member-restore', { memberId: 'one', expectedRevision: 0, backup });
  await entered.promise;
  await assert.rejects(app.freeze(), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  proceed.resolve();
  const response = await saving; assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal((await app.freeze()).revision, 1);
});
test('application freeze validates save caps before admission and keeps an oversized writer available', async t => {
  const { app, request, dataDir } = await fixture(t);
  for (const maxSaveBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '100', null]) {
    await assert.rejects(app.freeze({ maxSaveBytes }), /positive safe integer/);
  }
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  await assert.rejects(app.freeze({ requireIdle: true, maxSaveBytes: 1 }), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  const response = await request('/api/command', { expectedRevision: 0,
    command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'é'.repeat(512) } });
  assert.equal(response.status, 200); await response.arrayBuffer();
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  assert.ok(bytes.length > bytes.toString('utf8').length);
  await assert.rejects(app.freeze({ maxSaveBytes: bytes.toString('utf8').length }), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  assert.equal((await app.freeze({ requireIdle: true, maxSaveBytes: bytes.length })).revision, 1);
  assert.equal((await (await request('/api/health')).json()).savesReady, false);
});

test('application freeze refuses a save that grows beyond its cap while an accepted command drains', async t => {
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  const { app, request, dataDir } = await fixture(t, { beforeCommit: async ({ state }) => {
    if (state.revision === 1) { entered.resolve(); await proceed.promise; }
  } });
  const maxSaveBytes = (await readFile(path.join(dataDir, 'state.json'))).length;
  const saving = request('/api/command', { expectedRevision: 0,
    command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'é'.repeat(512) } });
  await entered.promise;
  const freezing = app.freeze({ maxSaveBytes }); freezing.catch(() => {});
  proceed.resolve();
  const response = await saving; assert.equal(response.status, 200); await response.arrayBuffer();
  await assert.rejects(freezing, { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  const next = await request('/api/command', { expectedRevision: 1,
    command: { type: 'set-rule', ruleId: 'access.shared', value: false } });
  assert.equal(next.status, 200); await next.arrayBuffer();
  assert.equal(app.store.getInfo().revision, 2);
});

test('background maintenance defers application freeze and leaves the original writer ready', async t => {
  const { app, request } = await fixture(t);
  const reading = app.store.listBackups();
  await assert.rejects(app.freeze(), { code: 'LIVE_SWAP_BUSY' });
  await reading;
  assert.equal((await (await request('/api/health')).json()).savesReady, true);
  assert.equal((await request('/api/command', { expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } })).status, 200);
});
test('warmed application activation retains its server and world, reloads sidecars and serves latest receipts', async t => {
  const { app, request, config, dataDir, auth } = await fixture(t);
  const activationEvents = [];
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(18781, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
  const standby = await createServer({ ...config, port: 18781, liveSwap: { standby: true, strict: true, version: 'warmed-fixture',
    onActivationTiming(event) {
      activationEvents.push(event);
      if (event.phase === 'store.guard') throw new Error('Injected synchronous diagnostic failure');
      if (event.phase === 'app.sidecarsOpen') return Promise.reject(new Error('Injected asynchronous diagnostic failure'));
    } } });
  t.after(() => standby.close()); await standby.listen();
  assert.deepEqual(activationEvents, []);
  const server = standby.server, world = standby.world, timing = standby.getStartupTimingMs();
  const session = await (await request('/api/action-session', { clientId: '40000000-0000-4000-8000-000000000001' })).json();
  const body = { requestId: `v3.${session.scope}.${session.slot}.${session.generation}.1`, requestAck: 0, expectedRevision: 0,
    command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'After standby warmed' } };
  const original = await (await request('/api/command', body)).json();
  const invitation = await (await request('/api/invites', { label: 'Player', memberId: 'one' })).json();
  const joined = await fetch(invitation.link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const checkpoint = await app.freeze(); await app.close();
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  const getState = standby.store.getState;
  standby.store.getState = () => { throw new Error('Activation must not clone full History to read member IDs.'); };
  try { await standby.activate(checkpoint); } finally { standby.store.getState = getState; }
  assert.deepEqual(activationEvents.map(event => event.phase), ['app.sidecarsClose', 'store.guard', 'store.ownerLock',
    'store.readValidate', 'store.prepare', 'store.listeners', 'app.sidecarsOpen', 'app.total']);
  assert.ok(activationEvents.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
  assert.equal(standby.server, server); assert.equal(standby.world, world); assert.deepEqual(standby.getStartupTimingMs(), timing);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), bytes);
  const origin = `http://127.0.0.1:${standby.address().port}`;
  const response = await fetch(origin + '/api/command', { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200); const replay = await response.json();
  assert.deepEqual(replay.receipt, original.receipt); assert.equal(replay.state.members[0].notes['12341'], 'After standby warmed');
  const linked = await fetch(origin + '/api/action-session', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: '40000000-0000-4000-8000-000000000002' }) });
  assert.equal(linked.status, 200); await linked.arrayBuffer();
  const health = await (await fetch(origin + '/api/health', { headers: auth })).json();
  assert.equal(health.standby, false); assert.equal(health.savesReady, true); assert.equal(health.ready, true);
});
test('sidecar activation failure closes the candidate and releases its acquired writer lock', async t => {
  const { app, reopen, dataDir } = await fixture(t);
  const checkpoint = await app.freeze(); await app.close();
  const standby = await reopen({ liveSwap: { standby: true, strict: true } });
  const file = path.join(dataDir, 'state.json'), bytes = await readFile(file);
  await writeFile(path.join(dataDir, 'feedback.json'), '{invalid');
  await assert.rejects(standby.activate(checkpoint));
  assert.equal(standby.address(), null);
  assert.deepEqual(await readFile(file), bytes);
  assert.equal((await readdir(dataDir)).includes('store.lock'), false);
});

test('session registration, retained receipt replay before Undo validation, and explicit acknowledgement work through HTTP', async t => {
  const { app, request } = await fixture(t);
  const module = await request('/live-swap-client.mjs');
  assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(await module.text(), /export function createLiveSwapCommandClient/);
  const clientId = '10000000-0000-4000-8000-000000000001';
  const sessionResponse = await request('/api/action-session', { clientId }); assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const command = { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Durable' };
  const first = await (await request('/api/command', { expectedRevision: 0, command, requestId, requestAck: 0 })).json();
  assert.equal(first.state.revision, 1); assert.equal(first.receipt.requestId, requestId); assert.equal(first.receipt.revision, 1);
  const undoId = `v3.${session.scope}.${session.slot}.${session.generation}.2`;
  const undo = { type: 'undo' };
  const undone = await (await request('/api/command', { expectedRevision: 1, command: undo, requestId: undoId, requestAck: 1 })).json();
  assert.equal(undone.state.revision, 2);
  await request('/api/command', { expectedRevision: 2, command: { ...command, note: 'Later' } });
  const replay = await request('/api/command', { expectedRevision: 1, command: undo, requestId: undoId, requestAck: 1 });
  assert.equal(replay.status, 200);
  const saved = await replay.json(); assert.equal(saved.state.revision, 3); assert.equal(saved.receipt.revision, 2);
  assert.deepEqual(saved.receipt, undone.receipt); assert.equal(app.store.getInfo().revision, 3);
  const mismatch = await request('/api/command', { expectedRevision: 3, command, requestId: undoId, requestAck: 1 });
  assert.equal(mismatch.status, 409); assert.match((await mismatch.json()).code, /^REQUEST_/);
  const ack = await request('/api/action-session', { clientId, acknowledge: { slot: session.slot, generation: session.generation, sequence: 2, scope: session.scope } });
  assert.equal(ack.status, 200); assert.equal((await ack.json()).acknowledged, 2);
  const created = await (await request('/api/invites', { label: 'Player', memberId: 'one' })).json();
  const joined = await fetch(created.link, { redirect: 'manual' });
  const headers = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  const player = await request('/api/action-session', { clientId: '10000000-0000-4000-8000-000000000002' }, headers);
  assert.equal(player.status, 200); await player.arrayBuffer();
  const wrongActor = await request('/api/command', { expectedRevision: 1, command: undo, requestId: undoId, requestAck: 1 }, headers);
  assert.equal(wrongActor.status, 409); assert.match((await wrongActor.json()).code, /^(?:REQUEST_|ACTION_SESSION_)/);
  await request(`/api/invites/${created.invite.id}/revoke`, {});
  const revoked = await request('/api/command', { expectedRevision: 1, command: undo, requestId: undoId, requestAck: 1 }, headers);
  assert.equal(revoked.status, 401); await revoked.arrayBuffer();
});

test('strict standby startup, authenticated reads and close leave every storage byte and timestamp untouched', async t => {
  const { app, reopen, dataDir, request } = await fixture(t);
  await request('/api/action-session', { clientId: '30000000-0000-4000-8000-000000000001' });
  const checkpoint = await app.freeze(); await app.close();
  async function snapshot(directory) {
    const files = {};
    async function visit(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name), info = await stat(file);
        files[path.relative(directory, file)] = { size: info.size, mtime: info.mtimeMs, ...(entry.isFile() ? { bytes: (await readFile(file)).toString('base64') } : {}) };
        if (entry.isDirectory()) await visit(file);
      }
    }
    await visit(directory);
    const binding = `${directory}.dataset.json`;
    let info;
    try { info = await stat(binding); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    files['<dataset-binding>'] = info
      ? { size: info.size, mtime: info.mtimeMs, bytes: (await readFile(binding)).toString('base64') }
      : { absent: true };
    return files;
  }
  const before = await snapshot(dataDir);
  const standby = await reopen({ liveSwap: { standby: true, strict: true, checkpoint } });
  for (const route of ['/api/health', '/api/state', '/api/art-status', '/api/overlays', '/overlay/overlay.css']) {
    const response = await request(route); assert.equal(response.status, 200, route); await response.arrayBuffer();
  }
  const health = await (await request('/api/health')).json(); assert.equal(health.standby, true); assert.equal(health.savesReady, false);
  const denied = await request('/api/action-session', { clientId: '30000000-0000-4000-8000-000000000002' });
  assert.equal(denied.status, 503); await denied.arrayBuffer();
  await standby.close(); assert.deepEqual(await snapshot(dataDir), before);
});

test('invited member Undo refusal consumes no action ID and permits a following member save', async t => {
  const { app, request } = await fixture(t);
  await app.store.command({ type: 'add-finish-line-custom', itemId: 'finish:test', text: 'Test goal' }, 0);
  await app.store.command({ type: 'set-finish-line-custom', itemId: 'finish:test', memberId: 'two', completed: true }, 1);
  const created = await (await request('/api/invites', { label: 'Player', memberId: 'one' })).json();
  const joined = await fetch(created.link, { redirect: 'manual' });
  const headers = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  const session = await (await request('/api/action-session', { clientId: '90000000-0000-4000-8000-000000000001' }, headers)).json();
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const refused = await request('/api/command', { expectedRevision: 2, command: { type: 'undo' }, requestId, requestAck: 0 }, headers);
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).message, /signed-in player/);
  const next = await request('/api/command', { expectedRevision: 2, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Allowed' }, requestId, requestAck: 0 }, headers);
  assert.equal(next.status, 200); await next.arrayBuffer();
  assert.equal(app.store.getInfo().revision, 3);
});

test('coins saves use action receipts, preserve facts, reject another invited member and support Undo', async t => {
  const { app, request } = await fixture(t);
  const created = await (await request('/api/invites', { label: 'Player', memberId: 'one' })).json();
  const joined = await fetch(created.link, { redirect: 'manual' });
  const headers = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  const session = await (await request('/api/action-session', { clientId: '90000000-0000-4000-8000-000000000002' }, headers)).json();
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const facts = { quests: { 'A quest': true }, currencies: { coins: 2000 } };
  const refused = await request('/api/command', { expectedRevision: 0, command: { type: 'set-transport-facts', memberId: 'two', facts }, requestId, requestAck: 0 }, headers);
  assert.equal(refused.status, 403); await refused.arrayBuffer();
  const body = { expectedRevision: 0, command: { type: 'set-transport-facts', memberId: 'one', facts }, requestId, requestAck: 0 };
  const saved = await request('/api/command', body, headers); assert.equal(saved.status, 200); await saved.arrayBuffer();
  const replay = await request('/api/command', body, headers); assert.equal(replay.status, 200); await replay.arrayBuffer();
  assert.equal(app.store.getInfo().revision, 1); assert.deepEqual(app.store.getState().members[0].transportFacts, facts);
  const cleared = await request('/api/command', { expectedRevision: 1, command: { type: 'set-transport-facts', memberId: 'one', facts: { quests: { 'A quest': true } } } }, headers);
  assert.equal(cleared.status, 200); await cleared.arrayBuffer();
  assert.equal(app.store.getState().members[0].transportFacts.currencies, undefined);
  await app.store.command({ type: 'undo' }, 2);
  assert.deepEqual(app.store.getState().members[0].transportFacts, facts);
  const host = await request('/api/command', { expectedRevision: 3, command: { type: 'set-transport-facts', memberId: 'two', facts } });
  assert.equal(host.status, 200); await host.arrayBuffer();
  const undoOther = await request('/api/command', { expectedRevision: 4, command: { type: 'undo' } }, headers);
  assert.equal(undoOther.status, 403); await undoOther.arrayBuffer();
});
