#!/usr/bin/env node
// Read-only source; all commands run against disposable copied storage.
// Reports contain fixed pathnames, numeric observations and source hashes only.
import { fork, execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { afterOwnedChildrenStop } from './owned-cleanup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, '.local/server-routes'), TIMEOUT = 300000, RSS_LIMIT = 1450 * 1024 ** 2;
const EXCLUDED = new Set(['access-token', 'store.lock', 'store.lock.recovery', 'invites.json', 'feedback.json']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ERROR_CODES = new Set(['OBSERVER_FAILURE', 'CHILD_STARTUP_TIMEOUT', 'CHILD_SPAWN_FAILED', 'CHILD_EXIT',
  'CHILD_APP_ERROR', 'CHILD_MEMORY_LIMIT', 'CHILD_PROBE_UNAVAILABLE', 'SAMPLE_TIMEOUT', 'SAMPLE_UNAVAILABLE',
  'REQUEST_FAILED', 'REQUEST_TIMEOUT', 'RESPONSE_FAILED', 'RESPONSE_DECODE_FAILED', 'RESPONSE_BODY_LIMIT',
  'INVALID_STATE', 'FIRST_TASKS_FAILED', 'SAVE_FAILED', 'SOURCE_CHANGED', 'ENTRY_CHANGED', 'INTERRUPTED', 'CLEANUP_FAILED', 'EVENT_STREAM_TIMEOUT']);
const PHASES = new Set(['source-copy', 'source-check', 'scratch-token', 'cold-start', 'restart-start', 'spawn', 'startup', 'cleanup',
  'source-binding', 'initial-state', 'first-tasks', 'restart-first-tasks', 'warm', 'revalidate', 'static-first', 'static-revalidate',
  'history-page', 'status', 'sync-availability', 'sync-events', 'plugin-availability', 'warm-diagnostics', 'retirement-poll', 'idle-observation',
  'wake-tasks', 'wake-full-tasks', 'wake-diagnostics', 'first-save-note', 'repeated-save-note',
  'post-save-state', 'browser-history', 'history-detail', 'post-save-reference', 'second-member-tasks',
  'duo-sidebar-tasks', 'partner-lane-tasks', 'complete']);
const reportPathname = url => /^\/api\/history\/[^/]+$/.test(url.pathname) ? '/api/history/:revision' : url.pathname;
const STARTUP_PHASES = new Set(['modules-start', 'modules-loaded', 'early-listen', 'listen',
  'dataset:resolve', 'dataset:profile', 'dataset:data-pack', 'dataset:rules-pack', 'dataset:values', 'dataset:legacy-values',
  'dataset:rule-contract', 'dataset:digest', 'dataset:provider', 'create:start', 'create:dataset', 'create:storage',
  'create:browser-payload', 'create:inputs', 'create:definitions', 'create:world', 'create:worker', 'create:store', 'create:sidecars', 'create:handler']);
function stackLocations(error) {
  // Child IPC already contains location objects; independently validate them.
  const locations = Array.isArray(error?.locations) ? error.locations : String(error?.stack ?? '').split(/\r?\n/).slice(1, 81).flatMap(line => {
    const match = /[/\\]([A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.mjs):(\d+):(\d+)\)?$/.exec(line.trim());
    return match ? [{ file: match[1], line: Number(match[2]), column: Number(match[3]) }] : [];
  });
  return locations.filter(value => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.mjs$/.test(value?.file ?? '')
    && Number.isSafeInteger(value?.line) && value.line > 0 && Number.isSafeInteger(value?.column) && value.column > 0)
    .slice(0, 8).map(value => ({ file: value.file, line: value.line, column: value.column }));
}
const safeUnderlying = error => ({
  name: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error?.name) ? error.name : null,
  code: ['EADDRINUSE', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EMFILE', 'ENOMEM', 'ECONNREFUSED', 'ECONNRESET',
    'EPIPE', 'ETIMEDOUT', 'ERR_MODULE_NOT_FOUND', 'ERR_WORKER_OUT_OF_MEMORY', 'ERR_WORKER_INIT_FAILED',
    'ERR_INVALID_ARG_TYPE', 'PRIVATE_ADDON_INVALID'].includes(error?.code) ? error.code : null,
  locations: stackLocations(error),
});
function observerError(code, cause) {
  const error = new Error('Observer operation failed.');
  error.observerCode = ERROR_CODES.has(code) ? code : 'OBSERVER_FAILURE';
  error.safeUnderlying = safeUnderlying(cause);
  return error;
}
function failureEvidence(error, observation) {
  return { code: ERROR_CODES.has(error?.observerCode) ? error.observerCode : 'OBSERVER_FAILURE',
    error: error?.safeUnderlying ?? safeUnderlying(error), observation: error?.observation ?? observation ?? null };
}
const within = (base, target) => { const relative = path.relative(base, target); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const help = 'node scripts/perf/server-routes.mjs --source FROZEN_SCRUBBED_SAVE --entry SERVER.mjs --port 8950 --runs 3 --label before [--source-binding DATASET.json] [--prewarm off|on] [--idle-ms 60000] [--save-count 5] [--heap-mb 768] [--packs-dir DIR --pack-selection FILE] [--map-assets DIR] [--game-data DIR]\nRun through the shared with-heavy.ps1 wrapper. Defaults: runs 3, prewarm off, accelerated worker idle 60000ms, five note saves, unchanged V8 heap limit. Reports: .local/server-routes/. No browser or task-calculation microbenchmarks.';
const options = { runs: 3, prewarm: 'off', label: 'routes', 'idle-ms': 60000, 'save-count': 5 };
const invalidArguments = () => { console.error('Invalid observer arguments. Use --help.'); process.exit(1); };
if (process.argv.includes('--help')) { console.log(help); process.exit(0); }
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.slice(2), value = process.argv[i + 1];
  if (!['source', 'source-binding', 'entry', 'port', 'runs', 'label', 'prewarm', 'idle-ms', 'save-count', 'heap-mb', 'packs-dir', 'pack-selection', 'map-assets', 'game-data'].includes(key) || !value) invalidArguments();
  options[key] = ['port', 'runs', 'idle-ms', 'save-count', 'heap-mb'].includes(key) ? Number(value) : value;
}
if (!options.source || !options.entry || !Number.isInteger(options.port) || options.port < 8950 || options.port > 8959
  || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 20 || !/^[a-zA-Z0-9_-]{1,40}$/.test(options.label)
  || !Number.isInteger(options['idle-ms']) || options['idle-ms'] < 100 || options['idle-ms'] > 600000
  || !Number.isInteger(options['save-count']) || options['save-count'] < 1 || options['save-count'] > 30
  || options['heap-mb'] !== undefined && (!Number.isInteger(options['heap-mb']) || options['heap-mb'] < 128 || options['heap-mb'] > 1024)
  || !['off', 'on'].includes(options.prewarm)) invalidArguments();
async function assertHeavyOwnership() {
  const { RS3_HEAVY_LOCK_PATH: lock, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!lock || !token || !pid) throw new Error('Run through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(lock, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || owner.pid !== Number(pid)) throw new Error('Heavy-work ownership changed.');
}
async function rejectLinks(target) {
  let current = path.resolve(target);
  for (;;) { if ((await lstat(current)).isSymbolicLink()) throw new Error('Linked input paths are unsupported.'); const parent = path.dirname(current); if (parent === current) break; current = parent; }
}
function rejectSensitivePath(target) {
  if (/(?:^|[\\/])\.local[\\/]duo(?:[\\/]|$)|(?:^|[\\/])(?:private|rs3-private|chunk-picker-rs3-private)(?:[\\/]|$)/i.test(target)) throw new Error('Live/private input paths are forbidden.');
}
async function fingerprint(directory) {
  const digest = createHash('sha256'); let files = 0, bytes = 0;
  async function visit(base) {
    for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(base, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Linked sources are unsupported.');
      if (EXCLUDED.has(entry.name)) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) { const data = await readFile(file); digest.update(path.relative(directory, file)); digest.update(data); files++; bytes += data.length; }
      else throw new Error('Unsupported source file.');
    }
  }
  await visit(directory); return { sha256: digest.digest('hex'), files, bytes };
}
const numeric = (value, keys) => Object.fromEntries(keys.map(key => [key,
  typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : typeof value?.[key] === 'boolean' ? value[key] : null]));
const cacheKeys = ['hit', 'savedResult', 'worker', 'unlockPredictionHit', 'evaluationMs', 'requestMs', 'entries', 'bytes', 'compressedBytes'];
const timingKeys = ['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'currentBiSMs', 'activityMs', 'predictionMs', 'deathMs', 'totalMs', 'compileMs', 'startupMs'];
function diagnostics(value) {
  const lane = data => ({ worker: numeric(data?.worker, ['resident', 'retiring', 'idleStops', 'restarts', 'failures', 'compileMs', 'startupMs']),
    queue: numeric(data?.queue, ['active', 'depth']), cache: numeric(data?.cache, cacheKeys),
    counts: numeric(data?.counts, ['requested', 'coalesced', 'cacheHits', 'completed', 'errors', 'expired', 'cancelled', 'superseded', 'rejected', 'promoted', 'retired']),
    timingMs: numeric(data?.timingMs?.last, timingKeys) });
  return { foreground: lane(value), death: lane(value?.deathLane), duo: lane(value?.duoLane), prediction: lane(value?.predictionLane),
    idleGc: numeric(value?.idleGc, ['pending', 'collections', 'released', 'lastDurationMs', 'totalDurationMs']),
    responseCache: numeric(value?.responseCache, cacheKeys), staticCache: numeric(value?.staticCache, cacheKeys),
    referenceCache: numeric(value?.referenceCache, cacheKeys), viewerTaskCache: numeric(value?.viewerTaskCache, ['entries', 'playBytes', 'fullCompressedBytes']) };
}
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) try { child.send({ type: 'stop' }); } catch {}
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10000)]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
    else child.kill('SIGKILL');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]);
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Shutdown failed; scratch retained.');
}
const owned = new Set(); let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  void Promise.all([...owned].map(stopChild)).catch(() => { console.error('Owned child cleanup failed; scratch retained.'); process.exitCode = 1; });
});

