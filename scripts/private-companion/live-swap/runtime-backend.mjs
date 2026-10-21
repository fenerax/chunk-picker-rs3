import path from 'node:path';
import { createIngressContext } from './ingress.mjs';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { loadTopology, pinned } from './managed-runtime.mjs';
import { createBackendLifecycle, serveBackendControl } from './backend-lifecycle.mjs';
import { failure } from './journal.mjs';

// Detached real application host. No injectable factory or synthetic switch.
const [file, hash, slot] = process.argv.slice(2);
if (!['old', 'next'].includes(slot) || process.platform !== 'win32') throw failure('LIVE_SWAP_RUNTIME_PLATFORM');
const topology = await loadTopology(file, hash), info = topology.slots[slot], config = info.config;
for (const name of Object.keys(process.env)) if (name.startsWith('RS3_') || ['NODE_OPTIONS', 'NODE_PATH'].includes(name)) delete process.env[name];
Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: config.packsDir, RS3_PACK_SELECTION: config.selection.path, RS3_PUBLIC_ORIGIN: info.origin });
if (config.profile) Object.assign(process.env, { RS3_DATASET_PROFILE: config.profile.path, RS3_DATASET_PROFILE_SHA256: config.profile.sha256 });
if (config.addons) Object.assign(process.env, { RS3_PRIVATE_ADDON: config.addons.path, RS3_PRIVATE_ADDON_SHA256: config.addons.sha256 });
if (config.runtimeOptions.taskWorkerMode) process.env.RS3_TASK_WORKER_MODE = config.runtimeOptions.taskWorkerMode;
if (config.runtimeOptions.workerIdleMs) process.env.RS3_WORKER_IDLE_MS = String(config.runtimeOptions.workerIdleMs);
const { createServer, frontDoorIngressProtocol } = await import(pathToFileURL(path.join(config.coreRoot, 'app/server.mjs')));
let requestContextFor;
if (topology.door.lanes) {
  if (frontDoorIngressProtocol !== 1) throw failure('LIVE_SWAP_CORE_INGRESS_REQUIRED');
  const { requestContext } = await import(pathToFileURL(path.join(config.coreRoot, 'app/security/request.mjs')));
  requestContextFor = createIngressContext({ token: topology.controlToken, contextHost: topology.door.contextHost, requestContext });
}
const retention = Object.fromEntries(['backupDays', 'historyEntries'].filter(key => config.runtimeOptions[key] !== null).map(key => [key, config.runtimeOptions[key]]));
const lifecycle = createBackendLifecycle({
  async processIdentity() {
    const record = JSON.parse(await readFile(info.spec.recordFile, 'utf8'));
    if (record.pid !== process.pid || record.configHash !== info.configHash || record.topologyHash !== hash || typeof record.processStartedAt !== 'string') throw failure('LIVE_SWAP_RUNTIME_RECORD');
    return { pid: process.pid, processStartedAt: record.processStartedAt, configHash: info.configHash };
  },
  // Complete roots were validated before standby, outside the freeze.
  validateActivation: () => pinned(info.identity.configPin),
  createApplication: ({ standby, checkpoint }) => createServer({ dataDir: config.dataDir, host: config.host, port: config.port, loopbackPort: undefined,
    publicOrigin: info.origin, requestContextFor, predictionPrewarm: false, retention,
    liveSwap: { standby, strict: true, checkpoint, version: info.identity.version } }),
  async verifyApplication() {
    const until = Date.now() + 300000;
    while (Date.now() < until) {
      const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { headers: { Authorization: `Bearer ${topology.adminToken}` }, signal: AbortSignal.timeout(5000) });
      if (response.status !== 200) throw failure('LIVE_SWAP_RUNTIME_HEALTH');
      const health = await response.json(); if (health.ready) return health;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw failure('LIVE_SWAP_RUNTIME_READINESS_TIMEOUT');
  },
});
const control = await serveBackendControl({ address: info.spec.controlPipe, token: topology.controlToken, identity: info.identity, lifecycle });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void control.shutdown(); });
