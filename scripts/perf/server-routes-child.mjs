// Private observer child. Application output and error strings never leave IPC.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance, PerformanceObserver, monitorEventLoopDelay } from 'node:perf_hooks';

if (!process.send || !process.env.RS3_ROUTES_SCRATCH) { console.error('Launch through server-routes.mjs.'); process.exit(1); }
const started = performance.now(), children = new Set();
const send = value => { if (process.connected) process.send(value); };
const STARTUP_PHASES = new Set(['modules-start', 'modules-loaded', 'early-listen', 'listen',
  'dataset:resolve', 'dataset:profile', 'dataset:data-pack', 'dataset:rules-pack', 'dataset:values', 'dataset:legacy-values',
  'dataset:rule-contract', 'dataset:digest', 'dataset:provider', 'create:start', 'create:dataset', 'create:storage',
  'create:browser-payload', 'create:inputs', 'create:definitions', 'create:world', 'create:worker', 'create:store', 'create:sidecars', 'create:handler']);
const fs = createRequire(import.meta.url)('node:fs'), appendFileSync = fs.appendFileSync;
fs.appendFileSync = function(file, data, ...args) {
  if (typeof file === 'string' && file === process.env.RS3_STARTUP_TIMING_LOG && typeof data === 'string' && data.length < 4096) {
    try {
      const event = JSON.parse(data);
      if (event.pid === process.pid && event.thread === 0 && STARTUP_PHASES.has(event.phase)) {
        const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage();
        send({ type: 'startup-checkpoint', phase: event.phase, elapsedMs: performance.now() - started,
          main: { rss, heapTotal, heapUsed, external, arrayBuffers } });
        return;
      }
    } catch { /* Preserve ordinary writes when they are not recognized startup events. */ }
  }
  return appendFileSync.call(fs, file, data, ...args);
};
const cp = createRequire(import.meta.url)('node:child_process'), fork = cp.fork;
const fsPromises = createRequire(import.meta.url)('node:fs/promises'), open = fsPromises.open;
const io = Object.fromEntries(['state', 'backup', 'static', 'other'].map(key => [key,
  { writeFileCount: 0, writeFileMs: 0, syncCount: 0, syncMs: 0 }]));
function fileClass(file) {
  const text = typeof file === 'string' ? file : file instanceof URL ? file.pathname : '';
  if (/(?:^|[\\/])(?:backups?|archives?|history)(?:[\\/]|$)/i.test(text)) return 'backup';
  if (/state\.json/i.test(path.basename(text))) return 'state';
  if (/(?:^|[\\/])static(?:[\\/]|$)/i.test(text) || /\.(?:mjs|css|html|png|webp|woff2?)$/i.test(text)) return 'static';
  return 'other';
}
fsPromises.open = async function(file, ...args) {
  const handle = await open(file, ...args), counters = io[fileClass(file)];
  for (const method of ['writeFile', 'sync']) {
    const original = handle[method].bind(handle);
    handle[method] = async (...values) => {
      const before = performance.now(); counters[`${method}Count`]++;
      try { return await original(...values); }
      finally { counters[`${method}Ms`] += performance.now() - before; }
    };
  }
  return handle;
};
cp.fork = function(file, args, options = {}) {
  const child = fork(file, args, { ...options, windowsHide: true });
  children.add(child); child.once('exit', () => children.delete(child));
  return child;
};
syncBuiltinESMExports();
const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
const gc = { count: 0, totalMs: 0, maxMs: 0 };
const observer = new PerformanceObserver(list => {
  for (const item of list.getEntries()) { gc.count++; gc.totalMs += item.duration; gc.maxMs = Math.max(gc.maxMs, item.duration); }
});
observer.observe({ entryTypes: ['gc'] });
let app, readyApp, closing = false, busy = false, sequence = 0, stage = 'import';
function stackLocations(error) {
  // Skip the first stack line (the error message). Keep no function names or paths.
  return String(error?.stack ?? '').split(/\r?\n/).slice(1, 81).flatMap(line => {
    const match = /[/\\]([A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.mjs):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!match) return [];
    const lineNumber = Number(match[2]), column = Number(match[3]);
    return Number.isSafeInteger(lineNumber) && lineNumber > 0 && Number.isSafeInteger(column) && column > 0
      ? [{ file: match[1], line: lineNumber, column }] : [];
  }).slice(0, 8);
}
const safeError = error => ({
  name: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error?.name) ? error.name : null,
  code: ['EADDRINUSE', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EMFILE', 'ENOMEM', 'ERR_MODULE_NOT_FOUND',
    'ERR_WORKER_OUT_OF_MEMORY', 'ERR_WORKER_INIT_FAILED', 'ERR_INVALID_ARG_TYPE', 'PRIVATE_ADDON_INVALID'].includes(error?.code) ? error.code : null,
  locations: stackLocations(error),
});
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key,
  typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null]));
