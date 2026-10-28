import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { normalizeIngressRole, normalizePublicOrigin, requestContext } from './security/request.mjs';
import { startupPhase } from './startup-timing.mjs';

// Bind before store/catalogue initialization. The dispatcher has no save queue:
// every request except private health is refused until the real handler exists.
export async function startEarlyServer(options, createApplication) {
  const { dataDir, host = '127.0.0.1', port = 8788,
    loopbackPort = process.env.RS3_LOOPBACK_PORT ? Number(process.env.RS3_LOOPBACK_PORT) : undefined } = options;
  const publicOrigin = normalizePublicOrigin(options.publicOrigin ?? process.env.RS3_PUBLIC_ORIGIN);
  const ingressRole = normalizeIngressRole(options.ingressRole);
  const loopbackRole = normalizeIngressRole(options.loopbackRole ?? process.env.RS3_LOOPBACK_ROLE);
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host must be nonempty.');
  for (const value of [port, loopbackPort].filter(value => value !== undefined)) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new TypeError('port must be an integer from 0 through 65535.');
  }
  let handler, application, stopped = false, closePromise, token;
  const initialization = new AbortController();
  const connections = new Set();
  async function dispatch(request, response, ingress) {
    if (handler && !stopped) { await handler(request, response, ingress); return; }
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    let security;
    try { security = requestContext(request, { ...ingress, publicOrigin }); }
    catch (error) {
      response.statusCode = error.status ?? 400;
      response.setHeader('Connection', 'close');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ message: error.message }));
      return;
    }
    const health = ['GET', 'HEAD'].includes(request.method) && request.url?.split('?')[0] === '/api/health';
    let authorized = false, publicMaster = false;
    if (health) {
      try { token ??= (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim(); } catch { /* Fresh stores create the token during initialization. */ }
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
      const validMaster = /^[A-Za-z0-9_-]{43}$/.test(token ?? '')
        && !!bearer && timingSafeEqual(Buffer.from(bearer), Buffer.from(token));
      authorized = security.masterAllowed && validMaster;
      publicMaster = security.ingressRole === 'public' && validMaster;
    }
    response.statusCode = publicMaster ? 403 : health && !authorized ? 401 : health ? 200 : 503;
    response.setHeader('Retry-After', '1');
    // Closing refused requests also bounds unread/slow POST bodies. No body is
    // parsed or queued, so retrying cannot duplicate a saved command.
    response.setHeader('Connection', 'close');
    const payload = health && authorized ? { ready: false, status: stopped ? 'stopping' : 'warming', savesReady: false,
      worker: { status: 'starting', ready: false, stuck: false, restartRequired: false }, local: true }
      : { message: health ? 'Access required.' : 'The picker is starting. Try again in a moment.', code: 'PICKER_WARMING' };
    if (response.statusCode === 503 && ['GET', 'HEAD'].includes(request.method)
      && !request.url?.split('?')[0].startsWith('/api/') && request.headers.accept?.includes('text/html')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Updating</title><body><h1>Updating</h1><p>Back in a moment. This page will retry automatically.</p></body></html>');
      return;
    }
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(payload));
  }
  const primaryIngress = Object.freeze({ host, ingressRole });
  const loopbackIngress = Object.freeze({ host: '127.0.0.1', ingressRole: loopbackRole });
  const server = http.createServer((request, response) => dispatch(request, response, primaryIngress));
  const loopbackServer = loopbackPort === undefined ? null : http.createServer((request, response) => dispatch(request, response, loopbackIngress));
  const track = socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); };
  for (const listener of [server, loopbackServer]) listener?.on('connection', track);
  const bind = (listener, bindPort, bindHost) => new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(bindPort, bindHost, () => { listener.off('error', reject); resolve(); });
  });
  async function closeListeners() {
    const closing = [server, loopbackServer].filter(listener => listener?.listening).map(listener => new Promise(resolve => listener.close(resolve)));
    for (const socket of connections) socket.destroy();
    await Promise.all(closing);
  }
  try {
    await bind(server, port, host);
    if (loopbackServer) await bind(loopbackServer, loopbackPort, '127.0.0.1');
  } catch (error) { await closeListeners(); throw error; }
  startupPhase('early-listen');
  const handle = {
    server, address: () => server.address(), loopbackAddress: () => loopbackServer?.address() ?? null,
    get inviteUrl() { return application?.inviteUrl; },
    ready: undefined,
    close() {
      if (!closePromise) {
        stopped = true;
        initialization.abort();
        closePromise = (async () => {
          if (application) await application.close();
          else { await closeListeners(); await handle.ready.catch(() => {}); }
        })();
      }
      return closePromise;
    },
  };
  // Yield once with the listener active before synchronous catalogue work.
  handle.ready = new Promise(resolve => setImmediate(resolve)).then(async () => {
    try {
      if (stopped) throw new Error('Server is closed.');
      application = await createApplication({ ...options, publicOrigin, ingressRole, loopbackRole, httpServer: server, httpLoopbackServer: loopbackServer,
        startupConnections: connections, onRequestHandler(value) { handler = value; },
        startupSignal: initialization.signal,
        taskWorkerOptions: { startupDeadlineMs: 300000, ...options.taskWorkerOptions, signal: initialization.signal } });
      if (stopped) { await application.close(); throw new Error('Server is closed.'); }
      await application.listen();
      startupPhase('listen');
      return application;
    } catch (error) { stopped = true; await closeListeners(); throw error; }
  });
  handle.ready.catch(() => {}); // Callers observe ready; avoid a race with handlers.
  return handle;
}

// The import-time provider stays reachable from its module's top-level await.
// Keeping an equivalent second resolution would retain every catalogue twice.
// Workers rebuild providers from workerSelection(), so it defines equivalence.
export function reuseEquivalentDataset(resolved, imported) {
  if (!imported || resolved === imported || resolved?.digest !== imported.digest) return resolved;
  try { return JSON.stringify(resolved.workerSelection()) === JSON.stringify(imported.workerSelection()) ? imported : resolved; }
  catch { return resolved; }
}
