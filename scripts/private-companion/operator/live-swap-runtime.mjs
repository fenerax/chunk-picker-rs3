import readline from 'node:readline';
import { loadTopology, createRuntimeAdapter, productionPolicy, createTargetGuard } from '../live-swap/managed-runtime.mjs';
import { serveBackendControl } from '../live-swap/backend-lifecycle.mjs';
import { createFrontDoor, connectFrontDoor } from '../live-swap/front-door.mjs';
import { SwapController } from '../live-swap/controller.mjs';
import { Journal, latestCheckpoint, failure } from '../live-swap/journal.mjs';
import { randomUUID } from 'node:crypto';

const [mode, file, hash] = process.argv.slice(2);
if (!['door', 'swap', 'recover', 'bootstrap'].includes(mode) || process.platform !== 'win32') throw failure('LIVE_SWAP_RUNTIME_PLATFORM');
const topology = await loadTopology(file, hash);
if (mode === 'door') {
  const door = await createFrontDoor({ listen: topology.door.listen, lanes: topology.door.lanes, contextHost: topology.door.contextHost, stateFile: topology.door.stateFile,
    token: topology.controlToken, backendToken: topology.adminToken,
    allowedPorts: [topology.slots.old.config.port, topology.slots.next.config.port], requireOwnership: true,
    assertTargetOwned: createTargetGuard({ topology }) });
  const stopControl = await door.control(topology.door.controlPipe);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stopControl().then(() => door.close()); });
} else {
  // Only this channel may request managed mutations. The PowerShell parent
  // executes them synchronously while retaining the real lock streams.
  let serial = 0, parentAlive = true;
  const pending = new Map();
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    if (line.length > 128 * 1024) { lines.close(); return; }
    let response; try { response = JSON.parse(line); } catch { lines.close(); return; }
    const call = pending.get(response.id);
    if (call) { pending.delete(response.id); clearTimeout(call.timer); response.error ? call.reject(failure('LIVE_SWAP_MANAGED_REFUSED')) : call.resolve(response.value); }
  });
  function managedCall(method, argument) {
    return new Promise((resolve, reject) => {
      if (!parentAlive) { reject(failure('LIVE_SWAP_MANAGED_LOST')); return; }
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(failure('LIVE_SWAP_MANAGED_TIMEOUT')); }, 330000);
      pending.set(id, { resolve, reject, timer }); process.stdout.write(JSON.stringify({ id, method, argument }) + '\n');
    });
  }
  await managedCall('ensureDoor');
  const frontDoor = await connectFrontDoor(topology.door.controlPipe, topology.controlToken);
  lines.once('close', () => {
    parentAlive = false;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(failure('LIVE_SWAP_MANAGED_LOST')); } pending.clear();
    void frontDoor.freeze().catch(() => {}).finally(() => { frontDoor.disconnect(); process.exit(1); });
  });
  const managed = {
    async acquire() { await managedCall('acquire'); return () => managedCall('release'); },
    assertHeld: () => managedCall('assertHeld'), pause: () => managedCall('pause'),
    assertStoreReleased: async () => managedCall('assertStoreReleased', Object.fromEntries(await Promise.all(['old', 'next'].map(async slot => [slot, await adapters[slot].observe()])))),
    commit: identity => managedCall('commit', identity), unpause: () => managedCall('unpause'),
  };
  const adapters = Object.fromEntries(['old', 'next'].map(slot => [slot, createRuntimeAdapter({ slot, topology, inspect: argument => managedCall('inspect', argument), start: argument => managedCall('start', argument), pinProof: argument => managedCall('pinDoorProof', argument) })]));
  const admission = mode === 'swap' ? await productionPolicy(topology) : {};
  const controller = new SwapController({ journal: topology.journal, dataDir: topology.dataDir, ...adapters, frontDoor, managed, policy: admission.policy });
  try {
    if (mode === 'bootstrap') {
      // First deployment is maintenance-only: the legacy writer must already
      // be stopped. Never attach to or terminate the old app/server.mjs PID.
      const release = await managed.acquire();
      try {
        await managed.pause(); await frontDoor.freeze(); await managed.assertStoreReleased();
        const journal = new Journal(topology.journal);
        if (await journal.read({ optional: true })) throw failure('LIVE_SWAP_BOOTSTRAP_EXISTING');
        await journal.write({ transaction: randomUUID(), phase: 'prepared', old: adapters.old.identity, next: adapters.next.identity, dataDir: topology.dataDir, preferred: 'old', checkpoint: await latestCheckpoint(topology.dataDir) });
      } finally { await release(); }
      await controller.recover();
    } else {
      if (mode === 'swap') await managedCall('resourceAdmission', admission.resources);
      await controller[mode]();
    }
    // Later requests reuse this coordinator and its ingress lease. There is no
    // second PowerShell lock holder or parallel controller during a swap.
    let operations = Promise.resolve(), busy = false;
    const enqueue = action => {
      const run = operations.then(async () => { busy = true; try { return await action(); } finally { busy = false; } });
      operations = run.catch(() => {}); return run;
    };
    await serveBackendControl({ address: topology.coordinator.controlPipe, token: topology.controlToken,
      identity: { kind: 'coordinator', topologyHash: hash }, lifecycle: {
        run: method => enqueue(async () => {
          if (method === 'status') return frontDoor.status();
          if (method === 'recover') return controller.recover();
          if (method === 'swap') {
            const admission = await productionPolicy(topology); controller.policy = admission.policy;
            await managedCall('resourceAdmission', admission.resources); return controller.swap();
          }
          throw failure('LIVE_SWAP_COORDINATOR_METHOD');
        }),
        shutdown: () => operations,
      } });
    // Retain the authenticated ingress lease after admission. Backend death,
    // ownership drift, parent loss, or disk failure closes admission. Recovery
    // always reads the latest durable save and receipts under managed locks.
    let checking = false, failed = false;
    const monitor = setInterval(() => {
      if (checking || failed || busy) return; checking = true;
      void enqueue(async () => {
        await managedCall('heartbeat');
        const status = await frontDoor.status();
        const selected = status.target?.slot;
        if (!adapters[selected]) throw failure('LIVE_SWAP_MONITOR_IDENTITY');
        const observed = await adapters[selected].observe();
        if (observed.state !== 'owned' || observed.standby || status.frozen) {
          await frontDoor.freeze(); await controller.recover();
        }
      }).catch(async () => {
        failed = true; await frontDoor.freeze().catch(() => {});
        const release = await managed.acquire().catch(() => null);
        if (release) { try { await managed.pause(); const journal = new Journal(topology.journal), state = await journal.read(); await journal.write({ ...state, phase: 'recovery-required', failure: 'LIVE_SWAP_RUNTIME_MONITOR' }); } finally { await release(); } }
        process.stderr.write('LIVE_SWAP_RECOVERY_REQUIRED\n');
      }).finally(() => { checking = false; });
    }, 100);
    process.once('SIGTERM', () => { clearInterval(monitor); void frontDoor.freeze().finally(() => { frontDoor.disconnect(); process.exit(1); }); });
  } catch {
    await frontDoor.freeze().catch(() => {}); frontDoor.disconnect(); process.stderr.write('LIVE_SWAP_RECOVERY_REQUIRED\n'); process.exitCode = 1; lines.close();
  }
}
