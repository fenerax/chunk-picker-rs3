// Calculator capacity workloads. Private inputs stay in temporary storage; reports contain metrics and hashes only.
import { readFileSync } from 'node:fs';
import { writeFile, readFile, realpath, mkdtemp, mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { cpus, availableParallelism } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize, deserialize } from 'node:v8';
import { Calculator } from '../../tools/calc-check/client.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const optionalRead = file => { try { return readFileSync(file, 'utf8').trim(); } catch { return null; } };
const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
function usage(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ');
  const bytes = key => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1] ?? 0) * 1024;
  // Process stat includes all threads, including finished compiler/GC threads.
  return { cpu: (Number(stat[11]) + Number(stat[12])) / ticks, rss: bytes('VmRSS'), hwm: bytes('VmHWM') };
}
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { n: sorted.length, median: sorted.length % 2 ? quantile(0.5) : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    min: sorted[0], max: sorted.at(-1), p50: quantile(0.5), p95: quantile(0.95) };
}
function environment(options = {}) {
  // Only explicit options may select private packs, defaults or a save.
  const env = { ...process.env, RS3_DATASET: 'open-f2p', RS3_TASK_WORKER_MODE: 'process' };
  for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
    'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR', 'RS3_STARTUP_TIMING_LOG']) delete env[key];
  if (options.dataset === 'duo-legacy') {
    if (!options.packs || !options['game-defaults-file']) throw new Error('PrivateOptionsError');
    env.RS3_DATASET = 'duo-legacy'; env.RS3_PACKS_DIR = path.resolve(options.packs);
    env.RS3_GAME_DEFAULTS_FILE = path.resolve(options['game-defaults-file']);
  }
  return env;
}
async function fixture(options = {}) {
  if (options.phases && options.phases.split(',').some(name => !['cold', 'warm-round', 'warm-local', 'alternating', 'prediction-3', 'save-list-burst'].includes(name))) throw new Error('OptionsError');
  const env = environment(options);
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') && !(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (options['prepared-dir']) {
    const saved = deserialize(await readFile(path.join(options['prepared-dir'], 'fixture.bin')));
    return { ...saved, env, phaseNames: options.phases?.split(',') };
  }
  globalThis.capacityStage = 1;
  const [{ selectedDataset: dataset }, { defaultInit }, { createGroupState }, rules, { buildWorld }] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../calculator/bundle/export.mjs'), import('../../app/core/state.mjs'),
    import('../../app/core/rules.mjs'), import('../../app/data/world.mjs'),
  ]);
  if (dataset.datasetId !== (options.dataset ?? 'open-f2p')) throw new Error('DatasetError');
  const init = await defaultInit(dataset);
  if (dataset.datasetId === 'duo-legacy') init.omitReadyCatalogue = true;
  let state = dataset.datasetId === 'open-f2p' ? createGroupState([1, 2].map(n => ({ id: `player-${n}`, name: `Player ${n}`, unlocked: [dataset.gameDefaults.startingCell] }))) : undefined;
  let sourceStateHash;
  if (dataset.datasetId === 'duo-legacy') {
    globalThis.capacityStage = 2;
    const scratch = await mkdtemp('/tmp/multi-picker-input-');
    const dataDir = path.join(scratch, 'store');
    try {
      if (options['data-dir']) {
        await cp(path.resolve(options['data-dir']), dataDir, { recursive: true, dereference: true });
        await copyFile(path.resolve(options['data-dir']) + '.dataset.json', dataDir + '.dataset.json');
        sourceStateHash = hash(await readFile(path.join(dataDir, 'state.json')));
      }
      const { createServer } = await import('../../app/server.mjs');
      const initialState = options['data-dir'] ? undefined : createGroupState(dataset.gameDefaults.members.map((member, i) =>
        ({ id: member.id, name: `Player ${i + 1}` })));
      const app = await createServer({ dataDir, initialState, predictionPrewarm: false, retention: false,
        runeMetrics: { fetchImpl: async () => { throw new Error('Offline'); } },
        originalSync: { fetchImpl: async () => { throw new Error('Offline'); } } });
      try { state = app.store.getCalculationSnapshot().state; } finally { await app.close(); }
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  globalThis.capacityStage = 3;
  const world = buildWorld(init.definitions, { dataset });
  let candidates = rules.evaluateRollPool(world, state, state.members[0].id, rules.createRuleRegistry()).eligible
    .map(row => row.id).sort((a, b) => Number(a) - Number(b)).slice(0, 3);
  const eligibleCandidateCount = candidates.length;
  if (!candidates.length && dataset.datasetId === 'duo-legacy' && !options['data-dir']) candidates = [...world.chunks.keys()].filter(id => !world.surface || world.surface.has(id)).sort((a, b) => Number(a) - Number(b)).slice(0, 3);
  if (candidates.length !== 3) throw new Error('CandidateCountError');
  // Three real gameplay inputs, not fingerprints that lie about identical states.
  const states = [0, 1, 2].map(n => {
    const value = structuredClone(state);
    for (const member of value.members) member.unlocked = [...new Set([...member.unlocked, ...candidates.slice(0, n)])];
    return value;
  });
  return { init, states, candidates, env, phaseNames: options.phases?.split(','), fingerprint: { datasetDigest: dataset.digest,
    // Hash inventories without printing paths or contents. open-f2p has no installed packs.
    sourceHashes: dataset.files.map(row => ({ sha256: row.sha256, bytes: row.bytes })).sort((a, b) => a.sha256.localeCompare(b.sha256)),
    packHashes: Object.values(dataset.workerSelection().selection ?? {}).filter(value => value?.sha256).map(value => value.sha256).sort(),
    sourceStateHash, eligibleCandidateCount, memberCount: state.members.length, taskCount: state.tasks.length, stateBytes: Buffer.byteLength(JSON.stringify(state)),
    defaultsHash: options['game-defaults-file'] ? hash(await readFile(options['game-defaults-file'])) : undefined, stateHashes: states.map(value => hash(JSON.stringify(value))), initHash: hash((await import('../../calculator/reference/codec.mjs')).stringify(init)) } };
}

// The production ProcessWorker message protocol, including MP3 picker keys.
// The framed reference adapter remains available for cross-boundary diagnostics.
class ProductionCalculator {
  child = {};
  pending = new Map();
  lengths = new Map();
  nextId = 0;
  async init(init) {
    const { ProcessWorker } = await import('../../app/tasks/process-worker.mjs');
    const { definitions, ...fields } = init, bytes = Buffer.from(JSON.stringify(definitions));
    const definitionBytes = new SharedArrayBuffer(bytes.length); Buffer.from(definitionBytes).set(bytes);
    this.worker = new ProcessWorker({ ...fields, definitionBytes, omitReadyCatalogue: false }); this.child.pid = this.worker.pid;
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => { if (!this.closing) this.fail(); });
    const ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker.on('message', message => {
      try {
        if (message.type === 'ready') { this.readyResolve({ header: message }); return; }
        const entry = this.pending.get(message.id); if (!entry) return;
        if (['progress', 'prediction-prepared'].includes(message.type)) { entry.arm(); return; }
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) { entry.resolve({ header: { type: 'error', error: { kind: entry.ref && message.error.name === 'RangeError' ? 'snapshot-missing' : 'failed' } } }); return; }
        const parts = message.playJSON ? { play: JSON.parse(Buffer.from(message.playJSON).toString('utf8')) } : { delta: message.result };
        entry.resolve({ header: { type: 'result', timingMs: message.timingMs, cancelled: message.cancelled || message.result?.cancelled }, parts });
      } catch { this.fail(); }
    });
    let timer;
    try { return await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ReadyTimeout')), 180000); })]); }
    finally { clearTimeout(timer); }
  }
  fail() {
    this.readyReject?.(new Error('WorkerError'));
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('WorkerError')); }
    this.pending.clear();
  }
  request(header, state) {
    const id = ++this.nextId, key = JSON.stringify([header.pickerId, header.input]);
    let stateJSON;
    if (state !== undefined) {
      const bytes = Buffer.from(JSON.stringify(state)); stateJSON = new SharedArrayBuffer(bytes.length);
      Buffer.from(stateJSON).set(bytes); this.lengths.set(key, bytes.length);
    }
    const promise = new Promise((resolve, reject) => {
      const entry = { resolve, reject, ref: state === undefined, arm: () => {
        clearTimeout(entry.timer); entry.timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RequestTimeout')); }, 180000);
      } };
      this.pending.set(id, entry); entry.arm();
      this.worker.postMessage({ id, type: header.type, pickerId: header.pickerId, memberId: header.memberId,
        input: header.input, snapshotKey: header.snapshotKey, chunkId: header.chunkId,
        ...(header.type === 'predict' ? { state } : { stateTransport: 'json-shared-v1',
          stateJSON, stateJSONBytes: this.lengths.get(key), stateRevision: header.revision, stateMemberIds: header.memberIds }),
        reportProgress: true, predictionProgress: true, resultTransport: 'json-shared-v1', resultView: 'play-v1' });
    });
    return { promise };
  }
  async close() { this.closing = true; this.fail(); await this.worker?.terminate(); }
}

