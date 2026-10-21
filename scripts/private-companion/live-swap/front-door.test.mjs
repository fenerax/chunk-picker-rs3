import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createFrontDoor, connectFrontDoor } from './front-door.mjs';
import { atomicJSON } from './journal.mjs';
import os from 'node:os';
const get = socketPath => new Promise((resolve, reject) => {
  const request = http.get({ socketPath, path: '/api/health' }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); }); request.once('error', reject);
});
async function fixture(t) {
  const root = path.join((process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(), 'rs3-live-swap-tests')), 'operator-door'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'run-'));
  const pipe = name => process.platform === 'win32' ? `\\\\.\\pipe\\bridgecore-test-${name}-${randomUUID()}` : path.join(directory, `${name}.sock`);
  return { listen: pipe('http'), control: pipe('control'), stateFile: path.join(directory, 'door.json'), token: randomUUID(), backendToken: 'synthetic' };
}
test('restart ignores retained admitted state and refuses ordinary ingress', async t => {
  const config = await fixture(t); await atomicJSON(config.stateFile, { frozen: false, target: { port: 18788, version: 'retained' } });
  const door = await createFrontDoor(config); t.after(async () => { await door.close(); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  assert.equal((await door.status()).frozen, true); assert.equal(await get(config.listen), 503);
  const retained = JSON.parse(await readFile(config.stateFile)); assert.equal(retained.frozen, true); assert.equal(retained.recoveryRequired, true);
});
test('production ownership guard is mandatory and refuses before backend authentication', async t => {
  const config = await fixture(t);
  await assert.rejects(createFrontDoor({ ...config, requireOwnership: true }), { code: 'LIVE_SWAP_DOOR_OWNERSHIP_REQUIRED' });
  let checked = 0;
  const door = await createFrontDoor({ ...config, requireOwnership: true, assertTargetOwned: async () => { checked++; throw new Error('foreign listener'); } });
  t.after(async () => { await door.close(); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  await door.route({ version: 'synthetic', port: 8999 }); await assert.rejects(door.probe(), /foreign listener/); assert.equal(checked, 1); assert.equal((await door.status()).frozen, true);
});
test('a diagnostic write failure after admission freezes without a retry loop', async t => {
  const config = await fixture(t); let writes = 0, fail = false;
  const door = await createFrontDoor({ ...config, writeState: async (file, value) => { writes++; if (fail && !value.frozen) throw Object.assign(new Error('Injected disk failure'), { code: 'EIO' }); await atomicJSON(file, value); } });
  t.after(async () => { await door.close(); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  const identity = { version: 'synthetic', port: 8999 }; await door.route(identity); await door.settled();
  // The transport/health route is covered by the other real HTTP tests. This
  // controlled proof isolates the asynchronous persistence failure boundary.
  door.probe = async () => ({ ready: true, standby: false, version: 'synthetic', liveSwapProtocol: 2, actionReceiptFormat: 2 });
  fail = true; await door.resume(identity); await door.settled(); const after = writes;
  assert.equal((await door.status()).frozen, true); assert.equal((await door.status()).recoveryRequired, true); assert.equal((await door.status()).diagnosticFailure, 'EIO');
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(writes, after, 'No persistence retry loop'); assert.equal(await get(config.listen), 503);
});
test('persistent control uses constant-memory signed sequences and refuses replay, gaps and unsafe IDs', async t => {
  const config = await fixture(t), door = await createFrontDoor(config), closeControl = await door.control(config.control);
  const socket = net.createConnection(config.control); let input = ''; const rows = [], readers = [];
  socket.setEncoding('utf8'); socket.on('error', () => {});
  socket.on('data', data => { input += data; for (;;) { const end = input.indexOf('\n'); if (end < 0) break; const row = JSON.parse(input.slice(0, end)); input = input.slice(end + 1); const reader = readers.shift(); if (reader) reader(row); else rows.push(row); } });
  const next = () => rows.length ? Promise.resolve(rows.shift()) : new Promise(resolve => readers.push(resolve));
  await once(socket, 'connect'); const { challenge } = await next();
  t.after(async () => { socket.destroy(); await closeControl(); await door.close(); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  const request = async id => {
    const payload = { id, method: 'status', challenge, nonce: randomUUID() }, mac = createHmac('sha256', config.token).update(`request:${JSON.stringify(payload)}`).digest('hex');
    socket.write(`${JSON.stringify({ ...payload, mac })}\n`); return next();
  };
  assert.equal((await request(1)).error, undefined);
  assert.equal((await request(1)).error, 'LIVE_SWAP_DOOR_AUTH', 'Replay refused');
  assert.equal((await request(3)).error, 'LIVE_SWAP_DOOR_AUTH', 'Gap refused without advancing sequence');
  assert.equal((await request(2)).error, undefined);
  assert.equal((await request(Number.MAX_SAFE_INTEGER + 1)).error, 'LIVE_SWAP_DOOR_AUTH');
  assert.equal((await request(3)).error, undefined);
});
test('control-channel loss durably freezes; replacement control lease can inspect', async t => {
  const config = await fixture(t), door = await createFrontDoor(config), closeControl = await door.control(config.control);
  t.after(async () => { await closeControl(); await door.close(); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  const control = await connectFrontDoor(config.control, config.token);
  await control.freeze(); control.disconnect();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const retained = JSON.parse(await readFile(config.stateFile)); if (retained.recoveryRequired) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const replacement = await connectFrontDoor(config.control, config.token);
  assert.equal((await replacement.status()).frozen, true); replacement.disconnect();
  assert.equal(await get(config.listen), 503);
});

for (const window of ['probe', 'disk']) test(`lease loss during resume ${window} cannot reopen ingress`, async t => {
  const config = await fixture(t); let reached, release;
  const barrier = new Promise(resolve => { reached = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  const backend = http.createServer(async (_request, response) => {
    if (window === 'probe') { reached(); await waiting; }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ready: true, standby: false, version: 'synthetic', liveSwapProtocol: 2, actionReceiptFormat: 2 }));
  });
  let port;
  for (let candidate = 8990; candidate <= 8999; candidate++) {
    try { await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(candidate, '127.0.0.1', resolve); }); port = candidate; break; } catch {}
  }
  assert.ok(port, 'One free scratch backend port required');
  const door = await createFrontDoor({ ...config, writeState: async (file, value) => { if (window === 'disk' && !value.frozen) { reached(); await waiting; } await atomicJSON(file, value); } });
  const closeControl = await door.control(config.control);
  t.after(async () => { release(); await closeControl(); await door.close(); await new Promise(resolve => backend.close(resolve)); await rm(path.dirname(config.stateFile), { recursive: true, force: true }); });
  const controller = await connectFrontDoor(config.control, config.token), identity = { port, version: 'synthetic' };
  await controller.route(identity); const result = controller.resume(identity).catch(error => error); await barrier;
  controller.disconnect(); await result; await new Promise(resolve => setTimeout(resolve, 25)); release(); await door.settled();
  assert.equal((await door.status()).frozen, true); assert.equal(await get(config.listen), 503);
  const retained = JSON.parse(await readFile(config.stateFile)); assert.equal(retained.frozen, true); assert.equal(retained.recoveryRequired, true);
});
