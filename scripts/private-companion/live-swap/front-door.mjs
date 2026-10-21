import http from 'node:http';
import { validateLanes, forwardHeaders } from './ingress.mjs';
import net from 'node:net';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { atomicJSON, failure } from './journal.mjs';

const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const signed = (key, kind, value) => createHmac('sha256', key).update(`${kind}:${JSON.stringify(value)}`).digest('hex');
const scratchPort = value => Number.isInteger(value) && ((value >= 18700 && value <= 18799) || (value >= 8900 && value <= 8999));
const response503 = (request, response) => {
  response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Retry-After': '1', Connection: 'close' });
  response.end('{"code":"PICKER_UPDATING","message":"Updating… Pending input is retained."}');
  response.once('finish', () => request.destroy());
};

// Stable, separately owned listener. Startup ALWAYS freezes, including when a
// previously admitted state file exists. Only authenticated recovery can open.
// All lanes share admission, backend ownership, drain and control state.
export async function createFrontDoor({ listen, lanes, contextHost, scratchLanes = false, stateFile, token, backendToken, drainMs = 2500, writeState = atomicJSON, allowedPorts = [], monitorMs = 250, requireOwnership = false, assertTargetOwned }) {
  if (requireOwnership && typeof assertTargetOwned !== 'function') throw failure('LIVE_SWAP_DOOR_OWNERSHIP_REQUIRED');
  const targetOwned = assertTargetOwned ?? (async () => {});
  if (!Array.isArray(allowedPorts) || allowedPorts.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) throw failure('LIVE_SWAP_DOOR_CONFIG');
  const permittedPort = port => scratchPort(port) || allowedPorts.includes(port);
  if ((lanes && listen !== undefined) || (!lanes && !(typeof listen === 'string' || permittedPort(listen))) || !token || token.length < 32) throw failure('LIVE_SWAP_DOOR_CONFIG');
  const bindings = lanes ? validateLanes(lanes, { scratch: scratchLanes && !requireOwnership }) : null;
  if (bindings && (!net.isIP(contextHost) || !bindings.some(lane => lane.host === contextHost))) throw failure('LIVE_SWAP_LANE_CONTEXT');
  const probeLane = bindings?.find(lane => lane.trust === 'loopback-proxy');
  let target = null, frozen = true, recoveryRequired = true, epoch = randomUUID(), active = 0, lease;
  let freezeStartedAtMs = performance.now(), lastAdmissionAtMs = null, lastFreezeMs = null, admissions = 0;
  let diagnosticFailure = null;
  const sockets = new Set(), upstreams = new Set(), controlWork = new Set();
  let persistence = Promise.resolve();
  const persist = ({ initial = false } = {}) => {
    const value = { schemaVersion: 2, frozen, recoveryRequired, target, epoch };
    persistence = persistence.catch(() => {}).then(() => writeState(stateFile, value)).catch(error => {
      // Diagnostic snapshots are never boot instructions. Completion can never
      // reopen ingress; any failed snapshot closes memory admission immediately
      // and invalidates in-flight resume, without scheduling a retry loop.
      if (!frozen) freezeStartedAtMs = performance.now();
      frozen = true; recoveryRequired = true; epoch = randomUUID(); diagnosticFailure = error.code ?? 'LIVE_SWAP_DOOR_STATE_WRITE';
      if (initial) throw error;
    });
    return persistence;
  };
  try { const retained = JSON.parse(await readFile(stateFile, 'utf8')); target = retained.target ?? null; }
  catch (error) { if (error.code !== 'ENOENT') target = null; }
  await persist({ initial: true });
  const servers = [];
  const serve = lane => http.createServer({ maxHeaderSize: http.maxHeaderSize, requestTimeout: 10000, headersTimeout: 5000 }, async (request, response) => {
    const maintenance = request.method === 'GET' && request.url === '/api/health' && safeEqual(request.headers['x-picker-maintenance'], token);
    delete request.headers['x-picker-maintenance'];
    if ((!maintenance && frozen) || !target) { response503(request, response); return; }
    const checkedTarget = target, checkedEpoch = epoch;
    try { await targetOwned(structuredClone(checkedTarget)); }
    catch { if (checkedTarget === target && checkedEpoch === epoch) void door.freeze().catch(() => {}); response503(request, response); return; }
    if (checkedTarget !== target || checkedEpoch !== epoch || (!maintenance && frozen)) { response503(request, response); return; }
    active++; let finished = false;
    const finish = () => { if (!finished) { finished = true; active--; } };
    const upstream = http.request({ host: '127.0.0.1', port: target.port, path: request.url, method: request.method, headers: forwardHeaders(request, lane, token, contextHost) }, received => {
      response.writeHead(received.statusCode, received.headers); received.pipe(response);
      received.once('end', finish); received.once('error', () => { response.destroy(); finish(); });
    });
    upstreams.add(upstream); upstream.once('close', () => upstreams.delete(upstream));
    upstream.once('error', () => { if (!frozen) freezeStartedAtMs = performance.now(); frozen = true; recoveryRequired = true; epoch = randomUUID(); void persist().catch(() => {}); if (!response.headersSent) response503(request, response); else response.destroy(); finish(); });
    request.once('aborted', () => upstream.destroy()); response.once('close', () => { upstream.destroy(); finish(); }); request.pipe(upstream);
  });
  try {
    for (const lane of bindings ?? [null]) {
      const server = serve(lane); servers.push(server);
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready);
        lane ? server.listen(lane.port, lane.host) : typeof listen === 'string' ? server.listen(listen) : server.listen(listen, '127.0.0.1');
      });
    }
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    const refused = failure('LIVE_SWAP_DOOR_BIND_RETRY'); refused.retryable = true;
    refused.bindCode = ['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES'].includes(error.code) ? error.code : 'BIND_FAILED';
    throw refused;
  }
  const door = {
    async status() { return { frozen, recoveryRequired, diagnosticFailure, target: structuredClone(target), epoch, active, freezeStartedAtMs, lastAdmissionAtMs, lastFreezeMs, admissions }; },
    async settled() { await Promise.all([...controlWork]); await persistence; },
    async freeze() { if (!frozen) freezeStartedAtMs = performance.now(); frozen = true; recoveryRequired = true; epoch = randomUUID(); void persist(); return { epoch }; },
    async route(identity) {
      if (!frozen || !permittedPort(identity?.port) || typeof identity.version !== 'string') throw failure('LIVE_SWAP_DOOR_ROUTE');
      target = structuredClone(identity); void persist();
    },
    async probe() {
      if (!target) throw failure('LIVE_SWAP_DOOR_ROUTE');
      const checkedTarget = target, checkedEpoch = epoch;
      await targetOwned(structuredClone(checkedTarget));
      if (checkedTarget !== target || checkedEpoch !== epoch) throw failure('LIVE_SWAP_DOOR_CHANGED');
      const result = await new Promise((resolve, reject) => {
        const req = http.get(typeof listen === 'string' ? { socketPath: listen, path: '/api/health', headers: { Authorization: `Bearer ${backendToken}`, 'x-picker-maintenance': token } }
          : { host: probeLane?.host ?? '127.0.0.1', port: probeLane?.port ?? listen, path: '/api/health', headers: { Authorization: `Bearer ${backendToken}`, 'x-picker-maintenance': token } }, response => {
          let bytes = ''; response.setEncoding('utf8'); response.on('data', data => { bytes += data; if (bytes.length > 64 * 1024) req.destroy(failure('LIVE_SWAP_PROBE_SIZE')); });
          response.on('end', () => { try { if (response.statusCode !== 200) throw failure('LIVE_SWAP_PROBE_STATUS'); resolve(JSON.parse(bytes)); } catch (error) { reject(error); } });
          response.once('error', reject);
        });
        req.setTimeout(5000, () => req.destroy(failure('LIVE_SWAP_PROBE_TIMEOUT'))); req.once('error', reject);
      });
      return result;
    },
    async resume(identity) {
      if (!frozen || JSON.stringify(identity) !== JSON.stringify(target)) throw failure('LIVE_SWAP_DOOR_CHANGED');
      const checkedEpoch = epoch;
      const proof = await door.probe();
      if (!proof.ready || proof.standby || proof.version !== target.version || proof.liveSwapProtocol !== 2 || proof.actionReceiptFormat !== 2) throw failure('LIVE_SWAP_DOOR_PROOF');
      if (epoch !== checkedEpoch) throw failure('LIVE_SWAP_DOOR_CHANGED');
      // Controller journal + pointer are authoritative durable fences. The door
      // always starts frozen before listening, regardless of this diagnostic.
      recoveryRequired = false; diagnosticFailure = null; lastAdmissionAtMs = performance.now(); lastFreezeMs = lastAdmissionAtMs - freezeStartedAtMs; admissions++; frozen = false;
      void persist();
    },
    async drain() {
      const deadline = Date.now() + drainMs;
      while (active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (active) throw failure('LIVE_SWAP_DRAIN_TIMEOUT');
    },
    async close() {
      clearInterval(monitor); if (!frozen) freezeStartedAtMs = performance.now(); frozen = true; recoveryRequired = true; epoch = randomUUID(); await persist();
      for (const upstream of upstreams) upstream.destroy(); for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    },
    async control(address) {
      const controls = new Set();
      const control = net.createServer(socket => {
        controls.add(socket); let input = '', authenticated = false, queue = Promise.resolve(), lastRequestId = 0; const challenge = randomUUID();
        socket.write(`${JSON.stringify({ challenge })}\n`);
        socket.setEncoding('utf8');
        socket.on('data', data => {
          input += data; if (input.length > 64 * 1024) { socket.destroy(); return; }
          for (;;) {
            const end = input.indexOf('\n'); if (end < 0) break;
            const line = input.slice(0, end); input = input.slice(end + 1);
            queue = queue.then(async () => {
              let request;
              try {
                request = JSON.parse(line);
                if (socket.destroyed || (authenticated && lease !== socket)) throw failure('LIVE_SWAP_DOOR_LEASE');
                const { mac, ...payload } = request;
                if (payload.challenge !== challenge || typeof payload.nonce !== 'string' || !Number.isSafeInteger(payload.id)
                  || lastRequestId === Number.MAX_SAFE_INTEGER || payload.id !== lastRequestId + 1
                  || !safeEqual(mac, signed(token, 'request', payload))) throw failure('LIVE_SWAP_DOOR_AUTH');
                lastRequestId = payload.id;
                if (!authenticated) {
                  if (lease && lease !== socket) throw failure('LIVE_SWAP_DOOR_LEASE');
                  lease = socket; authenticated = true;
                }
                if (!['status', 'freeze', 'route', 'probe', 'resume', 'drain'].includes(request.method)) throw failure('LIVE_SWAP_DOOR_METHOD');
                if (socket.destroyed || lease !== socket) throw failure('LIVE_SWAP_DOOR_LEASE');
                const value = await door[request.method](request.argument);
                const answer = { id: request.id, nonce: request.nonce, value };
                if (!socket.destroyed) socket.write(`${JSON.stringify({ ...answer, mac: signed(token, 'response', answer) })}\n`);
              } catch (error) {
                if (lease === socket) await door.freeze().catch(() => {});
                const answer = { id: request?.id, nonce: request?.nonce, error: error.code ?? 'LIVE_SWAP_DOOR_FAILED' };
                if (!socket.destroyed) socket.write(`${JSON.stringify({ ...answer, mac: signed(token, 'response', answer) })}\n`);
              }
            });
            const dispatched = queue; controlWork.add(dispatched); void dispatched.finally(() => controlWork.delete(dispatched));
          }
        });
        socket.on('error', () => {});
        socket.once('close', () => { controls.delete(socket); if (lease === socket) { lease = null; if (!frozen) freezeStartedAtMs = performance.now(); frozen = true; recoveryRequired = true; epoch = randomUUID(); void persist().catch(() => {}); } });
      });
      await new Promise((resolve, reject) => { control.once('error', reject); control.listen(address, resolve); });
      return async () => { for (const socket of controls) socket.destroy(); await new Promise(resolve => control.close(resolve)); };
    },
  };
  let checking = false;
  const monitor = setInterval(() => {
    if (frozen || checking || !target) return;
    checking = true; const checkedEpoch = epoch, version = target.version;
    void door.probe().then(health => {
      if (!health.ready || health.standby || health.version !== version || health.liveSwapProtocol !== 2 || health.actionReceiptFormat !== 2) throw failure('LIVE_SWAP_BACKEND_LOST');
    }).catch(async () => { if (epoch === checkedEpoch && !frozen) await door.freeze().catch(() => {}); }).finally(() => { checking = false; });
  }, monitorMs);
  monitor.unref();
  return door;
}

