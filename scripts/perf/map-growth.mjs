import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireHeavyLock, selectCompanion, readScratchState, seededRandom, mib } from './inputs.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Run under the heavy-work wrapper. Set RS3_PERF_STATE (copy in a perfwalk scratch directory) and normal dataset env, or RS3_PERF_COMPANION_ROOT. Options: --full --seed N --output-dir DIR --frontier walking|grid --repeat N --max-ms N --max-worker-mib N. Default checkpoints: 1,10,50,200; full adds 600 and the reachable map. Grid is an adjacency-only stress scenario. Treat output as private.');
  process.exit(0);
}
const options = { full: false, frontier: 'walking', seed: 1729, repeat: 3, out: 'var/perfwalk/walk', maxMs: 900000, maxWorkerMiB: 1800 };
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--full') options.full = true;
  else if (key === '--frontier' && ['walking', 'grid'].includes(args[i + 1])) options.frontier = args[++i];
  else if (['--seed', '--repeat', '--output-dir', '--max-ms', '--max-worker-mib'].includes(key) && args[i + 1]) {
    const value = args[++i];
    options[{ '--seed': 'seed', '--repeat': 'repeat', '--output-dir': 'out', '--max-ms': 'maxMs', '--max-worker-mib': 'maxWorkerMiB' }[key]] = key === '--output-dir' ? value : Number(value);
  } else throw new Error('Unknown or incomplete walk option.');
}
for (const key of ['seed', 'repeat', 'maxMs', 'maxWorkerMiB']) if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error('Numeric walk options must be positive integers.');
await requireHeavyLock();
const output = path.resolve(options.out);
await mkdir(output, { recursive: true });
await selectCompanion(output);
const started = performance.now();
let coreCommit = null, appDirty = null;
try {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  coreCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'app'], { cwd, windowsHide: true, stdio: 'ignore' }); appDirty = false; }
  catch { appDirty = true; }
} catch { /* An exported source tree can still be measured. */ }
const [{ selectedDataset }, { prepareServerDefinitions }, { loadDatasetInputs }, { buildWorld }, rules, { ProcessWorker }] = await Promise.all([
  import('../../app/dataset-runtime.mjs'), import('../../app/dataset-pipeline.mjs'), import('../../app/dataset-bootstrap.mjs'),
  import('../../app/data/world.mjs'), import('../../app/core/rules.mjs'), import('../../app/tasks/process-worker.mjs'),
]);
// Register the production automatic-travel evaluator used by roll pools.
await import('../../app/tasks/engine.mjs');
const { state: source, sha256 } = await readScratchState(process.env.RS3_PERF_STATE, { calculationOnly: true });
const input = await loadDatasetInputs(selectedDataset, { loadTaskMap: false });
const definitions = prepareServerDefinitions(JSON.parse(input.definitionBytes), selectedDataset);
const world = buildWorld(definitions, { dataset: selectedDataset }), registry = rules.createRuleRegistry();
const random = seededRandom(options.seed);
const state = { ...source, members: structuredClone(source.members), history: [] };
const member = state.members[0];
if (!member?.unlocked?.length) throw new Error('The save needs a starting chunk.');
// Counterfactual map size; preserve personal facts/rules and the partner's map.
member.unlocked = member.unlocked.slice(0, 1); member.pendingRoll = []; member.selected = [];
const definitionBytes = Buffer.from(JSON.stringify(definitions));
const shared = new SharedArrayBuffer(definitionBytes.length); Buffer.from(shared).set(definitionBytes);
const worker = new ProcessWorker({ definitionBytes: shared, datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
  preparedDatasetStages: [...(selectedDataset.capabilities.equipmentCorrections ? ['equipmentCorrections'] : []), ...(selectedDataset.capabilities.cacheShops ? ['cacheShops'] : [])],
  world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [] });
