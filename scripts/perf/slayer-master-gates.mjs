// Compare START with the candidate, allowing only Slayer current-access changes.
// Public: node scripts/perf/slayer-master-gates.mjs --baseline /tmp/start
// Copied-save mode (--source) is disabled: it started the server on a private copy, which can
// copy or create credentials. Compare private saves with a pure filesystem reader instead.
// Reports contain aggregate counts, hashes, durations and memory only.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, cp, copyFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

if (Number(process.versions.node.split('.')[0]) < 24 || process.versions.node.startsWith('24.') && Number(process.versions.node.split('.')[1]) < 20) throw Error('Node 24.20+ required.');
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'source', 'out', 'internal'].map(key => [key, { type: 'string' }])) });
const here = fileURLToPath(import.meta.url), candidate = fileURLToPath(new URL('../..', import.meta.url));
const PRIVATE_DISABLED = 'Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (key, item) => ['elapsedMs', 'timingMs'].includes(key) ? undefined
  : item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const spread = values => { const sorted = [...values].sort((a, b) => a - b); return { median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, min: sorted[0], max: sorted.at(-1) }; };
function withoutCurrent(result) {
  const copy = structuredClone(result);
  for (const master of copy.activityInfo?.slayer?.masters ?? []) {
    if (master.name === 'Death') continue;
    delete master.currentAccess;
    if (master.warnings) delete master.warnings.current;
    for (const task of master.tasks) for (const key of ['currentUnlocked', 'currentStatus', 'currentQuests']) delete task[key];
  }
  return copy;
}
async function trial(config) {
  const load = name => import(pathToFileURL(path.join(config.checkout, name)));
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const { preparedDefinitionStages, prepareTaskDefinitions } = await load('app/dataset-pipeline.mjs');
  const { selectedDataset: dataset } = await load('app/dataset-runtime.mjs');
  const { buildWorld } = await load('app/data/world.mjs');
  const { createRuleRegistry, evaluateRollPool } = await load('app/core/rules.mjs');
  let world, states;
  if (config.store) {
    throw Error(PRIVATE_DISABLED);
    const { createServer } = await load('app/server.mjs');
    const app = await createServer({ dataDir: config.store, port: 0, predictionPrewarm: false, retention: false, now: () => Date.parse('2026-11-01T00:00:00Z') });
    try {
      const current = app.store.getState();
      const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a, b) => a.revision - b.revision);
      if (backups.length < 7) throw Error('Eight retained states required.');
      states = [];
      for (let i = 0; i < 7; i++) states.push((await app.store.readBackup(backups[Math.floor(i * (backups.length - 1) / 6)].id)).state);
      states.push(current);
      world = app.world;
    } finally { await app.close(); }
  } else {
    const definitions = prepareTaskDefinitions(JSON.parse(await readFile(path.join(config.checkout, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8')), dataset);
    definitions.chunks['10001'] = { NPC: { Vannaka: 1, Turael: 1 }, Monster: { Spider: 1 } };
    world = buildWorld(definitions, { dataset });
    states = Array.from({ length: 9 }, (_, index) => {
      const levels = { Attack: 20, Strength: 20, Defence: 20, Constitution: 24 + index % 3 * 4, Prayer: 20, Summoning: 20, Magic: 20, Ranged: 20, Necromancy: 20, Slayer: 1 };
      return { schemaVersion: 1, revision: index, tasks: [], history: [], rules: { 'content.f2p': false }, members: [{ id: 'a', name: 'Player', unlocked: ['10001'], completedTasks: [], passiveLevels: { Combat: 152, Slayer: 120 },
        skillProgress: Object.fromEntries(Object.entries(levels).map(([skill, level]) => [skill, { level, xp: 0, memberId: 'a', source: 'game-plugin', fetchedAt: '2026-11-01T00:00:00Z' }])) }] };
    });
  }
  const scheduler = await createTaskScheduler({ workerData: { definitions: world.definitions, world: { chunks: world.chunks, areas: world.areas, surface: world.surface },
    datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: preparedDefinitionStages(world.definitions) } });
  const rows = [], registry = createRuleRegistry();
  try {
    for (const state of states) for (const member of state.members) {
      const evaluated = await scheduler.evaluate(state, member.id, 'evaluate', undefined, `trial-${rows.length}`, `trial-${rows.length}`);
      const result = evaluated.result;
      const masters = result.activityInfo.slayer.masters.filter(master => master.name !== 'Death');
      rows.push({ inputHash: sha(canonical(state)), stableHash: sha(canonical(withoutCurrent(result))), fullHash: sha(canonical(result)), poolHash: sha(canonical(evaluateRollPool(world, state, member.id, registry))),
        usableMasterCount: masters.filter(master => master.tasks.some(task => task.currentUnlocked && task.currentStatus === 'doable')).length,
        unlockedCount: masters.reduce((sum, master) => sum + master.tasks.filter(task => task.currentUnlocked).length, 0),
        activityMs: evaluated.timingMs.activityMs, evaluationMs: evaluated.evaluationMs });
    }
  } finally { await scheduler.close(); }
  return { stateCount: states.length, rows };
}
async function main() {
  if (values.internal) {
    const config = JSON.parse(await readFile(values.internal, 'utf8'));
    await writeFile(config.result, JSON.stringify(await trial(config)), { mode: 0o600 }); return;
  }
  if (values.source) throw Error(PRIVATE_DISABLED);
  if (!values.baseline) throw Error('Pass --baseline START checkout.');
  const root = await mkdtemp(path.join(tmpdir(), 'slayer-master-gates-'));
  try {
    const runs = [];
    for (const [index, checkout] of [path.resolve(values.baseline), candidate].entries()) {
      const store = values.source ? path.join(root, `game-${index}`) : undefined;
      if (store) { await cp(path.resolve(values.source), store, { recursive: true }); await copyFile(path.resolve(values.source) + '.dataset.json', store + '.dataset.json'); }
      const config = { checkout, store, result: path.join(root, `result-${index}.json`) }, input = path.join(root, `input-${index}.json`);
      await writeFile(input, JSON.stringify(config), { mode: 0o600 });
      let peakRSSBytes = 0;
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [here, '--internal', input], { stdio: 'ignore', env: { ...process.env, RS3_TASK_WORKER_MODE: 'process' } });
        const sample = () => {
          // Some sandboxes expose status but omit task/<pid>/children.
          const processes = new Map();
          for (const entry of readdirSync('/proc').filter(value => /^\d+$/.test(value))) try {
            const status = readFileSync(`/proc/${entry}/status`, 'utf8');
            processes.set(Number(entry), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
          } catch { /* Process exited during sampling. */ }
          const visit = pid => (processes.get(pid)?.rss ?? 0) + [...processes].filter(([, row]) => row.parent === pid).reduce((sum, [id]) => sum + visit(id), 0);
          peakRSSBytes = Math.max(peakRSSBytes, visit(child.pid));
        };
        const timer = setInterval(sample, 100);
        child.once('error', () => { clearInterval(timer); reject(Error('Comparison child failed.')); });
        child.once('exit', code => { clearInterval(timer); code === 0 ? resolve() : reject(Error('Comparison child failed.')); });
      });
      runs.push({ ...JSON.parse(await readFile(config.result, 'utf8')), peakRSSBytes });
    }
    const [before, after] = runs;
    const differences = key => after.rows.reduce((sum, row, i) => sum + Number(row[key] !== before.rows[i]?.[key]), 0) + Math.abs(before.rows.length - after.rows.length);
    const summary = run => ({ activityMs: spread(run.rows.map(row => row.activityMs)), evaluationMs: spread(run.rows.map(row => row.evaluationMs)), peakRSSBytes: run.peakRSSBytes,
      usableMasterCounts: run.rows.map(row => row.usableMasterCount), unlockedCounts: run.rows.map(row => row.unlockedCount) });
    const report = { stateCount: after.stateCount, evaluationCount: after.rows.length, inputDifferences: differences('inputHash'), stableResultDifferences: differences('stableHash'), poolDifferences: differences('poolHash'), fullResultDifferences: differences('fullHash'),
      stableBeforeHash: sha(before.rows.map(row => row.stableHash).join('')), stableAfterHash: sha(after.rows.map(row => row.stableHash).join('')), before: summary(before), after: summary(after) };
    if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    if (report.inputDifferences || report.stableResultDifferences || report.poolDifferences) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message === PRIVATE_DISABLED ? error.message : JSON.stringify({ errorCount: 1 })); process.exitCode = 1; });
