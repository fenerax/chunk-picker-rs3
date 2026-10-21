import net from 'node:net';
import { validateDoorTopology } from './ingress.mjs';
import path from 'node:path';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertPlainPath, latestCheckpoint, failure } from './journal.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const constantEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const signMessage = (token, value) => createHmac('sha256', token).update(JSON.stringify(value)).digest('hex');
export function assertDistinctTopologyPaths({ mutable, immutable, current }) {
  const canonical = value => {
    // Refuse alternate Win32 spellings whose aliases path.resolve cannot prove.
    if (typeof value !== 'string' || value.includes('~') || /[. ](?:[\\/]|$)/.test(value.replace(/(?:^|[\\/])\.{1,2}(?=[\\/])/g, '/'))
      || /:/.test(value.replace(/^[A-Za-z]:/, ''))) throw failure('LIVE_SWAP_STATE_ALIAS');
    return path.resolve(value).toLowerCase();
  };
  const writes = mutable.map(canonical), reads = immutable.map(canonical), pointer = canonical(current);
  if (new Set(writes).size !== writes.length || writes.includes(pointer) || reads.includes(pointer) || reads.some(value => writes.includes(value))) throw failure('LIVE_SWAP_STATE_ALIAS');
}
export async function pinned(pin) {
  if (!pin || !hex(pin.sha256)) throw failure('LIVE_SWAP_PIN');
  await assertPlainPath(pin.path);
  if ((await lstat(pin.path)).size > 32 * 1024 * 1024) throw failure('LIVE_SWAP_PIN_SIZE');
  const bytes = await readFile(pin.path);
  if (sha(bytes) !== pin.sha256) throw failure('LIVE_SWAP_PIN_CHANGED');
  return bytes;
}
export function assertPipe(value) {
  if (typeof value !== 'string' || !/^\\\\\.\\pipe\\picker-bridge-[a-z0-9-]{16,100}$/.test(value)) throw failure('LIVE_SWAP_PIPE');
}
export async function loadTopology(file, expectedHash) {
  if (!hex(expectedHash)) throw failure('LIVE_SWAP_TOPOLOGY_PIN');
  const bytes = await pinned({ path: file, sha256: expectedHash }), topology = JSON.parse(bytes);
  if (topology.schemaVersion !== 2 || topology.capability !== 'bridgecore-local-pipe-v2' || topology.legacyWatchdogMode !== 'durable-pause') throw failure('LIVE_SWAP_TOPOLOGY_CAPABILITY');
  const lanes = validateDoorTopology(topology);
  if (lanes) topology.door.lanes = lanes;
  assertPipe(topology.door.controlPipe);
  assertPipe(topology.coordinator?.controlPipe);
  for (const name of ['stateDir', 'dataDir']) { await assertPlainPath(topology[name]); if (!(await lstat(topology[name])).isDirectory()) throw failure('LIVE_SWAP_TOPOLOGY_PATH'); }
  const stateRoot = await realpath(topology.stateDir);
  const statePath = async value => {
    await assertPlainPath(value);
    if ((await realpath(path.dirname(value))).toLowerCase() !== stateRoot.toLowerCase()) throw failure('LIVE_SWAP_STATE_ROOT');
  };
  for (const value of [topology.journal, topology.controlTokenFile, topology.door.stateFile, topology.door.recordFile, topology.door.proofFile]) await statePath(value);
  const mutable = [topology.journal, topology.controlTokenFile, topology.door.stateFile, topology.door.recordFile, topology.door.proofFile, topology.old?.recordFile, topology.next?.recordFile,
    `${topology.journal}.budget-blocked.json`, ...['active-runtime.json', 'bridgecore-paused', 'old.log', 'old-error.log', 'next.log', 'next-error.log', 'door.log', 'door-error.log'].map(name => path.join(topology.stateDir, name)),
    ...['picker-paused', 'helper.lock', 'watchdog-tick.lock'].map(name => path.join(path.dirname(topology.dataDir), name))];
  for (const value of mutable) {
    await assertPlainPath(value);
    try { if ((await lstat(value)).nlink > 1) throw failure('LIVE_SWAP_STATE_ALIAS'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (new Set(mutable).size !== mutable.length) throw failure('LIVE_SWAP_STATE_ALIAS');
  const controlToken = (await readFile(topology.controlTokenFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(controlToken)) throw failure('LIVE_SWAP_CONTROL_CREDENTIAL');
  await pinned(topology.identityModule);
  const { hashTree } = await import(pathToFileURL(topology.identityModule.path));
  for (const key of ['Operator-Common.ps1', 'ReleaseV2-Common.ps1']) {
    const pin = topology.helpers?.[key]; await pinned(pin);
    if (path.basename(pin.path) !== key) throw failure('LIVE_SWAP_HELPER_PIN');
  }
  const slots = {};
  for (const slot of ['old', 'next']) {
    const spec = topology[slot];
    if (!spec || !hex(spec.coreTreeSha256) || typeof spec.version !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(spec.version)) throw failure('LIVE_SWAP_SLOT');
    assertPipe(spec.controlPipe); await statePath(spec.recordFile);
    const pointer = JSON.parse(await pinned(spec.pointer));
    if (pointer.schemaVersion !== 2 || typeof pointer.releaseId !== 'string') throw failure('LIVE_SWAP_POINTER');
    const configBytes = await pinned(pointer.config), config = JSON.parse(configBytes);
    for (const field of ['coreRoot', 'dataDir', 'nodePath', 'publicOriginFile', 'packsDir']) await assertPlainPath(config[field]);
    if (config.schemaVersion !== 1 || config.host !== '127.0.0.1' || config.loopbackPort !== null || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw failure('LIVE_SWAP_BACKEND_TOPOLOGY');
    if ((await realpath(config.dataDir)).toLowerCase() !== (await realpath(topology.dataDir)).toLowerCase()) throw failure('LIVE_SWAP_PHYSICAL_SAVE');
    if (config.port === topology.door.listen || topology.door.lanes?.some(lane => lane.port === config.port && lane.host === '127.0.0.1')) throw failure('LIVE_SWAP_TOPOLOGY_PORT');
    const origin = (await readFile(config.publicOriginFile, 'utf8')).trim();
    const configHash = sha(Buffer.from(configBytes.toString('utf8') + '\n' + origin));
    const tree = await hashTree(config.coreRoot);
    if (tree.digest !== spec.coreTreeSha256) throw failure('LIVE_SWAP_CORE_CHANGED');
    await pinned(config.selection);
    for (const kind of ['data', 'rulesText', 'art']) await pinned(config.packs[kind]);
    for (const pin of [config.profile, config.addons].filter(Boolean)) await pinned(pin);
    if (config.nodePath.toLowerCase() !== topology.nodePin.path.toLowerCase()) throw failure('LIVE_SWAP_EXECUTABLE_PIN');
    slots[slot] = { spec, config, origin, configHash, identity: { slot, version: spec.version, port: config.port, releaseId: pointer.releaseId, configHash, configPin: pointer.config, coreTreeSha256: spec.coreTreeSha256 } };
  }
  await assertPlainPath(topology.currentPointer);
  const currentPath = (await realpath(topology.currentPointer)).toLowerCase();
  const immutable = [file, topology.old.pointer.path, topology.next.pointer.path, slots.old.identity.configPin.path, slots.next.identity.configPin.path, topology.nodePin.path, topology.identityModule.path,
    ...Object.values(topology.helpers ?? {}).map(pin => pin.path), ...Object.values(topology.runtimePins ?? {}).map(pin => pin.path),
    ...['compatibilityEvidence', 'freezeBudgetEvidence', 'resourceEvidence'].flatMap(key => topology[key] ? [topology[key].path] : []),
    ...Object.values(slots).flatMap(({ config }) => [config.publicOriginFile, config.selection.path, ...Object.values(config.packs).map(pin => pin.path), ...[config.profile, config.addons].filter(Boolean).map(pin => pin.path)]),
    ...['state.json', 'access-token', 'store.lock', 'store.lock.recovery'].map(name => path.join(topology.dataDir, name)), `${topology.dataDir}.dataset.json`];
  assertDistinctTopologyPaths({ mutable, immutable, current: currentPath });
  if (slots.old.config.coreRoot.toLowerCase() === slots.next.config.coreRoot.toLowerCase() || slots.old.config.port === slots.next.config.port || slots.old.spec.controlPipe === slots.next.spec.controlPipe) throw failure('LIVE_SWAP_SLOT_ALIAS');
  for (const key of ['publicOriginFile', 'packsDir']) if (slots.old.config[key].toLowerCase() !== slots.next.config[key].toLowerCase()) throw failure('LIVE_SWAP_OFFLINE_TRANSITION');
  if (slots.old.origin !== slots.next.origin || slots.old.config.selection.sha256 !== slots.next.config.selection.sha256
    || ['data', 'rulesText', 'art'].some(key => slots.old.config.packs[key].sha256 !== slots.next.config.packs[key].sha256)) throw failure('LIVE_SWAP_OFFLINE_TRANSITION');
  await pinned(topology.nodePin);
  if (topology.door.controlPipe === topology.old.controlPipe || topology.door.controlPipe === topology.next.controlPipe) throw failure('LIVE_SWAP_SLOT_ALIAS');
  if ([topology.door.controlPipe, topology.old.controlPipe, topology.next.controlPipe].includes(topology.coordinator.controlPipe)) throw failure('LIVE_SWAP_SLOT_ALIAS');
  const adminToken = (await readFile(path.join(topology.dataDir, 'access-token'), 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(adminToken)) throw failure('LIVE_SWAP_EXISTING_CREDENTIAL');
  await assertPlainPath(path.join(topology.dataDir, 'state.json'));
  await assertPlainPath(topology.dataDir + '.dataset.json');
  return { ...topology, dataDir: await realpath(topology.dataDir), file, topologyHash: expectedHash, slots, controlToken, adminToken };
}

// Evidence artifacts are independently reviewed release outputs. A boolean
// operator switch cannot replace these exact release/shape/protocol bindings.
export async function productionPolicy(topology) {
  const compatibility = JSON.parse(await pinned(topology.compatibilityEvidence));
  const evidence = JSON.parse(await pinned(topology.freezeBudgetEvidence));
  const resources = JSON.parse(await pinned(topology.resourceEvidence));
  validateProductionEvidence({ topology, compatibility, evidence, resources });
  if ((await latestCheckpoint(topology.dataDir)).schemaVersion !== compatibility.saveSchemaVersion) throw failure('LIVE_SWAP_COMPATIBILITY_SCHEMA');
  return { policy: { mode: 'automatic', freezeBudgetEvidence: evidence }, resources };
}
export function validateProductionEvidence({ topology, compatibility, evidence, resources }) {
  const old = topology.slots.old.identity, next = topology.slots.next.identity;
  const bound = value => same(value?.old, old) && same(value?.next, next);
  if (!bound(compatibility) || compatibility.schemaVersion !== 2 || compatibility.liveSwapProtocol !== 2 || compatibility.actionReceiptFormat !== 2
    || compatibility.previousBrowserProtocol !== 2 || compatibility.bidirectionalLatestSave !== true || compatibility.allMutationRoutesCovered !== true
    || !Number.isInteger(compatibility.saveSchemaVersion) || compatibility.selectionSha256 !== topology.slots.old.config.selection.sha256
    || !hex(compatibility.evidenceSha256)) throw failure('LIVE_SWAP_COMPATIBILITY_EVIDENCE');
  if (!bound(evidence) || evidence.schemaVersion !== 1 || evidence.representative !== true || evidence.liveSwapProtocol !== 2 || evidence.actionReceiptFormat !== 2
    || !Number.isFinite(evidence.maxFreezeMs) || evidence.maxFreezeMs < 0 || evidence.maxFreezeMs > 150 || !Number.isSafeInteger(evidence.maxSaveBytes) || evidence.maxSaveBytes < 1) throw failure('LIVE_SWAP_FREEZE_EVIDENCE');
  if (!bound(resources) || resources.schemaVersion !== 1 || resources.measured !== true || !Number.isSafeInteger(resources.standbyPeakBytes) || resources.standbyPeakBytes < 1
    || !Number.isSafeInteger(resources.reserveBytes) || resources.reserveBytes < 1 || !hex(resources.evidenceSha256)) throw failure('LIVE_SWAP_RESOURCE_EVIDENCE');
}

// One bounded JSON request per connection. No credential or implementation
// exception is returned to the caller or written to stdout.
export async function runtimeCall(address, token, identity, method, argument, timeoutMs = 330000) {
  assertPipe(address);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address); let input = '';
    const request = { identity, method, argument: argument ?? null, nonce: randomUUID(), issuedAt: Date.now() };
    const timer = setTimeout(() => socket.destroy(failure('LIVE_SWAP_RUNTIME_TIMEOUT')), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(JSON.stringify({ value: request, mac: signMessage(token, request) }) + '\n'));
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 128 * 1024) { socket.destroy(failure('LIVE_SWAP_RUNTIME_SIZE')); return; }
      const end = input.indexOf('\n'); if (end < 0) return;
      try {
        const envelope = JSON.parse(input.slice(0, end)), response = envelope.value;
        if (!response || response.nonce !== request.nonce || !constantEqual(envelope.mac, signMessage(token, response))) throw failure('LIVE_SWAP_RUNTIME_AUTH');
        response.error ? reject(failure(response.error)) : resolve(response.value);
      }
      catch { reject(failure('LIVE_SWAP_RUNTIME_REPLY')); }
      socket.destroy();
    });
    socket.once('error', () => reject(failure('LIVE_SWAP_RUNTIME_UNAVAILABLE')));
    socket.once('close', () => { clearTimeout(timer); reject(failure('LIVE_SWAP_RUNTIME_DISCONNECTED')); });
  });
}

