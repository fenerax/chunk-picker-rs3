import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROBE_CHANNEL } from './worker-memory-probe.mjs';

// Synthetic-save memory and unlock-latency trial. Run with the worker probe:
//   node --expose-gc --import ./scripts/perf/worker-memory-probe.mjs scripts/perf/server-memory.mjs \
//     [--app-dir <copy from scale-server.mjs>] [--mode process|thread] [--out report.json] [--snapshots dir]
// Fresh temporary storage, port 0 and no response bodies or invitations logged.
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) =>
  index % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), all[index + 1]]], []));
const mode = args.mode ?? 'process';
if (!['process', 'thread'].includes(mode)) throw new TypeError('Use --mode process or --mode thread.');
const port = Number(args.port ?? 0);
if (!Number.isInteger(port) || port !== 0 && (port < 8900 || port > 8999)) throw new TypeError('Use port 0 or 8900–8999.');
process.env.RS3_DATASET = 'open-f2p';
process.env.RS3_TASK_WORKER_MODE = mode;
// Lanes must outlive a full-scale Preview (sleep clears prepared results), yet
// still sleep within the trial so the idle collection can be measured.
process.env.RS3_WORKER_IDLE_MS ??= '120000';
process.env.RS3_WORKER_MEMORY_PROBE_IMPORT ??= new URL('./worker-memory-probe.mjs', import.meta.url).href;
for (const key of ['RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION']) delete process.env[key];
const appDir = path.resolve(args['app-dir'] ?? new URL('../../app', import.meta.url).pathname);
const appModule = name => import(pathToFileURL(path.join(appDir, name)).href);
const mib = bytes => Math.round(bytes / 1024 ** 2 * 10) / 10;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const { ProcessWorker } = await appModule('tasks/process-worker.mjs');
const processWorkers = new Set();
const originalOn = ProcessWorker.prototype.on;
ProcessWorker.prototype.on = function(...values) { processWorkers.add(this); return originalOn.apply(this, values); };
const { createServer } = await appModule('server.mjs');

const channel = new BroadcastChannel(PROBE_CHANNEL);
let requestId = 0;
function broadcast(message, waitMs = 1500) {
  const request = ++requestId, replies = [];
  return new Promise(resolve => {
    channel.onmessage = ({ data }) => { if (data?.kind === 'reply' && data.request === request) replies.push(data); };
    channel.postMessage({ ...message, request });
    setTimeout(() => resolve(replies), waitMs);
  });
}
const pick = usage => ({ rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, external: usage.external, arrayBuffers: usage.arrayBuffers });
let readDiagnostics;
// Linux only: anonymous (heap, malloc) versus file-backed (code) resident pages.
function linuxRss() {
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    const kib = name => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(status)?.[1]) * 1024 || undefined;
    return { rssAnon: kib('RssAnon'), rssFile: kib('RssFile') };
  } catch { return {}; }
}
// Retained result bytes by owner, from the server's own bounded caches.
const cacheBytes = value => value && ({ foreground: value.cache?.bytes, death: value.deathLane?.cache?.bytes, prediction: value.predictionLane?.cache?.bytes,
  duo: value.duoLane?.cache?.bytes, unlockReuse: value.unlockReuse?.bytes, viewerTasks: (value.viewerTaskCache?.playBytes ?? 0) + (value.viewerTaskCache?.fullCompressedBytes ?? 0),
  responses: value.responseCache?.bytes, static: value.staticCache?.bytes, reference: value.referenceCache?.bytes });
// Lane health: restarts or failures explain missing workers and slow unlocks.
const laneHealth = value => value && Object.fromEntries([['foreground', value.worker], ['prediction', value.predictionLane?.worker],
  ['death', value.deathLane?.worker], ['duo', value.duoLane?.worker]].filter(([, lane]) => lane)
  .map(([name, lane]) => [name, { status: lane.status, restarts: lane.restarts, failures: lane.failures, lastFailure: lane.lastFailure?.kind }]));