async function trial(fix, count, workers, run, transport = 'framed') {
  const clients = [], queues = [], rows = [];
  let phasePeak = 0, lifetimePeak = 0, combinedHwmUpperBound = 0, workerHwmUpperBound = 0, sequence = 0;
  const sample = () => {
    const usages = [usage(process.pid), ...clients.filter(client => client.child.pid).map(client => usage(client.child.pid))];
    const combined = usages.reduce((n, value) => n + value.rss, 0);
    phasePeak = Math.max(phasePeak, combined); lifetimePeak = Math.max(lifetimePeak, combined);
    workerHwmUpperBound = Math.max(workerHwmUpperBound, usages.slice(1).reduce((n, value) => n + value.hwm, 0));
    combinedHwmUpperBound = Math.max(combinedHwmUpperBound, usages.reduce((n, value) => n + value.hwm, 0));
    return { combined, workerRSS: usages.slice(1).reduce((n, value) => n + value.rss, 0),
      cpu: usages.reduce((n, value) => n + value.cpu, 0) };
  };
  // Synchronous /proc sampling cannot overlap itself or retain reply graphs.
  const timer = setInterval(() => { if (clients.length) sample(); }, 25);
  try {
    const beforeCPU = usage(process.pid).cpu, readyStart = performance.now();
    const ready = await Promise.all(Array.from({ length: workers }, async (_, i) => {
      const client = transport === 'production' ? new ProductionCalculator() : new Calculator(`"${process.execPath}" "${path.join(root, 'calculator/reference/main.mjs')}"`, { env: fix.env });
      clearInterval(client.memoryTimer); clients[i] = client; queues[i] = Promise.resolve();
      const result = await client.init(fix.init);
      if (result.header.datasetDigest !== fix.fingerprint.datasetDigest) throw new Error('DigestError');
      return { wallMs: performance.now() - readyStart, compileMs: result.header.compileMs };
    }));
    const readyUsage = sample();
    const startup = { readyWallMs: performance.now() - readyStart, coreSeconds: readyUsage.cpu - beforeCPU,
      combinedRSS: readyUsage.combined, workerRSS: readyUsage.workerRSS, compileMs: ready.map(value => value.compileMs) };
    const send = (picker, variant, { type = 'evaluate', ref = false, chunkId, revision = fix.states[variant].revision } = {}) => {
      const index = picker % workers, submitted = performance.now();
      const state = { ...fix.states[variant], revision }, input = fix.fingerprint.stateHashes[variant];
      const header = { type, pickerId: 'p_' + (picker + 1).toString(16).padStart(32, '0'), input, revision,
        snapshotKey: JSON.stringify([revision, input]), memberId: state.members[0].id, memberIds: state.members.map(m => m.id),
        state: ref ? 'ref' : 'body', ...(type === 'evaluate' ? { view: 'play-v1', projections: [] } : { chunkId }) };
      const job = queues[index].then(async () => {
        const dispatched = performance.now();
        let result = await clients[index].request(header, ref ? undefined : state).promise, resends = 0;
        if (result.header.error?.kind === 'snapshot-missing') {
          resends++; result = await clients[index].request({ ...header, state: 'body' }, state).promise;
        }
        if (result.header.type !== 'result' || result.header.cancelled) throw new Error('RequestError');
        if (type === 'evaluate' && !result.parts.play || type === 'predict' && !result.parts.delta) throw new Error('PartsError');
        return { sequence: ++sequence, latencyMs: performance.now() - submitted, queueMs: dispatched - submitted,
          serviceMs: performance.now() - dispatched, engineMs: result.header.timingMs?.engineMs ?? 0, resends };
      });
      queues[index] = job.then(() => {}, () => {});
      return job;
    };
    const phase = async (name, dispatch, primingCompleted = 0) => {
      if (fix.phaseNames && !fix.phaseNames.includes(name)) return;
      phasePeak = 0; const before = sample(), start = performance.now();
      const results = await dispatch(), wallMs = performance.now() - start, after = sample();
      const row = { name, completed: results.length, primingCompleted, totalCompleted: results.length + primingCompleted, wallMs, coreSeconds: after.cpu - before.cpu,
        latencyMs: summarize(results.map(r => r.latencyMs)), queueMs: summarize(results.map(r => r.queueMs)),
        serviceMs: summarize(results.map(r => r.serviceMs)), throughput: (results.length + primingCompleted) / (wallMs / 1000),
        steadyRSS: after.combined, peakRSS: phasePeak, workerRSS: after.workerRSS,
        engineWorkCount: results.filter(r => r.engineMs > 0).length, snapshotResends: results.reduce((n, r) => n + r.resends, 0) };
      rows.push(row);
      process.stderr.write(JSON.stringify({ run, pickers: count, workers, phase: rows.length, completed: row.totalCompleted, p95ms: row.latencyMs.p95 }) + '\n');
    };
    const all = dispatch => Promise.all(Array.from({ length: count }, (_, i) => dispatch(i)));
    await phase('cold', () => all(i => send(i, 0)));
    // Same complete round again: shows cache loss when identities exceed the shared LRU.
    await phase('warm-round', () => all(i => send(i, 0, { ref: true })));
    // Genuine hot control: next request immediately follows its own priming request.
    await phase('warm-local', async () => {
      const results = [];
      for (let i = 0; i < count; i++) { await send(i, 0); results.push(await send(i, 0, { ref: true })); }
      return results;
    }, count);
    await phase('alternating', () => Promise.all([1, 2, 0, 1, 2, 0].flatMap(variant =>
      Array.from({ length: count }, (_, i) => send(i, variant)))));
    await phase('prediction-3', () => Promise.all(Array.from({ length: count }, (_, i) =>
      fix.candidates.map(chunkId => send(i, 0, { type: 'predict', chunkId, ref: true }))).flat()));
    // A save has no protocol verb: measure its post-save calculation, then the task-list read.
    // Both arrivals are enqueued in the same synchronous turn, before either completes.
    await phase('save-list-burst', () => Promise.all(Array.from({ length: count }, (_, i) => [
      send(i, 1, { revision: fix.states[1].revision + 1 }), send(i, 1, { revision: fix.states[1].revision + 1, ref: true }),
    ]).flat()));
    return { run, pickers: count, workers, transport, startup, phases: rows, peakRSS: lifetimePeak, combinedHwmUpperBound, workerHwmUpperBound };
  } finally {
    clearInterval(timer); await Promise.all(clients.map(client => client.close()));
  }
}

