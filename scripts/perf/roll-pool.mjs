// Counts, timings and hashes only. The source store is copied before opening.
// Run with the same dataset/pack/defaults environment as the server.
// node scripts/perf/roll-pool.mjs --store /scratch/store --out /tmp/report.json
import { registerHooks } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cp, copyFile, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const calls = [];
globalThis.__rollPoolProbe = (ms, stack) => {
  const site = ['applyCommandCopy', 'rankingPoolIds', 'stateEnvelope', 'rollPools'].find(name => stack.includes(name))
    ?? (stack.includes('execute') ? 'sandbox' : 'death-estimates');
  calls.push({ site, ms });
};
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/app/core/rules.mjs')) return result;
  const source = String(result.source).replace('export function evaluateRollPool(', 'function inlineRollPool(');
  return { ...result, source: source + `\nexport function evaluateRollPool(...args) {
    const start = performance.now(); const stack = new Error().stack;
    try { return inlineRollPool(...args); }
    finally { globalThis.__rollPoolProbe(performance.now() - start, stack); }
  }\n` };
} });
const { values } = parseArgs({ options: { store: { type: 'string' }, out: { type: 'string' }, runs: { type: 'string', default: '5' }, 'app-dir': { type: 'string' } } });
if (!values.store || !values.out) throw new Error('Use --store and --out outside the checkout.');
const appDir = values['app-dir'] ? path.resolve(values['app-dir']) : fileURLToPath(new URL('../../app/', import.meta.url));
const { createServer } = await import(pathToFileURL(path.join(appDir, 'server.mjs')).href);
const { ProcessWorker } = await import(pathToFileURL(path.join(appDir, 'tasks/process-worker.mjs')).href);
const workers = new Set(), on = ProcessWorker.prototype.on;
ProcessWorker.prototype.on = function(...args) { workers.add(this); return on.apply(this, args); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { runs: [] };
for (let run = 0; run < Number(values.runs); run++) {
  const root = await mkdtemp(path.join(tmpdir(), 'roll-pool-')), dataDir = path.join(root, 'game');
  let app;
  try {
    await cp(path.resolve(values.store), dataDir, { recursive: true });
    await copyFile(path.resolve(values.store) + '.dataset.json', dataDir + '.dataset.json').catch(error => { if (error.code !== 'ENOENT') throw error; });
    app = await createServer({ dataDir, port: 0, predictionPrewarm: false, retention: false, random: () => 0.25,
      taskWorkerOptions: { idleMs: 600000 }, shutdownDeadlineMs: 5000,
      runeMetrics: { fetchImpl: async () => { throw new Error('Offline measurement.'); } },
      originalSync: { fetchImpl: async () => { throw new Error('Offline measurement.'); } } });
    const measurements = [], workerPeaks = new Map();
    async function measure(type, action) {
      const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable(); await pause(30);
      calls.length = 0; const started = performance.now();
      const response = await action();
      const wallMs = performance.now() - started;
      await pause(30); histogram.disable();
      measurements.push({ type, wallMs, loopMaxMs: histogram.max / 1e6, loopP99Ms: histogram.percentile(99) / 1e6,
        ...(response?.httpStatus ? { httpStatus: response.httpStatus, estimateCount: response.estimateCount } : {}),
        calls: calls.slice(), rssBytes: process.memoryUsage.rss() });
      // Sample before a later save can retire an advisory process. VmHWM
      // retains peaks missed while synchronous calculator work blocks timers.
      for (const worker of workers) {
        try {
          const peak = Number(/^VmHWM:\s+(\d+)/m.exec(await readFile(`/proc/${worker.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
          workerPeaks.set(worker.pid, Math.max(workerPeaks.get(worker.pid) ?? 0, peak));
        } catch { /* An exited process was sampled at its preceding response. */ }
      }
      console.log(JSON.stringify({ run, phase: type, wallMs, loopMaxMs: histogram.max / 1e6, inlineCalls: calls.length }));
      return response;
    }
    await measure('state-load', () => app.listen());
    const origin = `http://127.0.0.1:${app.address().port}`;
    const headers = { Authorization: `Bearer ${app.store.getAccessToken()}`, Origin: origin, 'Content-Type': 'application/json' };
    const request = async (route, body) => {
      const response = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      if (!response.ok) { await response.body.cancel(); throw new Error(`Measurement request status ${response.status}.`); }
      return response.json();
    };
    let state = (await measure('state', () => request('/api/state?view=play-v1'))).state;
    const member = state.members.find(owner => !owner.pendingRoll.length) ?? state.members[0];
    await measure('ranking', () => request('/api/pool-ranking?memberId=' + encodeURIComponent(member.id)));
    await measure('sandbox', () => request('/api/sandbox/evaluate', { memberId: member.id, baseRevision: state.revision,
      changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } }));
    await measure('death-estimates', async () => {
      const response = await fetch(origin + '/api/death-estimates?memberId=' + encodeURIComponent(member.id),
        { headers, signal: AbortSignal.timeout(180000) });
      const body = await response.json();
      return { httpStatus: response.status, estimateCount: body.estimates?.length ?? 0 };
    });
    if (member.pendingRoll.length) state = (await request('/api/command?view=play-v1', { expectedRevision: state.revision,
      command: { type: 'cancel-roll', memberId: member.id } })).state;
    state = (await measure('roll', () => request('/api/command?view=play-v1', { expectedRevision: state.revision,
      command: { type: 'roll', memberId: member.id, count: 1 } }))).state;
    await measure('state-after', () => request('/api/state?view=play-v1'));
    const backup = await app.store.backup();
    await measure('envelope', () => request('/api/restore?view=play-v1', { expectedRevision: state.revision, backup }));
    const workerRSS = [...workerPeaks.values()];
    report.runs.push({ measurements, mainPeakRSSBytes: process.resourceUsage().maxRSS * 1024, workerPeakRSSBytes: workerRSS });
    await writeFile(values.out, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ run, measurements: measurements.map(({ type, wallMs, loopMaxMs, calls }) => ({ type, wallMs, loopMaxMs, callCount: calls.length })) }));
  } catch { console.error(JSON.stringify({ errorCount: 1 })); process.exitCode = 1; break; }
  finally { await app?.close(); await rm(root, { recursive: true, force: true }); workers.clear(); }
}
