import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { bodyJSON, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';
import { createGuestLimits, guestError } from './guest-limits.mjs';
import { TASK_WORKER_RESOURCE_LIMITS } from './tasks/worker-limits.mjs';
import { preparedDefinitionStages } from './dataset-pipeline.mjs';

const assets = new Map([['/guest/', ['index.html', 'text/html']], ['/guest/guest.mjs', ['guest.mjs', 'text/javascript']],
  ['/guest/guest-save.mjs', ['guest-save.mjs', 'text/javascript']], ['/guest/guest.css', ['guest.css', 'text/css']]]);
const operations = new Set(['new', 'load', 'upgrade', 'command', 'tasks', 'how', 'why', 'why-chain', 'chunk-sections', 'chunk-planning',
  'profile-preview', 'predict', 'teleports', 'backlog-search', 'roll-stats', 'xp-choices', 'map-info']);
export const isGuestRoute = request => /^\/guest(?:\/|\?|$)/.test(request.url ?? '');

function readGuestUpload(request, uploadLease, maxBytes, clock, now) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw guestError(415, 'Use application/json for guest requests.');
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw guestError(413, 'Guest save is too large. Keep your download and sign in to import it.');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0, settled = false, idleTimer, totalTimer;
    const cleanup = () => {
      clock.clearTimeout(idleTimer); clock.clearTimeout(totalTimer);
      request.off('data', onData); request.off('end', onEnd);
      request.off('error', onError); request.off('aborted', onAbort); request.off('close', onClose);
    };
    const fail = (error, destroy = false) => {
      if (settled) return;
      settled = true; cleanup();
      if (destroy) request.destroy();
      reject(error);
    };
    const timedOut = () => fail(uploadLease.expiresAt <= now()
      ? guestError(401, 'Guest access expired. Reload to resume your browser save.')
      : guestError(408, 'Guest request timed out while uploading. Reload and try again.'), true);
    const armIdle = () => {
      clock.clearTimeout(idleTimer);
      const remaining = uploadLease.deadlineAt - now();
      if (remaining <= 0) { timedOut(); return; }
      idleTimer = clock.setTimeout(timedOut, Math.max(1, Math.min(uploadLease.idleMs, remaining)));
      idleTimer.unref?.();
    };
    const onData = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.length) armIdle();
      length += buffer.length;
      if (length > maxBytes) return fail(guestError(413, 'Guest save is too large. Keep your download and sign in to import it.'), true);
      try { uploadLease.reserveBytes(buffer.length); } catch (error) { return fail(error, true); }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true; cleanup();
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(guestError(400, 'Guest request could not be read. Reload and try again.'));
          return;
        }
        resolve(value);
      } catch {
        reject(guestError(400, 'Guest request could not be read. Reload and try again.'));
      }
    };
    const onError = () => fail(guestError(400, 'Guest request could not be read. Reload and try again.'));
    const onAbort = () => fail(guestError(400, 'Guest request was interrupted. Reload and try again.'));
    const onClose = () => { if (!request.complete) onAbort(); };
    const totalRemaining = uploadLease.deadlineAt - now();
    if (totalRemaining <= 0) { timedOut(); return; }
    totalTimer = clock.setTimeout(timedOut, Math.max(1, totalRemaining));
    totalTimer.unref?.();
    armIdle();
    request.on('data', onData); request.once('end', onEnd);
    request.once('error', onError); request.once('aborted', onAbort); request.once('close', onClose);
  });
}

