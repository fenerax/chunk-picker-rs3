import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { constantEqual, signMessage, same } from './managed-runtime.mjs';
import { failure } from './journal.mjs';

// Tests inject a tiny factory here; production always imports its real core.
export function createBackendLifecycle({ createApplication, validateActivation = async () => {}, verifyApplication, processIdentity = async () => undefined }) {
  let application, state = 'stopped', closing = false, queue = Promise.resolve(), generation;
  async function close() { if (application) { await application.close(); application = undefined; } state = 'stopped'; return { state }; }
  async function start(standby, checkpoint) {
    if (closing) throw failure('LIVE_SWAP_RUNTIME_CLOSING');
    if (application && state === 'active') throw failure('LIVE_SWAP_RUNTIME_ALREADY_ACTIVE');
    if (!standby && (!checkpoint || !Number.isSafeInteger(checkpoint.revision) || !/^[a-f0-9]{64}$/.test(checkpoint.sha256))) throw failure('LIVE_SWAP_RUNTIME_CHECKPOINT');
    if (!standby && application && state === 'standby' && typeof application.activate === 'function') {
      await validateActivation();
      // A failed promotion remains the same owned application. Recovery must
      // close it explicitly; never hide uncertain ownership by recreating it.
      await application.activate(checkpoint);
      if (closing) { await close(); throw failure('LIVE_SWAP_RUNTIME_CLOSING'); }
      state = 'active'; return { state };
    }
    await close(); await validateActivation();
    application = await createApplication({ standby, checkpoint });
    generation = randomUUID();
    try { if (closing) throw failure('LIVE_SWAP_RUNTIME_CLOSING'); await application.listen(); state = standby ? 'standby' : 'active'; }
    catch (error) { await close().catch(() => {}); throw error; }
    return { state };
  }
  return {
    get closing() { return closing; },
    run(method, argument) {
      const run = queue.then(async () => {
        if (closing) throw failure('LIVE_SWAP_RUNTIME_CLOSING');
        if (method === 'status') {
          const address = application?.server?.address();
          return { state, processIdentity: await processIdentity(), listenerProof: application?.server?.listening && address && typeof address === 'object'
            ? { generation, host: address.address, port: address.port, listening: true } : null };
        }
        if (method === 'standby') return start(true);
        if (method === 'activate') return start(false, argument);
        if (method === 'close') return close();
        if (method === 'freeze') { if (!application || state !== 'active') throw failure('LIVE_SWAP_RUNTIME_STATE'); const value = await application.freeze(argument); state = 'frozen'; return value; }
        if (method === 'verify') return verifyApplication(application);
        throw failure('LIVE_SWAP_RUNTIME_METHOD');
      });
      queue = run.catch(() => {}); return run;
    },
    async shutdown() { closing = true; await queue; await close(); },
  };
}

export async function serveBackendControl({ address, token, identity, lifecycle }) {
  const nonces = new Map(), connections = new Set(); let closing = false;
  const server = net.createServer(socket => {
    if (closing) { socket.destroy(); return; }
    connections.add(socket); socket.once('close', () => connections.delete(socket));
    let input = '', received = false;
    socket.setEncoding('utf8'); socket.setTimeout(340000, () => socket.destroy()); socket.on('error', () => {});
    socket.on('data', bytes => {
      if (received) { socket.destroy(); return; } input += bytes;
      if (input.length > 65536) { socket.destroy(); return; }
      const end = input.indexOf('\n'); if (end < 0) return; received = true;
      void (async () => {
        let nonce;
        try {
          const envelope = JSON.parse(input.slice(0, end)), request = envelope.value;
          if (closing || !request || !constantEqual(envelope.mac, signMessage(token, request)) || !same(request.identity, identity)
            || typeof request.nonce !== 'string' || !Number.isSafeInteger(request.issuedAt) || Math.abs(Date.now() - request.issuedAt) > 30000 || nonces.has(request.nonce)) throw failure('LIVE_SWAP_RUNTIME_AUTH');
          nonce = request.nonce;
          for (const [key, issued] of nonces) if (issued < Date.now() - 30000) nonces.delete(key);
          if (nonces.size >= 8192) throw failure('LIVE_SWAP_RUNTIME_AUTH_CAPACITY'); nonces.set(nonce, request.issuedAt);
          let value = await lifecycle.run(request.method, request.argument);
          if (request.method === 'status') value = { ...value, pid: process.pid, identity };
          const response = { nonce, value }; if (!socket.destroyed) socket.end(JSON.stringify({ value: response, mac: signMessage(token, response) }) + '\n');
        } catch (error) {
          const response = { nonce, error: /^LIVE_SWAP_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'LIVE_SWAP_RUNTIME_REFUSED' };
          if (!socket.destroyed) socket.end(JSON.stringify({ value: response, mac: signMessage(token, response) }) + '\n');
        }
      })();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
  return { async shutdown() {
    if (closing) return; closing = true;
    const stopped = new Promise(resolve => server.close(resolve));
    await lifecycle.shutdown();
    for (const socket of connections) socket.destroy(); await stopped;
  } };
}
