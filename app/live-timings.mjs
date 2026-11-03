import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const requests = new AsyncLocalStorage();
export const actions = Object.freeze(['tasks-full', 'tasks-play', 'tasks-duo', 'tasks-sidebar', 'tasks-inspection', 'preview-first', 'preview-partner', 'how', 'why', 'roll-pool', 'pool-ranking', 'chunk-planning', 'sandbox', 'command', 'state-full', 'state-play', 'calculator-wake', 'worker-start']);
const actionSet = new Set(actions);
const stages = new Set(['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'currentBiSMs', 'activityMs', 'predictionMs', 'deathMs', 'totalMs', 'sandboxInputMs', 'sandboxProjectionMs', 'sandboxDeltaMs', 'sandboxSerializationMs', 'preparationMs', 'rollPoolMs', 'howMs', 'areaCheckMs', 'sandboxValidationMs', 'sandboxPoolMs']);
const HOUR = 3600000, HOURS = 168, RECENT = 2048;
export const TIMING_FILE_CAP = 8 * 1024 * 1024;
const duration = value => Number.isFinite(value) ? Math.max(0, Math.min(86400000, value)) : 0;
const bucket = ms => Math.min(422, Math.ceil(Math.log1p(ms) / Math.log(1.05)));
const upper = index => Math.expm1(index * Math.log(1.05));
export function noteTiming(metadata) {
  const current = requests.getStore();
  if (!current || current.done) return;
  if (metadata.source === 'computed' || !current.source) current.source = metadata.source;
  current.coalesced ||= !!metadata.coalesced;
  current.calculatorStarted ||= !!metadata.calculatorStarted;
  if (metadata.timingMs && metadata.source !== 'cache') {
    for (const [key, value] of Object.entries(metadata.timingMs.stages ?? metadata.timingMs)) {
      if (stages.has(key) && Number.isFinite(value)) current.stages[key] = (current.stages[key] ?? 0) + duration(value);
    }
  }
}
function requestAction(request) {
  let url; try { url = new URL(request.url, 'http://localhost'); } catch { return; }
  const route = url.pathname.replace(/^\/api\/pickers\/[^/]+(?=\/)/, '/api');
  if (route === '/api/tasks') {
    if (url.searchParams.get('projection') === 'duo-inspection-v1') return 'tasks-inspection';
    if (url.searchParams.get('projection') === 'duo-sidebar-v1') return 'tasks-sidebar';
    if (url.searchParams.get('lane') === 'duo-v1') return 'tasks-duo';
    return url.searchParams.get('view') === 'play-v1' ? 'tasks-play' : 'tasks-full';
  }
  if (route === '/api/state') return url.searchParams.get('view') === 'play-v1' ? 'state-play' : 'state-full';
  return ({ '/api/predict': 'preview-first', '/api/task-how': 'how', '/api/task-why': 'why', '/api/pool-ranking': 'pool-ranking', '/api/chunk-planning': 'chunk-planning', '/api/sandbox/evaluate': 'sandbox', '/api/command': 'command' })[route];
}
export async function openLiveTimings(dataDir, { enabled = true, paused = false, now = Date.now, flushMs = 60000 } = {}) {
  const file = path.join(dataDir, 'live-timings.json');
  const hours = new Map(), recent = new Array(RECENT);
  let cursor = 0, size = 0, dirty = false, closing = false, writing = Promise.resolve(), writeFailures = 0;
  const hourNow = () => Math.floor(now() / HOUR);
  function prune() { const cutoff = hourNow() - HOURS + 1; for (const key of hours.keys()) if (key < cutoff || key > hourNow()) hours.delete(key); }
  function record(action, ms, metadata = {}, time = now()) {
    if (!enabled || paused || closing || !actionSet.has(action) || !Number.isFinite(ms) || !Number.isFinite(time)) return;
    const hour = Math.floor(time / HOUR);
    if (hour < hourNow() - HOURS + 1 || hour > hourNow()) return;
    if (!hours.has(hour)) prune();
    const event = { action, durationMs: Math.round(duration(ms) * 1000) / 1000, time,
      cached: metadata.source === 'cache', coalesced: !!metadata.coalesced, calculatorStarted: !!metadata.calculatorStarted,
      failed: !!metadata.failed, stages: {} };
    for (const [key, value] of Object.entries(metadata.source === 'cache' ? {} : metadata.stages ?? {})) if (stages.has(key) && Number.isFinite(value)) event.stages[key] = duration(value);
    let row = hours.get(hour); if (!row) hours.set(hour, row = {});
    const cell = row[action] ??= { count: 0, cached: 0, coalesced: 0, calculatorStarted: 0, failed: 0, max: 0, histogram: {}, stages: {} };
    cell.count++; for (const flag of ['cached', 'coalesced', 'calculatorStarted', 'failed']) cell[flag] += Number(event[flag]);
    cell.max = Math.max(cell.max, event.durationMs);
    const bin = bucket(event.durationMs); cell.histogram[bin] = (cell.histogram[bin] ?? 0) + 1;
    for (const [key, value] of Object.entries(event.stages)) { const stage = cell.stages[key] ??= { count: 0, totalMs: 0, maxMs: 0 }; stage.count++; stage.totalMs += value; stage.maxMs = Math.max(stage.maxMs, value); }
    recent[cursor] = event; cursor = (cursor + 1) % RECENT; size = Math.min(size + 1, RECENT); dirty = true;
  }
  function events() { return Array.from({ length: size }, (_, i) => recent[(cursor - size + i + RECENT) % RECENT]).filter(event => event.time >= now() - HOURS * HOUR && event.time <= now()); }
  // Parse bounded, untrusted local bytes into a closed numeric schema. Never
  // spread persisted objects back into output (including unknown keys).
  async function restore() {
  hours.clear(); recent.fill(undefined); cursor = 0; size = 0;
  try {
    if ((await stat(file)).size <= TIMING_FILE_CAP) {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version === 1 && Array.isArray(saved.hours)) for (const [hour, row] of saved.hours.slice(-HOURS)) {
        if (!Number.isInteger(hour) || hour < hourNow() - HOURS + 1 || hour > hourNow()) continue;
        const clean = {};
        for (const action of actions) {
          const value = row?.[action]; if (!value || !Number.isSafeInteger(value.count) || value.count < 0) continue;
          const cell = { count: value.count, max: duration(value.max), histogram: {}, stages: {} };
          for (const flag of ['cached', 'coalesced', 'calculatorStarted', 'failed']) cell[flag] = Math.min(cell.count, Math.max(0, Number.isSafeInteger(value[flag]) ? value[flag] : 0));
          for (let i = 0; i <= 422; i++) if (Number.isSafeInteger(value.histogram?.[i]) && value.histogram[i] > 0) cell.histogram[i] = value.histogram[i];
          for (const key of stages) if (value.stages?.[key]) cell.stages[key] = { count: Math.min(cell.count, Math.max(0, Number(value.stages[key].count) || 0)), totalMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(value.stages[key].totalMs) || 0)), maxMs: duration(value.stages[key].maxMs) };
          clean[action] = cell;
        }
        hours.set(hour, clean);
      }
      // Restore the bounded event ring without incrementing the summaries.
      if (Array.isArray(saved.recent)) for (const event of saved.recent.slice(-RECENT)) {
        if (!actionSet.has(event?.action) || !Number.isFinite(event.time) || event.time > now() || event.time < now() - HOURS * HOUR) continue;
        const clean = { action: event.action, time: event.time, durationMs: duration(event.durationMs), stages: {} };
        for (const flag of ['cached', 'coalesced', 'calculatorStarted', 'failed']) clean[flag] = event[flag] === true;
        for (const key of stages) if (Number.isFinite(event.stages?.[key])) clean.stages[key] = duration(event.stages[key]);
        recent[cursor] = clean; cursor = (cursor + 1) % RECENT; size++;
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') writeFailures++; }
  }
  await restore();
  function summary() {
    prune();
    const windows = {};
    for (const [name, span] of [['24h', 24], ['7d', HOURS]]) windows[name] = actions.map(action => {
      const cells = [...hours].filter(([hour]) => hour > hourNow() - span).map(([, row]) => row[action]).filter(Boolean);
      const row = { action, count: 0, cached: 0, coalesced: 0, calculatorStarted: 0, failed: 0, max: 0, stages: {} }, hist = {};
      for (const cell of cells) {
        for (const key of ['count', 'cached', 'coalesced', 'calculatorStarted', 'failed']) row[key] += cell[key];
        row.max = Math.max(row.max, cell.max);
        for (const [key, count] of Object.entries(cell.histogram)) hist[key] = (hist[key] ?? 0) + count;
        for (const [key, value] of Object.entries(cell.stages)) { const s = row.stages[key] ??= { count: 0, totalMs: 0, maxMs: 0 }; s.count += value.count; s.totalMs += value.totalMs; s.maxMs = Math.max(s.maxMs, value.maxMs); }
      }
      for (const percentile of [50, 90, 99]) { let count = 0; row[`p${percentile}`] = 0; for (const key of Object.keys(hist).map(Number).sort((a, b) => a - b)) { count += hist[key]; if (count >= Math.ceil(row.count * percentile / 100)) { row[`p${percentile}`] = Math.min(row.max, upper(key)); break; } } }
      row.cacheHitShare = row.count ? row.cached / row.count : 0; return row;
    });
    return { enabled: enabled && !paused, windows, slowest: events().filter(e => e.time >= now() - 24 * HOUR && e.time <= now()).sort((a, b) => b.durationMs - a.durationMs).slice(0, 20), recentCapacity: RECENT, hourCapacity: HOURS, writeFailures };
  }
  function flush({ allowPaused = false } = {}) {
    writing = writing.catch(() => {}).then(async () => {
      if (paused && !allowPaused || !dirty) return;
      prune();
      const retained = [...hours];
      let bytes = JSON.stringify({ version: 1, hours: retained, recent: events() });
      // At extreme volumes, retain the newest complete hourly summaries.
      while (Buffer.byteLength(bytes) > TIMING_FILE_CAP && retained.length) { retained.shift(); bytes = JSON.stringify({ version: 1, hours: retained, recent: events() }); }
      if (Buffer.byteLength(bytes) > TIMING_FILE_CAP) { writeFailures++; return; }
      dirty = false;
      try { await mkdir(dataDir, { recursive: true, mode: 0o700 }); await writeFile(`${file}.tmp`, bytes, { mode: 0o600 }); await rename(`${file}.tmp`, file); }
      catch { dirty = true; writeFailures++; }
    });
    return writing;
  }
  const timer = enabled ? setInterval(() => { void flush(); }, flushMs) : undefined; timer?.unref();
  return { record, summary, flush,
    async pause() { paused = true; await flush({ allowPaused: true }); },
    async resume() { if (paused) { await restore(); paused = false; } },
    request(request, response, operation) {
      const action = enabled && !paused && requestAction(request); if (!action) return operation();
      const start = performance.now(), current = { stages: {}, done: false };
      const finish = () => { if (current.done) return; current.done = true; response.off('finish', finish); response.off('close', finish); record(action, performance.now() - start, { ...current, failed: !response.writableFinished || response.statusCode >= 400 }); };
      response.once('finish', finish); response.once('close', finish);
      return requests.run(current, operation);
    },
    async close() { clearInterval(timer); await flush(); closing = true; },
  };
}
