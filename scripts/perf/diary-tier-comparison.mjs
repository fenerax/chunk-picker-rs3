// Compare explicit checkouts using public generated states or a copied private
// current save plus seven evenly spaced retained revisions. One process worker
// at a time. Only counts, hashes, sizes and measurements leave scratch storage.
// node scripts/perf/diary-tier-comparison.mjs --baseline /tmp/start --candidate .
//   --out /tmp/public.json [--runs 3] [--data-dir /tmp/copied-game]
// Private mode requires RS3_DATASET, RS3_PACKS_DIR, RS3_GAME_DEFAULTS_FILE.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { compareOriginalData } from '../lib/original-data-compare.mjs';

const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'runs', 'data-dir', 'child'].map(k => [k, { type: 'string' }])) });
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || major === 24 && minor >= 20, 'Node 24.20+ required');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const PRIVATE_DISABLED = 'Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.';
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(canonical(value));
const rows = tasks => Object.fromEntries(tasks.map(row => [sha(row.id), hash(row)]));
const diff = (before, after) => {
  const result = { added: 0, removed: 0, changed: 0 };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(before, key)) result.added++;
    else if (!Object.hasOwn(after, key)) result.removed++;
    else if (before[key] !== after[key]) result.changed++;
  }
  return result;
};
const spread = numbers => { const sorted = numbers.toSorted((a,b) => a-b); return { median: sorted[Math.floor(sorted.length/2)], min: sorted[0], max: sorted.at(-1) }; };