const startup = () => pick(readyApp?.getStartupTimingMs?.(), ['cataloguesMs', 'workerAndReferencesMs', 'storeMs', 'authMs', 'variantMs', 'stateResponseMs']);
function childRss(child) {
  return new Promise(resolve => {
    const id = ++sequence, startedAt = performance.now(); let settled = false, deferredTimeout, ipcClosed = false;
    const exitedAlready = () => Number.isInteger(child.exitCode) || typeof child.signalCode === 'string';
    const finish = (rssBytes, outcome) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearImmediate(deferredTimeout);
      child.off('message', listener); child.off('exit', exited); child.off('disconnect', disconnected);
      resolve({ rssBytes, outcome, ipcClosed, elapsedMs: performance.now() - startedAt });
    };
    const listener = message => {
      if (message?.kind === 'memory-rss' && message.id === id)
        finish(Number.isFinite(message.rssBytes) ? message.rssBytes : null, Number.isFinite(message.rssBytes) ? 'replied' : 'ipc-unavailable');
    };
    const exited = () => finish(0, 'exited');
    const disconnected = () => {
      ipcClosed = true;
      // Retirement can close IPC before ChildProcess emits exit. Keep observing
      // the owned process within the original deadline; a live silent process
      // remains incomplete and cannot be treated as zero resident memory.
      if (exitedAlready()) finish(0, 'exited');
    };
    // A blocked parent turn can leave both the timer and a reply queued. Give
    // the pending IPC callback its poll-phase opportunity before failing safely.
    const timer = setTimeout(() => {
      deferredTimeout = setImmediate(() => exitedAlready() ? finish(0, 'exited') : finish(null, ipcClosed ? 'ipc-unavailable' : 'timed-out'));
    }, 15000);
    child.on('message', listener); child.once('exit', exited); child.once('disconnect', disconnected);
    if (exitedAlready()) { finish(0, 'exited'); return; }
    if (!child.connected) { disconnected(); return; }
    try { child.send({ kind: 'memory-rss', id }, error => { if (error) disconnected(); }); }
    catch { disconnected(); }
  });
}
async function stop(code = 0) {
  if (closing) return; closing = true;
  clearInterval(memoryTimer); observer.disconnect(); lag.disable();
  const deadline = setTimeout(() => { for (const child of children) child.kill(); process.exit(1); }, 8000);
  try { await app?.close(); }
  catch { code = 1; }
  finally {
    const remaining = [...children];
    await Promise.all(remaining.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(resolve, 2500);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill();
    })));
    clearTimeout(deadline); process.exit(code);
  }
}
async function sample(id) {
  const probeStarted = performance.now(), childrenAtStart = [...children];
  const usage = process.memoryUsage(), childValues = await Promise.all(childrenAtStart.map(childRss));
  const complete = childValues.every(value => value.rssBytes !== null);
  const rssBytes = usage.rss + childValues.reduce((sum, value) => sum + (value.rssBytes ?? 0), 0);
  const processProbes = { requested: childrenAtStart.length, replied: 0, exited: 0, timedOut: 0, ipcUnavailable: 0, ipcClosed: 0,
    deadlineMs: 15000, elapsedMs: performance.now() - probeStarted, maxReplyMs: 0 };
  for (const value of childValues) {
    const key = { replied: 'replied', exited: 'exited', 'timed-out': 'timedOut', 'ipc-unavailable': 'ipcUnavailable' }[value.outcome];
    processProbes[key]++; processProbes.maxReplyMs = Math.max(processProbes.maxReplyMs, value.elapsedMs);
    if (value.ipcClosed) processProbes.ipcClosed++;
  }
  send({ type: 'sample', id, elapsedMs: performance.now() - started, rssBytes, processCount: children.size + 1, complete,
    processProbes,
    main: pick(usage, ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']),
    mainCpu: process.cpuUsage(), mainGc: { ...gc }, mainFileHandles: structuredClone(io), startupTimingMs: startup(),
    mainEventLoop: { meanMs: Number.isFinite(lag.mean) ? lag.mean / 1e6 : null, maxMs: lag.max / 1e6, p99Ms: lag.percentile(99) / 1e6 } });
  if (!complete || rssBytes >= Number(process.env.RS3_ROUTES_RSS_LIMIT)) {
    send({ type: 'safety-stop', stage, reason: !complete ? 'probe-unavailable' : 'memory-limit', rssBytes, processCount: children.size + 1 });
    await stop(1);
  }
}
const memoryTimer = setInterval(() => {
  if (busy || closing) return; busy = true;
  void sample().catch(error => { send({ type: 'safety-stop', stage, reason: 'probe-unavailable', error: safeError(error) }); return stop(1); }).finally(() => { busy = false; });
}, 500);
process.on('message', message => {
  if (message?.type === 'sample') void sample(message.id).catch(error => send({ type: 'probe-error', id: message.id, stage, error: safeError(error) }));
  if (message?.type === 'stop') void stop();
});
process.once('disconnect', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  send({ type: 'stage', stage });
  const module = await import(pathToFileURL(process.env.RS3_ROUTES_ENTRY).href);
  send({ type: 'imports', elapsedMs: performance.now() - started });
  const scratch = process.env.RS3_ROUTES_SCRATCH;
  const options = { dataDir: scratch, host: '127.0.0.1', port: Number(process.env.RS3_ROUTES_PORT),
    publicOrigin: undefined, loopbackPort: undefined, predictionPrewarm: process.env.RS3_ROUTES_PREWARM === 'on',
    taskWorkerOptions: { idleMs: Number(process.env.RS3_ROUTES_IDLE_MS ?? 60000), startupDeadlineMs: 300000 }, shutdownDeadlineMs: 5000 };
  stage = 'listen'; send({ type: 'stage', stage });
  if (module.startServer) app = await module.startServer(options);
  else { app = await module.createServer(options); await app.listen(); }
  if (app.address()?.port !== options.port) throw new Error('Unexpected listener.');
  // Fixed registered GET paths are capabilities, never response data.
  const registered = Object.keys(module.routePermissions?.GET ?? {});
  send({ type: 'listening', elapsedMs: performance.now() - started,
    pluginRoutes: registered.filter(route => /^\/api\/plugin\/v1\/[a-z0-9/-]+$/.test(route)),
    syncRoutes: registered.filter(route => /^\/api\/[a-z0-9/-]*sync[a-z0-9/-]*\/status$/.test(route)) });
  stage = 'ready'; send({ type: 'stage', stage });
  readyApp = app.ready ? await app.ready : app;
  send({ type: 'ready', elapsedMs: performance.now() - started, startupTimingMs: startup() });
  stage = 'running'; send({ type: 'stage', stage });
} catch (error) { send({ type: 'error', stage, reason: 'app-error', error: safeError(error) }); await stop(1); }
