#!/usr/bin/env node
// Sequential isolated process measurements. Never starts or contacts the live picker.
import { fork, spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, '.local/warmstart');
const TIMEOUT = 300000, IDLE_MS = 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { port: 9121, source: path.join(ROOT, '.local/warmstart-save'), condition: 'both', 'defer-ms': 0 };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!value || !['--label', '--entry', '--port', '--source', '--condition', '--defer-ms'].includes(key)) throw new Error('Use --label before|after [--entry PATH] [--port 9121] [--source PATH] [--condition idle|busy] [--defer-ms MS].');
  options[key.slice(2)] = ['--port', '--defer-ms'].includes(key) ? Number(value) : value;
}
if (!/^[a-z][a-z0-9-]{0,40}$/.test(options.label ?? '') || options.port !== 9121) throw new Error('A plain report label and assigned port 9121 are required.');
if (!['both', 'idle', 'busy'].includes(options.condition)) throw new Error('Condition must be idle or busy.');
if (!Number.isSafeInteger(options['defer-ms']) || options['defer-ms'] < 0 || options['defer-ms'] > TIMEOUT) throw new Error('Defer must be an integer from 0 through 300000.');
options.source = path.resolve(options.source);
if (options.entry) options.entry = path.resolve(options.entry);
const within = (base, target) => { const relative = path.relative(base, target); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
async function assertHeavyOwnership() {
  const { RS3_HEAVY_LOCK_PATH: lock, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!lock || !token || !pid) throw new Error('Run warmstart measurements through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(lock, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || owner.pid !== Number(pid)) throw new Error('Shared heavy-work ownership changed; refusing the timing run.');
}
async function rejectLinks(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked scratch sources are unsupported.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked scratch sources are unsupported.');
    if (entry.isDirectory()) await rejectLinks(path.join(directory, entry.name));
  }
}
async function removeScratch(directory) {
  const base = await realpath(OUTPUT), target = await realpath(directory);
  if (!within(base, target) || !path.basename(target).startsWith('scratch-')) throw new Error('Unsafe scratch cleanup target.');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
async function stopChild(child, graceful = false) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (graceful && child.connected) {
    child.send({ type: 'stop' });
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(12000)]);
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  else child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) throw new Error('Owned process did not exit; scratch retained.');
}
// Diagnostic and result objects can contain private strings. Only declared counters survive.
const numericTree = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,70}$/.test(key))
    .map(([key, item]) => [key, numericTree(item)]).filter(([, item]) => item !== undefined));
};
const lanes = diagnostic => [diagnostic, diagnostic.deathLane, diagnostic.duoLane, diagnostic.predictionLane].filter(Boolean);
const startupWarmReady = diagnostic => !diagnostic.startupWarmup
  || ['ready', 'unavailable', 'sleeping', 'disabled'].includes(diagnostic.startupWarmup.status);
const sleeping = diagnostic => lanes(diagnostic).every(lane => lane.worker?.resident !== true && !lane.worker?.retiring);
const safeStatus = value => ['ready', 'sleeping', 'starting', 'idle', 'waking', 'not-configured', 'closed',
  'restarting', 'restart-required', 'pending', 'running', 'unavailable', 'disabled'].includes(value) ? value : null;
const workerResidency = diagnostic => Object.fromEntries([
  ['foreground', diagnostic], ['death', diagnostic.deathLane], ['duo', diagnostic.duoLane], ['prediction', diagnostic.predictionLane],
].map(([name, lane]) => [name, { resident: lane?.worker?.resident === true,
  status: safeStatus(lane?.worker?.status), idleStops: lane?.worker?.idleStops ?? null }]));

