import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeAdapter, createTargetGuard, signMessage, constantEqual, validateProductionEvidence, assertDistinctTopologyPaths } from './managed-runtime.mjs';

const identity = { slot: 'old', version: 'bridge-old', port: 18731, releaseId: 'old', configHash: 'a'.repeat(64), configPin: { path: 'C:/immutable/config.json', sha256: 'b'.repeat(64) }, coreTreeSha256: 'c'.repeat(64) };
// Windows path rules (case, 8.3 names, streams): the live swap runs only on the Windows server.
test('runtime, credential, current pointer and retained immutable paths cannot alias', { skip: process.platform !== 'win32' }, () => {
  const paths = { mutable: ['C:/state/journal.json', 'C:/state/control-token'], immutable: ['C:/old/pointer.json', 'C:/next/pointer.json'], current: 'C:/live/current.json' };
  assert.doesNotThrow(() => assertDistinctTopologyPaths(paths));
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, mutable: [...paths.mutable, 'C:/STATE/JOURNAL.json'] }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, current: paths.immutable[0] }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, current: paths.mutable[0] }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, immutable: [paths.mutable[1]] }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, current: 'C:\\OLD\\unused\\..\\pointer.json' }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  assert.throws(() => assertDistinctTopologyPaths({ ...paths, mutable: [...paths.mutable, 'C:/state/./JOURNAL.json'] }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  for (const current of ['C:/live/current.json.', 'C:/live/current.json ', 'C:/live/current.json:stream', 'C:/LONGNA~1/current.json']) {
    assert.throws(() => assertDistinctTopologyPaths({ ...paths, current }), { code: 'LIVE_SWAP_STATE_ALIAS' });
  }
  assert.doesNotThrow(() => assertDistinctTopologyPaths({ ...paths, current: 'C:/live/other/../current.json' }));
});
function harness() {
  const info = { identity, configHash: identity.configHash, config: { selection: { sha256: 'd'.repeat(64) } }, spec: { controlPipe: '\\\\.\\pipe\\picker-bridge-runtime-test-old' } };
  const topology = { slots: { old: info, next: { ...info, identity: { ...identity, slot: 'next', version: 'bridge-next' } } }, controlToken: 'e'.repeat(64) };
  let processState = 'owned', runtimeState = 'active', listeners = true, serial = 0;
  const processIdentity = { pid: 1234, processStartedAt: '2026-10-18T12:00:00.0000000Z', configHash: info.configHash };
  const calls = [];
  const inspect = async () => { serial++; return { state: processState, processIdentity: structuredClone(processIdentity), listeners }; };
  const call = async (_address, _token, sentIdentity, method, argument) => {
    assert.deepEqual(sentIdentity, identity); calls.push({ method, argument });
    if (method === 'status') return { pid: 1234, identity: structuredClone(identity), processIdentity: structuredClone(processIdentity), state: runtimeState,
      listenerProof: runtimeState === 'stopped' ? null : { generation: 'one', host: '127.0.0.1', port: identity.port, listening: true } };
    if (method === 'close') { runtimeState = 'stopped'; listeners = false; }
    if (method === 'activate') { assert.ok(argument.sha256); runtimeState = 'active'; listeners = true; }
    if (method === 'verify') return { ready: true, version: identity.version };
    if (method === 'freeze') { runtimeState = 'frozen'; return { revision: 2, schemaVersion: 1, sha256: 'f'.repeat(64) }; }
  };
  const options = { slot: 'old', topology, inspect, call, start: async () => { processState = 'owned'; runtimeState = 'stopped'; } };
  return { options, calls, processIdentity, setState: value => { processState = value; }, setListeners: value => { listeners = value; }, count: () => serial };
}
test('production adapter closes only through authenticated lifecycle and retains latest activation checkpoint', async () => {
  const fixture = harness(), adapter = createRuntimeAdapter(fixture.options);
  const checkpoint = await adapter.freeze({ requireIdle: true }); await adapter.close();
  assert.deepEqual(fixture.calls.find(call => call.method === 'freeze').argument, { requireIdle: true });
  assert.equal((await adapter.observe()).state, 'stopped');
  await adapter.activate(checkpoint); assert.equal((await adapter.verify()).ready, true);
  assert.deepEqual(fixture.calls.find(call => call.method === 'activate').argument, checkpoint);
  assert.ok(fixture.count() >= 2); assert.ok(fixture.count() < fixture.calls.length);
});
test('PID reuse or process start-time drift across pipe response refuses lifecycle', async () => {
  const fixture = harness(); let reads = 0;
  fixture.processIdentity.processStartedAt = 'original';
  fixture.options.inspect = async () => ({ state: 'owned', listeners: true, processIdentity: { ...fixture.processIdentity, processStartedAt: ++reads === 1 ? 'original' : 'reused' } });
  const adapter = createRuntimeAdapter(fixture.options);
  await assert.rejects(adapter.close(), { code: 'LIVE_SWAP_PROCESS_CHANGED' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['status']);
});
test('prewarmed adapter refreshes authenticated status each time without repeated CIM', async () => {
  const fixture = harness(), adapter = createRuntimeAdapter(fixture.options);
  await adapter.observe(); const initial = fixture.count();
  for (let index = 0; index < 4; index++) await adapter.observe();
  assert.equal(fixture.count(), initial); assert.equal(fixture.calls.filter(call => call.method === 'status').length, 5);
  fixture.processIdentity.processStartedAt = 'changed-after-prewarm';
  await assert.rejects(adapter.observe(), { code: 'LIVE_SWAP_PROCESS_CHANGED' });
});
test('fast target guard requires live authenticated exact process and held listener generation', async () => {
  const { options: { topology }, processIdentity } = harness(); topology.topologyHash = 'f'.repeat(64);
  const listenerProof = { generation: 'bound-one', host: '127.0.0.1', port: identity.port, listening: true };
  const proof = { topologyHash: topology.topologyHash, entries: { old: { processIdentity, listenerProof } } };
  const status = { pid: processIdentity.pid, processIdentity, listenerProof, identity, state: 'active' };
  let statusValue = status, calls = 0;
  const guard = createTargetGuard({ topology, readProof: async () => JSON.stringify(proof), call: async () => { calls++; return statusValue; } });
  await guard(identity); assert.equal(calls, 1);
  for (const changed of [{ ...status, state: 'standby' }, { ...status, listenerProof: null }, { ...status, listenerProof: { ...listenerProof, generation: 'foreign' } },
    { ...status, processIdentity: { ...processIdentity, processStartedAt: 'reused' } }, { ...status, pid: 9999 }]) {
    statusValue = changed; await assert.rejects(guard(identity), { code: 'LIVE_SWAP_TARGET_UNOWNED' });
  }
});
test('foreign listener never receives readiness credentials', async () => {
  const fixture = harness(); fixture.setListeners(false);
  await assert.rejects(createRuntimeAdapter(fixture.options).verify(), { code: 'LIVE_SWAP_LISTENER_OWNERSHIP' });
  assert.ok(fixture.calls.every(call => call.method !== 'verify'));
});
test('known dead process can restart without any PID kill or old save restoration', async () => {
  const fixture = harness(); fixture.setState('dead');
  const checkpoint = { revision: 55, schemaVersion: 1, sha256: 'f'.repeat(64) };
  await createRuntimeAdapter(fixture.options).activate(checkpoint);
  assert.deepEqual(fixture.calls.find(call => call.method === 'activate').argument, checkpoint);
});
test('unknown ownership refuses restart', async () => {
  const fixture = harness(); fixture.setState('uncertain');
  await assert.rejects(createRuntimeAdapter(fixture.options).activate({}), { code: 'LIVE_SWAP_PROCESS_UNCERTAIN' });
  assert.equal(fixture.calls.length, 0);
});
test('mutual runtime MAC binds method, checkpoint, nonce and response bytes', () => {
  const token = 'a'.repeat(64), value = { method: 'activate', checkpoint: { revision: 55 }, nonce: 'one' };
  const mac = signMessage(token, value);
  assert.equal(constantEqual(mac, signMessage(token, structuredClone(value))), true);
  assert.equal(constantEqual(mac, signMessage(token, { ...value, nonce: 'two' })), false);
  assert.equal(constantEqual(mac, signMessage('b'.repeat(64), value)), false);
});
test('automatic promotion requires exact compatibility, prior-browser, resource and <=150ms evidence', () => {
  const { options: { topology } } = harness(), old = topology.slots.old.identity, next = topology.slots.next.identity;
  const compatibility = { schemaVersion: 2, old, next, liveSwapProtocol: 2, actionReceiptFormat: 2, previousBrowserProtocol: 2, bidirectionalLatestSave: true,
    allMutationRoutesCovered: true, saveSchemaVersion: 1, selectionSha256: 'd'.repeat(64), evidenceSha256: 'f'.repeat(64) };
  const evidence = { schemaVersion: 1, old, next, representative: true, liveSwapProtocol: 2, actionReceiptFormat: 2, maxFreezeMs: 150, maxSaveBytes: 100000 };
  const resources = { schemaVersion: 1, old, next, measured: true, standbyPeakBytes: 1000000, reserveBytes: 2000000, evidenceSha256: 'f'.repeat(64) };
  const args = { topology, compatibility, evidence, resources };
  assert.doesNotThrow(() => validateProductionEvidence(args));
  for (const invalid of [ { ...evidence, maxFreezeMs: 150.01 }, { ...evidence, old: next }, { ...evidence, representative: false } ]) assert.throws(() => validateProductionEvidence({ ...args, evidence: invalid }));
  for (const key of ['previousBrowserProtocol', 'bidirectionalLatestSave', 'allMutationRoutesCovered']) assert.throws(() => validateProductionEvidence({ ...args, compatibility: { ...compatibility, [key]: false } }));
  assert.throws(() => validateProductionEvidence({ ...args, resources: { ...resources, measured: false } }));
});
