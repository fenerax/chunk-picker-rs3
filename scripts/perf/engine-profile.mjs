import { isMainThread, parentPort } from 'node:worker_threads';
import { Session } from 'node:inspector';
import { readFile, writeFile, mkdtemp, cp, copyFile, rm, readdir, realpath, lstat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const here = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(here), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const post = (session, method, params = {}) => new Promise((resolve, reject) =>
  session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));

// Diagnostic preload in the production task isolate. No application edits.
// Inspector sampling is the V8 mechanism behind --cpu-prof and --heap-prof.
if (!isMainThread && process.env.RS3_ENGINE_PROFILE_PROBE === '1') {
  const session = new Session(); session.connect();
  if (process.env.RS3_ENGINE_HEAP_PROFILE === '1') await post(session, 'HeapProfiler.startSampling', { samplingInterval: 32768 });
  const send = parentPort.postMessage.bind(parentPort);
  let cpuStart;
  parentPort.on('message', message => {
    if (message.__engineProfile) {
      void (async () => {
        const command = message.__engineProfile;
        let value;
        if (command === 'cpu-start') { await post(session, 'Profiler.enable'); await post(session, 'Profiler.setSamplingInterval', { interval: 1000 }); await post(session, 'Profiler.start'); }
        if (command === 'cpu-stop') value = (await post(session, 'Profiler.stop')).profile;
        if (command === 'heap-start') await post(session, 'HeapProfiler.startSampling', { samplingInterval: 32768 });
        if (command === 'heap-stop') { await post(session, 'HeapProfiler.collectGarbage'); value = (await post(session, 'HeapProfiler.stopSampling')).profile; }
        send({ id: message.id, __engineProfile: command, value });
      })().catch(() => send({ id: message.id, error: { name: 'ProfileError' } }));
    } else if (!['cancel', 'supersede'].includes(message.type)) cpuStart = process.cpuUsage();
  });
  parentPort.postMessage = (message, ...rest) => {
    if (message.id !== undefined && !['progress', 'prediction-prepared'].includes(message.type) && cpuStart) {
      const cpu = process.cpuUsage(cpuStart);
      message.__engineCpuSeconds = (cpu.user + cpu.system) / 1e6;
    }
    return send(message, ...rest);
  };
} else if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === here) {
  try { await main(); }
  catch (error) {
    // Error messages can quote private input; emit only kind and numeric stage.
    process.stderr.write(JSON.stringify({ error: error.name, stage: globalThis.profileStage ?? 0 }) + '\n');
    process.exitCode = 1;
  }
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { n, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, min: sorted[0], max: sorted.at(-1) };
}
function cpuSummary(profile) {
  const nodes = new Map(profile.nodes.map(row => [row.id, row])), totals = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const frame = nodes.get(profile.samples[i]).callFrame;
    const key = (frame.url ? path.basename(frame.url) : 'v8') + ':' + (frame.functionName || '(anonymous)') + ':' + (frame.lineNumber + 1) + ':' + (frame.columnNumber + 1);
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 1000));
  }
  return { self: [...totals], sampledSeconds: [...totals.values()].reduce((a, b) => a + b, 0) / 1e6,
    top15: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([functionModule, us]) => ({ functionModule, selfSeconds: us / 1e6 })) };
}
function heapSummary(profile) {
  const totals = new Map();
  function walk(node) {
    const frame = node.callFrame;
    const key = (frame.url ? path.basename(frame.url) : 'v8') + ':' + (frame.functionName || '(anonymous)');
    totals.set(key, (totals.get(key) ?? 0) + node.selfSize); node.children.forEach(walk);
  }
  walk(profile.head);
  return { allocations: [...totals], sampledLiveBytes: [...totals.values()].reduce((a, b) => a + b, 0),
    top15: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([functionModule, bytes]) => ({ functionModule, bytes })) };
}
async function processCpuSeconds(pid) {
  let ns = 0;
  for (const tid of await readdir('/proc/' + pid + '/task')) {
    try { ns += Number((await readFile('/proc/' + pid + '/task/' + tid + '/schedstat', 'utf8')).split(' ')[0]); } catch {}
  }
  return ns / 1e9;
}
function peakRSS(pid) {
  return Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync('/proc/' + pid + '/status', 'utf8'))?.[1] ?? 0) * 1024;
}
function rss(pid) {
  return Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync('/proc/' + pid + '/status', 'utf8'))?.[1] ?? 0) * 1024;
}
async function subprocess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [here, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('SubprocessError')));
  });
}
async function main() {
  const { values: options } = parseArgs({ options: {
    'data-dir': { type: 'string' }, packs: { type: 'string' }, dataset: { type: 'string', default: 'open-f2p' },
    'game-defaults-file': { type: 'string' }, output: { type: 'string' }, runs: { type: 'string', default: '5' },
    candidates: { type: 'string', default: '3' }, profile: { type: 'boolean', default: false }, 'cpu-only': { type: 'boolean', default: false },
    only: { type: 'string' }, 'pool-trial': { type: 'string' }, 'state-file': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (options.help) { console.log('node scripts/perf/engine-profile.mjs --dataset ID [--packs DIR] [--data-dir DIR] [--game-defaults-file FILE] --output /tmp/FILE [--runs 5] [--candidates 3] [--profile] [--only TYPE,TYPE] [--cpu-only --runs 1]'); return; }
  const runs = Number(options.runs), candidateCount = Number(options.candidates);
  if (!Number.isSafeInteger(runs) || runs < (options.profile && options['cpu-only'] ? 1 : 5) || !Number.isSafeInteger(candidateCount) || candidateCount < 1) throw new TypeError('OptionsError');
  if (options['cpu-only'] && !options.profile) throw new TypeError('OptionsError');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new TypeError('NodeVersionError');
  process.env.RS3_DATASET = options.dataset; process.env.RS3_TASK_WORKER_MODE = 'process';
  if (options.packs) process.env.RS3_PACKS_DIR = path.resolve(options.packs);
  if (options['game-defaults-file']) process.env.RS3_GAME_DEFAULTS_FILE = path.resolve(options['game-defaults-file']);
  const session = new Session(); session.connect();
  if (options.profile && !options['cpu-only'] && options['pool-trial'] !== undefined) await post(session, 'HeapProfiler.startSampling', { samplingInterval: 32768 });
  globalThis.profileStage = 1;
  const [{ selectedDataset }, { loadDatasetInputs }, pipeline, { buildWorld }, rules, { ProcessWorker }] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'),
    import('../../app/data/world.mjs'), import('../../app/core/rules.mjs'), import('../../app/tasks/process-worker.mjs'),
  ]);
  await import('../../app/tasks/engine.mjs');
  const loaded = await loadDatasetInputs(selectedDataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), selectedDataset);
  const world = buildWorld(definitions, { dataset: selectedDataset }), registry = rules.createRuleRegistry();
  if (options['pool-trial'] !== undefined) {
    const state = JSON.parse(await readFile(options['state-file'], 'utf8')), memberId = state.members[Number(options['pool-trial'])].id, rows = [];
    const profileStart = performance.now();
    if (options.profile) { await post(session, 'Profiler.enable'); await post(session, 'Profiler.setSamplingInterval', { interval: 1000 }); await post(session, 'Profiler.start'); }
    for (let i = 0; i < 2; i++) {
      const cpu = process.cpuUsage(), start = performance.now(), pool = rules.evaluateRollPool(world, state, memberId, registry), used = process.cpuUsage(cpu);
      rows.push({ wallMs: performance.now() - start, cpuSeconds: (used.user + used.system) / 1e6, eligibleCount: pool.eligible.length, peakRSS: peakRSS(process.pid) });
    }
    let extraRepeats = 0;
    while (options.profile && performance.now() - profileStart < 1000) { rules.evaluateRollPool(world, state, memberId, registry); extraRepeats++; }
    const profiledPeakRSS = peakRSS(process.pid);
    const profile = options.profile ? cpuSummary((await post(session, 'Profiler.stop')).profile) : undefined;
    if (profile) profile.peakRSS = profiledPeakRSS;
    let heap;
    if (options.profile && !options['cpu-only']) { await post(session, 'HeapProfiler.collectGarbage'); heap = heapSummary((await post(session, 'HeapProfiler.stopSampling')).profile); }
    console.log(JSON.stringify({ rows, profile, heap, extraRepeats })); session.disconnect(); return;
  }
  if (!options.output) throw new TypeError('OutputError');
  const output = path.resolve(options.output);
  const outputParent = await realpath(path.dirname(output));
  if (outputParent !== '/tmp' && !outputParent.startsWith('/tmp/')) throw new TypeError('OutputLocationError');
  if (path.join(outputParent, path.basename(output)) !== output) throw new TypeError('OutputLocationError');
  try { if (!(await lstat(output)).isFile()) throw new TypeError('OutputLocationError'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scratch = await mkdtemp('/tmp/engine-profile-');
  let worker;
  const report = { node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    datasetDigest: selectedDataset.digest, cpuCount: cpus().length, runs, candidateCount, profiled: options.profile, cpuOnly: options['cpu-only'], peakMethod: 'proc-status-v1',
    compile: [], requests: {}, pools: [], profiles: {}, heaps: [] };
  try {
    globalThis.profileStage = 2;
    const dataDir = path.join(scratch, 'store');
    if (options['data-dir']) {
      await cp(path.resolve(options['data-dir']), dataDir, { recursive: true, dereference: true });
      try { await copyFile(path.resolve(options['data-dir']) + '.dataset.json', dataDir + '.dataset.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      report.sourceStateHash = sha(await readFile(path.join(dataDir, 'state.json')));
    }
    const { createServer } = await import('../../app/server.mjs');
    let initialState;
    if (!options['data-dir']) {
      const { createGroupState } = await import('../../app/core/state.mjs');
      initialState = createGroupState(selectedDataset.gameDefaults.members.map(member => ({ ...member, unlocked: [selectedDataset.gameDefaults.startingCell] })), registry);
    }
    const app = await createServer({ dataDir, initialState, predictionPrewarm: false, retention: false,
      runeMetrics: { fetchImpl: async () => { throw new Error('Offline'); } }, originalSync: { fetchImpl: async () => { throw new Error('Offline'); } } });
    let state;
    try { state = app.store.getCalculationSnapshot().state; } finally { await app.close(); }
    report.stateHash = sha(JSON.stringify(state)); report.stateBytes = Buffer.byteLength(JSON.stringify(state)); report.memberCount = state.members.length;
    const stateFile = path.join(scratch, 'calculation.json'); await writeFile(stateFile, JSON.stringify(state));
    globalThis.profileStage = 3;
    for (let member = 0; !options.only && member < state.members.length; member++) {
      const trials = [];
      for (let run = 0; run < runs; run++) {
        const trial = await subprocess(['--dataset', options.dataset, '--pool-trial', String(member), '--state-file', stateFile, ...(options.profile ? ['--profile'] : []), ...(options['cpu-only'] ? ['--cpu-only', '--runs', '1'] : [])]);
        trials.push(trial.rows);
        if (trial.profile) { report.profiles['roll-pool-' + member + '-' + run] = { ...trial.profile, extraRepeats: trial.extraRepeats }; if (trial.heap) report.heaps.push({ kind: 'roll-pool-' + member, run, ...trial.heap }); }
      }
      report.pools.push({ member, cold: { wallMs: summary(trials.map(t => t[0].wallMs)), cpuSeconds: summary(trials.map(t => t[0].cpuSeconds)) },
        warm: { wallMs: summary(trials.map(t => t[1].wallMs)), cpuSeconds: summary(trials.map(t => t[1].cpuSeconds)) }, peakRSS: Math.max(...trials.flat().map(t => t.peakRSS)) });
      await writeFile(output, JSON.stringify(report, null, 2));
    }
    const pools = state.members.map(member => rules.evaluateRollPool(world, state, member.id, registry));
    const candidates = pools[0].eligible.map(row => row.id).sort((a, b) => Number(a) - Number(b)).slice(0, candidateCount);
    if (candidates.length !== candidateCount) throw new RangeError('CandidateCountError');
    const bytes = Buffer.from(JSON.stringify(definitions)), definitionBytes = new SharedArrayBuffer(bytes.length); Buffer.from(definitionBytes).set(bytes);
    const stateBytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(stateBytes.length); Buffer.from(stateJSON).set(stateBytes);
    const input = report.stateHash, snapshotKey = JSON.stringify([state.revision, input]);
    const kinds = {
      evaluate: { type: 'evaluate' },
      play: { type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1' },
      full: { type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'full' },
      duo: { type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true },
      'duo-sidebar': { type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1', duoSidebarProjection: true },
      predict: { type: 'predict' },
      'death-estimates': { type: 'death-estimates', chunkIds: candidates },
      'chunk-planning': { type: 'chunk-planning', chunkId: candidates[0] },
      sandbox: { type: 'sandbox', resultTransport: 'json-shared-v1', chunkId: { changes: { unlockChunks: [candidates[0]] } } },
      'area-check': { type: 'area-check', chunkId: { chunkIds: [candidates[0]] } },
    };
    process.env.RS3_ENGINE_PROFILE_PROBE = '1';
    process.env.RS3_ENGINE_HEAP_PROFILE = options.profile && !options['cpu-only'] ? '1' : '0';
    let sequence = 0;
    async function request(message) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('TimeoutError')); }, 600000);
        const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); };
        const fail = () => { cleanup(); reject(new Error('WorkerError')); };
        const receive = result => {
          if (result.id !== id || ['progress', 'prediction-prepared'].includes(result.type)) return;
          cleanup(); result.error ? reject(new Error('RequestError')) : resolve(result);
        };
        worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
        worker.postMessage({ id, ...message });
      });
    }
    if (options.only && options.only.split(',').some(kind => !Object.hasOwn(kinds, kind))) throw new TypeError('RequestKindError');
    for (const [kind, parameters] of Object.entries(kinds)) {
      if (options.only && !options.only.split(',').includes(kind)) continue;
      globalThis.profileStage = 4 + Object.keys(kinds).indexOf(kind);
      const samples = { cold: [], warm: [] };
      for (let run = 0; run < runs; run++) {
        const spawnStart = performance.now();
        worker = new ProcessWorker({ definitionBytes, datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
          preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [],
          omitReadyCatalogue: ['duo', 'predict', 'death-estimates'].includes(kind) }, { probeImport: pathToFileURL(here).href });
        const ready = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
        if (ready.type !== 'ready') throw new Error('ReadyError');
        report.compile.push({ kind, run, compileMs: ready.compileMs, readyWallMs: performance.now() - spawnStart, readyRSS: rss(worker.pid), cpuSeconds: await processCpuSeconds(worker.pid) });
        const profileStart = performance.now();
        if (options.profile) await request({ type: 'cancel', __engineProfile: 'cpu-start' });
        for (const temperature of ['cold', 'warm']) {
          const parentCpu = process.cpuUsage(), childCpu = await processCpuSeconds(worker.pid), start = performance.now();
          let stages = {}, evaluationMs = 0, computeCpuSeconds = 0;
          for (let candidate = 0; candidate < (kind === 'predict' ? candidates.length : 1); candidate++) {
            const sharedState = ['evaluate', 'chunk-planning', 'sandbox', 'area-check'].includes(parameters.type);
            const result = await request({ ...parameters, memberId: state.members[0].id, input, snapshotKey, reportProgress: true,
              ...(sharedState ? { stateTransport: 'json-shared-v1', stateJSONBytes: stateBytes.length, stateRevision: state.revision,
                stateMemberIds: state.members.map(member => member.id), ...(temperature === 'cold' ? { stateJSON } : {}) }
                : temperature === 'cold' && candidate === 0 ? { state } : {}),
              ...(kind === 'predict' ? { chunkId: candidates[candidate], predictionProgress: true } : {}) });
            evaluationMs += result.evaluationMs; computeCpuSeconds += result.__engineCpuSeconds;
            for (const [key, value] of Object.entries(result.timingMs)) stages[key] = (stages[key] ?? 0) + value;
          }
          const wallMs = performance.now() - start, childEnd = await processCpuSeconds(worker.pid), parentEnd = process.cpuUsage(parentCpu);
          samples[temperature].push({ wallMs, evaluationMs, computeCpuSeconds, cpuSeconds: childEnd - childCpu + (parentEnd.user + parentEnd.system) / 1e6,
            childCpuSeconds: childEnd - childCpu, rss: rss(worker.pid), peakRSS: peakRSS(worker.pid), stages });
        }
        if (options.profile) {
          let extraRepeats = 0;
          while (performance.now() - profileStart < 1000) {
            const sharedState = ['evaluate', 'chunk-planning', 'sandbox', 'area-check'].includes(parameters.type);
            for (let candidate = 0; candidate < (kind === 'predict' ? candidates.length : 1); candidate++) {
              await request({ ...parameters, memberId: state.members[0].id, input, snapshotKey, reportProgress: true,
                ...(sharedState ? { stateTransport: 'json-shared-v1', stateJSONBytes: stateBytes.length, stateRevision: state.revision, stateMemberIds: state.members.map(member => member.id) } : {}),
                ...(kind === 'predict' ? { chunkId: candidates[candidate], predictionProgress: true } : {}) });
            }
            extraRepeats++;
          }
          const profiledPeakRSS = peakRSS(worker.pid);
          report.profiles[kind + '-' + run] = { peakRSS: profiledPeakRSS, ...cpuSummary((await request({ type: 'cancel', __engineProfile: 'cpu-stop' })).value), extraRepeats };
          if (!options['cpu-only']) report.heaps.push({ kind, run, ...heapSummary((await request({ type: 'cancel', __engineProfile: 'heap-stop' })).value) });
        }
        await worker.terminate(); worker = undefined;
        console.error(JSON.stringify({ kind, run: run + 1 }));
      }
      report.requests[kind] = { samples, cold: {}, warm: {} };
      for (const temperature of ['cold', 'warm']) for (const key of ['wallMs', 'evaluationMs', 'computeCpuSeconds', 'cpuSeconds', 'childCpuSeconds', 'rss', 'peakRSS'])
        report.requests[kind][temperature][key] = summary(samples[temperature].map(row => row[key]));
      await writeFile(output, JSON.stringify(report, null, 2));
    }
    report.compileSummary = Object.fromEntries(['compileMs', 'readyWallMs', 'readyRSS', 'cpuSeconds'].map(key => [key, summary(report.compile.map(row => row[key]))]));
    await writeFile(output, JSON.stringify(report, null, 2));
  } finally {
    await worker?.terminate(); session.disconnect(); await rm(scratch, { recursive: true, force: true });
  }
}