export async function connectFrontDoor(address, token) {
  const socket = net.createConnection(address); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  let serial = 0, input = '', challenge, resolveChallenge, rejectChallenge; const pending = new Map();
  const challenged = new Promise((resolve, reject) => { resolveChallenge = resolve; rejectChallenge = reject; });
  const challengeDeadline = setTimeout(() => { socket.destroy(); rejectChallenge(failure('LIVE_SWAP_DOOR_HANDSHAKE')); }, 5000);
  socket.setEncoding('utf8'); socket.on('error', () => {});
  socket.on('data', data => {
    input += data; if (input.length > 128 * 1024) { socket.destroy(); return; }
    for (;;) {
      const end = input.indexOf('\n'); if (end < 0) break;
      const line = input.slice(0, end); input = input.slice(end + 1);
      let response; try { response = JSON.parse(line); } catch { socket.destroy(); return; }
      if (!challenge && typeof response.challenge === 'string') { challenge = response.challenge; clearTimeout(challengeDeadline); resolveChallenge(); continue; }
      const { mac, ...payload } = response;
      if (!safeEqual(mac, signed(token, 'response', payload))) { socket.destroy(); return; }
      const call = pending.get(response.id); if (call) { if (call.nonce !== response.nonce) { socket.destroy(); return; } pending.delete(response.id); clearTimeout(call.timer); response.error ? call.reject(failure(response.error)) : call.resolve(response.value); }
    }
  });
  socket.once('close', () => { clearTimeout(challengeDeadline); rejectChallenge(failure('LIVE_SWAP_DOOR_DISCONNECTED')); for (const call of pending.values()) { clearTimeout(call.timer); call.reject(failure('LIVE_SWAP_DOOR_DISCONNECTED')); } pending.clear(); });
  await challenged;
  const call = (method, argument) => new Promise((resolve, reject) => {
    if (socket.destroyed) { reject(failure('LIVE_SWAP_DOOR_DISCONNECTED')); return; }
    const id = ++serial;
    if (!Number.isSafeInteger(id)) { socket.destroy(); reject(failure('LIVE_SWAP_DOOR_SEQUENCE')); return; }
    const timer = setTimeout(() => { pending.delete(id); socket.destroy(); reject(failure('LIVE_SWAP_DOOR_TIMEOUT')); }, 10000);
    const payload = { id, method, ...(argument === undefined ? {} : { argument }), challenge, nonce: randomUUID() };
    pending.set(id, { resolve, reject, timer, nonce: payload.nonce }); socket.write(`${JSON.stringify({ ...payload, mac: signed(token, 'request', payload) })}\n`);
  });
  const adapter = Object.fromEntries(['status', 'freeze', 'route', 'probe', 'resume', 'drain'].map(method => [method, argument => call(method, argument)]));
  return { ...adapter, disconnect: () => socket.destroy() };
}