// Fresh driver per trial prevents old result buffers/allocator arenas from biasing RSS.
async function isolatedTrial(fix, count, workers, run, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [fileURLToPath(import.meta.url), '--trial-pickers', String(count), '--trial-workers', String(workers), '--trial-run=' + run, ...['dataset', 'packs', 'game-defaults-file', 'prepared-dir', 'data-dir', 'phases', 'transport'].flatMap(key => options[key] ? ['--' + key, options[key]] : [])],
      { env: fix.env, timeout: 3600000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new Error('TrialError'));
        else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('TrialOutputError')); } }
      });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
  });
}

export async function benchmark({ runs = 5, pickers = [1, 4, 8, 16], separate = 8, include32 = false, progress = () => {}, options = {} } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('NodeVersionError');
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20 || !pickers.length || pickers.some(n => !Number.isSafeInteger(n) || n < 1 || n > 32)
    || !Number.isSafeInteger(separate) || separate < 0 || separate > 8) throw new Error('OptionsError');
  const fix = await fixture(options);
  if (options.transport && !['framed', 'production'].includes(options.transport)) throw new Error('OptionsError');
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('OptionsError');
  const cases = pickers.map(n => [n, Math.min(n, concurrency)]); if (separate) cases.push([separate, separate]);
  const report = { version: 1, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    host: { cpuCount: cpus().length, availableParallelism: availableParallelism(), cpuModel: cpus()[0].model,
      cpuMax: optionalRead('/sys/fs/cgroup/cpu.max'), memoryMax: optionalRead('/sys/fs/cgroup/memory.max'), clockTicks: ticks },
    fingerprint: fix.fingerprint, runs, sampleIntervalMs: 25, trials: [] };
  // Admit 32 only after a separate 16-picker pilot; include it in the rotated trials.
  if (include32) {
    const pilot = await isolatedTrial(fix, 16, 1, -1, options);
    report.pilot16 = pilot;
    report.included32 = pilot.peakRSS < 2 * 1024 ** 3 &&
      pilot.phases.find(p => p.name === 'cold').latencyMs.p95 < 10000 &&
      pilot.phases.find(p => p.name === 'warm-round').latencyMs.p95 < 2000;
    if (report.included32 && !pickers.includes(32)) cases.push([32, 1]);
  }
  report.notAdmitted = [];
  const workerBudget = Number(options['worker-peak-bytes'] ?? 0);
  if (!Number.isSafeInteger(workerBudget) || workerBudget < 0) throw new Error('OptionsError');
  if (options.dataset === 'duo-legacy' && separate > 1 && !workerBudget) throw new Error('WorkerBudgetRequired');
  if (options.output) await writeFile(path.resolve(options.output) + '.partial', JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const saveProgress = options.output ? async () => writeFile(path.resolve(options.output) + '.partial', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }) : async () => {};
  // Rotate case order on each repetition; no two trials or test suites run together.
  for (let run = 0; run < runs; run++) {
    const order = [...cases.slice(run % cases.length), ...cases.slice(0, run % cases.length)];
    for (const [count, workers] of order) {
      if (workers > 1 && workerBudget) {
        const limit = Number(optionalRead('/sys/fs/cgroup/memory.max')), current = Number(optionalRead('/sys/fs/cgroup/memory.current'));
        const estimatedBytes = workers * workerBudget + 2 * 1024 ** 3;
        if (Number.isFinite(limit) && estimatedBytes > limit - current) {
          report.notAdmitted.push({ run, pickers: count, workers, estimatedBytes, availableBytes: limit - current });
          await saveProgress(); continue;
        }
      }
      progress({ run, pickers: count, workers });
      report.trials.push(await isolatedTrial(fix, count, workers, run, options));
      await saveProgress();
    }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { runs: { type: 'string', default: '5' }, pickers: { type: 'string', default: '1,4,8,16' },
      separate: { type: 'string', default: '8' }, 'include-32': { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean' },
      dataset: { type: 'string', default: 'open-f2p' }, packs: { type: 'string' }, 'game-defaults-file': { type: 'string' }, 'data-dir': { type: 'string' },
      transport: { type: 'string' }, phases: { type: 'string' }, concurrency: { type: 'string' }, 'worker-peak-bytes': { type: 'string' },
      'prepare-output': { type: 'string' }, 'prepared-dir': { type: 'string' },
      'trial-pickers': { type: 'string' }, 'trial-workers': { type: 'string' }, 'trial-run': { type: 'string' } } });
    values.transport ??= values.dataset === 'duo-legacy' ? 'production' : 'framed';
    if (values.help) console.log('node scripts/perf/multi-picker-capacity.mjs --output /tmp/report.json [--runs 5] [--pickers 1,4,8,16] [--separate 8] [--include-32] [--transport framed|production] [--concurrency 1] [--phases cold,warm-round] [--dataset duo-legacy --packs DIR --game-defaults-file FILE --data-dir DIR] [--prepare-output /tmp/DIR | --prepared-dir /tmp/DIR] [--worker-peak-bytes N]');
    else if (values['prepare-output']) {
      const directory = path.resolve(values['prepare-output']);
      const parent = await realpath(path.dirname(directory));
      if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('OutputLocationError');
      const fix = await fixture(values); delete fix.env;
      await mkdir(directory, { mode: 0o700 });
      await writeFile(path.join(directory, 'fixture.bin'), serialize(fix), { mode: 0o600, flag: 'wx' });
      await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(fix.fingerprint), { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify(fix.fingerprint));
    } else if (values['trial-pickers']) {
      const count = Number(values['trial-pickers']), workers = Number(values['trial-workers']), run = Number(values['trial-run']);
      if (!Number.isSafeInteger(count) || count < 1 || count > 32 || !Number.isSafeInteger(workers) || workers < 1 || workers > 8 || !Number.isSafeInteger(run)) throw new Error('OptionsError');
      console.log(JSON.stringify(await trial(await fixture(values), count, workers, run, values.transport ?? 'framed')));
    } else {
      const output = path.resolve(values.output ?? '');
      const parent = await realpath(path.dirname(output));
      if (!parent.startsWith('/tmp/') && parent !== '/tmp') throw new Error('OutputLocationError');
      try { await readFile(output); throw new Error('OutputExists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const report = await benchmark({ runs: Number(values.runs), pickers: values.pickers.split(',').map(Number), separate: Number(values.separate),
        include32: values['include-32'], options: values, progress: value => process.stderr.write(JSON.stringify(value) + '\n') });
      await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ trials: report.trials.length, runs: report.runs, datasetDigest: report.fingerprint.datasetDigest }));
    }
  } catch (error) { console.error(JSON.stringify({ error: error.name, stage: globalThis.capacityStage ?? 0, frames: error.stack?.split('\n').slice(1).map(line => /([\w-]+\.mjs):(\d+):(\d+)/.exec(line)?.slice(1)).filter(Boolean) })); process.exitCode = 1; }
}
