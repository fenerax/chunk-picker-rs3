// Test-only child. Never imported by runtime-backend or selected by topology.
import { createBackendLifecycle, serveBackendControl } from './backend-lifecycle.mjs';
const address = process.argv[2], token = 'a'.repeat(64), identity = { kind: 'test-backend', version: 'tiny' };
let delay = 0, generation = 0, active = false;
const lifecycle = createBackendLifecycle({
  async createApplication({ standby, checkpoint }) {
    const id = ++generation; process.send?.({ event: 'factory-start', id });
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    process.send?.({ event: 'factory-return', id });
    return { async listen() { active = true; process.send?.({ event: 'listen', id }); }, async close() { active = false; process.send?.({ event: 'closed', id }); },
      async freeze() { return { revision: checkpoint?.revision ?? 7, schemaVersion: 1, sha256: 'f'.repeat(64) }; } };
  },
  async verifyApplication() { return { ready: active, version: 'tiny' }; },
});
const control = await serveBackendControl({ address, token, identity, lifecycle });
process.on('message', message => {
  if (message.method === 'delay') { delay = message.ms; process.send?.({ event: 'delay-set' }); }
  if (message.method === 'shutdown') void control.shutdown().then(() => { process.send?.({ event: 'shutdown', active }); process.disconnect(); });
});
process.send?.({ event: 'ready' });