async function child(config) {
  const load = name => import(pathToFileURL(path.join(config.checkout, name)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  let definitions, world, app;
  const states = [];
  try {
    if (config.privateMode) {
    throw Error(PRIVATE_DISABLED);
      const { createServer } = await load('app/server.mjs');
      app = await createServer({ dataDir: config.store, port: 0, predictionPrewarm: false, retention: false, now: () => Date.parse('2026-11-01T00:00:00.000Z'),
        originalSync: { fetchImpl: async () => { throw Error('Offline comparison'); } },
        runeMetrics: { fetchImpl: async () => { throw Error('Offline comparison'); } } });
      const current = app.store.getState();
      states.push(current);
      world = app.world;
      definitions = world.definitions;
      await app.close();
      const backups = (await app.store.listBackups()).filter(row => row.revision < current.revision).sort((a,b) => a.revision-b.revision);
      assert.ok(backups.length >= 7, 'Seven historical states required');
      for (let i=0; i<7; i++) states.push((await app.store.readBackup(backups[Math.floor(i*(backups.length-1)/6)].id)).state);
    } else {
      definitions = prepareTaskDefinitions(JSON.parse(await readFile(path.join(config.checkout, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8')), selectedDataset);
      const { createGroupState } = await load('app/core/state.mjs');
      const { playerControlSkills } = await load('app/core/player-controls.mjs');
      const chunks = Object.keys(definitions.chunks).filter(key => /^\d+$/.test(key)).sort();
      // Match the public corpus in quest-requirements-check.mjs.
      for (let i=0; i<3; i++) {
        const state = createGroupState(Array.from({ length: i ? 2 : 1 }, (_, slot) => ({ id: `fixture-${slot}`, name: `Fixture ${slot}`,
          unlocked: chunks.filter((_, n) => i ? n % (17+slot) === i : n === 0) })));
        state.rules['content.f2p'] = false;
        state.taskRules = { Boosting: i === 2 };
        for (const member of state.members) member.passiveLevels = Object.fromEntries(playerControlSkills.map(skill => [skill, i === 0 ? 1 : i === 1 ? 35 : 70]));
        states.push(state);
      }
      await writeFile(config.definitions, JSON.stringify(definitions), { mode: 0o600 });
    }
    const scheduler = await createTaskScheduler({ workerData: { definitions,
      ...(world ? { world: { chunks: world.chunks, areas: world.areas, surface: world.surface } } : {}),
      datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
      preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } }, requestDeadlineMs: 600000 });
    const evaluations = [], durationsMs = [], poolsMs = [];
    try {
      for (const state of states) for (const member of state.members) {
        const key = String(evaluations.length);
        let started = performance.now();
        const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, 'tasks-'+key)).result;
        durationsMs.push(performance.now()-started);
        started = performance.now();
        const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, 'pool-'+key)).result.pool;
        poolsMs.push(performance.now()-started);
        evaluations.push({ tasks: rows(result.tasks), pool: hash(pool) });
      }
    } finally { await scheduler.close(); }
    await writeFile(config.result, JSON.stringify({ datasetDigest: selectedDataset.digest, states: states.length,
      stateHashes: states.map(hash), evaluations, durationsMs, poolsMs }), { mode: 0o600 });
  } finally { await app?.close(); }
}
function sampleTree(pid) {
  const entries = new Map();
  for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const text = readFileSync(`/proc/${name}/status`, 'utf8');
      entries.set(Number(name), { parent: Number(/^PPid:\s+(\d+)/m.exec(text)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(text)?.[1] ?? 0)*1024 });
    } catch { /* process exited */ }
  }
  const visit = id => (entries.get(id)?.rss ?? 0) + [...entries].filter(([,entry]) => entry.parent === id).reduce((sum,[child]) => sum+visit(child),0);
  return visit(pid);
}
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (values['data-dir']) throw Error(PRIVATE_DISABLED);
  assert.ok(values.baseline && values.candidate && values.out, 'Explicit baseline, candidate and out required');
  const runs = Number(values.runs ?? 3);
  assert.ok(Number.isSafeInteger(runs) && runs > 0);
  const source = values['data-dir'] && path.resolve(values['data-dir']);
  for (const root of [values.baseline, values.candidate]) if (source) assert.ok(path.relative(path.resolve(root), source).startsWith('..'), 'Private source must be outside checkouts');
  const sourceHash = source && sha(await readFile(path.join(source,'state.json')));
  const scratch = await mkdtemp(path.join(tmpdir(),'diary-tier-comparison-'));
  const trials = [], differences = [];
  try {
    for (let run=0; run<runs; run++) {
      const pair = [];
      for (const [slot, checkout] of [values.baseline, values.candidate].entries()) {
        const directory = path.join(scratch,`${run}-${slot}`);
        await mkdir(directory);
        const config = { checkout: path.resolve(checkout), privateMode: Boolean(source), store: path.join(directory,'game'),
          result: path.join(directory,'result.json'), definitions: path.join(directory,'definitions.json') };
        if (source) { await cp(source,config.store,{recursive:true}); await copyFile(source+'.dataset.json',config.store+'.dataset.json'); }
        const input = path.join(directory,'config.json');
        await writeFile(input, JSON.stringify(config),{mode:0o600});
        let peakRSSBytes = 0;
        const started = performance.now();
        await new Promise((resolve,reject) => {
          const env = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process' };
          if (!source) for (const key of ['RS3_PACKS_DIR','RS3_PACK_SELECTION','RS3_GAME_DEFAULTS_FILE','RS3_DATASET_PROFILE','RS3_DATASET_PROFILE_SHA256']) delete env[key];
          const processHandle = spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',input], { cwd:config.checkout,env,stdio:['ignore','ignore','pipe'] });
          let diagnosticBytes = 0;
          processHandle.stderr.on('data',bytes => { diagnosticBytes += bytes.length; });
          const sample = () => { peakRSSBytes = Math.max(peakRSSBytes,sampleTree(processHandle.pid)); };
          const timer = setInterval(sample,50);
          processHandle.once('error',error => { clearInterval(timer); reject(error); });
          processHandle.once('exit',code => { sample(); clearInterval(timer); code === 0 ? resolve() : reject(Error(`Child failed: ${code}; diagnostic bytes: ${diagnosticBytes}`)); });
        });
        pair.push({ ...JSON.parse(await readFile(config.result,'utf8')), wallMs: performance.now()-started, peakRSSBytes, definitions:config.definitions });
      }
      assert.deepEqual(pair[0].stateHashes,pair[1].stateHashes,'Inputs must match');
      assert.equal(pair[0].datasetDigest,pair[1].datasetDigest);
      const counts = { states:pair[0].states,evaluations:pair[0].evaluations.length,tasks:{added:0,removed:0,changed:0},poolDifferences:0 };
      for (let i=0; i<counts.evaluations; i++) {
        const a=pair[0].evaluations[i], b=pair[1].evaluations[i], delta=diff(a.tasks,b.tasks);
        for (const key of Object.keys(delta)) counts.tasks[key]+=delta[key];
        if (a.pool!==b.pool) counts.poolDifferences++;
      }
      if (!source) {
        const [before,after] = await Promise.all(pair.map(row => readFile(row.definitions,'utf8').then(JSON.parse)));
        const report = compareOriginalData(before,after);
        const tasks = report.categories.find(row => row.key==='tasks');
        counts.definitions={added:tasks.added.length,removed:tasks.removed.length,changed:tasks.changed.length};
        assert.deepEqual(counts.definitions,{added:0,removed:0,changed:1});
        assert.ok(tasks.changed[0].label.includes('Ardougne Achievements#Hard'));
        assert.ok(report.categories.filter(row => row.key!=='tasks').every(row => !row.added.length && !row.removed.length && !row.changed.length));
        assert.ok(report.otherSections.every(row => !row.added.length && !row.removed.length && !row.changed.length));
      }
      differences.push(counts);
      trials.push(pair.map(({wallMs,peakRSSBytes,durationsMs,poolsMs}) => ({wallMs,peakRSSBytes,evaluationMs:durationsMs,poolMs:poolsMs})));
      console.log(JSON.stringify({runs:run+1,...counts}));
    }
    assert.ok(differences.every(row => canonical(row)===canonical(differences[0])), 'Differences must repeat');
    if (source) assert.equal(sha(await readFile(path.join(source,'state.json'))),sourceHash,'Source changed');
    const measurements = slot => ({ wallMs:spread(trials.map(pair => pair[slot].wallMs)),peakRSSBytes:spread(trials.map(pair => pair[slot].peakRSSBytes)),
      evaluationMs:spread(trials.flatMap(pair => pair[slot].evaluationMs)) });
    const report = { runs, ...(sourceHash ? {sourceHash} : {}),differences:differences[0],trials,before:measurements(0),after:measurements(1) };
    await writeFile(values.out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(report));
  } finally { await rm(scratch,{recursive:true,force:true}); }
}
main().catch(error => {
  const text = String(error.message);
  if (text === PRIVATE_DISABLED) { console.error(text); process.exitCode = 1; return; }
  console.error(JSON.stringify({ errorCount: 1, inputMismatchCount: Number(text.startsWith('Inputs must match')),
    childFailureCount: Number(text.startsWith('Child failed')), sourceChangeCount: Number(text.startsWith('Source changed')),
    errorMessageSha256: sha(text), ...(text.startsWith('Child failed') ? { diagnosticByteCount: Number(/diagnostic bytes: (\d+)/.exec(text)?.[1] ?? 0) } : {}) }));
  process.exitCode=1;
});