async function runCell(condition, sourceHash) {
  const directory = await mkdtemp(path.join(OUTPUT, 'scratch-'));
  const dataDir = path.join(directory, 'duo');
  let child, busyChild, healthLoop, memoryLoop, keepProbing = true, loadWanted = false, loadLoop;
  const busy = { command: 'node scripts/test.mjs quick (npm run test:quick equivalent)', runs: [], overlapMs: 0 };
  const token = randomBytes(32).toString('base64url');
  let spawnedAt, peakRssBytes = 0, firstHealth200Ms = null, healthMaxRoundtripMs = 0, healthSamples = 0;
  let listening = null, ready = null, probeId = 0;
  const origin = `http://127.0.0.1:${options.port}`;
  const rss = () => new Promise((resolve, reject) => {
    const id = ++probeId;
    const timer = setTimeout(() => { child.off('message', listener); reject(new Error('Memory probe timeout.')); }, 10000);
    const listener = message => { if (message?.type === 'rss' && message.id === id) { clearTimeout(timer); child.off('message', listener); peakRssBytes = Math.max(peakRssBytes, message.rssBytes); resolve(message); } };
    child.on('message', listener); child.send({ type: 'rss', id });
  });
  const request = async route => {
    const started = performance.now();
    const response = await fetch(`${origin}${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
    const bytes = await response.arrayBuffer();
    const elapsedMs = performance.now() - started;
    if (response.status !== 200) throw new Error(`Benchmark request failed with status ${response.status}.`);
    return { data: JSON.parse(Buffer.from(bytes).toString('utf8')), elapsedMs, completedFromSpawnMs: performance.now() - spawnedAt, bytes: bytes.byteLength };
  };
  try {
    await cp(options.source, dataDir, { recursive: true, dereference: false,
      filter: filename => !['store.lock', 'access-token'].includes(path.basename(filename)) });
    if (sha256(await readFile(path.join(dataDir, 'state.json'))) !== sourceHash
      || sha256(await readFile(path.join(options.source, 'state.json'))) !== sourceHash) throw new Error('Frozen source changed during copy.');
    await writeFile(path.join(dataDir, 'access-token'), `${token}\n`, { mode: 0o600 });
    if (condition === 'busy') {
      loadWanted = true;
      loadLoop = (async () => {
        while (loadWanted) {
          const started = performance.now();
          busyChild = spawn(process.execPath, ['scripts/test.mjs', 'quick'], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
          const result = await new Promise(resolve => { busyChild.once('error', () => resolve({ exitCode: null, failedToSpawn: true })); busyChild.once('exit', (exitCode, signal) => resolve({ exitCode, terminated: Boolean(signal) })); });
          busy.runs.push({ startedAt: started, finishedAt: performance.now(), ...result });
          busyChild = null;
          if (result.exitCode !== 0 || result.failedToSpawn) loadWanted = false;
        }
      })();
    }
    const env = { ...process.env, RS3_WARMSTART_SCRATCH: dataDir, RS3_DATA_DIR: dataDir,
      RS3_WARMSTART_PORT: String(options.port), RS3_WORKER_IDLE_MS: String(IDLE_MS) };
    if (options.entry) env.RS3_WARMSTART_ENTRY = options.entry;
    else delete env.RS3_WARMSTART_ENTRY;
    delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
    spawnedAt = performance.now();
    child = fork(path.join(ROOT, 'scripts/perf/warmstart-server.mjs'), [], { cwd: ROOT, env,
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const readyPending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Scratch startup timeout.')), TIMEOUT);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Scratch process failed.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Scratch process exited.')); });
      child.on('message', message => {
        if (message?.type === 'listening') { listening = { processMs: performance.now() - spawnedAt, childMs: message.elapsedMs, rssBytes: message.rssBytes }; peakRssBytes = Math.max(peakRssBytes, message.rssBytes); }
        if (message?.type === 'ready') { clearTimeout(timer); ready = message; resolve(message); }
        if (message?.type === 'error') { clearTimeout(timer); reject(new Error('Scratch startup failed.')); }
      });
    });
    healthLoop = (async () => {
      while (keepProbing) {
        const started = performance.now();
        try {
          const response = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
          await response.arrayBuffer();
          if (response.status === 200) { firstHealth200Ms ??= performance.now() - spawnedAt; healthSamples++; healthMaxRoundtripMs = Math.max(healthMaxRoundtripMs, performance.now() - started); }
        } catch {}
        await sleep(250);
      }
    })();
    memoryLoop = (async () => { while (keepProbing) { try { await rss(); } catch {} await sleep(500); } })();
    await readyPending;
    const storeReadyMs = performance.now() - spawnedAt;
    if (options['defer-ms']) await sleep(options['defer-ms']);
    const state = await request('/api/state?view=play-v1');
    const memberIds = state.data.state.members.map(member => member.id);
    if (memberIds.length !== 2) throw new Error('The benchmark needs a two-player save.');
    const tasksStartedAt = performance.now();
    const taskResults = await Promise.all(memberIds.map(memberId => request(`/api/tasks?memberId=${encodeURIComponent(memberId)}`)));
    const firstBothTaskListsMs = performance.now() - spawnedAt;
    const tasksEndedAt = performance.now();
    const member = state.data.state.members[0], unlocked = new Set(member.unlocked);
    const candidates = [...(member.pendingRoll ?? []), ...(member.selected ?? []), ...(state.data.pools?.[member.id]?.eligible ?? []).map(row => row.id)];
    const chunkId = candidates.map(String).find(id => /^[1-9]\d*$/.test(id) && !unlocked.has(id)) ?? '7463';
    const prediction = await request(`/api/predict?memberId=${encodeURIComponent(member.id)}&chunkId=${encodeURIComponent(chunkId)}`);
    const loadEndedAt = performance.now();
    loadWanted = false;
    const warmDeadline = performance.now() + TIMEOUT;
    let warmDiagnostic;
    do {
      warmDiagnostic = (await request('/api/diagnostics')).data;
      if (startupWarmReady(warmDiagnostic)) break;
      if (performance.now() > warmDeadline) throw new Error('Startup warmup did not settle.');
      await sleep(500);
    } while (true);
    // Capture the used workers before candidate preparation can run past idle expiry.
    // The repeated requests have the same full transport as the first requests.
    const cachedTasksStartedAt = performance.now();
    const cachedTaskResults = await Promise.all(memberIds.map(memberId => request(`/api/tasks?memberId=${encodeURIComponent(memberId)}`)));
    const cachedTasksBatchMs = performance.now() - cachedTasksStartedAt;
    const cachedPrediction = await request(`/api/predict?memberId=${encodeURIComponent(member.id)}&chunkId=${encodeURIComponent(chunkId)}`);
    warmDiagnostic = (await request('/api/diagnostics')).data;
    const warmMemory = await rss(), warmCompletedMs = performance.now() - spawnedAt;
    // Finish the currently owned quick suite; do not leave its test children running.
    if (loadLoop) {
      await Promise.race([loadLoop, sleep(120000)]);
      if (busyChild) await stopChild(busyChild);
      await loadLoop;
    }
    const sleepDeadline = performance.now() + 90000;
    let sleepingDiagnostic;
    do {
      sleepingDiagnostic = (await request('/api/diagnostics')).data;
      if (sleeping(sleepingDiagnostic)) break;
      if (performance.now() > sleepDeadline) throw new Error('Workers did not retire within accelerated idle window.');
      await sleep(1000);
    } while (true);
    // Thread teardown and allocator RSS release can trail the sleeping notice.
    await sleep(3000);
    const sleepingMemory = await rss();
    const summary = result => ({ elapsedMs: result.elapsedMs, completedFromSpawnMs: result.completedFromSpawnMs,
      responseBytes: result.bytes, cache: numericTree(result.data.cache), taskCount: result.data.tasks?.length ?? null });
    busy.overlapMs = busy.runs.reduce((sum, run) => sum + Math.max(0, Math.min(run.finishedAt, loadEndedAt) - Math.max(run.startedAt, spawnedAt)), 0);
    busy.runs = busy.runs.map(run => ({ startedFromSpawnMs: run.startedAt - spawnedAt, durationMs: run.finishedAt - run.startedAt,
      exitCode: run.exitCode, terminated: run.terminated ?? false, failedToSpawn: run.failedToSpawn ?? false }));
    busy.valid = busy.runs.every(run => run.exitCode === 0 && !run.failedToSpawn && !run.terminated);
    return { condition, valid: busy.valid, listening, storeReadyMs, deferMs: options['defer-ms'], firstHealth200Ms, firstBothTaskListsMs, tasksBatchMs: tasksEndedAt - tasksStartedAt,
      tasks: taskResults.map(summary), firstPrediction: summary(prediction), warmCompletedMs,
      repeated: { tasks: cachedTaskResults.map(summary), tasksBatchMs: cachedTasksBatchMs, prediction: summary(cachedPrediction) },
      rss: { peakBytes: peakRssBytes, warmBytes: warmMemory.rssBytes, sleepingBytes: sleepingMemory.rssBytes },
      memoryUsage: { warm: numericTree(warmMemory.memoryUsage), sleeping: numericTree(sleepingMemory.memoryUsage) },
      workerResidency: { warm: workerResidency(warmDiagnostic), sleeping: workerResidency(sleepingDiagnostic) },
      startupWarmupStatus: { warm: safeStatus(warmDiagnostic.startupWarmup?.status), sleeping: safeStatus(sleepingDiagnostic.startupWarmup?.status) },
      sleepingFromSpawnMs: performance.now() - spawnedAt, health: { samples: healthSamples, maxRoundtripMs: healthMaxRoundtripMs },
      startupTrace: ready.trace, finalStartupTrace: sleepingMemory.trace, startupTimingMs: warmMemory.startupTimingMs,
      warmDiagnostic: numericTree(warmDiagnostic), sleepingDiagnostic: numericTree(sleepingDiagnostic), busy };
  } finally {
    loadWanted = false;
    if (busyChild) await stopChild(busyChild);
    if (loadLoop) await loadLoop;
    keepProbing = false;
    await Promise.allSettled([healthLoop, memoryLoop].filter(Boolean));
    await stopChild(child, true);
    await removeScratch(directory);
    if (sha256(await readFile(path.join(options.source, 'state.json'))) !== sourceHash) throw new Error('Frozen source changed during measurement.');
  }
}

await mkdir(OUTPUT, { recursive: true });
if (!within(ROOT, await realpath(options.source))) throw new Error('Use a frozen source copy inside this worktree.');
if (options.entry && (!options.entry.endsWith('.mjs') || !within(ROOT, await realpath(options.entry)))) throw new Error('Use a local worktree server module.');
await rejectLinks(options.source);
const sourceHash = sha256(await readFile(path.join(options.source, 'state.json')));
const sourceFiles = [...new Set([options.entry ?? path.join(ROOT, 'app/server.mjs'),
  'app/startup.mjs', 'app/tasks/startup-warmup.mjs', 'app/tasks/scheduler.mjs', 'app/tasks/worker.mjs', 'app/tasks/engine.mjs',
  'rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json', 'app/data/legacy-task-history.json'].map(filename => path.resolve(filename)))];
const fingerprints = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async filename =>
  [path.relative(ROOT, filename).split(path.sep).join('/'), sha256(await readFile(filename))])));
const applicationSource = await fingerprints();
const report = { schemaVersion: 2, label: options.label, port: options.port, sourceStateSha256: sourceHash, deferMs: options['defer-ms'],
  applicationSource,
  workerIdleMs: IDLE_MS, productionWorkerIdleMs: 600000, idlePolicy: 'Accelerated retirement at 60 seconds; production default is 10 minutes.',
  startupDeadlineMs: TIMEOUT, rssPolicy: 'Process RSS, sampled every 500ms; main-thread heap/external/arrayBuffers; no forced GC.',
  warmPolicy: 'After explicit full tasks and prediction, startupWarmup settled when present, then repeated full tasks and prediction. Candidate preparation need not settle.', cells: [] };
try {
  if (options.condition !== 'both') {
    try {
      const previous = JSON.parse(await readFile(path.join(OUTPUT, `${options.label}.json`), 'utf8'));
      if (previous.schemaVersion === report.schemaVersion && previous.sourceStateSha256 === sourceHash
        && previous.deferMs === report.deferMs) report.cells = previous.cells.filter(cell => cell.condition !== options.condition);
    } catch {}
  }
  for (const condition of options.condition === 'both' ? ['idle', 'busy'] : [options.condition]) {
    await assertHeavyOwnership();
    const cell = await runCell(condition, sourceHash);
    await assertHeavyOwnership();
    if (JSON.stringify(await fingerprints()) !== JSON.stringify(applicationSource)) throw new Error('Application source changed during measurement.');
    report.cells.push(cell);
    report.cells.sort((a, b) => ['idle', 'busy'].indexOf(a.condition) - ['idle', 'busy'].indexOf(b.condition));
    await writeFile(path.join(OUTPUT, `${options.label}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ cell: report.cells.length, listeningMs: cell.listening?.processMs,
      health200Ms: cell.firstHealth200Ms, tasksMs: cell.firstBothTaskListsMs, predictMs: cell.firstPrediction.completedFromSpawnMs,
      warmRssBytes: cell.rss.warmBytes, sleepingRssBytes: cell.rss.sleepingBytes }));
    if (!cell.valid) throw new Error('Busy quick suite failed; cell marked invalid in report.');
  }
} catch {
  // Do not expose URLs, tokens, private state, or arbitrary child errors.
  console.error('Warmstart measurement failed; completed cells remain in the local report.');
  process.exitCode = 1;
}
