// Calculator-only wake benchmark. Read an explicitly copied scratch save;
// never open storage or create credentials. Outputs contain counts/hashes only.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { deserialize } from 'node:v8';
import { readScratchState } from './inputs.mjs';
import { canonical } from '../../tools/calc-check/compare.mjs';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
if (Number(option('runs') ?? 5) > 1) {
  const runs = [];
  let metadata;
  for (let index = 0; index < Number(option('runs') ?? 5); index++) {
    const args = process.argv.slice(1), output = `${option('output')}.${index}.tmp`;
    if (args.includes('--runs')) args[args.indexOf('--runs') + 1] = '1';
    else args.push('--runs', '1');
    args[args.indexOf('--output') + 1] = output;
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error('Wake measurement failed.');
    const report = JSON.parse(await readFile(output, 'utf8'));
    metadata = report; runs.push(...report.runs); await rm(output);
  }
  await writeFile(option('output'), JSON.stringify({ ...metadata, runs }, null, 2) + '\n');
  process.exit(0);
}
const root = path.resolve(option('root') ?? '.');
const load = file => import(pathToFileURL(path.join(root, file)));
const sha = value => createHash('sha256').update(value).digest('hex');
const shared = value => { const bytes = Buffer.from(value), out = new SharedArrayBuffer(bytes.length); Buffer.from(out).set(bytes); return out; };
const { selectedDataset: dataset } = await load('app/dataset-runtime.mjs');
const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
const { prepareServerDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
const { buildWorld } = await load('app/data/world.mjs');
const { createRuleRegistry } = await load('app/core/rules.mjs');
const { validateState } = await load('app/core/state.mjs');
const { ProcessWorker } = await load('app/tasks/process-worker.mjs');
const input = await loadDatasetInputs(dataset, { loadTaskMap: false });
const definitions = prepareServerDefinitions(JSON.parse(input.definitionBytes.toString('utf8')), dataset);
const world = buildWorld(definitions, { dataset });
const { state: rawState, sha256: stateSha256 } = await readScratchState(path.join(option('data-dir'), 'state.json'));
const state = validateState(rawState, createRuleRegistry());
const workerData = { definitionBytes: shared(JSON.stringify(definitions)), datasetSelection: dataset.workerSelection(),
  datasetDigest: dataset.digest, preparedDatasetStages: preparedDefinitionStages(definitions),
  world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) },
  extraRules: [], omitReadyCatalogue: process.argv.includes('--omit-ready') };
if (process.argv.includes('--no-json-receipts')) {
  delete workerData.datasetSelection.inputValidationKey; delete workerData.datasetSelection.validatedJsonInputs;
}
const stateJSON = shared(JSON.stringify(state));
const preparation = process.argv.includes('--prepare') ? (await load('app/tasks/prepared-collection.mjs')).createWorkerPreparation(workerData,
  { mode: option('prepare-mode') ?? 'file' }) : undefined;
try {
// Match a sleeping scheduler: retain its initial catalogue, then retire the
// seed worker completely before measuring a replacement. No state is sent here.
const seedStarted = performance.now();
const seed = new ProcessWorker({ ...(preparation?.input() ?? workerData), omitReadyCatalogue: false });
let retainedCatalogue, seedReadyMs;
try {
  const [ready] = await once(seed, 'message');
  seedReadyMs = performance.now() - seedStarted;
  preparation?.accept(ready);
  retainedCatalogue = [ready.catalogue, ready.dynamicCatalogueBytes === undefined ? [] : deserialize(ready.dynamicCatalogueBytes)];
} finally { await seed.terminate(); }
await preparation?.settled?.();
globalThis.workerWakeCatalogue = retainedCatalogue;
const rss = async pid => {
  try { return Number(/^VmRSS:\s+(\d+)/m.exec(await readFile(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; }
  catch { return 0; }
};
const runs = [];
for (let run = 0; run < Number(option('runs') ?? 5); run++) {
  let parentPeak = process.memoryUsage.rss(), workerPeak = 0;
  const started = performance.now();
  const worker = new ProcessWorker({ ...(preparation?.input() ?? workerData), omitReadyCatalogue: process.argv.includes('--omit-ready') });
  const sample = async () => { parentPeak = Math.max(parentPeak, process.memoryUsage.rss()); workerPeak = Math.max(workerPeak, await rss(worker.pid)); };
  const timer = setInterval(() => void sample(), 25);
  try {
    const [ready] = await once(worker, 'message');
    if (ready.type !== 'ready') throw new Error('Unexpected initial reply.');
    const readyMs = performance.now() - started;
    preparation?.accept(ready);
    // A scheduler already owns its seed catalogue; repeated handshakes are
    // discarded once readiness has been handled.
    delete ready.catalogue; delete ready.dynamicCatalogue; delete ready.dynamicCatalogueBytes;
    const lists = [];
    for (const [index, member] of (process.argv.includes('--startup-only') ? [] : state.members).entries()) {
      const response = new Promise((resolve, reject) => {
        const listener = message => { if (message.id !== index + 1 || message.type === 'progress') return; worker.off('message', listener); resolve(message); };
        worker.on('message', listener); worker.once('error', reject);
      });
      worker.postMessage({ id: index + 1, type: 'evaluate', memberId: member.id, input: 'wake-benchmark',
        snapshotKey: JSON.stringify([state.revision, 'wake-benchmark']), stateTransport: 'json-shared-v1',
        stateRevision: state.revision, stateMemberIds: state.members.map(row => row.id), stateJSON, stateJSONBytes: stateJSON.byteLength,
        resultTransport: 'json-shared-v1', resultView: 'full' });
      const message = await response;
      if (message.error) throw new Error('Calculator evaluation failed.');
      const elapsedMs = performance.now() - started;
      const bytes = Buffer.from(message.resultJSON);
      lists.push({ elapsedMs, bytes: bytes.length, resultBytes: bytes, replyBuffers: message, timingMs: message.timingMs });
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    await sample();
    const row = { run, seedReadyMs, readyMs, compileMs: ready.compileMs, lists,
      rss: { parentPeak, workerPeak, parentIdle: process.memoryUsage.rss(), workerIdle: await rss(worker.pid) } };
    clearInterval(timer);
    for (const list of lists) {
      const result = JSON.parse(list.resultBytes.toString('utf8'));
      list.taskCount = result.tasks.length; list.sha256 = sha(JSON.stringify(canonical(result))); delete list.resultBytes; delete list.replyBuffers;
    }
    runs.push(row);
    console.log(JSON.stringify(row));
  } finally { clearInterval(timer); await worker.terminate(); }
}
await writeFile(option('output'), JSON.stringify({ node: process.version, datasetDigest: dataset.digest, stateSha256, runs }, null, 2) + '\n');
} finally { await preparation?.clear(); }
