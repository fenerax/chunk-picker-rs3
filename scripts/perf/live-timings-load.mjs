// Public synthetic HTTP load. Fresh picker/child processes for every trial.
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { trial: { type: 'string' }, out: { type: 'string' }, requests: { type: 'string', default: '200' }, micro: { type: 'boolean' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('NodeVersionError');
const iterations = Number(values.requests);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('OptionsError');
async function trial(mode) {
  process.env.RS3_TASK_WORKER_MODE = 'process';
  const [{ createServer }, { createGroupState }, { resolveDataset }, { surfaceCoordinates, SURFACE_GRID }] = await Promise.all([import('../../app/server.mjs'), import('../../app/core/state.mjs'), import('../../app/datasets.mjs'), import('../../app/data/surface-grid.mjs')]);
  const dataDir = await mkdtemp('/tmp/live-timings-load-'), workers = new Set();
  const first = surfaceCoordinates('12344') ? 12341 : SURFACE_GRID.startId - 3, ids = [String(first), String(first + 1)];
  const initialState = createGroupState([{ id: 'a', name: 'Synthetic', unlocked: [ids[0]] }]); initialState.rules['content.f2p'] = false;
  const definitions = { chunks: { [ids[0]]: {}, [ids[1]]: {} }, walkableChunks: ids, walkableChunksF2P: ids, challenges: { Extra: { Present: { Chunks: [ids[0]] }, Future: { Chunks: [ids[1]] } } } };
  const dataset = await resolveDataset({ packsDir: `${dataDir}/no-packs`, gameDataDir: `${dataDir}/no-data` });
  let app, sampler, parentPeak = 0, workerPeak = 0;
  const rss = async pid => { try { const bytes = await readFile(`/proc/${pid}/status`, 'utf8'); return Number(/^VmRSS:\s+(\d+)/m.exec(bytes)?.[1] ?? 0) * 1024; } catch { return 0; } };
  const sample = async () => { parentPeak = Math.max(parentPeak, await rss(process.pid)); workerPeak = Math.max(workerPeak, (await Promise.all([...workers].map(rss))).reduce((a, b) => a + b, 0)); };
  try {
    app = await createServer({ dataDir, deepProfiles: true, dataset, definitions, initialState, taskMap: {}, port: 0, predictionPrewarm: false, rateLimits: { expensive: 100000, expensiveGlobal: 100000 }, liveTimingOptions: { enabled: mode !== 'off' }, taskWorkerOptions: { onWorker(worker) { if (worker.pid) workers.add(worker.pid); } } });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
    const request = async route => { const response = await fetch(origin + route, { headers }); const body = await response.json(); if (response.status !== 200) throw new Error('HTTPError'); return body; };
    const tasks = await request('/api/tasks?memberId=a&view=play-v1'), task = tasks.tasks[0].id, revision = app.store.getInfo().revision;
    const routes = ['/api/state?view=play-v1', '/api/tasks?memberId=a&view=play-v1', `/api/task-how?memberId=a&taskId=${encodeURIComponent(task)}&revision=${revision}`];
    for (let warm = 0; warm < 50; warm++) for (const route of routes) await request(route);
    if (mode === 'profile') {
      const response = await fetch(origin + '/api/admin/cpu-profiles', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', seconds: 600 }) });
      if (!response.ok) throw new Error('ProfileError'); await response.json();
    }
    // Clear startup garbage before comparing steady-state request costs.
    for (let collection = 0; collection < 3; collection++) { global.gc?.(); await new Promise(resolve => setImmediate(resolve)); }
    const preparedHeapBytes = process.memoryUsage().heapUsed;
    await sample(); sampler = setInterval(() => { void sample(); }, 20);
    const cpu = process.cpuUsage(), start = performance.now();
    for (let i = 0; i < iterations; i++) for (const route of routes) await request(route);
    const wallMs = performance.now() - start, used = process.cpuUsage(cpu); clearInterval(sampler); await sample();
    const parentIdle = await rss(process.pid), workerIdle = (await Promise.all([...workers].map(rss))).reduce((a, b) => a + b, 0);
    return { mode, requests: iterations * routes.length, wallMs, requestMs: wallMs / (iterations * routes.length), parentCpuMs: (used.user + used.system) / 1000, preparedHeapBytes, parentPeak, workerPeak, parentIdle, workerIdle };
  } finally { clearInterval(sampler); await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
}
async function micro() {
  const { EventEmitter } = await import('node:events');
  const { openLiveTimings, noteTiming } = await import('../../app/live-timings.mjs');
  const dir = await mkdtemp('/tmp/live-timings-micro-'), trials = [];
  try {
    for (let run = 0; run < 5; run++) for (const enabled of [false, true]) {
      const timings = await openLiveTimings(dir, { enabled });
      const start = performance.now();
      for (let i = 0; i < 100000; i++) {
        const response = new EventEmitter(); response.writableFinished = true; response.statusCode = 200;
        timings.request({ url: '/api/tasks?view=play-v1&memberId=synthetic' }, response, () => {
          noteTiming({ source: 'cache', timingMs: { engineMs: 1, totalMs: 1 } }); response.emit('finish');
        });
      }
      const elapsedMs = performance.now() - start, flushStart = performance.now(); await timings.close();
      trials.push({ enabled, requests: 100000, elapsedMs, microsecondsPerRequest: elapsedMs / 100, flushMs: performance.now() - flushStart });
    }
    console.log(JSON.stringify({ trials }, null, 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (values.micro) await micro();
else if (values.trial) console.log(JSON.stringify(await trial(values.trial)));
else {
  const trials = [];
  for (let run = 0; run < 5; run++) for (const mode of ['off', 'on', 'profile']) {
    const result = await new Promise((resolve, reject) => {
      const child = fork(new URL(import.meta.url), ['--trial', mode, '--requests', String(iterations)], { execArgv: [...process.execArgv, '--expose-gc'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let output = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => process.stderr.write(bytes));
      child.once('error', reject); child.once('exit', code => { if (code !== 0) { reject(new Error('TrialError')); return; } try { resolve(JSON.parse(output)); } catch { reject(new Error('TrialError')); } });
    });
    trials.push(result); console.error(JSON.stringify({ completed: trials.length }));
    if (values.out) await writeFile(values.out, JSON.stringify({ node: process.version, trials }, null, 2));
  }
  const summary = {};
  for (const mode of ['off', 'on', 'profile']) {
    const rows = trials.filter(row => row.mode === mode); summary[mode] = {};
    for (const key of Object.keys(rows[0]).filter(key => key !== 'mode')) { const numbers = rows.map(row => row[key]).sort((a, b) => a - b); summary[mode][key] = { median: numbers[2], min: numbers[0], max: numbers[4] }; }
  }
  console.log(JSON.stringify(summary, null, 2));
}