async function sample(label) {
  const value = await readDiagnostics?.().catch(() => undefined);
  const caches = cacheBytes(value), lanes = laneHealth(value);
  globalThis.gc?.();
  await pause(250);
  const main = { ...pick(process.memoryUsage()), ...linuxRss() };
  const workers = [];
  if (mode === 'thread') {
    for (const reply of await broadcast({ kind: 'sample' })) workers.push({ threadId: reply.threadId, ...pick(reply.memoryUsage), rss: undefined });
  } else {
    await Promise.all([...processWorkers].map(async worker => {
      try {
        const usage = await worker.getMemoryUsage();
        workers.push({ pid: usage.pid, processRss: usage.main.rss, hostHeapUsed: usage.main.heapUsed, hostArrayBuffers: usage.main.arrayBuffers,
          ...Object.fromEntries(Object.entries(pick(usage.workers[0]?.memoryUsage ?? {})).filter(([key]) => key !== 'rss')) });
      } catch { /* Retired or sleeping lanes have no process. */ }
    }));
  }
  const totalRss = main.rss + workers.reduce((sum, row) => sum + (row.processRss ?? 0), 0);
  const row = { label, at: Math.round(performance.now()), main, workers, totalRss, caches, lanes };
  console.log(`${label.padEnd(18)} main rss ${mib(main.rss)}${main.rssAnon ? ` (anon ${mib(main.rssAnon)})` : ''} heap ${mib(main.heapUsed)}/${mib(main.heapTotal)} ext ${mib(main.external)} ab ${mib(main.arrayBuffers)} | workers ${workers.length} `
    + workers.map(row => `[${row.processRss ? `rss ${mib(row.processRss)} host-ab ${mib(row.hostArrayBuffers)} host-heap ${mib(row.hostHeapUsed)} ` : ''}heap ${mib(row.heapUsed ?? 0)} ext ${mib(row.external ?? 0)}]`).join(' ')
    + ` | total rss ${mib(totalRss)} MiB`
    + (lanes ? ` | lanes ${Object.entries(lanes).map(([name, lane]) => `${name} ${lane.status}${lane.failures ? ` failures ${lane.failures} (${lane.lastFailure})` : ''}`).join(', ')}` : '')
    + (caches ? ` | caches ${Object.entries(caches).filter(([, bytes]) => bytes).map(([name, bytes]) => `${name} ${mib(bytes)}`).join(', ')}` : ''));
  return row;
}
async function snapshots(label) {
  if (!args.snapshots) return;
  const { writeHeapSnapshot } = await import('node:v8');
  const prefix = path.join(path.resolve(args.snapshots), label);
  const files = [writeHeapSnapshot(`${prefix}-main.heapsnapshot`)];
  if (mode === 'thread') files.push(...(await broadcast({ kind: 'snapshot', prefix }, 60000)).map(reply => reply.file));
  console.log(`${label} heap snapshots: ${files.length}`);
}

