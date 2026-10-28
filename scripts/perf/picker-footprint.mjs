import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { copyTree, inventory, encode, outside, noLinks, assertReleased } from '../linux/files.mjs';

const here = fileURLToPath(import.meta.url);
const probe = new URL('./picker-footprint-probe.mjs', import.meta.url).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const numeric = value => typeof value === 'number' ? Number.isFinite(value) : Array.isArray(value)
  ? value.every(numeric) : value !== null && typeof value === 'object' && Object.values(value).every(numeric);

async function cloneStore(source, target) {
  await assertReleased(source);
  const rows = await copyTree(source, target);
  try { await noLinks(source + '.dataset.json'); await copyFile(source + '.dataset.json', target + '.dataset.json', 1); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
}

async function trial(config) {
  const sample = phase => globalThis[Symbol.for('rs3.footprint.sample')](phase);
  const snapshots = { beforeImport: sample(1) };
  const controller = new AbortController();
  const module = name => import(pathToFileURL(path.join(config.appDir, name)).href);
  const workers = new Set();
  const { ProcessWorker } = await module('tasks/process-worker.mjs');
  const on = ProcessWorker.prototype.on;
  ProcessWorker.prototype.on = function(...args) { workers.add(this); return on.apply(this, args); };
  const { createServer } = await module('server.mjs');
  snapshots.afterImport = sample(2);
  const { createRuleRegistry } = await module('core/rules.mjs');
  const { createGroupState } = await module('core/state.mjs');
  const { openStore } = await module('storage/store.mjs');
  const { prepareGameStorage } = await module('game-profile.mjs');
  const { selectedDataset } = await module('dataset-runtime.mjs');
  const registry = createRuleRegistry();
  const initialState = config.solo ? createGroupState([{ id: 'owner', name: 'Owner', unlocked: [] }], registry) : undefined;
  let app, timer, rejectGuard, guardFailed = false;
  const guard = new Promise((_, reject) => { rejectGuard = reject; });
  function checkRSS() {
    let rss = process.memoryUsage.rss();
    for (const worker of workers) {
      try { rss += Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${worker.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; }
      catch { /* A retired worker has no /proc entry. */ }
    }
    if (rss > config.maxRSS && !guardFailed) {
      guardFailed = true; controller.abort(); rejectGuard(new Error('Memory guard.'));
      for (const worker of workers) void worker.terminate();
    }
  }
  const stop = () => { controller.abort(); rejectGuard(new Error('Trial interrupted.')); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const run = async () => {
    // New master credential exists only in the task-owned scratch copy.
    await mkdir(config.store, { recursive: true, mode: 0o700 });
    await prepareGameStorage(config.store, selectedDataset);
    await writeFile(path.join(config.store, 'access-token'), randomBytes(32).toString('base64url'), { mode: 0o600 });
    app = await createServer({ dataDir: config.store, port: config.port, host: '127.0.0.1',
      initialState, startupSignal: controller.signal, predictionPrewarm: false,
      shutdownDeadlineMs: 5000,
      runeMetrics: { fetchImpl: async () => { throw new Error('Offline footprint trial.'); } },
      originalSync: { fetchImpl: async () => { throw new Error('Offline footprint trial.'); } },
      retention: config.retention });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    let cookie;
    async function request(route) {
      const response = await fetch(new URL(route, origin), { redirect: 'manual',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]),
        headers: cookie ? { Cookie: cookie } : {} });
      if (response.status >= 400) { await response.body?.cancel(); throw new Error('Footprint request refused.'); }
      return response;
    }
    cookie = (await request('/join/' + app.store.getAccessToken())).headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Scratch authentication failed.');
    const diagnostics = async () => (await request('/api/diagnostics')).json();
    async function sleepWorkers() {
      const until = performance.now() + config.idleMs + 60000;
      while (performance.now() < until) {
        const d = await diagnostics();
        if ([d, d.predictionLane, d.deathLane, d.duoLane].every(lane => !lane?.worker || ['sleeping', 'idle'].includes(lane.worker.status) && !lane.worker.retiring)) {
          globalThis.gc(); await pause(50); return sample(4);
        }
        await pause(100);
      }
      throw new Error('Workers did not sleep.');
    }
    snapshots.idle = await sleepWorkers();
    const { members, initialProgress } = (() => {
      const initial = app.store.getCalculationSnapshot().state;
      return { members: initial.members.map(member => member.id), initialProgress: {
        members: initial.members.length, revision: initial.revision,
        unlocked: initial.members.reduce((n, member) => n + member.unlocked.length, 0),
        completed: initial.members.reduce((n, member) => n + member.completedTasks.length, 0) } };
    })();
    const evaluations = [];
    for (let index = 0; index < members.length; index++) {
      // Sleep clears calculator caches. Each member gets an uncached cold wake,
      // followed immediately by the identical full HTTP query (warm/cache hit).
      await sleepWorkers();
      for (const repeat of [0, 1]) {
        const before = sample(5), start = performance.now();
        await (await request(`/api/tasks?memberId=${encodeURIComponent(members[index])}`)).arrayBuffer();
        evaluations.push({ member: index, repeat, startMs: before.atMs, endMs: Date.now(), wallMs: performance.now() - start,
          before, after: sample(6) });
      }
    }
    // Full state envelope evaluates every member's roll pool on the HTTP loop.
    // No earlier /api/state request has populated its response cache.
    const poolBefore = sample(7), poolStart = performance.now();
    await (await request('/api/state')).arrayBuffer();
    const rollPool = { startMs: poolBefore.atMs, endMs: Date.now(), wallMs: performance.now() - poolStart,
      before: poolBefore, after: sample(8) };
    snapshots.asleep = await sleepWorkers();
    // Release the scratch writer before making immutable store-only copies.
    // Keep the original handle/runtime reachable as the shared baseline.
    await app.close();
    const contexts = [];
    for (const count of [1, 3]) {
      const opened = [];
      globalThis.gc(); const before = sample(9);
      try {
        for (let i = 0; i < count; i++) {
          controller.signal.throwIfAborted();
          const destination = path.join(config.root, `context-${count}-${i}`);
          await cloneStore(config.store, destination);
          const store = await openStore({ dataDir: destination, world: app.world, registry, retention: false });
          opened.push(store);
          checkRSS(); controller.signal.throwIfAborted();
        }
        globalThis.gc(); await pause(50); const after = sample(10);
        contexts.push({ count, before, after, retainedHeapBytes: after.memory.heapUsed - before.memory.heapUsed,
          perContextHeapBytes: (after.memory.heapUsed - before.memory.heapUsed) / count });
      } finally { for (const store of opened) await store.close(); }
    }
    return { snapshots, evaluations, rollPool, contexts, initialProgress,
      storeBytes: (await inventory(config.store)).reduce((sum, row) => sum + (row.bytes ?? 0), 0),
      bindingBytes: (await readFile(config.store + '.dataset.json').catch(error => { if (error.code !== 'ENOENT') throw error; return Buffer.alloc(0); })).length,
      datasetDigestBytes: [...Buffer.from(app.dataset.digest, 'hex')] };
  };
  let running;
  try {
    timer = setInterval(checkRSS, 50); checkRSS();
    running = run();
    return await Promise.race([running, guard]);
  } finally {
    clearInterval(timer); controller.abort();
    await running?.catch(() => {});
    await app?.close();
    for (const worker of workers) await worker.terminate();
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['pointer', 'app-dir', 'store', 'port', 'out', 'max-rss-mib', 'idle-ms', 'internal'].map(key => [key, { type: 'string' }])) });
  if (values['internal']) {
    const config = JSON.parse(await readFile(values['internal'], 'utf8'));
    const result = await trial(config);
    await writeFile(config.result, encode(result), { mode: 0o600 });
    return;
  }
  const port = Number(values.port ?? 0), maxRSS = Number(values['max-rss-mib'] ?? 3500) * 1024 ** 2;
  const idleMs = Number(values['idle-ms'] ?? 2000);
  if (!values.store || !values.out || (!!values.pointer === !!values['app-dir']) ||
    !Number.isInteger(port) || port !== 0 && (port < 8900 || port > 8999) ||
    !Number.isFinite(maxRSS) || maxRSS <= 0 || !Number.isSafeInteger(idleMs) || idleMs < 100)
    throw new Error('Invalid footprint arguments.');
  const source = path.resolve(values.store), output = path.resolve(values.out);
  outside(source, output); outside(source + '.dataset.json', output);
  await noLinks(path.dirname(output));
  await noLinks(source); await assertReleased(source);
  const original = encode(await inventory(source));
  let binding;
  try { binding = await readFile(source + '.dataset.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-picker-footprint-'));
  try {
    const { readRelease, runtimeEnvironment, assertSameRelease } = await import('../linux/runtime.mjs');
    let release, config;
    if (values.pointer) {
      const pointer = JSON.parse(await readFile(values.pointer, 'utf8'));
      const pinned = JSON.parse(await readFile(pointer.config.path, 'utf8'));
      release = await readRelease(path.resolve(values.pointer), pinned.dataDir);
      config = release.config;
    } else {
      const appDir = path.resolve(values['app-dir']);
      await noLinks(appDir);
      config = { coreRoot: path.dirname(appDir), datasetId: 'open-f2p', packsDir: path.join(root, 'packs'), selection: { path: path.join(root, 'packs', 'selection.json') } };
      if (path.basename(appDir) !== 'app') throw new Error('Use an app directory.');
    }
    outside(values.pointer ? config.coreRoot : path.join(config.coreRoot, 'app'), output);
    const startedAtMs = Date.now();
    const report = { schemaVersion: 1, startedAtMs, nodeVersion: process.versions.node.split('.').map(Number),
      linux: Number(process.platform === 'linux'), cpuCount: cpus().length, totalRAMBytes: totalmem(),
      releaseIdUtf8: [...Buffer.from(values.pointer ? path.basename(path.dirname(path.resolve(values.pointer))) : 'synthetic')],
      workerMode: 1, idleMs, sampleIntervalMs: 100, maxRSSBytes: maxRSS, trials: [] };
    for (const solo of [0, 1]) {
      const trialRoot = path.join(root, `trial-${solo}`), samples = path.join(trialRoot, 'samples');
      await mkdir(samples, { recursive: true, mode: 0o700 });
      const store = path.join(trialRoot, 'store');
      const sourceBytes = solo ? 0 : await cloneStore(source, store);
      const trialConfig = { appDir: path.join(config.coreRoot, 'app'), root: trialRoot, store, port, solo, idleMs, maxRSS,
        retention: Object.fromEntries(Object.entries({ backupDays: config.runtimeOptions?.backupDays, historyEntries: config.runtimeOptions?.historyEntries }).filter(([, value]) => value != null)),
        result: path.join(trialRoot, 'result.json') };
      const input = path.join(trialRoot, 'input.json'); await writeFile(input, encode(trialConfig), { mode: 0o600 });
      const env = { ...runtimeEnvironment(config, { probe: true }),
        RS3_TASK_WORKER_MODE: 'process', RS3_WORKER_IDLE_MS: String(idleMs),
        RS3_FOOTPRINT_SAMPLES: samples, RS3_STARTUP_TIMING_LOG: path.join(trialRoot, 'phases.jsonl'),
        RS3_WORKER_MEMORY_PROBE_IMPORT: probe };
      let processTreePeakRSSBytes = 0;
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--expose-gc', '--import', probe, here, '--internal', input],
          { env, stdio: 'ignore', windowsHide: true });
        // Separate supervisor keeps watching while the HTTP or calculator loop
        // is blocked in synchronous work. Linux RSS is a process-tree sum.
        let exceeded = false, force;
        const interrupt = () => { exceeded = true; child.kill('SIGTERM'); };
        process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
        const cleanup = () => {
          clearInterval(monitor); clearTimeout(force);
          process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);
        };
        const monitor = setInterval(() => {
          if (process.platform !== 'linux' || exceeded) return;
          const pids = [];
          function visit(pid) {
            pids.push(pid);
            try { for (const id of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) visit(Number(id)); }
            catch { /* Process exited. */ }
          }
          visit(child.pid);
          const rss = pids.reduce((sum, pid) => {
            try { return sum + Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; }
            catch { return sum; }
          }, 0);
          processTreePeakRSSBytes = Math.max(processTreePeakRSSBytes, rss);
          if (rss > maxRSS) {
            exceeded = true; child.kill('SIGTERM');
            force = setTimeout(() => { for (const pid of pids.reverse()) try { process.kill(pid, 'SIGKILL'); } catch {} }, 5000);
          }
        }, 50);
        child.once('error', error => { cleanup(); reject(error); });
        child.once('exit', code => { cleanup();
          code === 0 && !exceeded ? resolve() : reject(new Error('Footprint child failed; inputs, memory guard or trial timeout.')); });
      });
      const result = JSON.parse(await readFile(trialConfig.result, 'utf8'));
      const series = [];
      for (const name of (await readdir(samples)).sort()) {
        const rows = (await readFile(path.join(samples, name), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
        series.push({ pid: rows[0].pid, thread: rows[0].thread, rows });
      }
      const main = series.find(s => s.pid === result.snapshots.beforeImport.pid && s.thread === 0);
      result.snapshots.afterStoreOpen = main?.rows.find(row => row.phase === 3);
      if (!result.snapshots.afterStoreOpen) throw new Error('Installed release lacks the expected startup phase.');
      for (const evaluation of [...result.evaluations, result.rollPool]) {
        const workerSeries = series.filter(s => s.pid !== main.pid);
        evaluation.workers = workerSeries.map(s => {
          const during = s.rows.filter(row => row.atMs >= evaluation.startMs && row.atMs <= evaluation.endMs);
          if (!during.length) return undefined;
          const before = s.rows.findLast(row => row.atMs < evaluation.startMs) ?? during[0];
          const after = during.at(-1);
          return { pid: s.pid, thread: s.thread, cpuUserUs: Math.max(0, after.cpu.user - before.cpu.user),
            cpuSystemUs: Math.max(0, after.cpu.system - before.cpu.system),
            heapPeakBytes: Math.max(...during.map(r => r.memory.heapUsed)),
            rssPeakBytes: Math.max(...during.map(r => r.memory.rss)),
            vmHWMPeakBytes: Math.max(...during.map(r => r.proc.vmHWM)) };
        }).filter(Boolean);
        // Host cpuUsage covers its calculator thread too: sum hosts only.
        evaluation.mainCpuUserUs = evaluation.after.cpu.user - evaluation.before.cpu.user;
        evaluation.mainCpuSystemUs = evaluation.after.cpu.system - evaluation.before.cpu.system;
        evaluation.workerCpuUserUs = evaluation.workers.filter(s => s.thread === 0).reduce((n, s) => n + s.cpuUserUs, 0);
        evaluation.workerCpuSystemUs = evaluation.workers.filter(s => s.thread === 0).reduce((n, s) => n + s.cpuSystemUs, 0);
      }
      report.trials.push({ solo, sourceBytes, processTreePeakRSSBytes, ...result, series });
    }
    if (original !== encode(await inventory(source))) throw new Error('Source changed during trial.');
    const afterBinding = await readFile(source + '.dataset.json').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (binding?.toString('hex') !== afterBinding?.toString('hex')) throw new Error('Source binding changed.');
    if (release) await assertSameRelease(release);
    report.finishedAtMs = Date.now();
    if (!numeric(report)) throw new Error('Non-numeric report rejected.');
    // Never overwrite an input or pre-existing output, including linked files.
    await writeFile(output, encode(report), { flag: 'wx', mode: 0o600 });
  } finally {
    // root is the exact directory returned by mkdtemp, never a caller's path.
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  main().catch(error => { process.stderr.write(`Footprint refused or aborted: ${error?.message ?? error}\nCheck matching inputs, free port and RSS budget.\n`); process.exitCode = 1; });
}
