// Calculator-only session experiment. Never open a server/store or write inputs.
// Each trial starts fresh; clock jumps simulate idle gaps without changing CPU time.
import { readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonical } from '../../tools/calc-check/compare.mjs';
const { values: args } = parseArgs({ options: { root: { type: 'string', default: '.' }, 'data-dir': { type: 'string' }, output: { type: 'string' },
  policy: { type: 'string' }, runs: { type: 'string', default: '5' }, trial: { type: 'boolean' }, 'think-ms': { type: 'string', default: '15000' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
if (!['before', 'after'].includes(args.policy)) throw Error('PolicyError');
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw Error('ForbiddenImport');
  return next(url, context);
} });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const load = file => import(pathToFileURL(path.resolve(args.root, file)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = () => new Promise(resolve => setImmediate(resolve));
const shared = value => { const bytes = Buffer.from(JSON.stringify(value)), out = new SharedArrayBuffer(bytes.length); Buffer.from(out).set(bytes); return out; };
function clock() {
  let time = 0, sequence = 0; const timers = new Map();
  return { now: () => time,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      time = end; await tick();
    } };
}
let stage = 0;
async function trial() {
  const dataDir = await realpath(args['data-dir']);
  if (!dataDir.startsWith('/tmp/')) throw Error('InputLocationError');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, codec, { createTaskScheduler }, { taskReuseInputKey }] = await Promise.all([
    load('app/dataset-runtime.mjs'), load('app/dataset-bootstrap.mjs'), load('app/dataset-pipeline.mjs'), load('app/data/world.mjs'),
    load('app/core/rules.mjs'), load('app/core/state.mjs'), load('app/storage/completion-codec.mjs'), load('app/tasks/scheduler.mjs'), load('app/tasks/unlock-reuse.mjs')]);
  const source = await readFile(path.join(dataDir, 'state.json'));
  const document = codec.decodeCompletionDocument(JSON.parse(source));
  for (const [key, ref] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
      || ref.id !== `static-${ref.sha256}.json.gz` || !/^static-[a-f0-9]{64}\.json\.gz$/.test(ref.id)) throw Error('ReferenceError');
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'static', ref.id)));
    if (sha(bytes) !== ref.sha256) throw Error('ChecksumError');
    document.state[key] = JSON.parse(bytes);
  }
  const full = core.importBackup(document, rules.createRuleRegistry());
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = full;
  state.history = full.members.some(member => core.hasRandomStartChoices(full, member)) ? history : [];
  const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset), world = buildWorld(definitions, { dataset });
  const report = { datasetHash: dataset.digest, sourceHash: sha(source), stateHash: sha(JSON.stringify(state)),
    counts: { members: state.members.length, tasks: state.tasks.length, chunks: world.chunks.size }, requests: {}, memory: [] };
  const sample = async () => {
    let children = 0, childPeak = 0;
    for (const pid of await readdir('/proc')) if (/^\d+$/.test(pid)) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        if (Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) !== process.pid) continue;
        children += Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
        childPeak = Math.max(childPeak, Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024);
      } catch { /* A retiring child can disappear between reads. */ }
    }
    const total = process.memoryUsage.rss() + children;
    report.peakRSS = Math.max(report.peakRSS ?? 0, total); report.workerPeakRSS = Math.max(report.workerPeakRSS ?? 0, childPeak);
    return { parentRSS: process.memoryUsage.rss(), workerRSS: children };
  };
  const idleClock = clock();
  const monitor = setInterval(() => void sample(), 50);
  let scheduler, release;
  try {
    const started = performance.now();
    scheduler = await createTaskScheduler({ workerData: { definitionBytes: shared(definitions), datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [] },
      idleClock, idleMs: 600000, ...(args.policy === 'after' ? { maxCalculators: 3 } : {}), fairness: { maxOutstandingJobsPerPicker: 4 },
      ...(args.policy === 'after' ? { residency: { memoryBytes: 6.5 * 1024 ** 3, estimatedBytes: 2 * 1024 ** 3, maxResident: 3 } } : {}) });
    report.startupMs = performance.now() - started;
    release = scheduler.openSession?.();
    const waitIdle = async () => {
      const end = performance.now() + 300000;
      for (;;) {
        const d = scheduler.getDiagnostics();
        if ([d, d.predictionLane, d.duoLane, d.deathLane].every(lane => !lane.queue.active && !lane.queue.depth && !lane.prewarm?.pending)) return;
        if (performance.now() > end) throw Error('IdleTimeout');
        await pause(20);
      }
    };
    const captures = new WeakMap();
    const record = async (name, current, member, type = 'evaluate', chunkId, view = 'full') => {
      stage++;
      const input = taskReuseInputKey(current), key = JSON.stringify([type === 'evaluate' ? input : current.revision, member.id, type, chunkId, undefined]);
      if (type !== 'predict' && !captures.has(current)) captures.set(current, { inputKey: input, taskInputKey: input, stateJSON: shared(current) });
      const metadata = type === 'predict' ? current : { revision: current.revision, members: current.members.map(({ id }) => ({ id })) };
      const at = performance.now();
      const result = await scheduler.evaluate(metadata, member.id, type, chunkId, key, input, undefined, [], view, type === 'predict' ? undefined : captures.get(current));
      const value = result.result;
      console.error(JSON.stringify({ completedRequests: stage, durationMs: performance.now() - at }));
      report.requests[name] = { wallMs: performance.now() - at, hit: +!!result.hit, hash: sha(JSON.stringify(canonical(value))),
        count: value.tasks?.length ?? value.delta?.tasksAdded?.length ?? value.pool?.eligible?.length ?? 0 };
      return value;
    };
    for (const [index, member] of state.members.entries()) await record(`initial${index}`, state, member);
    const pool = await record('pool', state, state.members[0], 'roll-pool');
    const chunkId = pool.pool.eligible[0]?.id;
    if (!chunkId) throw Error('CandidateError');
    const offer = structuredClone(state); offer.revision++;
    offer.members[0].pendingRoll = [String(chunkId)]; offer.members[0].selected = offer.members[0].selected.filter(id => id !== String(chunkId));
    const input = taskReuseInputKey(offer);
    scheduler.supersedeDisplay(offer.revision, input);
    const rollAt = performance.now();
    const unsubscribePrediction = args.policy === 'after' ? scheduler.subscribePredictions(event => {
      if (event.memberId === offer.members[0].id && String(event.chunkId) === String(chunkId)) report.preparedAfterRollMs ??= performance.now() - rollAt;
    }) : undefined;
    if (args.policy === 'after') {
      await pause(1000);
      scheduler.prewarm(offer, input, [{ memberId: offer.members[0].id, chunkIds: [chunkId] }]);
    }
    await pause(Math.max(0, Number(args['think-ms']) - (performance.now() - rollAt)));
    await record('firstPreview', offer, offer.members[0], 'predict', chunkId);
    unsubscribePrediction?.();
    await waitIdle();
    report.memory.push({ atMs: idleClock.now(), ...await sample() });
    const accepted = core.applyCommand(offer, { type: 'unlock-selection', memberId: offer.members[0].id, chunkId: String(chunkId) }, { world, now: '2026-11-01T00:00:00.000Z' });
    scheduler.setRevision(accepted.revision, taskReuseInputKey(accepted));
    for (const [index, member] of accepted.members.entries()) await record(`postAccept${index}`, accepted, member, 'evaluate', undefined, 'play-v1');
    // Identical repeat task results after independent simulated session gaps.
    for (const gap of [5, 15, 30]) {
      // Every gap starts with a requested full list, rather than inheriting a
      // preceding gap's expiry or a compact-only cache entry.
      for (const [index, member] of accepted.members.entries()) await record(`prime${gap}_${index}`, accepted, member);
      await waitIdle(); await idleClock.advance(gap * 60000);
      await pause(50); report.memory.push({ atMs: idleClock.now(), ...await sample() });
      for (const [index, member] of accepted.members.entries()) await record(`gap${gap}_${index}`, accepted, member);
    }
    // Several picker identities share the same calculator and memory ceiling.
    for (let index = 1; index <= 6; index++) {
      const scope = scheduler.forPicker('p_' + index.toString(16).repeat(32));
      scope.noteActivity?.();
      await scope.evaluate({ revision: accepted.revision, members: accepted.members.map(({ id }) => ({ id })) }, accepted.members[0].id, 'evaluate', undefined, `picker-${index}`, taskReuseInputKey(accepted), undefined, [], 'full', captures.get(accepted));
    }
    const inputAccepted = taskReuseInputKey(accepted);
    const stress = [
      scheduler.evaluate(accepted, accepted.members[0].id, 'evaluate', undefined, 'stress-foreground', inputAccepted),
      scheduler.evaluate(accepted, accepted.members[0].id, 'predict', chunkId, 'stress-preview', inputAccepted),
      scheduler.evaluate(accepted, accepted.members.at(-1).id, 'evaluate', undefined, 'stress-peer', inputAccepted, undefined, [], 'play-v1', undefined, 'duo'),
      scheduler.evaluate(accepted, accepted.members[0].id, 'death-estimates', undefined, 'stress-death', inputAccepted, undefined, [chunkId]),
    ];
    const stressResults = await Promise.all(stress); await waitIdle();
    report.stress = stressResults.map(value => ({ hash: sha(JSON.stringify(canonical(value.result))),
      count: value.result.tasks?.length ?? value.result.delta?.tasksAdded?.length ?? value.result.estimates?.length ?? 0 }));
    report.memory.push({ atMs: idleClock.now(), ...await sample() });
    report.calculators = scheduler.getDiagnostics().calculators;
    release?.(); release = undefined;
    await idleClock.advance(40 * 60000); await pause(100);
    for (let attempt = 0; attempt < 500; attempt++) {
      const h = scheduler.getHealth();
      if ([h, h.prediction, h.duo, h.death].every(lane => !lane.resident && !lane.retiring) && !(scheduler.getDiagnostics().calculators?.resident)) break;
      await pause(20);
    }
    report.idle = await sample();
    console.log(JSON.stringify(report));
  } finally { clearInterval(monitor); release?.(); await scheduler?.close(); }
}
try {
  if (args.trial) await trial();
  else {
    if (!args.output?.startsWith('/tmp/') || Number(args.runs) < 5) throw Error('OutputLocationError');
    const trials = [];
    for (let index = 0; index < Number(args.runs); index++) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--trial'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => process.stderr.write(bytes));
      if (await new Promise(resolve => child.once('close', resolve))) throw Error('TrialError');
      trials.push(JSON.parse(stdout)); await writeFile(args.output, JSON.stringify({ node: process.version, policy: args.policy, trials }, null, 2));
      console.error(JSON.stringify({ completed: index + 1 }));
    }
  }
} catch(error) { console.error(JSON.stringify({ error: error.name, stage, messageHash: sha(error.message ?? ''), frames: [...(error.stack ?? '').matchAll(/(?:app|scripts)\/[^\s():]+:\d+:\d+/g)].map(match => match[0]).slice(0, 4) })); process.exitCode = 1; }