// inspect/start are the concrete, synchronous PowerShell ownership service in
// Invoke-LiveSwap.ps1. Injection here permits PID-reuse tests without a server.
export function createRuntimeAdapter({ slot, topology, inspect, start, pinProof = async () => {}, call = runtimeCall }) {
  const info = topology.slots[slot], identity = info.identity;
  let last, retained;
  const rpc = (method, argument) => call(info.spec.controlPipe, topology.controlToken, identity, method, argument);
  async function observe() {
    if (retained) {
      let status;
      try { status = await rpc('status'); }
      catch {
        const dead = await inspect(slot);
        if (dead.state === 'dead' || dead.state === 'absent') { retained = undefined; return { state: 'dead' }; }
        throw failure('LIVE_SWAP_PROCESS_UNCERTAIN');
      }
      if (status.pid !== retained.processIdentity.pid || !same(status.processIdentity, retained.processIdentity) || !same(status.identity, identity) || !['stopped', 'standby', 'active', 'frozen'].includes(status.state)) throw failure('LIVE_SWAP_PROCESS_CHANGED');
      if (status.listenerProof && !same(status.listenerProof, retained.listenerProof)) {
        retained = undefined; return observe(); // A new bind requires fresh OS proof.
      }
      last = { state: status.state === 'stopped' ? 'stopped' : 'owned', standby: status.state === 'standby', processIdentity: retained.processIdentity,
        listeners: !!status.listenerProof, listenerProof: status.listenerProof };
      return last;
    }
    const proof = await inspect(slot);
    if (proof.state === 'dead' || proof.state === 'absent') return { state: 'dead' };
    if (proof.state !== 'owned' || !proof.processIdentity || proof.processIdentity.configHash !== info.configHash) throw failure('LIVE_SWAP_PROCESS_UNCERTAIN');
    const status = await rpc('status');
    if (status.pid !== proof.processIdentity.pid || !same(status.processIdentity, proof.processIdentity) || !same(status.identity, identity) || !['stopped', 'standby', 'active', 'frozen'].includes(status.state)) throw failure('LIVE_SWAP_RUNTIME_IDENTITY');
    // A stale PID returned by a slow pipe cannot authorize a lifecycle command.
    const after = await inspect(slot);
    if (after.state !== 'owned' || !same(after.processIdentity, proof.processIdentity)) throw failure('LIVE_SWAP_PROCESS_CHANGED');
    if (status.listenerProof && (!after.listeners || status.listenerProof.port !== identity.port || status.listenerProof.host !== '127.0.0.1' || status.listenerProof.listening !== true)) throw failure('LIVE_SWAP_LISTENER_OWNERSHIP');
    retained = { processIdentity: proof.processIdentity, listenerProof: status.listenerProof };
    if (status.listenerProof) await pinProof({ slot, processIdentity: proof.processIdentity, listenerProof: status.listenerProof });
    last = { state: status.state === 'stopped' ? 'stopped' : 'owned', standby: status.state === 'standby', processIdentity: proof.processIdentity, listeners: after.listeners && !!status.listenerProof, listenerProof: status.listenerProof };
    return last;
  }
  async function ensure() {
    const proof = await observe();
    if (proof.state === 'dead') { await start(slot); await observe(); }
  }
  return { identity, observe,
    async standby() { await ensure(); await rpc('standby'); },
    async freeze(options) { if ((await observe()).state !== 'owned') throw failure('LIVE_SWAP_PROCESS_NOT_OWNED'); return rpc('freeze', options); },
    async close() { const proof = await observe(); if (proof.state === 'dead' || proof.state === 'stopped') return; await rpc('close'); if ((await observe()).state !== 'stopped') throw failure('LIVE_SWAP_RELEASE_UNCERTAIN'); },
    async activate(checkpoint) { await ensure(); await rpc('activate', checkpoint); },
    async verify() { const proof = await observe(); if (proof.state !== 'owned' || proof.listeners !== true) throw failure('LIVE_SWAP_LISTENER_OWNERSHIP'); const health = await rpc('verify'); await observe(); return health; },
  };
}

export function createTargetGuard({ topology, readProof = () => readFile(topology.door.proofFile, 'utf8'), call = runtimeCall }) {
  return async identity => {
    const info = topology.slots[identity?.slot];
    if (!info || !same(identity, info.identity)) throw failure('LIVE_SWAP_TARGET_IDENTITY');
    const proofs = JSON.parse(await readProof()), proof = proofs.entries?.[identity.slot];
    if (proofs.topologyHash !== topology.topologyHash || !proof?.processIdentity || !proof.listenerProof) throw failure('LIVE_SWAP_TARGET_OS_PROOF');
    const status = await call(info.spec.controlPipe, topology.controlToken, identity, 'status', null, 5000);
    if (status.state !== 'active' || status.pid !== proof.processIdentity.pid || !same(status.identity, identity) || !same(status.processIdentity, proof.processIdentity)
      || !same(status.listenerProof, proof.listenerProof) || status.listenerProof.port !== identity.port || status.listenerProof.host !== '127.0.0.1' || status.listenerProof.listening !== true) throw failure('LIVE_SWAP_TARGET_UNOWNED');
  };
}
