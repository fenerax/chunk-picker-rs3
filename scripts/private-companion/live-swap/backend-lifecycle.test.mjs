import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createBackendLifecycle } from './backend-lifecycle.mjs';
import { runtimeCall, createTargetGuard, signMessage, constantEqual } from './managed-runtime.mjs';
const token = 'a'.repeat(64), identity = { kind: 'test-backend', version: 'tiny' };
const checkpoint = { revision: 70, schemaVersion: 1, sha256: 'f'.repeat(64) };
const pipe = () => `\\\\.\\pipe\\picker-bridge-test-${randomUUID()}`;
async function child(t) {
  const address = pipe(), process = fork(new URL('./backend-control.fixture.mjs', import.meta.url), [address], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const messages = [], exited = once(process, 'exit'); process.on('message', value => messages.push(value));
  const wait = async event => {
    const until = Date.now() + 10000;
    while (Date.now() < until) { const found = messages.find(value => value.event === event); if (found) return found; if (process.exitCode !== null) throw new Error('Fixture exited.'); await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('Fixture event timeout.');
  };
  await wait('ready');
  t.after(async () => { if (process.exitCode === null && process.connected) process.send({ method: 'shutdown' }); await exited; });
  return { address, process, messages, wait, call: (method, argument) => runtimeCall(address, token, identity, method, argument, 10000) };
}
async function raw(address, value) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address); let input = '';
    socket.setEncoding('utf8'); socket.once('connect', () => socket.write(JSON.stringify(value) + '\n'));
    socket.on('data', chunk => { input += chunk; if (input.includes('\n')) { resolve(JSON.parse(input.split('\n')[0])); socket.destroy(); } });
    socket.once('error', reject); socket.setTimeout(10000, () => socket.destroy(new Error('Pipe timeout.')));
  });
}
test('shutdown during awaited application creation closes final app before releasing lifecycle', async () => {
  let release, started; const began = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; }); const calls = [];
  const lifecycle = createBackendLifecycle({ async createApplication() { started(); await gate; return { async listen() { calls.push('listen'); }, async close() { calls.push('close'); } }; } });
  const activation = lifecycle.run('activate', checkpoint); await began;
  const stopped = lifecycle.shutdown(); release();
  await assert.rejects(activation, { code: 'LIVE_SWAP_RUNTIME_CLOSING' }); await stopped;
  assert.deepEqual(calls, ['close']);
});
test('shared lifecycle serializes close/activation and retains supplied latest revision', async () => {
  const seen = [], freezeOptions = [];
  const lifecycle = createBackendLifecycle({ async createApplication({ checkpoint }) { seen.push(checkpoint?.revision); return { async listen() {}, async close() {}, async freeze(options) { freezeOptions.push(options); return checkpoint; } }; } });
  await lifecycle.run('standby'); await lifecycle.run('close'); await lifecycle.run('activate', checkpoint);
  assert.deepEqual(await lifecycle.run('freeze', { requireIdle: true }), checkpoint); assert.deepEqual(freezeOptions, [{ requireIdle: true }]); await lifecycle.run('close'); await lifecycle.run('activate', { ...checkpoint, revision: 75 });
  assert.deepEqual(seen, [undefined, 70, 75]); await lifecycle.shutdown();
});
test('warmed standby promotes in place and never recreates after an activation failure', async () => {
  let creates = 0, closes = 0, rejected = true;
  const lifecycle = createBackendLifecycle({ async createApplication() { creates++; let listening = false;
    return { server: { get listening() { return listening; }, address: () => listening ? { address: '127.0.0.1', port: 18731 } : null },
      async listen() { listening = true; }, async close() { listening = false; closes++; },
      async activate(received) { assert.deepEqual(received, checkpoint); if (rejected) throw Object.assign(new Error('refused'), { code: 'LIVE_SWAP_CHECKPOINT' }); } }; } });
  await lifecycle.run('standby');
  const bound = (await lifecycle.run('status')).listenerProof;
  assert.equal(bound.port, 18731);
  await assert.rejects(lifecycle.run('activate', checkpoint), { code: 'LIVE_SWAP_CHECKPOINT' });
  assert.equal(creates, 1); assert.equal(closes, 0); assert.equal((await lifecycle.run('status')).state, 'standby');
  rejected = false; await lifecycle.run('activate', checkpoint); assert.equal(creates, 1); assert.equal((await lifecycle.run('status')).state, 'active');
  assert.deepEqual((await lifecycle.run('status')).listenerProof, bound);
  await lifecycle.run('close'); assert.equal((await lifecycle.run('status')).listenerProof, null);
  await lifecycle.run('standby'); assert.notEqual((await lifecycle.run('status')).listenerProof.generation, bound.generation);
  await lifecycle.shutdown(); assert.equal(closes, 2);
});
test('real child pipe supports repeated lifecycle requests and exact status PID', { skip: process.platform !== 'win32' }, async t => {
  const fixture = await child(t);
  assert.equal((await fixture.call('status')).pid, fixture.process.pid);
  await fixture.call('standby'); await fixture.call('close'); await fixture.call('activate', checkpoint);
  assert.deepEqual(await fixture.call('freeze'), checkpoint); await fixture.call('close');
  await fixture.call('activate', { ...checkpoint, revision: 80 });
  assert.equal((await fixture.call('verify')).ready, true);
  await assert.rejects(runtimeCall(fixture.address, token, { ...identity, version: 'other' }, 'close', null, 10000));
  assert.equal((await fixture.call('status')).state, 'active');
});
test('real child rejects replay and wrong MAC without executing commands', { skip: process.platform !== 'win32' }, async t => {
  const fixture = await child(t), request = { identity, method: 'standby', argument: null, nonce: randomUUID(), issuedAt: Date.now() };
  const envelope = { value: request, mac: signMessage(token, request) }, first = await raw(fixture.address, envelope);
  assert.equal(constantEqual(first.mac, signMessage(token, first.value)), true);
  assert.equal(first.value.value.state, 'standby');
  const replay = await raw(fixture.address, envelope); assert.equal(replay.value.error, 'LIVE_SWAP_RUNTIME_AUTH');
  const wrong = await raw(fixture.address, { value: { ...request, nonce: randomUUID(), method: 'close' }, mac: '0'.repeat(64) });
  assert.equal(wrong.value.error, 'LIVE_SWAP_RUNTIME_AUTH'); assert.equal((await fixture.call('status')).state, 'standby');
});
test('real child shutdown queued behind start never opens an orphan application', { skip: process.platform !== 'win32' }, async t => {
  const fixture = await child(t); fixture.process.send({ method: 'delay', ms: 150 }); await fixture.wait('delay-set');
  const activation = fixture.call('activate', checkpoint).catch(() => null); await fixture.wait('factory-start');
  fixture.process.send({ method: 'shutdown' }); const result = await fixture.wait('shutdown'); await activation;
  assert.equal(result.active, false); assert.ok(!fixture.messages.some(message => message.event === 'listen'));
  assert.ok(fixture.messages.some(message => message.event === 'closed'));
});
test('foreign pipe squatter cannot forge a mutually authenticated runtime reply', { skip: process.platform !== 'win32' }, async () => {
  const address = pipe(); let received;
  const server = net.createServer(socket => { socket.once('data', bytes => { received = bytes.toString(); const request = JSON.parse(received.trim()).value; socket.end(JSON.stringify({ value: { nonce: request.nonce, value: { state: 'active', pid: process.pid } }, mac: '0'.repeat(64) }) + '\n'); }); });
  await new Promise(resolve => server.listen(address, resolve));
  try {
    await assert.rejects(runtimeCall(address, token, identity, 'status', null, 10000));
    const target = { slot: 'old', version: 'tiny', port: 18731 }, topologyHash = 'b'.repeat(64);
    const processIdentity = { pid: process.pid, processStartedAt: '2026-10-18T12:00:00.000Z', configHash: 'c'.repeat(64) };
    const listenerProof = { generation: 'retained', host: '127.0.0.1', port: 18731, listening: true };
    const guard = createTargetGuard({ topology: { topologyHash, slots: { old: { identity: target, spec: { controlPipe: address } } }, controlToken: token },
      readProof: async () => JSON.stringify({ topologyHash, entries: { old: { processIdentity, listenerProof } } }) });
    await assert.rejects(guard(target));
    assert.ok(!received.includes(token)); assert.equal(JSON.parse(received).value.method, 'status');
  }
  finally { await new Promise(resolve => server.close(resolve)); }
});