// node:http retains compressed body octets; fetch transparently decompresses them.
function probeEvents(origin, token, observe) {
  return new Promise((resolve, reject) => {
    const started = performance.now(); let settled = false, response;
    const metric = { pathname: '/api/events', status: null, ttfbMs: null, firstChunkMs: null, firstChunkBytes: 0 };
    observe(metric, false, true);
    const finish = error => {
      if (settled) return; settled = true;
      clearTimeout(timer); observe(metric, !error);
      // Stop only this owned local stream. Never accumulate or parse SSE data.
      response?.destroy(); request.destroy();
      error ? reject(error) : resolve({ ...metric });
    };
    const request = httpRequest(new URL('/api/events', origin), { method: 'GET', agent: false,
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'Accept-Encoding': 'identity' } }, value => {
      response = value; metric.status = value.statusCode; metric.ttfbMs = performance.now() - started; observe(metric, false);
      value.once('data', chunk => { metric.firstChunkMs = performance.now() - started; metric.firstChunkBytes = chunk.length; finish(); });
      value.once('end', () => finish());
      value.once('error', error => finish(observerError('RESPONSE_FAILED', error)));
    });
    const timer = setTimeout(() => finish(observerError('EVENT_STREAM_TIMEOUT')), 10000);
    request.once('error', error => finish(observerError('REQUEST_FAILED', error)));
    request.end();
  });
}
function transport(origin, token, observe = () => {}) {
  return (route, { encoding = 'identity', etag, body, parse = false } = {}) => new Promise((resolve, reject) => {
    const started = performance.now(), payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const url = new URL(route, origin), view = url.searchParams.get('view');
    let metric = { pathname: reportPathname(url), representation: ['play-v1', 'display-v1', 'map-layers-v1'].includes(view) ? view : 'full',
      requestedEncoding: encoding, status: null, revalidation: Boolean(etag), ttfbMs: null, bodyMs: null, totalMs: null, wireBodyBytes: 0 };
    observe(metric, false, true);
    const req = httpRequest(new URL(route, origin), { method: payload ? 'POST' : 'GET', agent: false,
      headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': encoding,
        ...(etag ? { 'If-None-Match': etag } : {}), ...(payload ? { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, response => {
      const headersAt = performance.now(), chunks = []; let wireBodyBytes = 0;
      metric = { ...metric, status: response.statusCode, ttfbMs: headersAt - started }; observe(metric, false);
      response.on('data', chunk => { wireBodyBytes += chunk.length; if (wireBodyBytes > 128 * 1024 ** 2) req.destroy(observerError('RESPONSE_BODY_LIMIT')); else chunks.push(chunk); });
      response.once('error', error => { observe({ ...metric, totalMs: performance.now() - started, wireBodyBytes }, false); reject(observerError('RESPONSE_FAILED', error)); });
      response.once('end', () => {
        const ended = performance.now();
        try {
          const raw = Buffer.concat(chunks), coding = response.headers['content-encoding'];
          const decoded = !raw.length ? raw : coding === 'gzip' ? gunzipSync(raw, { maxOutputLength: 128 * 1024 ** 2 }) : coding === 'br' ? brotliDecompressSync(raw, { maxOutputLength: 128 * 1024 ** 2 }) : raw;
          metric = { pathname: reportPathname(url), representation: ['play-v1', 'display-v1', 'map-layers-v1'].includes(view) ? view : 'full', status: response.statusCode, requestedEncoding: encoding,
            contentEncoding: ['gzip', 'br', 'identity'].includes(coding) ? coding : coding ? 'other' : 'identity',
            revalidation: Boolean(etag), etagAvailable: typeof response.headers.etag === 'string', ttfbMs: headersAt - started, bodyMs: ended - headersAt, totalMs: ended - started,
            wireBodyBytes, decodedBodyBytes: decoded.length, contentLength: /^\d+$/.test(response.headers['content-length'] ?? '') ? Number(response.headers['content-length']) : null };
          observe(metric, true);
          resolve({ metric,
            etag: response.headers.etag, data: parse && decoded.length ? JSON.parse(decoded.toString('utf8')) : undefined });
        } catch (error) { observe({ ...metric, totalMs: ended - started, bodyMs: ended - headersAt, wireBodyBytes }, false); reject(observerError('RESPONSE_DECODE_FAILED', error)); }
      });
    });
    req.setTimeout(TIMEOUT, () => req.destroy(observerError('REQUEST_TIMEOUT')));
    req.once('error', error => {
      observe({ ...metric, totalMs: performance.now() - started }, false);
      reject(ERROR_CODES.has(error?.observerCode) ? error : observerError('REQUEST_FAILED', error));
    });
    req.end(payload);
  });
}
async function start(dataDir, token, mode = 'cold') {
  await assertHeavyOwnership();
  if (interrupted) throw observerError('INTERRUPTED');
  // Only explicit observer inputs may select app storage, packs or assets.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^RS3_|^NODE_OPTIONS$|^NODE_PATH$/.test(key)));
  Object.assign(env, { RS3_ROUTES_SCRATCH: dataDir, RS3_DATA_DIR: dataDir, RS3_ROUTES_ENTRY: options.entry,
    RS3_ROUTES_PORT: String(options.port), RS3_ROUTES_PREWARM: options.prewarm,
    RS3_WORKER_IDLE_MS: String(options['idle-ms']), RS3_ROUTES_IDLE_MS: String(options['idle-ms']),
    RS3_STARTUP_TIMING_LOG: path.join(dataDir, 'observer-startup.ndjson'),
    RS3_ROUTES_RSS_LIMIT: String(RSS_LIMIT), RS3_PACKS_DIR: options['packs-dir'] ?? path.join(dataDir, 'observer-packs'),
    RS3_GAME_DATA_DIR: options['game-data'] ?? path.join(dataDir, 'observer-game-data'),
    RS3_MAP_ASSETS_DIR: options['map-assets'] ?? path.join(dataDir, 'observer-map-assets') });
  if (options['pack-selection']) env.RS3_PACK_SELECTION = options['pack-selection'];
  if (process.env.RS3_DATASET) env.RS3_DATASET = process.env.RS3_DATASET;
  if (options['heap-mb'] !== undefined) env.NODE_OPTIONS = `--max-old-space-size=${options['heap-mb']}`;
  const spawned = performance.now(), child = fork(path.join(ROOT, 'scripts/perf/server-routes-child.mjs'), [],
    { cwd: ROOT, env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  owned.add(child); child.once('exit', () => owned.delete(child));
  const milestones = {}, samples = [], startupMemory = [], observation = { mode, phase: 'startup', childStage: null, safetyStop: null,
    childError: null, exitCode: null, peakRssBytes: 0, lastRssBytes: null, maxProcessCount: 0, lastProcessCount: null,
    sampleCount: 0, requestCount: 0, completedRequestCount: 0, lastRequest: null, lastProcessProbes: null };
  let pluginRoutes = [], syncRoutes = [], sequence = 0, failed = false, fatal;
  const snapshot = () => ({ ...observation, milestones: structuredClone(milestones), startupMemory: structuredClone(startupMemory), elapsedMs: performance.now() - spawned });
  const setPhase = phase => { observation.phase = PHASES.has(phase) ? phase : 'startup'; };
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(observerError('CHILD_STARTUP_TIMEOUT')), TIMEOUT);
  child.once('error', error => { failed = true; fatal ??= observerError('CHILD_SPAWN_FAILED', error); readyReject(fatal); });
  child.once('exit', code => {
    failed = true; observation.exitCode = Number.isInteger(code) ? code : null; fatal ??= observerError('CHILD_EXIT');
    readyReject(fatal); for (const item of pending.values()) item.reject(fatal); pending.clear();
  });
  child.on('message', message => {
    if (message?.type === 'startup-checkpoint' && STARTUP_PHASES.has(message.phase) && Number.isFinite(message.elapsedMs)) {
      startupMemory.push({ phase: message.phase, childMs: message.elapsedMs, fromSpawnMs: performance.now() - spawned,
        main: numeric(message.main, ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) });
    }
    if (['imports', 'listening', 'ready'].includes(message?.type)) milestones[message.type] = { childMs: message.elapsedMs, fromSpawnMs: performance.now() - spawned };
    if (message?.type === 'listening') { pluginRoutes = message.pluginRoutes; syncRoutes = message.syncRoutes; }
    if (message?.type === 'ready') { clearTimeout(timer); milestones.startupTimingMs = message.startupTimingMs; readyResolve(); }
    if (['import', 'listen', 'ready', 'running'].includes(message?.stage)) observation.childStage = message.stage;
    if (['error', 'safety-stop'].includes(message?.type)) {
      failed = true;
      observation.safetyStop = ['memory-limit', 'probe-unavailable', 'app-error'].includes(message.reason) ? message.reason : null;
      observation.childError = safeUnderlying(message.error);
      if (Number.isFinite(message.rssBytes)) {
        observation.lastRssBytes = message.rssBytes; observation.peakRssBytes = Math.max(observation.peakRssBytes, message.rssBytes);
      }
      if (Number.isInteger(message.processCount)) {
        observation.lastProcessCount = message.processCount; observation.maxProcessCount = Math.max(observation.maxProcessCount, message.processCount);
      }
      const code = message.reason === 'memory-limit' ? 'CHILD_MEMORY_LIMIT' : message.reason === 'probe-unavailable' ? 'CHILD_PROBE_UNAVAILABLE' : 'CHILD_APP_ERROR';
      fatal ??= observerError(code); readyReject(fatal);
      for (const item of pending.values()) item.reject(fatal); pending.clear();
    }
    if (message?.type === 'probe-error' && pending.has(message.id)) {
      observation.childError = safeUnderlying(message.error);
      pending.get(message.id).reject(observerError('SAMPLE_UNAVAILABLE')); pending.delete(message.id);
    }
    if (message?.type === 'sample') {
      samples.push(message); if (pending.has(message.id)) { pending.get(message.id).resolve(message); pending.delete(message.id); }
      observation.sampleCount++;
      observation.lastRssBytes = Number.isFinite(message.rssBytes) ? message.rssBytes : null;
      observation.peakRssBytes = Math.max(observation.peakRssBytes, observation.lastRssBytes ?? 0);
      observation.lastProcessCount = Number.isInteger(message.processCount) ? message.processCount : null;
      observation.maxProcessCount = Math.max(observation.maxProcessCount, observation.lastProcessCount ?? 0);
      observation.lastProcessProbes = numeric(message.processProbes, ['requested', 'replied', 'exited', 'timedOut', 'ipcUnavailable', 'ipcClosed', 'deadlineMs', 'elapsedMs', 'maxReplyMs']);
      observation.maxProcessCount = Math.max(observation.maxProcessCount, (observation.lastProcessProbes.requested ?? 0) + 1);
    }
  });
  try { await ready; } catch (error) {
    clearTimeout(timer); error.observation = snapshot();
    // A rejected start never assigns the caller's active handle.
    error.ownedObserverChild = child;
    try { await stopChild(child); } catch { error.observation.cleanupFailed = true; }
    throw error;
  }
  const sample = () => new Promise((resolve, reject) => {
    if (failed) { reject(fatal ?? observerError('SAMPLE_UNAVAILABLE')); return; }
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(observerError('SAMPLE_TIMEOUT')); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    try { child.send({ type: 'sample', id }); } catch (error) { clearTimeout(timeout); pending.delete(id); reject(observerError('SAMPLE_UNAVAILABLE', error)); }
  });
  const observeRequest = (metric, complete, starting = false) => {
    observation.lastRequest = { ...metric }; if (starting) observation.requestCount++;
    if (complete) observation.completedRequestCount++;
  };
  const origin = `http://127.0.0.1:${options.port}`, request = transport(origin, token, observeRequest);
  return { child, milestones, samples, startupMemory, pluginRoutes, syncRoutes, spawned, sample, snapshot, setPhase,
    events: () => failed ? Promise.reject(fatal ?? observerError('CHILD_EXIT')) : probeEvents(origin, token, observeRequest),
    request: (...args) => failed ? Promise.reject(fatal ?? observerError('CHILD_EXIT')) : request(...args) };
}
async function exercise(server, restart = false) {
  const rows = [], read = async (phase, route, config = {}) => {
    server.setPhase(phase);
    const isTasks = route.split('?')[0] === '/api/tasks';
    const result = await server.request(route, { ...config, ...(isTasks ? { parse: true } : {}) });
    rows.push({ phase, ...result.metric, ...(isTasks ? { cache: numeric(result.data?.cache, cacheKeys), timingMs: numeric(result.data?.cache?.timingMs, timingKeys) } : {}) });
    return result;
  };
  server.rows = rows;
  let state = (await read('initial-state', '/api/state?view=play-v1', { parse: true })).data?.state;
  if (!state?.members?.length) throw observerError('INVALID_STATE');
  const member = state.members[0], tasks = `/api/tasks?memberId=${encodeURIComponent(member.id)}&view=play-v1`;
  const first = await read(restart ? 'restart-first-tasks' : 'first-tasks', tasks, { parse: true });
  const firstTasksFromSpawnMs = performance.now() - server.spawned;
  if (first.metric.status !== 200) throw observerError('FIRST_TASKS_FAILED');
  if (restart) return { rows, firstTasksFromSpawnMs, cache: numeric(first.data?.cache, cacheKeys), sample: await server.sample() };
  for (const encoding of ['identity', 'gzip', 'br']) {
    for (const route of [tasks, '/api/state?view=play-v1', '/api/state']) {
      const warm = await read('warm', route, { encoding });
      await read('revalidate', route, { encoding, etag: warm.etag });
    }
  }
  const staticRoutes = ['/api/definitions?view=display-v1', '/api/definitions?view=map-layers-v1', '/api/rules', '/api/display-world', '/api/task-map',
    '/api/dataset-status', '/api/map-info', '/api/npcs-and-shops', '/api/archaeology-catalogue',
    '/api/training-catalogue', '/api/house-storage-catalogue', '/api/skill-guide-catalogue', '/api/interior-maps',
    '/api/helper-progress', '/api/art-status', '/api/backup-status', '/', '/style.css', '/main.mjs', '/screen-startup.mjs', '/map.mjs'];
  // These handlers only read the selected public dataset and isolated store.
  // Exclude fetch/import/sync previews and dynamic helper-drop calculations.
  for (const route of staticRoutes) for (const encoding of ['identity', 'gzip', 'br']) {
    const response = await read('static-first', route, { encoding });
    await read('static-revalidate', route, { encoding, etag: response.etag });
  }
  let before, historyPages = 0, historyItems = 0, historyHasMore = false;
  for (let page = 0; page < 3; page++) {
    const response = await read('history-page', `/api/history?limit=25${before === undefined ? '' : `&before=${before}`}`, { parse: true });
    historyPages++; historyItems += response.data?.history?.length ?? 0; historyHasMore = response.data?.hasMore === true;
    if (!Number.isSafeInteger(response.data?.nextBefore)) break; before = response.data.nextBefore;
  }
  for (const route of ['/api/session', '/api/coordination', ...server.syncRoutes, ...server.pluginRoutes]) await read('status', route);
  for (const route of [`/api/pool-ranking?memberId=${encodeURIComponent(member.id)}`,
    `/api/backlog-search?memberId=${encodeURIComponent(member.id)}`, `/api/xp-choices?memberId=${encodeURIComponent(member.id)}`,
    `/api/roll-stats?stateRevision=${state.revision}`]) await read('status', route);
  server.setPhase('sync-events');
  const sharedSaveEvents = await server.events(); rows.push({ phase: 'sync-events', ...sharedSaveEvents });
  // This optional pathname is not the shared-save SSE protocol. Its 404 does
  // not establish whether provider-gated outbound original-picker sync exists.
  const syncProbe = server.syncRoutes.length ? null : await read('sync-availability', '/api/original-sync/status');
  const pluginProbe = server.pluginRoutes.length ? null : await read('plugin-availability', '/api/plugin/v1/status');
  const warmDiagnostic = (await read('warm-diagnostics', '/api/diagnostics', { parse: true })).data;
  const warmMemory = await server.sample(), idleStart = performance.now();
  const retired = value => [value, value?.deathLane, value?.duoLane, value?.predictionLane].filter(Boolean)
    .every(lane => (lane.worker?.resident === false || ['idle', 'not-configured'].includes(lane.worker?.status))
      && !lane.worker?.retiring && !lane.queue?.active && !lane.queue?.depth);
  let idleDiagnostic;
  server.setPhase('retirement-poll');
  do {
    await pause(500);
    idleDiagnostic = (await server.request('/api/diagnostics', { parse: true })).data;
  } while (!retired(idleDiagnostic) && performance.now() - idleStart < options['idle-ms'] + 20000);
  const retirementWaitMs = performance.now() - idleStart;
  const idleBefore = await server.sample(), idleObservedAt = performance.now();
  server.setPhase('idle-observation');
  // Measure a quiet interval after retirement, separately from the HTTP polls
  // used to establish it. Only the periodic IPC memory observer remains active.
  await pause(2000);
  const idleMemory = await server.sample(), idleElapsedMs = performance.now() - idleObservedAt;
  await read('wake-tasks', tasks);
  // Full task details have not been requested earlier. A compact saved response
  // can survive retirement; this ordinary details request demonstrates real wake
  // when no retained full response exists, without restarting healthy workers.
  const wakeFull = await read('wake-full-tasks', `/api/tasks?memberId=${encodeURIComponent(member.id)}`, { encoding: 'gzip' });
  const wakeDiagnostic = (await read('wake-diagnostics', '/api/diagnostics', { parse: true })).data;
  // Use an existing whole chunk; note writes deliberately avoid task calculation.
  state = (await server.request('/api/state?view=play-v1', { parse: true })).data?.state;
  const chunkId = state?.members?.[0]?.unlocked?.map(String).find(value => /^[1-9]\d*$/.test(value));
  const saves = [], healthBaseline = (await server.request('/api/health')).metric;
  const ioDelta = (before, after) => Object.fromEntries(['state', 'backup', 'static', 'other'].map(kind => [kind,
    Object.fromEntries(['writeFileCount', 'writeFileMs', 'syncCount', 'syncMs'].map(key => [key,
      Math.max(0, (after?.[kind]?.[key] ?? 0) - (before?.[kind]?.[key] ?? 0))]))]));
  if (chunkId) {
    const encodings = ['identity', 'gzip', 'br', 'gzip, deflate, br, zstd'];
    for (let index = 0; index < options['save-count']; index++) {
      const beforeMemory = await server.sample(), health = [], saveStarted = performance.now();
      let saving = true, due = saveStarted, lastStart = null, save;
      const loop = (async () => {
        do {
          const actualStart = performance.now(), previousStart = lastStart; lastStart = actualStart;
          const result = await server.request('/api/health');
          health.push({ ...result.metric, phase: 'during-save', startMs: actualStart - saveStarted,
            schedulingDelayMs: Math.max(0, actualStart - due), gapMs: previousStart === null ? null : actualStart - previousStart });
          due = actualStart + 10;
          if (saving) await pause(Math.max(0, due - performance.now()));
        } while (saving);
      })();
      // Attach immediately: a failed probe must not become an unhandled rejection
      // while a slow save is still in progress.
      const healthPending = loop.then(() => true, () => false);
      try { save = await read(index === 0 ? 'first-save-note' : 'repeated-save-note', '/api/command?view=play-v1',
        { encoding: encodings[Math.min(index, encodings.length - 1)], parse: true, body: { expectedRevision: state.revision,
          command: { type: 'set-note', memberId: member.id, chunkId, note: `observer scratch note ${index + 1}` } } }); }
      finally { saving = false; await healthPending; }
      const afterSaveMs = performance.now() - saveStarted, tailStarted = performance.now();
      health.push({ ...(await server.request('/api/health')).metric, phase: 'after-save', startMs: tailStarted - saveStarted,
        schedulingDelayMs: 0, gapMs: lastStart === null ? null : tailStarted - lastStart });
      const afterMemory = await server.sample();
      saves.push({ index, first: index === 0, ...save.metric, completionWithHealthProbeMs: afterSaveMs,
        healthPollMs: 10, healthComplete: await healthPending, healthSamples: health,
        maxHealthMs: Math.max(...health.map(row => row.totalMs)),
        maxPollSchedulingDelayMs: Math.max(...health.map(row => row.schedulingDelayMs)),
        mainFileHandles: ioDelta(beforeMemory.mainFileHandles, afterMemory.mainFileHandles),
        mainGc: { count: Math.max(0, afterMemory.mainGc.count - beforeMemory.mainGc.count),
          totalMs: Math.max(0, afterMemory.mainGc.totalMs - beforeMemory.mainGc.totalMs) } });
      if (save.metric.status !== 200 || !Number.isSafeInteger(save.data?.state?.revision)) throw observerError('SAVE_FAILED');
      state = { revision: save.data.state.revision };
    }
  }
  // These additional ordinary client reads follow every measured note save.
  // Keep source values only long enough to build valid scratch-store requests.
  const postSaveState = (await read('post-save-state', '/api/state?view=play-v1', { encoding: 'gzip', parse: true })).data?.state;
  if (!postSaveState?.members?.length || !Number.isSafeInteger(postSaveState.revision)) throw observerError('INVALID_STATE');
  const currentMember = postSaveState.members[0], partner = postSaveState.members[1], revision = postSaveState.revision;
  const browserHistory = await read('browser-history', `/api/history?limit=150&stateRevision=${revision}`, { encoding: 'gzip', parse: true });
  const detailRevision = browserHistory.data?.history?.find(event => Number.isSafeInteger(event?.revision))?.revision;
  if (Number.isSafeInteger(detailRevision)) await read('history-detail', `/api/history/${detailRevision}?stateRevision=${revision}`, { encoding: 'gzip' });
  const referenceReads = ['/api/definitions', `/api/teleports?member=${encodeURIComponent(currentMember.id)}`,
    '/api/members-start', '/api/changelog', '/api/roadmap', '/api/backups', '/api/backup?download=gzip'];
  const existingChunk = currentMember.unlocked?.map(String).find(value => /^[1-9]\d*$/.test(value));
  if (existingChunk) referenceReads.push(`/api/chunk-sections?chunk=${encodeURIComponent(existingChunk)}`);
  for (const route of referenceReads) await read('post-save-reference', route, { encoding: 'gzip' });
  if (partner) {
    await read('second-member-tasks', `/api/tasks?memberId=${encodeURIComponent(partner.id)}&view=play-v1`, { encoding: 'gzip' });
    await read('duo-sidebar-tasks', `/api/tasks?memberId=${encodeURIComponent(currentMember.id)}&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`, { encoding: 'gzip' });
    await read('partner-lane-tasks', `/api/tasks?memberId=${encodeURIComponent(partner.id)}&view=play-v1&lane=duo-v1&peerFor=${encodeURIComponent(currentMember.id)}&revision=${revision}`, { encoding: 'gzip' });
  }
  const finalMemory = await server.sample();
  return { rows, firstTasksFromSpawnMs, cache: numeric(first.data?.cache, cacheKeys), firstTaskTimingMs: numeric(first.data?.cache?.timingMs, timingKeys),
    history: { pages: historyPages, items: historyItems, hasMore: historyHasMore },
    plugin: { registeredGetRoutes: server.pluginRoutes.length, probeStatus: pluginProbe?.metric.status ?? null, absent: server.pluginRoutes.length === 0 && pluginProbe?.metric.status === 404 },
    sync: { sharedSaveEvents, stateReadsMeasured: true, registeredStatusRoutes: server.syncRoutes.length,
      originalStatusProbe: syncProbe?.metric.status ?? null, originalSyncFeatureAvailable: null, originalSyncOutboundPostMeasured: false },
    warmDiagnostic: diagnostics(warmDiagnostic), idleDiagnostic: diagnostics(idleDiagnostic), wakeDiagnostic: diagnostics(wakeDiagnostic),
    retirement: { acceleratedIdleMs: options['idle-ms'], waitMs: retirementWaitMs, predictionPrewarm: options.prewarm,
      observed: retired(idleDiagnostic), wakeResident: wakeDiagnostic?.worker?.resident === true,
      fullRequestUsedWorker: wakeFull.data?.cache?.worker ?? null, fullRequestSavedResult: wakeFull.data?.cache?.savedResult ?? null },
    warmMemory, idleMemory, finalMemory,
    idleMainCpu: { elapsedMs: idleElapsedMs, observedRetired: retired(idleDiagnostic),
      userMicros: idleMemory.mainCpu.user - idleBefore.mainCpu.user,
      systemMicros: idleMemory.mainCpu.system - idleBefore.mainCpu.system },
    save: { attempted: Boolean(chunkId), requestedCount: options['save-count'], healthBaseline, samples: saves } };
}
async function repetition() {
  const directory = await mkdtemp(path.join(OUTPUT, 'scratch-')), dataDir = path.join(directory, 'store');
  const token = randomBytes(32).toString('base64url'); let active, failedStartChild, phase = 'source-copy', failure, completedCold;
  try {
    await cp(options.source, dataDir, { recursive: true, dereference: false, filter: file => !EXCLUDED.has(path.basename(file)) });
    phase = 'source-check';
    if ((await fingerprint(dataDir)).sha256 !== frozen.sha256 || (await fingerprint(options.source)).sha256 !== frozen.sha256) throw observerError('SOURCE_CHANGED');
    if (sourceBindingBytes) {
      phase = 'source-binding';
      if (hash(await readFile(options['source-binding'])) !== sourceBinding.sha256) throw observerError('SOURCE_CHANGED');
      await writeFile(`${dataDir}.dataset.json`, sourceBindingBytes, { flag: 'wx' });
    }
    phase = 'scratch-token';
    await writeFile(path.join(dataDir, 'access-token'), `${token}\n`, { mode: 0o600 });
    phase = 'cold-start'; active = await start(dataDir, token, 'cold'); const coldServer = active, cold = await exercise(active);
    completedCold = { milestones: coldServer.milestones, startupMemory: coldServer.startupMemory, ...cold };
    await stopChild(active.child); active = null;
    await assertHeavyOwnership();
    phase = 'restart-start'; active = await start(dataDir, token, 'restart'); const restartServer = active, restarted = await exercise(active, true);
    await stopChild(active.child); active = null;
    const sampleSummary = server => ({ peakRssBytes: Math.max(0, ...server.samples.map(row => row.rssBytes)),
      sampleCount: server.samples.length, complete: server.samples.every(row => row.complete),
      maxProcessCount: Math.max(0, ...server.samples.map(row => Math.max(row.processCount ?? 0, (row.processProbes?.requested ?? 0) + 1))) });
    return { cold: { milestones: coldServer.milestones, startupMemory: coldServer.startupMemory, ...cold, memory: sampleSummary(coldServer) },
      restart: { milestones: restartServer.milestones, startupMemory: restartServer.startupMemory, ...restarted, memory: sampleSummary(restartServer) } };
  } catch (error) {
    failure = error;
    failedStartChild = error.ownedObserverChild;
    error.observation ??= active ? { ...active.snapshot(), completedRequests: active.rows ?? [] } : { phase };
    if (completedCold) error.completedCold = completedCold;
    throw error;
  } finally {
    try {
      await afterOwnedChildrenStop([active?.child, failedStartChild], stopChild, async () => {
        const resolved = await realpath(directory);
        if (!within(await realpath(OUTPUT), resolved) || !path.basename(resolved).startsWith('scratch-')) throw observerError('CLEANUP_FAILED');
        await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      });
      if ((await fingerprint(options.source)).sha256 !== frozen.sha256) throw observerError('SOURCE_CHANGED');
      if (sourceBinding && hash(await readFile(options['source-binding'])) !== sourceBinding.sha256) throw observerError('SOURCE_CHANGED');
    } catch (error) {
      if (failure) failure.observation.cleanup = failureEvidence(error, { phase: 'cleanup' });
      else { error.observation ??= { phase: 'cleanup' }; throw error; }
    }
  }
}

let frozen, reportPath, sourceBindingBytes, sourceBinding = null;
try {
  await assertHeavyOwnership();
  // The shared wrapper may explicitly select the public read-only asset caches.
  options['game-data'] ??= process.env.RS3_GAME_DATA_DIR;
  options['map-assets'] ??= process.env.RS3_MAP_ASSETS_DIR;
  for (const key of ['source', 'source-binding', 'entry', 'packs-dir', 'pack-selection', 'map-assets', 'game-data']) {
    if (!options[key]) continue;
    options[key] = path.resolve(options[key]); rejectSensitivePath(options[key]); await rejectLinks(options[key]); options[key] = await realpath(options[key]);
  }
  if (!within(ROOT, options.source) || !/(?:^|[\\/])\.local[\\/]/.test(options.source)) throw new Error('Frozen source must be under this worktree ignored .local directory.');
  if (options['source-binding']) {
    if (!within(ROOT, options['source-binding']) || !/(?:^|[\\/])\.local[\\/]/.test(options['source-binding'])
      || !(await lstat(options['source-binding'])).isFile() || (await lstat(options['source-binding'])).size > 65536) throw new Error('Use an explicit local dataset binding receipt.');
    sourceBindingBytes = await readFile(options['source-binding']);
    if (sourceBindingBytes.length > 65536) throw new Error('Use a bounded dataset binding receipt.');
    sourceBinding = { sha256: hash(sourceBindingBytes), bytes: sourceBindingBytes.length };
  }
  if (!options.entry.endsWith('.mjs')) throw new Error('Entry must be a server module.');
  // Source metadata stays untouched and unread. fingerprint() and cp() both
  // exclude credentials, locks, invites and feedback; scratch gets a new token.
  frozen = await fingerprint(options.source);
  await readFile(path.join(options.source, 'state.json')); // Explicit save, never a default live path.
  await mkdir(OUTPUT, { recursive: true }); await rejectLinks(OUTPUT);
  const entryHash = hash(await readFile(options.entry));
  const appSource = path.basename(path.dirname(options.entry)) === 'app' ? await fingerprint(path.dirname(options.entry)) : null;
  const report = { schemaVersion: 1, node: process.version, platform: process.platform, source: frozen, sourceBinding,
    observer: { parentSha256: hash(await readFile(fileURLToPath(import.meta.url))),
      cleanupSha256: hash(await readFile(new URL('./owned-cleanup.mjs', import.meta.url))),
      childSha256: hash(await readFile(new URL('./server-routes-child.mjs', import.meta.url))) },
    entry: { basename: path.basename(options.entry), sha256: entryHash, appSource },
    settings: { port: options.port, runs: options.runs, predictionPrewarm: options.prewarm, acceleratedIdleMs: options['idle-ms'], saveCount: options['save-count'], rssLimitBytes: RSS_LIMIT,
      startupMemoryCheckpoints: true, maxOldSpaceMiB: options['heap-mb'] ?? null, sourceBindingSha256: sourceBinding?.sha256 ?? null,
      explicitPacks: Boolean(options['packs-dir']), explicitPackSelection: Boolean(options['pack-selection']), explicitAssets: Boolean(options['map-assets']), explicitGameData: Boolean(options['game-data']) },
    limits: ['Real scheduler clocks with explicitly accelerated worker retirement (default 60000ms; production default 600000ms); prewarm setting is explicit.', 'TTFB ends at response headers; wireBodyBytes excludes HTTP framing and headers.',
      'RSS sampled every 500ms; transient peaks can exceed the sampled limit.', 'CPU, GC and event loop observations cover server main isolate only; RSS includes forked task hosts and shared worker threads.',
      'Tasks measure HTTP delivery; this harness does not attribute task calculation internals.', 'History pagination stops after three pages or exhaustion.',
      'Only registered fixed GET plugin paths are probed; parameterized and write plugin APIs are excluded.', 'Idle CPU covers a separate two-second quiet interval with periodic IPC memory sampling; no forced GC.',
      'Shared-save sync covers state reads and SSE connection/first chunk only; the owned stream closes immediately. Later cross-client revision delivery is not measured.',
      'Original-picker sync POST preview/apply and external fetches are deliberately unmeasured; a missing optional status GET leaves feature availability unknown.',
      'FileHandle writeFile/sync counters cover main-process calls opened after observer installation; durations include asynchronous I/O wait and observer overhead.',
      'Startup memory checkpoints observe existing whitelisted phases in the server main process; worker-host startup log writes stay numeric and inside scratch storage.',
      'First save is cold for command delivery after route sampling and wake; later saves share that process and rotate fixed response Accept-Encoding headers.',
      'Health request duration and polling scheduling delay are separate; parent decoding and JSON parsing can delay polling.'],
    runs: [] };
  reportPath = path.join(OUTPUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.label}.json`);
  try {
    for (let run = 0; run < options.runs; run++) {
      console.log(`Server route observer repetition ${run + 1}/${options.runs}`);
      await assertHeavyOwnership(); report.runs.push(await repetition());
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
    if (hash(await readFile(options.entry)) !== entryHash
      || appSource && (await fingerprint(path.dirname(options.entry))).sha256 !== appSource.sha256) throw observerError('ENTRY_CHANGED');
    report.complete = true;
  } catch (error) {
    report.complete = false;
    report.failedRun = { index: report.runs.length, ...failureEvidence(error, { phase: 'source-copy' }), ...(error.completedCold ? { completedCold: error.completedCold } : {}) };
    throw error;
  }
  finally { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
  console.log(`Numeric report: .local/server-routes/${path.basename(reportPath)}`);
} catch (error) {
  console.error('Server route observer stopped. Check explicit frozen inputs, shared heavy ownership, route compatibility and memory limit.');
  console.error(`Failure code: ${failureEvidence(error).code}`);
  if (reportPath) console.error(`Completed evidence: .local/server-routes/${path.basename(reportPath)}`);
  process.exitCode = 1;
} finally {
  try { await Promise.all([...owned].map(stopChild)); }
  catch { console.error('Owned child cleanup failed; scratch retained.'); process.exitCode = 1; }
}
