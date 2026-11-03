// Calculator-only restart/preparation probe. Uses filesystem validation, never
// a server or a normal store. Reports contain counts/hashes/durations only.
import { readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { canonical } from '../../tools/calc-check/compare.mjs';
const processStarted = performance.now() - process.uptime() * 1000;
const { values: args } = parseArgs({ options: { root: { type: 'string', default: '.' }, 'data-dir': { type: 'string' },
  'warm-dir': { type: 'string' }, output: { type: 'string' }, runs: { type: 'string', default: '5' }, trial: { type: 'boolean' }, components: { type: 'boolean' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const load = name => import(pathToFileURL(path.resolve(args.root, name)));
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw Error('ForbiddenImport');
  return next(url, context);
} });
const memory = pid => {
  try {
    const text = readFileSync(`/proc/${pid}/status`, 'utf8');
    return Object.fromEntries(['VmRSS', 'VmHWM'].map(key => [key, Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024]));
  } catch { return { VmRSS: 0, VmHWM: 0 }; }
};
const cpu = pid => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  // Linux CLK_TCK is 100 on the measurement host; fields 14/15 include threads.
  return (Number(stat[11]) + Number(stat[12])) * 10;
};
async function disk(directory) {
  if (!directory) return { entries: 0, bytes: 0 };
  const files = await readdir(directory, { recursive: true }).catch(() => []);
  let bytes = 0, entries = 0; const partitions = {};
  for (const file of files) if (/^[a-f0-9]{64}\.warm$/.test(path.basename(file))) {
    const size = (await stat(path.join(directory, file))).size; bytes += size; entries++;
    const row = partitions[file.split(path.sep)[0]] ??= { entries: 0, bytes: 0 }; row.entries++; row.bytes += size;
  }
  return { entries, bytes, partitions };
}
async function trial() {
  const dataDir = await realpath(args['data-dir']);
  if (!dataDir.startsWith('/tmp/')) throw Error('InputLocationError');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, { ProcessWorker }, codec, preparation] = await Promise.all([
    load('app/dataset-runtime.mjs'), load('app/dataset-bootstrap.mjs'), load('app/dataset-pipeline.mjs'), load('app/data/world.mjs'),
    load('app/core/rules.mjs'), load('app/core/state.mjs'), load('app/tasks/process-worker.mjs'), load('app/storage/completion-codec.mjs'), load('app/tasks/prepared-collection.mjs')]);
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
  const workerData = { definitionBytes: shared, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
    world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules: [],
    ...(args['warm-dir'] ? { warmStoreDirectory: path.resolve(args['warm-dir']) } : {}) };
  const prepared = args['warm-dir'] ? preparation.createWorkerPreparation(workerData, { persistentDirectory: path.resolve(args['warm-dir']) }) : undefined;
  const report = { node: process.version, datasetHash: dataset.digest, sourceHash: sha(source), stateHash: input,
    counts: { members: state.members.length, tasks: state.tasks.length, chunks: world.chunks.size }, requests: [] };
  const { createPoolRanking, summarizePoolPrediction } = await load('app/tasks/pool-ranking.mjs');
  const ranking = createPoolRanking(), pools = new Map(); ranking.sync(input);
  let worker, sequence = 0, parentPeak = 0, workerPeak = 0;
  const started = performance.now();
  worker = new ProcessWorker(prepared?.input() ?? workerData);
  const sample = () => { parentPeak = Math.max(parentPeak, memory(process.pid).VmRSS); workerPeak = Math.max(workerPeak, memory(worker.pid).VmRSS); };
  const timer = setInterval(sample, 25);
  const request = (type, memberId, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, start = performance.now(); let previewMs;
    const timeout = setTimeout(() => { clean(); reject(Error('TimeoutError')); }, 600000);
    function clean() { clearTimeout(timeout); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); }
    function fail() { clean(); reject(Error('WorkerError')); }
    function receive(message) {
      if (message.id !== id || message.type === 'progress') return;
      if (message.type === 'prediction-prepared') { if (message.result) previewMs ??= performance.now() - start; return; }
      clean();
      if (message.error) { reject(Error('RequestError')); return; }
      const durationMs = performance.now() - start;
      const hashResult = message.resultJSON ? JSON.parse(Buffer.from(message.resultJSON)) : message.playJSON ? JSON.parse(Buffer.from(message.playJSON)) : message.result;
      let projections;
      if (type === 'roll-pool') pools.set(memberId, message.result.pool.eligible.map(row => row.id));
      if (type === 'predict') {
        const summaryStarted = performance.now(), summary = summarizePoolPrediction(extra.chunkId, message.result);
        const summaryMs = performance.now() - summaryStarted, rowsStarted = performance.now();
        ranking.remember(input, memberId, extra.chunkId, message.result);
        const rows = ranking.read(input, memberId, state.revision, pools.get(memberId) ?? []);
        projections = { summaryMs, rankingMs: performance.now() - rowsStarted, rows: rows.rows.length, checked: rows.checked,
          summaryBytes: Buffer.byteLength(JSON.stringify(summary)), summaryHash: sha(JSON.stringify(canonical(summary))), rankingHash: sha(JSON.stringify(canonical(rows))) };
      }
      const hashes = { canonical: sha(JSON.stringify(canonical(hashResult))) };
      const sizes = {};
      for (const key of ['resultJSON', 'playJSON', 'duoJSON', 'duoSidebarJSON']) if (message[key]) {
        const bytes = Buffer.from(message[key]); hashes[key] = sha(bytes); sizes[key] = bytes.length;
      }
      for (const key of ['unlockReuse', 'partnerUnlockReuse']) if (message[key]) {
        const { playJSON, duoJSON, duoSidebarJSON, ...metadata } = message[key];
        hashes[key] = sha(JSON.stringify(canonical({ ...metadata, ...Object.fromEntries(Object.entries({playJSON,duoJSON,duoSidebarJSON}).map(([key, bytes]) => [key, JSON.parse(Buffer.from(bytes))])) })));
      }
      report.requests.push({ type: type === 'evaluate' && extra.resultView === 'play-v1' ? 'play' : type,
        durationMs, elapsedMs: performance.now() - processStarted, previewMs: previewMs ?? durationMs, timingMs: message.timingMs,
        projections, taskCount: hashResult.tasks?.length ?? hashResult.delta?.tasksAdded?.length ?? hashResult.pool?.eligible?.length ?? 0, hashes, sizes });
      resolve(message);
    }
    worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
    worker.postMessage({ id, type, memberId, state, input, reportProgress: true, ...extra });
  });
  try {
    const [ready] = await once(worker, 'message');
    if (ready.type !== 'ready') throw Error('ReadyError');
    report.startup = { workerReadyMs: performance.now() - started, elapsedMs: performance.now() - processStarted, compileMs: ready.compileMs,
      parentCpuMs: Object.values(process.cpuUsage()).reduce((a, b) => a + b) / 1000, workerCpuMs: cpu(worker.pid) };
    prepared?.accept(ready); await prepared?.settled();
    if (args.components) await request('prepare-rules', state.members[0].id);
    for (const member of state.members) {
      await request('evaluate', member.id, { resultTransport: 'json-shared-v1' });
      if (args.components) { await request('evaluate', member.id, { resultTransport: 'json-shared-v1' }); continue; }
      await request('evaluate', member.id, { resultTransport: 'json-shared-v1', resultView: 'play-v1', duoSidebarProjection: true });
      const pool = await request('roll-pool', member.id);
      const chunkId = pool.result.pool.eligible[0]?.id;
      if (!chunkId) throw Error('CandidateError');
      await request('predict', member.id, { chunkId, predictionProgress: true, previewProgress: true });
    }
    report.cpuMs = { parent: Object.values(process.cpuUsage()).reduce((a, b) => a + b) / 1000, worker: cpu(worker.pid) };
    await new Promise(resolve => setTimeout(resolve, 2000)); sample();
    report.memory = { parentPeak: Math.max(parentPeak, memory(process.pid).VmHWM), workerPeak: Math.max(workerPeak, memory(worker.pid).VmHWM), parentIdle: memory(process.pid).VmRSS, workerIdle: memory(worker.pid).VmRSS };
    report.disk = await disk(args['warm-dir']);
    return report;
  } finally { clearInterval(timer); await worker.terminate(); await prepared?.clear(); }
}
try {
  if (args.trial) console.log(JSON.stringify(await trial()));
  else {
    if (!args.output?.startsWith('/tmp/') || Number(args.runs) < 1) throw Error('OutputLocationError');
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
} catch(error) { console.error(JSON.stringify({ error: error.name })); process.exitCode = 1; }
