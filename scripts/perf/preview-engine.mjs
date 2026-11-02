// Calculator-only Preview measurements. Inputs must be a copied /tmp save.
// No server/store imports or credentials. Outputs contain numeric metadata only.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { canonical } from '../../tools/calc-check/compare.mjs';
const { values: args } = parseArgs({ options: { root: { type: 'string', default: '.' }, 'data-dir': { type: 'string' }, output: { type: 'string' }, runs: { type: 'string', default: '5' }, trial: { type: 'boolean' }, member: { type: 'string', default: '0' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw Error('ForbiddenImport');
  return next(url, context);
} });
const load = file => import(pathToFileURL(path.resolve(args.root, file)));
const memory = pid => {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  return Object.fromEntries(['VmRSS', 'VmHWM'].map(key => [key, Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1] ?? 0) * 1024]));
};
async function trial() {
  const dataDir = await realpath(args['data-dir']);
  if (!dataDir.startsWith('/tmp/')) throw Error('InputLocationError');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, { ProcessWorker }, codec] = await Promise.all([
    load('app/dataset-runtime.mjs'), load('app/dataset-bootstrap.mjs'), load('app/dataset-pipeline.mjs'), load('app/data/world.mjs'),
    load('app/core/rules.mjs'), load('app/core/state.mjs'), load('app/tasks/process-worker.mjs'), load('app/storage/completion-codec.mjs')]);
  const source = await readFile(path.join(dataDir, 'state.json'));
  const document = codec.decodeCompletionDocument(JSON.parse(source));
  for (const [key, ref] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
      || ref.id !== `static-${ref.sha256}.json.gz` || !/^static-[a-f0-9]{64}\.json\.gz$/.test(ref.id)) throw Error('ReferenceError');
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'static', ref.id)));
    if (sha(bytes) !== ref.sha256) throw Error('ChecksumError');
    document.state[key] = JSON.parse(bytes);
  }
  const fullState = core.importBackup(document, rules.createRuleRegistry());
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = fullState;
  state.history = fullState.members.some(m => core.hasRandomStartChoices(fullState, m)) ? history : [];
  const input = sha(JSON.stringify(state));
  const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset });
  const bytes = Buffer.from(JSON.stringify(definitions)), shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
  const started = performance.now();
  const worker = new ProcessWorker({ definitionBytes: shared, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [], omitReadyCatalogue: true },
    { probeImport: new URL('./preview-probe.mjs', import.meta.url).href });
  let sequence = 0;
  const report = { datasetHash: dataset.digest, sourceHash: sha(source), stateHash: input, counts: { members: state.members.length, tasks: state.tasks.length, chunks: world.chunks.size }, requests: {} };
  const request = (type, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, start = performance.now(); let prepared;
    const timer = setTimeout(() => { clean(); reject(Error('TimeoutError')); }, 600000);
    function clean() { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); }
    function fail() { clean(); reject(Error('WorkerError')); }
    function receive(message) {
      if (message.id !== id || message.type === 'progress') return;
      if (message.type === 'prediction-prepared') { prepared ??= { wallMs: performance.now() - start, timingMs: message.timingMs, ...(message.result ? { resultHash: sha(JSON.stringify(canonical(message.result))) } : {}) }; return; }
      clean();
      if (message.error) { reject(Error('RequestError')); return; }
      const wallMs = performance.now() - start;
      resolve({ message, measurement: { wallMs, prepared, timingMs: message.timingMs, workerMemory: memory(worker.pid) } });
    }
    worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
    worker.postMessage({ id, type, state: sequence === 1 ? state : undefined, snapshotKey: JSON.stringify([state.revision, input]), input,
      memberId: state.members[Number(args.member)].id, reportProgress: true, ...extra });
  });
  const digest = message => {
    const output = { result: canonical(message.result) };
    for (const role of ['unlockReuse', 'partnerUnlockReuse']) if (message[role]) {
      const { playJSON, duoJSON, duoSidebarJSON, ...metadata } = message[role];
      output[role] = { ...metadata, ...Object.fromEntries(Object.entries({ playJSON, duoJSON, duoSidebarJSON }).map(([key, bytes]) => [key, canonical(JSON.parse(Buffer.from(bytes)))])) };
    }
    return { resultHash: sha(JSON.stringify(canonical(message.result))), hash: sha(JSON.stringify(canonical(output))), count: message.result.tasks?.length ?? message.result.delta?.tasksAdded?.length ?? message.result.pool?.eligible?.length ?? 0 };
  };
  try {
    const ready = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    if (ready.type !== 'ready') throw Error('ReadyError');
    report.startup = { wallMs: performance.now() - started, compileMs: ready.compileMs, workerMemory: memory(worker.pid) };
    const pool = await request('roll-pool'); report.requests.pool = { ...pool.measurement, ...digest(pool.message) };
    const chunkId = pool.message.result.pool.eligible[0]?.id;
    if (!chunkId) throw Error('CandidateError');
    for (const key of ['first', 'repeat']) {
      const response = await request('predict', { chunkId, predictionProgress: true, previewProgress: true });
      report.requests[key] = { ...response.measurement, ...digest(response.message) };
    }
    const full = await request('evaluate'); report.requests.evaluate = { ...full.measurement, ...digest(full.message) };
    await new Promise(resolve => setTimeout(resolve, 2000));
    report.idle = { worker: memory(worker.pid), parent: memory(process.pid) };
    console.log(JSON.stringify(report));
  } finally { await worker.terminate(); }
}
try {
  if (args.trial) await trial();
  else {
    if (!args.output?.startsWith('/tmp/') || Number(args.runs) < 5) throw Error('OutputLocationError');
    const trials = [];
    for (let run = 0; run < Number(args.runs); run++) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--trial'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', bytes => stdout += bytes); child.stderr.resume();
      if (await new Promise(resolve => child.once('close', resolve))) throw Error('TrialError');
      trials.push(JSON.parse(stdout));
      await writeFile(args.output, JSON.stringify({ node: process.version, trials }, null, 2));
      console.error(JSON.stringify({ completed: run + 1 }));
    }
  }
} catch(error) { console.error(JSON.stringify({ error: error.name, frames: [...(error.stack ?? '').matchAll(/(?:app|scripts)\/[^\s():]+:\d+:\d+/g)].map(m => m[0]).slice(0, 4) })); process.exitCode = 1; }