const directory = await mkdtemp(path.join(tmpdir(), 'rs3-server-memory-'));
const report = { schemaVersion: 1, node: process.version, platform: process.platform, mode, appDir: path.basename(appDir), samples: [], unlocks: [] };
let app;
try {
  const started = performance.now();
  app = await createServer({ dataDir: path.join(directory, 'game'), packsDir: path.join(directory, 'packs'),
    packSelection: path.join(directory, 'packs', 'selection.json'), port, host: '127.0.0.1', shutdownDeadlineMs: 5000 });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  let cookie, state;
  const request = async (route, { body, auth = cookie } = {}) => {
    const response = await fetch(new URL(route, origin), { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      signal: AbortSignal.timeout(600000), headers: { ...(auth ? { Cookie: auth } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status >= 400) throw new Error(`${route.split("?")[0]} returned ${response.status}: ${(await response.json().catch(() => ({}))).message ?? ""}`);
    return response;
  };
  const json = async (route, options) => (await request(route, options)).json();
  cookie = (await request('/join/' + app.store.getAccessToken(), { auth: null })).headers.get('set-cookie')?.split(';')[0];
  const diagnostics = readDiagnostics = () => json('/api/diagnostics');
  async function settle(limitMs = 600000) {
    const until = performance.now() + limitMs;
    for (;;) {
      const value = await diagnostics();
      const lanes = [value, value.predictionLane, value.deathLane, value.duoLane];
      const busy = lanes.some(lane => lane?.queue?.active || lane?.queue?.depth || lane?.prewarm?.pending || lane?.prewarm?.active)
        || ['pending', 'running'].includes(value.startupWarmup?.status);
      if (!busy || performance.now() > until) return value;
      await pause(250);
    }
  }
  const command = async value => { state = (await json('/api/command?view=play-v1', { body: { expectedRevision: state.revision, command: value } })).state; };
  state = (await json('/api/state?view=play-v1')).state;
  const memberIds = state.members.map(member => member.id), memberId = memberIds[0];
  const tasks = id => request(`/api/tasks?memberId=${encodeURIComponent(id)}&view=play-v1`).then(response => response.arrayBuffer());
  await tasks(memberId);
  report.startupMs = Math.round(performance.now() - started);
  await settle();
  report.samples.push(await sample('startup'));
  await snapshots('startup');
  await pause(5000); await settle();
  report.samples.push(await sample('idle'));

  const definitions = await json('/api/definitions?view=display-v1');
  const sections = (await json('/api/definitions')).sections ?? {};
  const neighbours = id => Object.values(sections[id] ?? {}).flat().map(String).filter(cell => definitions.chunks[cell]);
  const start = String(state.members[0].unlocked?.[0] ?? (await appModule('dataset-runtime.mjs')).selectedDataset.gameDefaults.startingCell);
  if (!state.members[0].unlocked?.includes(start)) await command({ type: 'set-chunk', memberId, chunkId: start, status: 'unlocked' });
  await tasks(memberId); await settle();
  const frontier = () => {
    const owned = new Set(state.members[0].unlocked.map(String));
    return [...new Set([...owned].flatMap(neighbours))].filter(cell => !owned.has(cell)).sort();
  };
  for (let index = 0; index < Number(args.unlocks ?? 10); index++) {
    const chunkId = frontier()[0];
    if (!chunkId) break;
    const prepared = index % 2 === 0;
    let preparedWait;
    if (prepared) {
      // Preview prepares a selected chunk in the background. Wait until both
      // players' prepared task bytes are admitted, as after a real pause.
      const admitted = (await diagnostics()).unlockReuse?.admitted ?? 0;
      await command({ type: 'set-chunk', memberId, chunkId, status: 'selected' });
      await tasks(memberId);
      const waitStarted = performance.now(), until = waitStarted + 300000;
      while ((await diagnostics()).unlockReuse?.admitted < admitted + memberIds.length && performance.now() < until) await pause(250);
      preparedWait = { waitMs: Math.round(performance.now() - waitStarted), paired: (await diagnostics()).unlockReuse?.admitted >= admitted + memberIds.length };
      if (process.env.RS3_MEMORY_TRIAL_VERBOSE) { const value = await diagnostics(); console.log(JSON.stringify({ unlockReuse: value.unlockReuse, prediction: value.predictionLane?.worker?.status, counts: value.predictionLane?.counts, prewarm: value.predictionLane?.prewarm })); }
      await settle();
    }
    const before = performance.now();
    await command({ type: 'set-chunk', memberId, chunkId, status: 'unlocked' });
    const saveMs = performance.now() - before;
    // The response ends with its cache metadata; read only that tail.
    const tail = Buffer.from(await tasks(memberId)).subarray(-2048).toString('utf8');
    const served = { hit: /"hit":true/.test(tail), unlockPredictionHit: /"unlockPredictionHit":true/.test(tail),
      requestMs: Math.round(Number(/"requestMs":([\d.]+)/.exec(tail)?.[1] ?? NaN)) };
    const totalMs = performance.now() - before;
    report.unlocks.push({ index, prepared, saveMs: Math.round(saveMs), totalMs: Math.round(totalMs), served, ...(preparedWait ? { preparedWait } : {}) });
    console.log(`unlock ${index + 1} ${prepared ? 'prepared  ' : 'unprepared'} ${Math.round(totalMs)} ms (save ${Math.round(saveMs)} ms, ${served.hit ? 'reused' : 'calculated'} in ${served.requestMs} ms)${preparedWait ? `, prepared pair ${preparedWait.paired ? 'ready' : 'not ready'} after ${preparedWait.waitMs} ms` : ''}`);
    await settle();
  }
  report.samples.push(await sample('after-10-unlocks'));
  await snapshots('unlocks');
  const recalcStarted = performance.now();
  await command({ type: 'set-task-rule', memberId, ruleId: 'Mining', value: false });
  await Promise.all(memberIds.map(tasks));
  await command({ type: 'set-task-rule', memberId, ruleId: 'Mining', value: true });
  await Promise.all(memberIds.map(tasks));
  // The browser also opens full task details, which the server caches separately.
  for (const id of memberIds) await request(`/api/tasks?memberId=${encodeURIComponent(id)}`).then(response => response.arrayBuffer());
  report.recalculationMs = Math.round(performance.now() - recalcStarted);
  await settle();
  report.samples.push(await sample('after-recalc'));
  // Lanes sleep after RS3_WORKER_IDLE_MS, then idle collection runs.
  const until = performance.now() + Number(process.env.RS3_WORKER_IDLE_MS) + 60000;
  while (performance.now() < until) {
    const value = await diagnostics();
    if (value.worker?.status === 'sleeping' && !value.worker.retiring && value.idleGc?.collections + value.idleGc?.released > 0 && !value.idleGc.pending) break;
    await pause(1000);
  }
  report.samples.push(await sample('asleep'));
  await snapshots('asleep');
} finally {
  channel.close();
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
const prepared = report.unlocks.filter(row => row.prepared).map(row => row.totalMs), cold = report.unlocks.filter(row => !row.prepared).map(row => row.totalMs);
const median = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
report.unlockSummary = { preparedMedianMs: median(prepared), unpreparedMedianMs: median(cold), preparedMaxMs: Math.max(...prepared), unpreparedMaxMs: Math.max(...cold) };
console.log(`startup ${report.startupMs} ms; recalculation ${report.recalculationMs} ms; unlock medians prepared ${report.unlockSummary.preparedMedianMs} ms, unprepared ${report.unlockSummary.unpreparedMedianMs} ms`);
if (args.out) await writeFile(path.resolve(args.out), JSON.stringify(report, null, 2) + '\n');
