import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { freemem } from 'node:os';
import { requireHeavyLock, selectCompanion, readScratchState, seededRandom, mib } from './inputs.mjs';

// Private measurements only: explicit disposable input, fresh credentials and
// one server at a time. Never log response bodies, member IDs or invitations.
await requireHeavyLock();
// Three production calculator lanes plus the HTTP/client process can peak near
// 5 GiB on a large companion. Admission happens before loading those graphs.
if (freemem() < 5.5 * 1024 ** 3) {
  console.log('Waiting for 5.5 GiB free RAM before the interaction trial.');
  process.exit(75); // The private trial launcher retries outside the lock.
}
const output = path.resolve(process.argv[2] ?? 'var/perfwalk/scenarios');
try {
  await access(path.join(output, 'commands'));
  throw new Error('Use a fresh output directory: the previous trial has a persisted scratch save.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
await selectCompanion(output);
for (const key of ['RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
const { state: source, sha256 } = await readScratchState(process.env.RS3_PERF_STATE);
for (const member of source.members) {
  member.unlocked = member.unlocked.slice(0, 1);
  member.selected = []; member.pendingRoll = [];
}
source.history = [];
const { ProcessWorker } = await import('../../app/tasks/process-worker.mjs');
const workers = new Set(), work = [], pending = new Map(), rows = [], hashes = {};
const originalPost = ProcessWorker.prototype.postMessage, originalEmit = ProcessWorker.prototype.emit;
const originalOn = ProcessWorker.prototype.on, ownOn = Object.getOwnPropertyDescriptor(ProcessWorker.prototype, 'on');
let phase, mainPeak = 0, workerPeak = 0, combinedPeak = 0, sampling;
// The scheduler registers listeners immediately after construction, before the
// worker is ready. Include cold initialization in RSS sampling too.
ProcessWorker.prototype.on = function(...args) {
  workers.add(this); return originalOn.apply(this, args);
};
ProcessWorker.prototype.postMessage = function(message) {
  workers.add(this); pending.set(`${this.pid}:${message.id}`, { phase, type: message.type, at: performance.now() });
  return originalPost.call(this, message);
};
ProcessWorker.prototype.emit = function(event, message, ...rest) {
  if (event === 'message' && message?.type === 'ready') workers.add(this);
  if (event === 'message' && message?.timingMs) {
    const request = pending.get(`${this.pid}:${message.id}`);
    work.push({ phase: request?.phase, type: request?.type, wallMs: performance.now() - request?.at, timingMs: message.timingMs });
    pending.delete(`${this.pid}:${message.id}`);
  }
  return originalEmit.call(this, event, message, ...rest);
};
function sample() {
  return sampling ??= (async () => {
    try {
      mainPeak = Math.max(mainPeak, process.memoryUsage.rss());
      let total = 0;
      await Promise.all([...workers].map(async worker => {
        try { const rss = (await worker.getMemoryUsage()).main.rss; total += rss; workerPeak = Math.max(workerPeak, rss); } catch {}
      }));
      combinedPeak = Math.max(combinedPeak, total);
    } finally { sampling = undefined; }
  })();
}
const timer = setInterval(sample, 250); timer.unref();
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['revision', 'stateRevision', 'cache', 'timingMs', 'elapsedMs', 'evaluationMs'].includes(key))
    .map(([key, child]) => [key, normalize(child)])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
async function measure(name, operation) {
  await sample();
  phase = name; mainPeak = process.memoryUsage.rss(); workerPeak = 0; combinedPeak = 0;
  const start = performance.now(), startedHrUs = Number(process.hrtime.bigint() / 1000n), index = work.length;
  const details = await operation();
  const wallMs = performance.now() - start, endedHrUs = Number(process.hrtime.bigint() / 1000n);
  await sample();
  const row = { name, wallMs, startedHrUs, endedHrUs, mainPeakRssMiB: mib(Math.max(mainPeak, process.resourceUsage().maxRSS * 1024)), workerPeakRssMiB: mib(workerPeak),
    combinedWorkerPeakRssMiB: mib(combinedPeak), details, work: work.slice(index) };
  rows.push(row); console.log(JSON.stringify(row));
  await writeFile(path.join(output, 'partial.json'), JSON.stringify({ rows, hashes }, null, 2));
  return details;
}
let app;
try {
  // Include module initialization and storage loading in the ready milestone.
  const started = performance.now(); phase = 'startup-ready';
  let startServer;
  async function start(name) {
    const probe = createNetServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(8966, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
    app = await startServer({ dataDir: path.join(output, name), initialState: structuredClone(source), port: 8966, host: '127.0.0.1',
      loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false, random: seededRandom(1729) });
    app = await app.ready;
  }
  await measure('startup-ready', async () => {
    ({ startServer } = await import('../../app/server.mjs'));
    await start('commands'); return { sinceLaunchMs: performance.now() - started, stages: app.getStartupTimingMs() };
  });
  const api = async (route, body) => {
    const origin = 'http://127.0.0.1:8966';
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${app.store.getAccessToken()}`, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Scratch ${route.split('?')[0]} failed: ${response.status}`);
    return response.json();
  };
  const [owner, peer] = source.members.map(member => member.id);
  const lists = () => {
    const revision = app.store.getInfo().revision;
    return Promise.all([api(`/api/tasks?memberId=${owner}&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`),
      api(`/api/tasks?memberId=${peer}&view=play-v1&lane=duo-v1&peerFor=${owner}&revision=${revision}`)]);
  };
  await measure('group-lists', async () => {
    await Promise.all(['/api/state?view=play-v1', '/api/definitions?view=display-v1', '/api/rules', '/api/display-world'].map(route => api(route)));
    const results = await lists(); hashes.startup = results.map(hash);
    return { sinceLaunchMs: performance.now() - started, cache: results.map(result => result.cache) };
  });
  // Measure panels on the original one-chunk-per-member state before changing
  // ownership. One server per trial also keeps the client's retained RAM modest.
  const area = [], seen = new Set(), queue = [source.members[0].unlocked[0]];
  while (queue.length && area.length < 50) {
    const id = queue.shift(); if (seen.has(id)) continue; seen.add(id); area.push(id);
    queue.push(...(app.world.neighbors.get(id) ?? []));
  }
  if (area.length !== 50) throw new Error('Cannot construct the 50-chunk area.');
  await measure('area-check-50', async () => {
    const result = await api(`/api/area-check?memberId=${owner}&revision=${app.store.getInfo().revision}&chunks=${area.join(',')}`);
    hashes.area = hash(result); return { cache: result.cache };
  });
  await measure('rules-preview', async () => {
    const result = await api('/api/sandbox/evaluate', { memberId: owner, baseRevision: app.store.getInfo().revision,
      changes: { unlockChunks: [], lockChunks: [], doneTasks: [], taskRules: { InsidePOH: source.members[0].taskRules?.InsidePOH === false } } });
    hashes.preview = hash(result); return { cache: result.cache };
  });
  const command = edit => api('/api/command?view=play-v1', { expectedRevision: app.store.getInfo().revision, command: edit });
  const rolled = await command({ type: 'roll', memberId: owner, count: 2 }); await lists();
  const chunkId = rolled.state.members.find(member => member.id === owner).pendingRoll[0];
  if (!chunkId) throw new Error('Scratch roll has no candidate.');
  await measure('unlock', async () => {
    const start = performance.now(); await command({ type: 'unlock-selection', memberId: owner, chunkId });
    const acknowledgementMs = performance.now() - start, results = await lists(); hashes.unlock = results.map(hash);
    return { acknowledgementMs, cache: results.map(result => result.cache) };
  });
  await measure('revision-churn', async () => {
    const initial = await lists();
    const shown = new Set(initial[0].presentation.tasks.map(task => task.id));
    const task = initial[0].tasks.find(task => shown.has(task.id) && task.status === 'available' && task.obligation !== false && !task.hidden);
    if (!task) throw new Error('Scratch map has no checkable task.');
    const timings = [];
    for (const challengeCompleted of [true, false, true, false, true, false]) {
      const start = performance.now();
      await command({ type: 'set-task-status', memberId: owner, taskId: task.id, challengeCompleted });
      const results = await lists();
      timings.push(performance.now() - start);
      (hashes.churn ??= []).push(results.map(hash));
    }
    return { refreshMs: timings };
  });
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ inputSha256: sha256, datasetDigest: selectedDataset.digest,
    cpuProfiling: process.execArgv.includes('--cpu-prof'), membersMode: source.rules?.['content.f2p'] === false,
    startingOwnedCounts: source.members.map(member => member.unlocked.length),
    node: process.version, method: 'Fresh disposable server; one chunk per member; production Group projections; panels on unchanged starting ownership; immediate unlock with no prediction warming; six subsequent check/uncheck revisions for retention peaks; cumulative main maxRSS and 250 ms worker RSS samples; Node client shares server process.', rows, hashes }, null, 2));
} finally {
  clearInterval(timer); await app?.close();
  ProcessWorker.prototype.postMessage = originalPost; ProcessWorker.prototype.emit = originalEmit;
  if (ownOn) Object.defineProperty(ProcessWorker.prototype, 'on', ownOn);
  else delete ProcessWorker.prototype.on;
}
