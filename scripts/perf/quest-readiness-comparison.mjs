// DISABLED: this script copied a private save and started the server on it, which can
// copy or create credentials. It refuses to run; kept as a record of the comparison method.
// Linux process-mode comparison; peak RSS samples the owned process tree.
// Compare readiness and unchanged task/pool outputs across evenly sampled
// copied-save snapshots. Only aggregate counts, hashes and measurements leave
// each child. Supply the matching dataset, pack and defaults environment.
// node scripts/perf/quest-readiness-comparison.mjs --baseline /tmp/start
//   --candidate . --source /tmp/copied-game --out /tmp/comparison.json
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['baseline', 'candidate', 'source', 'out', 'child'].map(key => [key, { type: 'string' }])) });
assert.ok(Number(process.versions.node.split('.')[0]) > 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 20, 'Node 24.20+ required.');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const PRIVATE_DISABLED = 'Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(canonical(value));
const spread = a => { const s = a.toSorted((a,b) => a-b); return { median: s[Math.floor(s.length / 2)], min: s[0], max: s.at(-1) }; };

async function child(config) {
  throw Error(PRIVATE_DISABLED);
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { createServer } = await load('app/server.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const { preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { buildQuestReadiness } = await load('app/tasks/activity-readiness.mjs');
  let app, scheduler;
  const observations = [], evaluationMs = [], readinessMs = [];
  try {
    app = await createServer({ dataDir: config.store, port: 0, predictionPrewarm: false, retention: false });
    const current = app.store.getCalculationSnapshot().state, world = app.world, dataset = app.dataset;
    const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a,b) => a.revision - b.revision);
    assert.ok(backups.length >= 7, 'Need seven retained snapshots.');
    await app.close();
    const states = [current];
    for (let n = 0; n < 7; n++) states.push((await app.store.readBackup(backups[Math.floor(n * (backups.length - 1) / 6)].id)).state);
    scheduler = await createTaskScheduler({ workerData: { definitions: world.definitions,
      world: { chunks: world.chunks, areas: world.areas, surface: world.surface },
      datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
      datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: preparedDefinitionStages(world.definitions) }, deadlineMs: 600000, startupDeadlineMs: 120000 });
    for (const [index, state] of states.entries()) for (const member of state.members) {
      let start = performance.now();
      const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `tasks-${index}-${member.id}`)).result;
      evaluationMs.push(performance.now() - start);
      // Time only the read-only readiness adapter, after the full worker result.
      start = performance.now();
      const readiness = buildQuestReadiness(result, state, member.id, world.definitions);
      readinessMs.push(performance.now() - start);
      const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, `pool-${index}-${member.id}`)).result.pool;
      observations.push({ tasks: hash(result.tasks), rows: result.tasks.length, pool: hash(pool),
        planning: hash({ access: result.access, items: result.items, training: result.training, presentation: result.presentation }),
        readiness: Object.fromEntries([...readiness].map(([id, facts]) => [hash(id), facts])) });
    }
    await writeFile(config.result, JSON.stringify({ states: states.length, observations,
      evaluationMs: spread(evaluationMs), readinessMs: spread(readinessMs) }), { mode: 0o600 });
  } finally { await scheduler?.close(); await app?.close(); }
}

async function main() {
  throw Error(PRIVATE_DISABLED);
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  for (const key of ['baseline', 'candidate', 'source', 'out']) assert.ok(values[key], `Missing --${key}.`);
  const source = path.resolve(values.source);
  for (const root of [values.baseline, values.candidate]) assert.ok(path.relative(path.resolve(root), source).startsWith('..'), 'Source must be outside checkouts.');
  const sourceHash = sha(await readFile(path.join(source, 'state.json')));
  const scratch = await mkdtemp(path.join(tmpdir(), 'quest-readiness-comparison-'));
  const pair = [];
  try {
    for (const [slot, root] of [values.baseline, values.candidate].entries()) {
      const dir = path.join(scratch, String(slot)), store = path.join(dir, 'game');
      await mkdir(dir); await cp(source, store, { recursive: true });
      await copyFile(source + '.dataset.json', store + '.dataset.json');
      const config = { root: path.resolve(root), store, result: path.join(dir, 'result.json') };
      const file = path.join(dir, 'config.json'); await writeFile(file, JSON.stringify(config), { mode: 0o600 });
      let peakRSSBytes = 0;
      const started = performance.now();
      await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', file], {
          cwd: config.root, env: { ...process.env, RS3_TASK_WORKER_MODE: 'process' }, stdio: ['ignore', 'ignore', 'pipe'] });
        let diagnosticBytes = 0; proc.stderr.on('data', b => { diagnosticBytes += b.length; });
        const sample = () => {
          const processes = new Map();
          for (const pid of readdirSync('/proc').filter(p => /^\d+$/.test(p))) try {
            const s = readFileSync(`/proc/${pid}/status`, 'utf8');
            processes.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(s)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(s)?.[1] ?? 0) * 1024 });
          } catch { /* Exited between discovery and sampling. */ }
          const visit = pid => (processes.get(pid)?.rss ?? 0) + [...processes].filter(([, p]) => p.parent === pid).reduce((n, [pid]) => n + visit(pid), 0);
          peakRSSBytes = Math.max(peakRSSBytes, visit(proc.pid));
        };
        const timer = setInterval(sample, 50);
        proc.once('error', error => { clearInterval(timer); reject(error); });
        proc.once('exit', code => { clearInterval(timer); code === 0 ? resolve() : reject(Error(`Comparison child failed (${code}); diagnostic bytes ${diagnosticBytes}.`)); });
      });
      pair.push({ ...JSON.parse(await readFile(config.result, 'utf8')), peakRSSBytes, wallMs: performance.now() - started });
      console.log(JSON.stringify({ completedRuns: pair.length }));
    }
    const [before, after] = pair;
    assert.equal(before.observations.length, after.observations.length);
    const differences = { tasks: 0, planning: 0, pools: 0, readiness: 0, personalCompletion: 0, readyAdded: 0, readyRemoved: 0 };
    before.observations.forEach((a, n) => {
      const b = after.observations[n];
      differences.tasks += Number(a.tasks !== b.tasks); differences.planning += Number(a.planning !== b.planning); differences.pools += Number(a.pool !== b.pool);
      for (const id of new Set([...Object.keys(a.readiness), ...Object.keys(b.readiness)])) {
        const x = a.readiness[id], y = b.readiness[id];
        differences.readiness += Number(canonical(x) !== canonical(y));
        differences.personalCompletion += Number(x?.personalCompleted !== y?.personalCompleted);
        differences.readyAdded += Number(!x?.canDoNow && y?.canDoNow);
        differences.readyRemoved += Number(x?.canDoNow && !y?.canDoNow);
      }
    });
    assert.equal(sha(await readFile(path.join(source, 'state.json'))), sourceHash);
    const timing = ({ evaluationMs, readinessMs, peakRSSBytes, wallMs }) => ({ evaluationMs, readinessMs, peakRSSBytes, wallMs });
    const report = { states: before.states, evaluations: before.observations.length,
      taskRows: before.observations.reduce((n, o) => n + o.rows, 0), sourceHash, differences,
      before: timing(before), after: timing(after) };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    assert.equal(differences.tasks + differences.planning + differences.pools + differences.personalCompletion + differences.readyRemoved, 0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(values.child ? 'Comparison child failed.' : error.message); process.exitCode = 1; });
