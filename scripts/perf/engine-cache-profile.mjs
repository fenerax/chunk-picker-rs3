// Sequential, single-process-worker interleaving. Private inputs and raw results
// never enter the report. Use --app-dir to compare an untouched worktree.
import { parseArgs } from 'node:util';
import { readFile, writeFile, cp, copyFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { once } from 'node:events';

const sha = value => createHash('sha256').update(value).digest('hex');
const percentile = (values, q) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(q * values.length) - 1)] ?? null;
const summary = values => ({ n: values.length, median: percentile(values, .5), min: Math.min(...values), max: Math.max(...values) });
const rss = pid => Object.fromEntries(['VmRSS', 'VmHWM'].map(key => [key, Number(new RegExp('^' + key + ':\\s+(\\d+)', 'm').exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024]));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: o } = parseArgs({ options: {
  'app-dir': { type: 'string', default: root }, 'data-dir': { type: 'string' }, output: { type: 'string' },
  counts: { type: 'string', default: '1,2,4,8' }, runs: { type: 'string', default: '3' }, rounds: { type: 'string', default: '5' },
  'cache-bytes': { type: 'string' }, sizes: { type: 'boolean', default: false }, resume: { type: 'boolean', default: false }, only: { type: 'string' },
} });
const scratch = await mkdtemp('/tmp/engine-cache-');
let worker, stage = 0;
try {
  if (!o.output || !path.resolve(o.output).startsWith('/tmp/')) throw new Error('OutputLocationError');
  const counts = o.counts.split(',').map(Number), runs = Number(o.runs), rounds = Number(o.rounds);
  if (counts.some(n => ![1,2,4,8].includes(n)) || !Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(rounds) || rounds < 1) throw new Error('OptionsError');
  if (o['cache-bytes'] !== undefined) process.env.RS3_CALCULATOR_CACHE_BYTES = o['cache-bytes'];
  process.env.RS3_TASK_WORKER_MODE = 'process';
  process.env.RS3_CACHE_PROFILE_SIZES = o.sizes ? '1' : '0';
  const module = name => import(pathToFileURL(path.join(path.resolve(o['app-dir']), 'app', name)).href);
  const [{ selectedDataset }, { loadDatasetInputs }, pipeline, { buildWorld }, { ProcessWorker }, { createTaskReuseFingerprint }] = await Promise.all([
    module('dataset-runtime.mjs'), module('dataset-bootstrap.mjs'), module('dataset-pipeline.mjs'), module('data/world.mjs'), module('tasks/process-worker.mjs'), module('tasks/unlock-reuse.mjs'),
  ]);
  stage = 1;
  const loaded = await loadDatasetInputs(selectedDataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), selectedDataset);
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const dataDir = path.join(scratch, 'game');
  if (o['data-dir']) { await cp(o['data-dir'], dataDir, { recursive: true }); await copyFile(o['data-dir'] + '.dataset.json', dataDir + '.dataset.json'); }
  const { createServer } = await module('server.mjs');
  const app = await createServer({ dataDir, predictionPrewarm: false, retention: false,
    runeMetrics: { fetchImpl: async () => { throw new Error('Offline'); } }, originalSync: { fetchImpl: async () => { throw new Error('Offline'); } } });
  let base;
  try { base = app.store.getCalculationSnapshot().state; } finally { await app.close(); }
  const fingerprint = createTaskReuseFingerprint();
  const appSourceHash = sha(Buffer.concat(await Promise.all(['tasks/worker.mjs','tasks/engine.mjs','tasks/eligibility-cache.mjs','tasks/snapshot-cache.mjs'].map(name => readFile(path.join(path.resolve(o['app-dir']), 'app', name)).catch(error => { if (name.endsWith('snapshot-cache.mjs') && error.code === 'ENOENT') return Buffer.alloc(0); throw error; })))));
  const harnessHash = sha(Buffer.concat(await Promise.all([readFile(fileURLToPath(import.meta.url)), readFile(new URL('./engine-cache-probe.mjs', import.meta.url))])));
  const saveReport = async report => { await writeFile(o.output + '.next', JSON.stringify(report, null, 2)); await rename(o.output + '.next', o.output); };
  const report = { cacheBytes: o['cache-bytes'] ?? null, appSourceHash, harnessHash, node: process.version, datasetHash: selectedDataset.digest, sourceHash: sha(JSON.stringify(base)), runs, rounds, counts, only: o.only ?? null, sizeProbe: o.sizes, trials: [] };
  // Every picker preserves member IDs/revision while adding a deterministic
  // amount of progress to the grown source. Rename display names only.
  const states = [];
  for (let i = 0; i < Math.max(...counts); i++) {
    const state = { ...base, members: base.members.map((member, j) => ({ ...member, name: `Player ${i * base.members.length + j + 1}`,
      unlocked: [...member.unlocked], completedTasks: [...member.completedTasks] })) };
    const member = state.members[0];
    const extra = [...world.chunks.keys()].map(String).filter(id => !member.unlocked.includes(id)).sort().slice(0, i);
    member.unlocked.push(...extra);
    const tasks = state.tasks.filter(task => !member.completedTasks.includes(task.id)).slice(0, i);
    member.completedTasks.push(...tasks.map(task => task.id));
    states.push(state);
  }
  const inputs = states.map(state => fingerprint(state));
  report.states = states.map(state => ({ hash: sha(JSON.stringify(state)), bytes: Buffer.byteLength(JSON.stringify(state)), members: state.members.length,
    unlocked: state.members.reduce((n,m) => n + m.unlocked.length, 0), completed: state.members.reduce((n,m) => n + m.completedTasks.length, 0) }));
  if (o.resume) {
    let previous;
    try { previous = JSON.parse(await readFile(o.output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      for (const key of ['appSourceHash','harnessHash','node','datasetHash','sourceHash','runs','rounds','sizeProbe','only','cacheBytes'])
        if (previous[key] !== report[key]) throw new Error('ResumeMetadataError');
      if (JSON.stringify(previous.counts) !== JSON.stringify(counts) || JSON.stringify(previous.states) !== JSON.stringify(report.states)) throw new Error('ResumeInputsError');
      report.trials = previous.trials; report.summary = previous.summary;
    }
  }
  const bytes = Buffer.from(JSON.stringify(definitions)), definitionBytes = new SharedArrayBuffer(bytes.length); Buffer.from(definitionBytes).set(bytes);
  let id = 0;
  async function request(message) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { clean(); reject(new Error('TimeoutError')); }, 600000);
      const clean = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); };
      const fail = () => { clean(); reject(new Error('WorkerError')); };
      const receive = result => { if (result.id !== requestId || ['progress','prediction-prepared'].includes(result.type)) return; clean(); result.error ? reject(new Error('RequestError')) : resolve(result); };
      worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
      worker.postMessage({ id: requestId, ...message });
    });
  }
  for (const count of counts) for (let run = 0; run < runs; run++) {
    if (report.trials.some(trial => trial.count === count && trial.run === run)) continue;
    stage = 2;
    worker = new ProcessWorker({ definitionBytes, datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [], omitReadyCatalogue: true },
      { probeImport: new URL('./engine-cache-probe.mjs', import.meta.url).href });
    const ready = (await once(worker, 'message'))[0];
    if (ready.type !== 'ready') throw new Error('ReadyError');
    const trial = { count, run, compileMs: ready.compileMs, rows: [], summaries: {} };
    // Get candidates through this same worker; do not compile a second engine.
    const candidates = [];
    for (let i = 0; i < count; i++) {
      if (o.only === 'prepare-rules') { candidates.push(undefined); continue; }
      const result = await request({ type: 'roll-pool', pickerId: `profile-${i}`, state: states[i], snapshotKey: JSON.stringify([states[i].revision, inputs[i]]), input: inputs[i], memberId: states[i].members[0].id });
      const candidate = result.result.pool.eligible[0]?.id;
      if (!candidate) throw new Error('CandidateError');
      candidates.push(candidate);
    }
    const kinds = ['evaluate', 'chunk-planning', 'sandbox', 'area-check', 'roll-pool', 'predict', 'death-estimates', ...(o.only === 'prepare-rules' ? ['prepare-rules'] : [])];
    for (let round = 0; round <= rounds; round++) {
      for (let i = 0; i < count; i++) for (const kind of kinds) {
        if (o.only && !o.only.split(',').includes(kind)) continue;
        const state = states[i], chunk = candidates[i], input = inputs[i];
        const parameters = kind === 'evaluate' ? { resultTransport: 'json-shared-v1', resultView: 'play-v1' }
          : kind === 'sandbox' ? { resultTransport: 'json-shared-v1', chunkId: { changes: { unlockChunks: [chunk] } } }
          : kind === 'area-check' ? { chunkId: { chunkIds: [chunk] } }
          : kind === 'death-estimates' ? { chunkIds: [chunk] }
          : ['chunk-planning', 'predict'].includes(kind) ? { chunkId: chunk } : {};
        const start = performance.now();
        const result = await request({ type: kind, pickerId: `profile-${i}`, ...(['evaluate','prepare-rules'].includes(kind) ? { state } : {}), snapshotKey: JSON.stringify([state.revision, input]), memberId: state.members[0].id, input, ...parameters });
        const memory = rss(worker.pid);
        trial.rows.push({ kind, round, picker: i, wallMs: performance.now() - start, evaluationMs: result.evaluationMs, ...memory, counters: result.__cacheProbe,
          cacheBudget: result.__cacheBudget, cache: result.resultCache ?? result.result?.cache });
      }
      await saveReport({ ...report, pending: trial });
    }
    for (const kind of kinds) {
      const rows = trial.rows.filter(row => row.kind === kind);
      if (!rows.length) continue;
      trial.summaries[kind] = { coldP95: percentile(rows.filter(row => row.round === 0).map(row => row.wallMs), .95),
        warmP95: percentile(rows.filter(row => row.round > 0).map(row => row.wallMs), .95), rss: Math.max(...rows.map(row => row.VmRSS)), peakRSS: Math.max(...rows.map(row => row.VmHWM)) };
    }
    if (o.sizes) trial.sizeSample = (await request({ type: 'cancel', __engineCacheSizes: true })).__cacheProbe;
    await worker.terminate(); worker = undefined;
    report.trials.push(trial);
    report.summary = {};
    for (const n of counts) {
      const trials = report.trials.filter(t => t.count === n); if (!trials.length) continue;
      report.summary[n] = Object.fromEntries(kinds.filter(k => trials[0].summaries[k]).map(k => [k,
        Object.fromEntries(['coldP95','warmP95','rss','peakRSS'].map(metric => [metric, summary(trials.map(t => t.summaries[k][metric]))]))]));
    }
    await saveReport(report);
    console.log(JSON.stringify({ count, run: run + 1, peakRSS: Math.max(...trial.rows.map(row => row.VmHWM)) }));
  }
} catch (error) { console.error(JSON.stringify({ error: error.name, stage })); process.exitCode = 1; }
finally { await worker?.terminate(); await rm(scratch, { recursive: true, force: true }); }
