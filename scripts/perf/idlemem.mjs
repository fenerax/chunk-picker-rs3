#!/usr/bin/env node
// One isolated server, frozen private store, numeric reports and observational idle.
import { fork, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { captureIdleScreens } from './idlemem-screens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, '.local/idlemem');
const TIMEOUT = 300000;
const maxOldSpaceMiB = process.env.RS3_PERF_HEAP_MB === undefined ? null : Number(process.env.RS3_PERF_HEAP_MB);
if (maxOldSpaceMiB !== null && (!Number.isInteger(maxOldSpaceMiB) || maxOldSpaceMiB < 128 || maxOldSpaceMiB > 1024)) throw new TypeError('RS3_PERF_HEAP_MB must be an integer from 128 to 1024.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceFingerprint(directory) {
  const hash = createHash('sha256'); let files = 0;
  async function visit(base) {
    const entries = (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const filename = path.join(base, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (/\.(?:mjs|json|css|html)$/.test(entry.name)) {
        hash.update(path.relative(directory, filename).split(path.sep).join('/')); hash.update(await readFile(filename)); files++;
      }
    }
  }
  await visit(directory); return { sha256: hash.digest('hex'), files };
}
const within = (base, target) => { const relative = path.relative(base, target); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const options = { port: 9151, source: path.join(ROOT, '.local/duo'), 'post-gc': 'off', screens: 'off', 'idle-ms': 60000, 'observe-idle-ms': 600000 };
const usage = 'Use --label before|after[-N] [--source PATH] [--port 8900..8999|9151] [--entry PATH] [--post-gc off|on] [--screens off|on] [--idle-ms 60000] [--observe-idle-ms 600000].';
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!value || !['--label', '--source', '--port', '--entry', '--post-gc', '--screens', '--idle-ms', '--observe-idle-ms'].includes(key)) throw new Error(usage);
  options[key.slice(2)] = ['--port', '--idle-ms', '--observe-idle-ms'].includes(key) ? Number(value) : value;
}
if (!/^(?:before|after)(?:-[1-9]\d{0,3})?$/.test(options.label ?? '') || !Number.isInteger(options.port)
  || !(options.port === 9151 || options.port >= 8900 && options.port <= 8999)
  || !['off', 'on'].includes(options['post-gc']) || !['off', 'on'].includes(options.screens)) throw new Error(usage);
for (const key of ['idle-ms', 'observe-idle-ms']) {
  if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 2147483647) throw new Error('Idle durations must be positive integers within the timer range.');
}
const retirementDeadlineMs = Math.max(TIMEOUT, options['idle-ms'] + 30000);
const observationalIdlePhase = options['observe-idle-ms'] === 600000 ? 'idle10' : 'idleObserved';
options.source = path.resolve(options.source);
if (options.entry) options.entry = path.resolve(options.entry);
async function assertHeavyOwnership() {
  const { RS3_HEAVY_LOCK_PATH: lock, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!lock || !token || !pid) throw new Error('Run idlemem through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(lock, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || owner.pid !== Number(pid)) throw new Error('Shared heavy-work ownership changed.');
}
async function rejectLinks(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked sources are unsupported.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked sources are unsupported.');
    if (entry.isDirectory()) await rejectLinks(path.join(directory, entry.name));
  }
}
async function removeScratch(directory) {
  const base = await realpath(OUTPUT), target = await realpath(directory);
  if (!within(base, target) || !path.basename(target).startsWith('scratch-')) throw new Error('Unsafe scratch cleanup target.');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) {
    child.send({ type: 'stop' });
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(12000)]);
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  else child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) throw new Error('Owned server did not exit; scratch retained.');
}
// Only values from known public counter schemas reach reports. No response rows survive.
const numericTree = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,70}$/.test(key))
    .map(([key, item]) => [key, numericTree(item)]).filter(([, item]) => item !== undefined));
};
const safeStatus = value => ['ready', 'sleeping', 'starting', 'idle', 'waking', 'not-configured', 'closed', 'restarting', 'restart-required', 'pending', 'running', 'unavailable', 'disabled'].includes(value) ? value : null;
const lanes = diagnostic => [diagnostic, diagnostic.deathLane, diagnostic.duoLane, diagnostic.predictionLane].filter(Boolean);
const settled = diagnostic => lanes(diagnostic).every(lane => !lane.queue?.active && !lane.queue?.depth && !lane.prewarm?.pending && !lane.prewarm?.active && !lane.ranking?.pending && !lane.ranking?.active);
const warmReady = diagnostic => (!diagnostic.startupWarmup || ['ready', 'unavailable', 'sleeping', 'disabled'].includes(diagnostic.startupWarmup.status)) && settled(diagnostic);
const sleeping = diagnostic => settled(diagnostic) && lanes(diagnostic).every(lane => lane.worker?.resident !== true && !lane.worker?.retiring);
const safeDiagnostic = diagnostic => {
  const safe = {};
  // Names are schema fields, never player IDs, cache keys or result strings.
  for (const key of ['worker', 'queue', 'counts', 'cache', 'prewarm', 'ranking', 'timingMs', 'unlockReuse', 'deathLane', 'duoLane', 'predictionLane',
    'poolRanking', 'referenceCache', 'startupTimingMs', 'startupPrepared', 'startupWarmup', 'viewerTaskCache', 'responseCache', 'staticCache', 'idleGc']) {
    if (diagnostic[key] !== undefined) safe[key] = numericTree(diagnostic[key]);
  }
  safe.startupWarmupStatus = safeStatus(diagnostic.startupWarmup?.status);
  safe.laneStatus = Object.fromEntries([['foreground', diagnostic], ['death', diagnostic.deathLane], ['duo', diagnostic.duoLane], ['prediction', diagnostic.predictionLane]]
    .map(([name, lane]) => [name, safeStatus(lane?.worker?.status)]));
  return safe;
};
function selectWorkflow(data) {
  const members = data.state.members;
  if (members.length !== 2) throw new Error('A two-player frozen store is required.');
  const member = members[0], unlocked = new Set(member.unlocked.map(String));
  const candidates = [...(member.pendingRoll ?? []), ...(member.selected ?? []), ...(data.pools?.[member.id]?.eligible ?? []).map(row => row.id)];
  const chunkId = candidates.map(String).find(id => /^[1-9]\d*$/.test(id) && !unlocked.has(id)) ?? '7463';
  if (unlocked.has(chunkId)) throw new Error('No locked preview candidate available.');
  return { memberIds: members.map(member => member.id), chunkId };
}
const requestSummary = (data, elapsedMs, bytes) => ({ elapsedMs, responseBytes: bytes, taskCount: data.tasks?.length ?? null,
  cache: numericTree(data.cache) });