const rows = [], plateau = [];
let sequence = 0, peakWorker = 0, peakMain = process.memoryUsage.rss(), sampling = false, reason = 'quick-limit', memoryExceeded = false, currentAttempt;
const sample = async () => {
  if (sampling) return; sampling = true;
  peakMain = Math.max(peakMain, process.memoryUsage.rss());
  try {
    peakWorker = Math.max(peakWorker, (await worker.getMemoryUsage()).main.rss);
    if (peakWorker / 1048576 > options.maxWorkerMiB) { memoryExceeded = true; void worker.terminate(); }
  } catch {} finally { sampling = false; }
};
const timer = setInterval(sample, 250); timer.unref();
const request = message => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { cleanup(); reject(new Error('Walk evaluation exceeded 120 seconds.')); }, 120000);
  const cleanup = () => { clearTimeout(timeout); worker.off('message', receive); worker.off('error', fail); worker.off('exit', exited); };
  const fail = error => { cleanup(); reject(error); };
  const exited = () => fail(new Error('Walk worker exited.'));
  const receive = result => { if (result.id !== id || result.type === 'progress') return; cleanup(); result.error ? reject(new Error('Walk evaluation failed.')) : resolve(result); };
  worker.on('message', receive); worker.once('error', fail); worker.once('exit', exited);
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length); Buffer.from(stateJSON).set(bytes);
  const input = `walk-${state.revision}`;
  worker.postMessage({ id, memberId: member.id, type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1',
    stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: bytes.length, stateRevision: state.revision,
    stateMemberIds: state.members.map(member => member.id), input, snapshotKey: JSON.stringify([state.revision, input]), ...message });
});
async function measure(target = rows) {
  peakWorker = 0; peakMain = process.memoryUsage.rss();
  currentAttempt = { chunks: member.unlocked.length, startedAt: performance.now() };
  const cpu = process.cpuUsage(), time = performance.now();
  const result = await request({});
  const evaluationWallMs = performance.now() - time;
  const play = JSON.parse(Buffer.from(result.playJSON).toString());
  const poolStart = performance.now(), pool = rules.evaluateRollPool(world, state, member.id, registry);
  const rollPoolMs = performance.now() - poolStart;
  await sample(); const memory = await worker.getMemoryUsage(), used = process.cpuUsage(cpu);
  target.push({ chunks: member.unlocked.length, evaluationWallMs, evaluationMs: result.evaluationMs, stages: result.timingMs, rollPoolMs,
    tasks: play.tasks.length, presented: play.presentation?.tasks?.length ?? 0, available: play.metrics?.availableCount,
    rollEligible: pool.eligible.length, mainCpuMs: (used.user + used.system) / 1000,
    mainPeakRssMiB: mib(Math.max(peakMain, process.resourceUsage().maxRSS * 1024)), workerPeakRssMiB: mib(peakWorker), workerEndRssMiB: mib(memory.main.rss),
    workerHostHeapMiB: mib(memory.main.heapUsed), outputBytes: result.playJSON.byteLength });
  console.log(JSON.stringify(target.at(-1)));
  currentAttempt = undefined;
}
let failure;
try {
  const [ready] = await Promise.race([
    once(worker, 'message'),
    once(worker, 'exit').then(() => { throw new Error('Walk worker exited before readiness.'); }),
  ]);
  if (ready.type !== 'ready') throw new Error('Worker did not become ready.');
  const checkpoints = new Set(options.full ? [1, 10, 50, 200, 600] : [1, 10, 50, 200]);
  while (true) {
    if (checkpoints.has(member.unlocked.length)) {
      await measure();
      if (peakWorker / 1048576 > options.maxWorkerMiB) { reason = 'worker-memory-limit'; break; }
    }
    if (performance.now() - started > options.maxMs) { reason = 'time-limit'; break; }
    if (!options.full && member.unlocked.length >= 200) break;
    // Real verified walking edges only. Disable transport and hand-picked
    // candidates for growth, but measure the unchanged save's real roll rules.
    const walkingState = { ...state, rules: { ...state.rules, 'travel.automatic': false, 'access.transport': false,
      'roll.teleports': false, 'roll.selected': false, 'roll.neighborMode': 'accessible', 'roll.adjacent': true } };
    const pool = rules.evaluateRollPool(world, walkingState, member.id, registry);
    const neighbours = (options.frontier === 'grid'
      ? [...new Set(member.unlocked.flatMap(id => world.neighbors.get(id) ?? []))].filter(id => !member.unlocked.includes(id))
        .map(id => ({ id, reasons: [] }))
      : pool.eligible.filter(row => row.reasons.some(reason => reason.ruleId === 'roll.adjacent')))
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    if (!neighbours.length) { reason = 'reachable-component-exhausted'; if (rows.at(-1)?.chunks !== member.unlocked.length) await measure(); break; }
    const candidate = neighbours[Math.floor(random() * neighbours.length)];
    member.unlocked.push(candidate.id);
    // Seed the verified entry section, just as a real unlock does. No save is
    // written: this is an in-memory hypothetical, like Area check/Sandbox.
    for (const edge of candidate.reasons.filter(reason => reason.ruleId === 'roll.adjacent' && reason.destinationSection !== undefined)) {
      member.sectionOverrides = { ...member.sectionOverrides, [`${candidate.id}-${edge.destinationSection}`]: true };
    }
    state.revision++;
  }
  // Identical gameplay with fresh revisions distinguishes retained snapshot
  // churn from growth in the map/task graph. This is not a proof of no leak.
  if (reason !== 'worker-memory-limit') for (let i = 0; i < options.repeat && performance.now() - started < options.maxMs; i++) { state.revision++; await measure(plateau); }
} catch (error) { reason = memoryExceeded ? 'worker-memory-limit' : 'measurement-error'; failure = error.message; }
finally {
  clearInterval(timer); await worker.terminate();
  const report = { schemaVersion: 1, coreCommit, appDirty, cpuProfiling: process.execArgv.includes('--cpu-prof'), node: process.version, platform: process.platform,
    seed: options.seed, full: options.full, frontier: options.frontier, requestedRepeats: options.repeat,
    inputSha256: sha256, datasetDigest: selectedDataset.digest, partnerChunks: state.members[1]?.unlocked.length ?? 0,
    method: 'Persistent production process worker, compact play evaluation and calculation-only JSON input; real pool at checkpoints; walking or geometric grid adjacency between checkpoints (see frontier). Grid is a stress scenario, not a legal walking route. 250ms RSS samples. Main maxRSS is cumulative. Worker RSS includes host and task isolate. No save writes.',
    limits: { workerMiB: options.maxWorkerMiB, wallMs: options.maxMs },
    stopReason: reason, reachedChunks: member.unlocked.length, worldSurfaceChunks: world.surface.size, elapsedMs: performance.now() - started, rows, plateau,
    ...(failure ? { interrupted: { chunks: currentAttempt?.chunks ?? member.unlocked.length, elapsedMs: performance.now() - (currentAttempt?.startedAt ?? started),
      workerPeakRssMiB: mib(peakWorker), mainPeakRssMiB: mib(Math.max(peakMain, process.resourceUsage().maxRSS * 1024)) },
      ...(!memoryExceeded ? { failure } : {}) } : {}) };
  await writeFile(path.join(output, 'walk.json'), JSON.stringify(report, null, 2) + '\n');
  const table = ['| Chunks | Eval s | Pool s | Tasks | Shown | Main peak MiB | Worker peak MiB |', '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(row => `| ${row.chunks} | ${(row.evaluationWallMs / 1000).toFixed(3)} | ${(row.rollPoolMs / 1000).toFixed(3)} | ${row.tasks} | ${row.presented} | ${row.mainPeakRssMiB} | ${row.workerPeakRssMiB} |`), '', `Stopped: ${reason}; reached ${member.unlocked.length} of ${world.surface.size} surface chunks.`, ''];
  await writeFile(path.join(output, 'walk.md'), table.join('\n'));
  if (failure && !memoryExceeded) process.exitCode = 1;
}
