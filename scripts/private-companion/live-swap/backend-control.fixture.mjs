// Test-only child. Never imported by runtime-backend or selected by topology.
import { createBackendLifecycle, serveBackendControl } from './backend-lifecycle.mjs';
const address = process.argv[2], token = 'a'.repeat(64), identity = { kind: 'test-backend', version: 'tiny' };
let factoryGate, releaseFactory, generation = 0, active = false, factoryWaiting = false;
const lifecycle = createBackendLifecycle({
  async createApplication({ standby, checkpoint }) {
    const id = ++generation; process.send?.({ event: 'factory-start', id });
    if (factoryGate) { factoryWaiting = true; await factoryGate; factoryWaiting = false; }
    process.send?.({ event: 'factory-return', id });
    return { async listen() { active = true; process.send?.({ event: 'listen', id }); }, async close() { active = false; process.send?.({ event: 'closed', id }); },
      async freeze() { return { revision: checkpoint?.revision ?? 7, schemaVersion: 1, sha256: 'f'.repeat(64) }; } };
  },
  async verifyApplication() { return { ready: active, version: 'tiny' }; },
});
const control = await serveBackendControl({ address, token, identity, lifecycle });
process.on('message', message => {
  if (message.method === 'hold-factory') { factoryGate = new Promise(resolve => { releaseFactory = resolve; }); process.send?.({ event: 'factory-held' }); }
  if (message.method === 'release-factory') { releaseFactory?.(); factoryGate = undefined; }
  if (message.method === 'barrier') process.send?.({ event: message.event, closing: lifecycle.closing, active, factoryWaiting });
  if (message.method === 'shutdown') {
    const stopped = control.shutdown();
    // shutdown() sets lifecycle.closing synchronously, before awaiting the factory.
    process.send?.({ event: 'shutdown-started', closing: lifecycle.closing });
    void stopped.then(() => { process.send?.({ event: 'shutdown', active }); process.disconnect(); });
  }
});
process.send?.({ event: 'ready' });