async function measure(sourceHash, report) {
  const directory = await mkdtemp(path.join(OUTPUT, 'scratch-'));
  const dataDir = path.join(directory, 'duo'), token = randomBytes(32).toString('base64url');
  const origin = `http://127.0.0.1:${options.port}`;
  let child, memoryLoop, keepSampling = true, probeId = 0, spawnedAt, peakRssBytes = 0, peakSamples = 0;
  const persist = () => writeFile(path.join(OUTPUT, `${options.label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const rpc = (type, timeout = 30000) => new Promise((resolve, reject) => {
    const id = ++probeId;
    const done = (error, value) => { clearTimeout(timer); child.off('message', listener); child.off('exit', exited); error ? reject(error) : resolve(value); };
    const listener = message => { if (message?.id !== id) return; if (message.type === type) done(null, message); else if (message.type === 'probe-error') done(new Error('Memory probe failed.')); };
    const exited = () => done(new Error('Owned process exited.'));
    const timer = setTimeout(() => done(new Error('Memory probe timeout.')), timeout);
    child.on('message', listener); child.once('exit', exited);
    child.send({ type, id }, error => { if (error) done(new Error('Memory IPC failed.')); });
  });
  const request = async (route, consume) => {
    const started = performance.now();
    const response = await fetch(`${origin}${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
    const bytes = await response.arrayBuffer();
    if (response.status !== 200) throw new Error('Measurement HTTP request failed.');
    // Callback retains only IDs needed for the next read or numeric result summaries.
    return consume(JSON.parse(Buffer.from(bytes).toString('utf8')), performance.now() - started, bytes.byteLength);
  };
  const diagnostic = () => request('/api/diagnostics', data => data);
  const poll = async (predicate, timeout) => {
    const deadline = performance.now() + timeout;
    while (true) {
      const value = await diagnostic();
      if (predicate(value)) return safeDiagnostic(value);
      if (performance.now() >= deadline) throw new Error('Worker milestone timeout.');
      await sleep(500);
    }
  };
  const sample = async (phase, diagnostics, type = 'sample') => {
    await assertHeavyOwnership();
    const memory = await rpc(type);
    const value = { fromSpawnMs: performance.now() - spawnedAt, ...memory };
    delete value.type; delete value.id;
    if (diagnostics) value.diagnostics = diagnostics;
    report.samples[phase] = value;
    peakRssBytes = Math.max(peakRssBytes, memory.totalRssBytes ?? memory.main.memoryUsage.rss);
    report.rss = { peakSampledBytes: peakRssBytes, sampleCount: peakSamples };
    await persist();
    console.log(JSON.stringify({ phase, rssBytes: memory.totalRssBytes ?? memory.main.memoryUsage.rss, mainHeapUsedBytes: memory.main.memoryUsage.heapUsed, activeWorkers: memory.activeWorkerCount }));
    return value;
  };
  try {
    await cp(options.source, dataDir, { recursive: true, dereference: false, filter: filename => !['store.lock', 'access-token'].includes(path.basename(filename)) });
    if (sha256(await readFile(path.join(dataDir, 'state.json'))) !== sourceHash || sha256(await readFile(path.join(options.source, 'state.json'))) !== sourceHash) throw new Error('Frozen source changed during copy.');
    await writeFile(path.join(dataDir, 'access-token'), `${token}\n`, { mode: 0o600 });
    const env = { ...process.env, RS3_IDLEMEM_SCRATCH: dataDir, RS3_DATA_DIR: dataDir, RS3_IDLEMEM_PORT: String(options.port),
      RS3_WORKER_IDLE_MS: String(options['idle-ms']), RS3_IDLEMEM_IDLE_MS: String(options['idle-ms']) };
    if (options.entry) env.RS3_IDLEMEM_ENTRY = options.entry; else delete env.RS3_IDLEMEM_ENTRY;
    delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT; delete env.NODE_OPTIONS;
    if (maxOldSpaceMiB !== null) env.NODE_OPTIONS = `--max-old-space-size=${maxOldSpaceMiB}`;
    spawnedAt = performance.now();
    child = fork(path.join(ROOT, 'scripts/perf/idlemem-server.mjs'), [], { cwd: ROOT, env, execArgv: ['--expose-gc'], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Scratch startup timeout.')), TIMEOUT);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Scratch process failed.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Scratch process exited.')); });
      child.on('message', message => {
        if (message?.type === 'start') { report.samples.start = { fromSpawnMs: performance.now() - spawnedAt, elapsedMs: message.elapsedMs, main: message.main, workers: [], activeWorkerCount: 0 }; peakRssBytes = Math.max(peakRssBytes, message.main.memoryUsage.rss); }
        if (message?.type === 'imports') report.samples.imports = { fromSpawnMs: performance.now() - spawnedAt, elapsedMs: message.elapsedMs, main: message.main, workers: [], activeWorkerCount: 0 };
        if (message?.type === 'listening') report.listeningMs = performance.now() - spawnedAt;
        if (message?.type === 'ready') { clearTimeout(timer); report.readyMs = performance.now() - spawnedAt; resolve(); }
        if (message?.type === 'error') { clearTimeout(timer); reject(new Error('Scratch startup failed.')); }
      });
    });
    memoryLoop = (async () => {
      while (keepSampling) {
        try { const memory = await rpc('rss', 10000); peakRssBytes = Math.max(peakRssBytes, memory.rssBytes); peakSamples++; } catch {}
        await sleep(500);
      }
    })();
    await ready;
    await sample('warm', await poll(warmReady, TIMEOUT));
    const workflow = await request('/api/state?view=play-v1', selectWorkflow);
    const fullLists = async () => {
      const started = performance.now();
      const tasks = await Promise.all(workflow.memberIds.map(memberId => request(`/api/tasks?memberId=${encodeURIComponent(memberId)}`, requestSummary)));
      return { batchMs: performance.now() - started, tasks };
    };
    report.firstUse = await fullLists();
    report.firstUse.preview = await request(`/api/predict?memberId=${encodeURIComponent(workflow.memberIds[0])}&chunkId=${encodeURIComponent(workflow.chunkId)}`, requestSummary);
    await sample('firstUse', safeDiagnostic(await diagnostic()));
    const retirementStarted = performance.now();
    const retirementDiagnostic = await poll(sleeping, retirementDeadlineMs);
    report.retirementObservedWaitMs = performance.now() - retirementStarted;
    // Worker 'exit' and allocator cleanup can trail scheduler residency notices.
    await sleep(3000);
    const retired = await sample('retiredPlus3s', retirementDiagnostic);
    if (retired.activeWorkerCount !== 0) throw new Error('Worker retirement incomplete.');
    const idleStarted = performance.now();
    // No application requests during the explicitly configured observation window.
    await sleep(options['observe-idle-ms']);
    report.observedIdleMs = performance.now() - idleStarted;
    const idle = await sample(observationalIdlePhase, safeDiagnostic(await diagnostic()));
    if (idle.activeWorkerCount !== 0) throw new Error('Unexpected worker activity during idle.');
    report.wake = { afterForcedGc: false };
    report.wake.compactFirst = await request(`/api/tasks?memberId=${encodeURIComponent(workflow.memberIds[0])}&view=play-v1`, requestSummary);
    report.wake.full = await fullLists();
    await sample('wake', safeDiagnostic(await diagnostic()));
    if (options['post-gc'] === 'on') {
      const secondRetirementStarted = performance.now();
      const secondRetirementDiagnostic = await poll(sleeping, retirementDeadlineMs);
      report.wakeRetirementObservedWaitMs = performance.now() - secondRetirementStarted;
      await sleep(3000);
      const beforeGc = await sample('wakeRetiredPlus3s', secondRetirementDiagnostic);
      if (beforeGc.activeWorkerCount !== 0) throw new Error('Worker retirement incomplete.');
      const postGc = await sample('wakeRetiredPostGc', safeDiagnostic(await diagnostic()), 'gc');
      const before = beforeGc.main.memoryUsage, after = postGc.main.memoryUsage;
      report.gcAnalysis = { rssReleasedBytes: before.rss - after.rss, heapUsedReleasedBytes: before.heapUsed - after.heapUsed,
        heapTotalReleasedBytes: before.heapTotal - after.heapTotal, externalReleasedBytes: before.external - after.external,
        arrayBuffersReleasedBytes: before.arrayBuffers - after.arrayBuffers };
    }
    if (options.screens === 'on') {
      await assertHeavyOwnership();
      report.screenshots = await captureIdleScreens({ root: ROOT, scratch: directory, origin, token });
    }
    report.completed = true;
    report.rss = { peakSampledBytes: peakRssBytes, sampleCount: peakSamples };
    await persist();
  } finally {
    keepSampling = false;
    if (memoryLoop) await memoryLoop;
    await stopChild(child);
    await removeScratch(directory);
    if (sha256(await readFile(path.join(options.source, 'state.json'))) !== sourceHash) throw new Error('Frozen source changed during measurement.');
  }
}