export function createGuestMode({ runtime, publicOrigin, host, limits: limitOptions, now = Date.now,
  serveStatic,
  workerFactory = (url, options) => new Worker(url, options), clock = { setTimeout, clearTimeout } } = {}) {
  const admission = createGuestLimits({ now, ...limitOptions });
  const active = new Set(), uploads = new Set();
  let closed = false;
  async function calculate(input, request, response, lease) {
    const remaining = lease.deadlineAt - now();
    if (remaining <= 0) throw lease.expiresAt <= now()
      ? guestError(401, 'Guest access expired. Reload to resume your browser save.')
      : guestError(503, 'Guest calculation stopped. Your browser save is unchanged. Try again.', 60);
    // No inherited profiling, startup logs, dataset receipts or bytecode cache.
    // Capture stdout/stderr so imported modules cannot publish guest contents.
    const worker = workerFactory(new URL('./guest-worker.mjs', import.meta.url), {
      workerData: { input, definitions: runtime.parsedDefinitions, datasetSelection: runtime.dataset.workerSelection(),
        datasetOptions: runtime.guestDatasetOptions, preparedDatasetStages: preparedDefinitionStages(runtime.parsedDefinitions) },
      env: { NODE_DISABLE_COMPILE_CACHE: '1' }, execArgv: [], resourceLimits: TASK_WORKER_RESOURCE_LIMITS,
      stdout: true, stderr: true,
    });
    worker.stdout.resume(); worker.stderr.resume();
    let stop, timer, disconnect, finished;
    const entry = { stop: () => stop?.(), done: new Promise(resolve => { finished = resolve; }) }; active.add(entry);
    try {
      const result = await new Promise((resolve, reject) => {
        stop = () => reject(lease.expiresAt <= now()
          ? guestError(401, 'Guest access expired. Reload to resume your browser save.')
          : guestError(503, 'Guest calculation stopped. Your browser save is unchanged. Try again.', 60));
        timer = clock.setTimeout(stop, Math.max(1, lease.deadlineAt - now())); timer.unref?.();
        disconnect = () => { if (!response.writableEnded) stop(); };
        request.once('aborted', disconnect); response.once('close', disconnect);
        worker.once('message', value => lease.deadlineAt <= now() ? stop() : resolve(value)); worker.once('error', stop); worker.once('exit', stop);
        if (closed || request.aborted || response.destroyed || lease.deadlineAt <= now()) stop();
      });
      if (result.error) throw guestError(422, result.error);
      return result;
    } finally {
      clock.clearTimeout(timer); request.off('aborted', disconnect); response.off('close', disconnect);
      try { await worker.terminate(); } finally { active.delete(entry); finished(); }
    }
  }
  return {
    async handle(request, response, listener = { host, ingressRole: 'private' }) {
      let uploadLease, lease;
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      try {
        const security = runtime.requestContextFor(request, { ...listener, publicOrigin });
        if (security.publicRequest && (!security.secure || !publicOrigin || security.origin !== publicOrigin)) throw guestError(403, 'Use the configured HTTPS address for guest mode.');
        if (closed) throw guestError(503, 'Guest mode is stopping. Try again shortly.', 60);
        const url = new URL(request.url, security.origin), route = url.pathname;
        if (route.startsWith('/guest/api/') && url.search || request.headers['x-picker-id'] || request.headers['x-account-id']) throw guestError(400, 'Guest mode does not accept group selectors.');
        if (request.method === 'GET' && route === '/guest') { response.writeHead(303, { Location: '/guest/' }); response.end(); return; }
        // Only the member picker's existing static allowlist is shared. API,
        // gallery, overlay and auth dispatchers are never called here.
        if (['GET', 'HEAD'].includes(request.method) && !assets.has(route) && route.startsWith('/guest/') && !route.startsWith('/guest/api/')) {
          if (!serveStatic) throw guestError(404, 'Guest feature unavailable.');
          const setHeader = response.setHeader.bind(response);
          response.setHeader = (name, value) => setHeader(name, name.toLowerCase() === 'cache-control' ? 'private, no-store' : value);
          return await serveStatic(request, response, route.slice('/guest'.length), { guest: true });
        }
        const asset = assets.get(route);
        if (asset && ['GET', 'HEAD'].includes(request.method)) {
          let bytes = await readFile(path.join(runtime.webRoot, asset[0]));
          if (route === '/guest/') bytes = Buffer.from(bytes.toString('utf8')
            .replace('src="/main.mjs"', 'src="/guest/guest.mjs"')
            .replaceAll('href="/', 'href="/guest/')
            .replace('</head>', '<link rel="stylesheet" href="/guest/guest.css"></head>'));

          response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
          response.end(request.method === 'HEAD' ? undefined : bytes); return;
        }
        if (request.method !== 'POST' || !['/guest/api/session', '/guest/api/run'].includes(route)) throw guestError(404, 'Guest feature unavailable. Sign in for account features.');
        checkRequestOrigin(request, security);
        if (!request.headers.origin || request.headers.origin !== security.origin) throw guestError(403, 'Open guest mode on this site before trying again.');
        if (route === '/guest/api/session') {
          const body = await bodyJSON(request, 128);
          if (Object.keys(body).length) throw guestError(400, 'Guest admission takes no save or account details.');
          await json(request, response, 200, { ...admission.open(security.rateKey, request.headers['x-guest-token']), dataset: { id: runtime.dataset.datasetId, digest: runtime.dataset.digest } }); return;
        }
        // Admit and read uploads under a bounded upload budget first so a slow or
        // stalled client never holds the single global guest calculation slot.
        uploadLease = admission.admitUpload(request.headers['x-guest-token'], security.rateKey);
        uploads.add(request);
        const body = await readGuestUpload(request, uploadLease, admission.config.bodyBytes, clock, now);
        uploads.delete(request);
        uploadLease.release(); uploadLease = undefined;
        if (!operations.has(body.operation) || Object.keys(body).some(key => !['operation', 'backup', 'command', 'taskId', 'chunkId', 'profile', 'selector'].includes(key))) throw guestError(400, 'Choose an available guest action.');
        lease = admission.acquire(request.headers['x-guest-token'], security.rateKey);
        const result = await calculate(body, request, response, lease);
        await json(request, response, 200, result);
      } catch (error) {
        // Do not pass guest requests to general request/error/usage loggers.
        request.resume();
        if (!response.headersSent && !response.destroyed) {
          const status = [400, 401, 403, 404, 408, 413, 415, 422, 429, 503].includes(error.status) ? error.status : 400;
          const message = error.guestPublic ? error.message : status === 413 ? 'Guest save is too large. Keep your download and sign in to import it.'
            : status === 415 ? 'Use application/json for guest requests.' : 'Guest request could not be read. Reload and try again.';
          if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
          await json(request, response, status, { message });
        }
      } finally { uploads.delete(request); uploadLease?.release(); lease?.release(); }
    },
    async close() {
      closed = true; admission.close(); for (const request of uploads) request.destroy();
      const pending = [...active]; for (const entry of pending) entry.stop(); await Promise.all(pending.map(entry => entry.done));
    },
  };
}
