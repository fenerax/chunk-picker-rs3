// Bounded START/candidate comparison on eight copied save snapshots. Reports
// counts/hashes/timings only. This is not the full lane/engine calc-check corpus.
// Set the documented private dataset, packs, defaults and process-worker env;
// pass --baseline /tmp/start --candidate . --data-dir /tmp/copied-game
//      --out /tmp/why-counts.json [--runs 3]. Never pass the private checkout.
import { readFile, writeFile, readdir, mkdtemp, mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'data-dir', 'out', 'runs', 'child'].map(key => [key, { type: 'string' }])) });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const hash = value => sha(canonical(value));
const spread = values => { const sorted = values.toSorted((a,b) => a-b); return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
async function child(config) {
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
  const { prepareTaskDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
  const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
  const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
  const raw = JSON.parse((await loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8'));
  const definitions = prepareTaskDefinitions(raw, selectedDataset);
  const scheduler = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions), datasetOptions: { reviewedOverlays: true } }, requestDeadlineMs: 600000 });
  const evaluations = [], evaluationMs = [];
  try {
    for (const directory of config.samples) {
      const { state } = await readCopiedState(directory);
      for (const member of state.members) {
        const start = performance.now();
        const result = (await scheduler.evaluate(state, member.id, 'evaluate', undefined, `evaluate-${evaluations.length}`)).result;
        evaluationMs.push(performance.now() - start);
        // Only the documented measured field is removed. Exact hashes cover all
        // other result fields, including blocker wording and presentation.
        delete result.metrics.elapsedMs;
        const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, `pool-${evaluations.length}`)).result.pool;
        evaluations.push({ result: hash(result), tasks: hash(result.tasks), training: hash(result.training), pool: hash(pool), taskCount: result.tasks.length });
      }
    }
  } finally { await scheduler.close(); }
  await writeFile(config.result, JSON.stringify({ evaluations, evaluationMs, datasetDigest: selectedDataset.digest }), { mode: 0o600 });
}
async function measure(config, file) {
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  let peakRSSBytes = 0, diagnosticBytes = 0;
  const started = performance.now();
  const handle = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', file], { cwd: config.root,
    env: { ...process.env, RS3_TASK_WORKER_MODE: 'process' }, stdio: ['ignore', 'ignore', 'pipe'] });
  handle.stderr.on('data', data => { diagnosticBytes += data.length; });
  const sample = () => {
    const rows = new Map();
    for (const pid of readdirSync('/proc').filter(value => /^\d+$/.test(value))) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        rows.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]), rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
      } catch { /* Child exited between discovery and sampling. */ }
    }
    const visit = pid => (rows.get(pid)?.rss ?? 0) + [...rows].filter(([, row]) => row.parent === pid).reduce((sum, [id]) => sum + visit(id), 0);
    peakRSSBytes = Math.max(peakRSSBytes, visit(handle.pid));
  };
  const timer = setInterval(sample, 50);
  try {
    await new Promise((resolve, reject) => { handle.once('error', reject); handle.once('exit', code => code === 0 ? resolve() : reject(Error(`Child failed: exit ${code}, diagnostic bytes ${diagnosticBytes}`))); });
  } finally { clearInterval(timer); }
  return { ...JSON.parse(await readFile(config.result, 'utf8')), wallMs: performance.now() - started, peakRSSBytes };
}
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out || !values['data-dir']) throw Error('Explicit roots, /tmp copied data directory and output required');
  const source = path.resolve(values['data-dir']);
  if (!source.startsWith('/tmp/')) throw Error('Use a copied save under /tmp');
  const runs = Number(values.runs ?? 3);
  if (!Number.isInteger(runs) || runs < 3) throw Error('At least three paired runs required');
  const scratch = await mkdtemp(path.join(tmpdir(), 'why-alternatives-check-'));
  try {
    const backups = (await readdir(path.join(source, 'backups'))).filter(name => /^\d+-[a-f0-9]+\.json\.gz$/.test(name)).sort();
    if (backups.length < 7) throw Error('Seven earlier snapshots required');
    const documents = [await readFile(path.join(source, 'state.json')),
      ...await Promise.all(Array.from({ length: 7 }, (_, i) => readFile(path.join(source, 'backups', backups[Math.floor(i * (backups.length - 1) / 6)]))).map(async promise => gunzipSync(await promise)))];
    const samples = [];
    for (const [index, bytes] of documents.entries()) {
      const directory = path.join(scratch, `sample-${index}`); await mkdir(directory);
      await cp(path.join(source, 'static'), path.join(directory, 'static'), { recursive: true });
      await writeFile(path.join(directory, 'state.json'), bytes, { mode: 0o600 });
      await copyFile(source + '.dataset.json', directory + '.dataset.json'); samples.push(directory);
    }
    const rows = [];
    let reference;
    for (let pair = 0; pair < runs; pair++) for (const variant of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const config = { root: path.resolve(values[variant]), samples, result: path.join(scratch, 'result.json') };
      const result = await measure(config, path.join(scratch, 'config.json'));
      reference ??= result;
      const differences = Object.fromEntries(['result', 'tasks', 'training', 'pool'].map(key => [key,
        result.evaluations.reduce((sum, entry, index) => sum + Number(entry[key] !== reference.evaluations[index]?.[key]), 0)]));
      if (result.evaluations.length !== reference.evaluations.length) throw Error('Evaluation count changed');
      rows.push({ variant, pair, wallMs: result.wallMs, peakRSSBytes: result.peakRSSBytes, evaluationMs: result.evaluationMs, differences });
      console.log(JSON.stringify({ pair, variant, differences }));
    }
    const summary = Object.fromEntries(['baseline', 'candidate'].map(variant => [variant, Object.fromEntries(['wallMs', 'peakRSSBytes'].map(key => [key, spread(rows.filter(row => row.variant === variant).map(row => row[key]))]))]));
    const report = { runs, states: documents.length, evaluations: reference.evaluations.length, sourceHash: sha(await readFile(path.join(source, 'state.json'))),
      sampleDigest: hash(documents.map(sha)), datasetDigest: reference.datasetDigest, summary, rows };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (rows.some(row => Object.values(row.differences).some(Boolean))) process.exitCode = 1;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(values.child ? 'Private child failed' : error.message); process.exitCode = 1; });