try {
  await assertHeavyOwnership();
  await mkdir(OUTPUT, { recursive: true });
  if (!within(ROOT, await realpath(OUTPUT))) throw new Error('Report directory must be inside this worktree.');
  if (!within(ROOT, await realpath(options.source))) throw new Error('Frozen source must be inside this worktree.');
  await rejectLinks(options.source);
  if (options.entry && (!options.entry.endsWith('.mjs') || !within(ROOT, await realpath(options.entry)) || (await lstat(options.entry)).isSymbolicLink())) throw new Error('Use a local server module.');
  const sourceHash = sha256(await readFile(path.join(options.source, 'state.json')));
  const report = { schemaVersion: 1, label: options.label, port: options.port, maxOldSpaceMiB, completed: false, sourceStateSha256: sourceHash,
    applicationSource: await sourceFingerprint(path.dirname(options.entry ?? path.join(ROOT, 'app/server.mjs'))),
    entrySha256: sha256(await readFile(options.entry ?? path.join(ROOT, 'app/server.mjs'))), workerIdleMs: options['idle-ms'], productionWorkerIdleMs: 600000,
    acceleratedWorkerRetirement: options['idle-ms'] < 600000, retirementDeadlineMs, retirementSettleMs: 3000,
    observationalIdleMs: options['observe-idle-ms'], observationalIdlePhase, postGc: options['post-gc'] === 'on',
    idlePolicy: `Configured worker retirement at ${options['idle-ms']}ms, then retirement +3000ms, then ${options['observe-idle-ms']}ms additional observational idle. Production worker retirement defaults to 600000ms; shorter configured windows are diagnostic evidence.`,
    warmPolicy: 'Startup warmup terminal status and all lane foreground/prewarm/ranking queues settled before first full task lists and Preview.',
    memoryPolicy: 'Process RSS sampled every 500ms, never summed across threads; per-isolate heap/external/arrayBuffers at milestones. Worker status 0=starting, 1=online; exited workers removed. Main --expose-gc is identical for both paired runs and does not itself force GC. Optional inspector GC runs only after the configured observational idle, wake measurements and a second worker retirement +3s.',
    wakePolicy: 'Compact first-wake request precedes repeat full lists for both players, before any optional inspector GC.', samples: {} };
  await measure(sourceHash, report);
  await assertHeavyOwnership();
} catch {
  // Never echo private child errors, request URLs, tokens, payloads or saved strings.
  console.error('Idle-memory measurement failed; completed samples remain in the local report.');
  process.exitCode = 1;
}
