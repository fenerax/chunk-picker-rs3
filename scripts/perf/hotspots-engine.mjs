// Calculator-only measurements. No server/store import, credentials or writes to inputs.
// Set the ordinary dataset environment, then pass a COPIED /tmp save via --data-dir.
// Output is numeric metadata only; errors deliberately omit messages/input paths.
import { readFile, writeFile, readdir, realpath, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gzip, gunzipSync } from 'node:zlib';
import { promisify, parseArgs } from 'node:util';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canonical } from '../../tools/calc-check/compare.mjs';
import { workerStartupSpans } from './profile-stack/worker-startup.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const zip = promisify(gzip);
const rss = pid => Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
const hwm = pid => Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
const { values: args } = parseArgs({ options: { 'data-dir': { type: 'string' }, out: { type: 'string' }, runs: { type: 'string', default: '5' }, trial: { type: 'boolean' }, 'fresh-preview': { type: 'boolean' }, 'fresh-member': { type: 'string' }, profile: { type: 'boolean' }, 'result-hashes': { type: 'boolean' }, phases: { type: 'boolean' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('NodeVersionError');
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw new Error('ForbiddenImport');
  return next(url, context);
} });
let stage = 0;
async function trial() {
  const dataDir = await realpath(args['data-dir']);
  if (!dataDir.startsWith('/tmp/')) throw new TypeError('InputLocationError');
  const [{ selectedDataset: dataset }, { loadDatasetInputs }, pipeline, { buildWorld }, rules, core, { ProcessWorker }, codec] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'),
    import('../../app/data/world.mjs'), import('../../app/core/rules.mjs'), import('../../app/core/state.mjs'),
    import('../../app/tasks/process-worker.mjs'), import('../../app/storage/completion-codec.mjs'),
  ]);
  stage = 1;
  const source = await readFile(path.join(dataDir, 'state.json'));
  const document = codec.decodeCompletionDocument(JSON.parse(source));
  if (document.storage !== undefined) {
    const storage = document.storage;
    if (storage.schemaVersion !== 1 || Object.keys(storage).some(k => !['schemaVersion', 'fields'].includes(k))) throw new TypeError('StorageError');
    const staticRoot = await realpath(path.join(dataDir, 'static'));
    for (const [key, ref] of Object.entries(storage.fields)) {
      if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
        || !/^static-[a-f0-9]{64}\.json\.gz$/.test(ref.id) || ref.id !== `static-${ref.sha256}.json.gz`
        || Object.keys(ref).some(k => !['id', 'sha256'].includes(k))) throw new TypeError('ReferenceError');
      const file = await realpath(path.join(staticRoot, ref.id));
      if (path.dirname(file) !== staticRoot) throw new TypeError('ReferenceError');
      const bytes = gunzipSync(await readFile(file));
      if (sha(bytes) !== ref.sha256) throw new TypeError('ChecksumError');
      document.state[key] = JSON.parse(bytes);
    }
  }
  const registry = rules.createRuleRegistry();
  const fullState = core.importBackup(document, registry);
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = fullState;
  state.history = fullState.members.some(m => core.hasRandomStartChoices(fullState, m)) ? history : [];
  const loaded = await loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset });
  const report = { node: process.version, datasetHash: dataset.digest, sourceHash: sha(source), stateHash: sha(JSON.stringify(state)),
    counts: { members: state.members.length, tasks: state.tasks.length, chunks: world.chunks.size,
      membersShape: state.members.map(m => ({ unlocked: m.unlocked.length, selected: m.selected.length, pending: m.pendingRoll.length, completed: m.completedTasks.length, status: Object.keys(m.taskStatus ?? {}).length })) },
    startup: {}, requests: {}, responses: {}, profiles: {}, resultHashes: {}, resultCounts: {}, peakRSS: 0 };
  const shared = value => { const bytes = Buffer.from(JSON.stringify(value)), out = new SharedArrayBuffer(bytes.length); Buffer.from(out).set(bytes); return out; };
  let worker, sequence = 0;
  const sentSnapshots = new Set();
  function request(message) {
    message = { ...message };
    if (message.snapshotKey && sentSnapshots.has(message.snapshotKey)) { delete message.state; delete message.stateJSON; }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('TimeoutError')); }, 600000);
      const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); };
      const fail = () => { cleanup(); reject(new Error('WorkerError')); };
      const receive = result => { if (result.id !== id || ['progress', 'prediction-prepared'].includes(result.type)) return; cleanup(); if (!result.error && message.snapshotKey) sentSnapshots.add(message.snapshotKey); result.error ? reject(new Error('RequestError')) : resolve(result); };
      worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail); worker.postMessage({ id, ...message });
    });
  }
  function cpuSummary(profile, window) {
    const windows = Array.isArray(window) ? window : [window];
    if (windows.some(window => !window || window.start < profile.startTime || window.end > profile.endTime)) throw new Error('ProfileClockError');
    let time = profile.startTime;
    const nodes = new Map(profile.nodes.map(n => [n.id, n.callFrame])), totals = new Map();
    for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
      const from = time; time += profile.timeDeltas?.[i] ?? 0;
      const overlapMs = windows.reduce((total, window) => total + Math.max(0, Math.min(time, window.end) - Math.max(from, window.start)) / 1000, 0);
      if (!overlapMs) continue;
      const f = nodes.get(profile.samples[i]);
      // Only public module paths, builtins and V8 frames reach the summary.
      const file = f.url.includes('/app/') ? f.url.slice(f.url.lastIndexOf('/app/') + 1) : f.url.startsWith('node:') ? f.url : '(V8)';
      const key = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + (file.startsWith('app/') ? 0 : 1)}`;
      totals.set(key, (totals.get(key) ?? 0) + overlapMs);
    }
    return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([functionFileLine, selfMs]) => ({ functionFileLine, selfMs }));
  }
  async function measured(key, message, profile = false) {
    if (args.profile && profile) await request({ type: 'cancel', __engineProfile: 'cpu-start' });
    const start = clock(), result = await request(message), wallMs = clock() - start;
    report.requests[key] = { wallMs, evaluationMs: result.evaluationMs, stages: result.timingMs, peakRSS: hwm(worker.pid), ...(args.phases ? { phases: result.__incrementalProfile, projection: result.__finalProjectionProfile } : {}) };
    if (args.profile && profile) {
      const cpu = (await request({ type: 'cancel', __engineProfile: 'cpu-stop' })).value;
      report.profiles[key] = cpuSummary(cpu, result.__hotspotsWindow);
      if (result.__finalProjectionProfile?.length) (report.projectionProfiles ??= {})[key] = cpuSummary(cpu, result.__finalProjectionProfile);
    }
    if (args['result-hashes']) {
      const decode = value => {
        if (value instanceof SharedArrayBuffer || value instanceof ArrayBuffer || Buffer.isBuffer(value)) {
          const bytes = Buffer.from(value);
          try { return JSON.parse(bytes); } catch { return { bytes: bytes.length, sha256: sha(bytes) }; }
        }
        if (Array.isArray(value)) return value.map(decode);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
        return value;
      };
      const values = {};
      for (const key of ['result', 'resultJSON', 'playJSON', 'duoJSON', 'duoSidebarJSON', 'sandboxJSON', 'unlockReuse', 'partnerUnlockReuse']) if (result[key] !== undefined) values[key] = decode(result[key]);
      report.resultHashes[key] = sha(JSON.stringify(canonical(values)));
      report.resultCounts[key] = Object.keys(values).length;
    }
    return result;
  }
  async function encode(key, value) {
    const start = clock(), bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), jsonMs = clock() - start;
    const syncStart = clock(), compressed = gzipSync(bytes, { level: 1 }), syncMs = clock() - syncStart;
    const asyncStart = clock(), asyncBytes = await zip(bytes, { level: 1 }), asyncMs = clock() - asyncStart;
    if (!compressed.equals(asyncBytes)) throw new Error('EncodingDifference');
    report.responses[key] = { rawBytes: bytes.length, gzipBytes: compressed.length, jsonMs, syncMs, asyncMs };
  }
  try {
    stage = 2;
    const workerData = { definitionBytes: shared(definitions), datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [], omitReadyCatalogue: !!args['fresh-preview'] };
    const start = clock();
    worker = new ProcessWorker(workerData,
      { probeImport: args.phases ? new URL('./incremental-engine-probe.mjs', import.meta.url).href : args.profile ? new URL('./hotspots-cpu-probe.mjs', import.meta.url).href : undefined });
    const spawnedAt = clock();
    const ready = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const end = clock();
    if (ready.type !== 'ready') throw new Error('ReadyError');
    const records = [];
    for (const file of await readdir(process.env.RS3_PROFILE_DIR)) if (file.startsWith(`${worker.pid}-`) && file.endsWith('.jsonl'))
      records.push(...(await readFile(path.join(process.env.RS3_PROFILE_DIR, file), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
    const parts = workerStartupSpans([{ name: 'worker.startup.wait', start, end, spawnedAt, workerPid: worker.pid, layer: 'server' }], records);
    report.startup = { wallMs: end - start, compileMs: ready.compileMs, peakRSS: hwm(worker.pid), parts: {}, ...(args.phases ? { phases: ready.__incrementalProfile } : {}) };
    for (const part of parts) report.startup.parts[part.name] = (report.startup.parts[part.name] ?? 0) + part.end - part.start;
    const input = report.stateHash, snapshotKey = JSON.stringify([state.revision, input]);
    const stateJSON = shared(state);
    const base = { input, snapshotKey, reportProgress: true, stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: stateJSON.byteLength,
      stateRevision: state.revision, stateMemberIds: state.members.map(m => m.id) };
    if (args['fresh-member'] !== undefined) {
      const member = Number(args['fresh-member']);
      if (!Number.isInteger(member) || !state.members[member]) throw new Error('MemberIndexError');
      const message = { ...base, type: 'evaluate', memberId: state.members[member].id, resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true };
      const cold = await measured(`tasks-${member}-cold`, message, true);
      await measured(`tasks-${member}-warm`, message);
      await encode(`tasks-${member}`, Buffer.from(cold.duoJSON ?? cold.playJSON));
      await new Promise(resolve => setTimeout(resolve, 2000));
      report.idleRSS = { worker: rss(worker.pid), parent: rss(process.pid) };
      report.peakRSS = { worker: hwm(worker.pid), parent: hwm(process.pid) };
      console.log(JSON.stringify(report));
      return;
    }
    if (args['fresh-preview']) {
      const pool = await measured('pool-cold', { type: 'roll-pool', state, snapshotKey, memberId: state.members[0].id, input }, true);
      const chunkId = pool.result.pool.eligible[0]?.id;
      if (!chunkId) throw new Error('CandidateError');
      const message = { type: 'predict', state, snapshotKey, memberId: state.members[0].id, input, chunkId, predictionProgress: true };
      const result = await measured('preview-cold', message, true);
      await measured('preview-warm', message);
      await encode('prediction', result.result);
      await new Promise(resolve => setTimeout(resolve, 2000));
      report.idleRSS = { worker: rss(worker.pid), parent: rss(process.pid) };
      report.peakRSS = { worker: hwm(worker.pid), parent: hwm(process.pid) };
      console.log(JSON.stringify(report));
      return;
    }
    stage = 3;
    for (let member = 0; member < state.members.length; member++) {
      const message = { ...base, type: 'evaluate', memberId: state.members[member].id, resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true };
      const cold = await measured(`tasks-${member}-cold`, message, member === 0);
      await measured(`tasks-${member}-warm`, message);
      await encode(`tasks-${member}`, Buffer.from(cold.duoJSON ?? cold.playJSON));
    }
    stage = 4;
    const pools = [];
    for (let member = 0; member < state.members.length; member++) {
      const message = { type: 'roll-pool', state, snapshotKey, memberId: state.members[member].id, input };
      const cold = await measured(`pool-${member}-cold`, message, member === 0);
      await measured(`pool-${member}-warm`, message); pools.push(cold.result);
    }
    const candidate = pools[0].pool.eligible[0]?.id;
    if (!candidate) throw new Error('CandidateError');
    const prediction = { type: 'predict', state, snapshotKey, memberId: state.members[0].id, input, chunkId: candidate, predictionProgress: true };
    const predicted = await measured('prediction-cold', prediction, true);
    await measured('prediction-warm', prediction);
    await encode('prediction', predicted.result);
    const { createUnlockResultCache } = await import('../../app/tasks/unlock-reuse.mjs');
    const reuseCache = createUnlockResultCache({ limit: 100, byteLimit: 128 * 2 ** 20 });
    const reuseMessages = [predicted.unlockReuse, predicted.partnerUnlockReuse].filter(Boolean);
    const admissionStart = clock(), ownerAdmitted = reuseCache.admit(reuseMessages[0], 3);
    const ownerEnd = clock(), admitted = reuseCache.admitMany(reuseMessages, 3, 'preview');
    report.requests['prediction-admission'] = { wallMs: clock() - admissionStart, ownerMs: ownerEnd - admissionStart, admitted: Number(admitted) + Number(ownerAdmitted), messages: reuseMessages.length };

    // Admission currently compresses all owner/partner compact projections synchronously.
    for (const [role, reuse] of [['owner', predicted.unlockReuse], ['partner', predicted.partnerUnlockReuse]])
      if (reuse) for (const view of ['playJSON', 'duoJSON', 'duoSidebarJSON']) if (reuse[view]) await encode(`reuse-${role}-${view}`, Buffer.from(reuse[view]));
    stage = 5;
    const offered = structuredClone(state); offered.members[0].pendingRoll = [candidate]; offered.members[0].selected = offered.members[0].selected.filter(id => id !== candidate);
    const acceptStart = clock();
    const accepted = core.applyCommand(offered, { type: 'unlock-selection', memberId: state.members[0].id, chunkId: candidate }, { world, registry });
    report.acceptCommandMs = clock() - acceptStart;
    for (let member = 0; member < state.members.length; member++) await measured(`accept-recalculate-${member}`, { type: 'evaluate', state: accepted,
      memberId: state.members[member].id, input: sha(JSON.stringify(accepted)), snapshotKey: JSON.stringify([accepted.revision, sha(JSON.stringify(accepted))]), resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true }, member === 0);
    stage = 6;
    // Why consumes full-result evidence. Select visible subjects by index only.
    const { savedWhyChain, forgetSavedWhyChain } = await import('../../app/task-why-http.mjs');
    const full = await measured('why-full-result', { ...base, type: 'evaluate', memberId: state.members[0].id, resultTransport: 'json-shared-v1', resultView: 'full' });
    const bytes = Buffer.from(full.resultJSON), result = JSON.parse(bytes);
    await encode('tasks-full', bytes);
    const visible = result.tasks.filter(t => !t.hidden && t.obligation !== false), indices = [...new Set([0, Math.floor(visible.length / 2), visible.length - 1])].filter(i => i >= 0);
    report.counts.visible = visible.length;
    for (const index of indices) {
      const taskId = visible[index].id;
      const entry = { revision: state.revision, fullGzip: gzipSync(bytes) };
      const query = new URLSearchParams({ memberId: state.members[0].id, revision: String(state.revision), taskId });
      for (const temperature of ['cold', 'warm']) {
        const start = clock();
        const why = await savedWhyChain(query, { revision: state.revision, members: new Set(state.members.map(m => m.id)), entry, definitions, currentRevision: () => state.revision });
        report.requests[`why-${index}-${temperature}`] = { wallMs: clock() - start, bytes: Buffer.byteLength(JSON.stringify(why)) };
      }
      forgetSavedWhyChain(entry);
      for (const temperature of ['cold', 'warm']) await measured(`how-${index}-${temperature}`, { type: 'how-task', state, snapshotKey, memberId: state.members[0].id, input, chunkId: taskId });
    }
    if (args['result-hashes']) {
      await measured('prepare-rules', { type: 'prepare-rules', state: { revision: state.revision, rules: state.rules } });
      for (let member = 0; member < state.members.length; member++) {
        const memberId = state.members[member].id;
        await measured(`planning-${member}`, { ...base, type: 'chunk-planning', memberId, chunkId: candidate });
        await measured(`sandbox-${member}`, { ...base, type: 'sandbox', memberId, chunkId: { changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } }, resultTransport: 'json-shared-v1' });
        await measured(`area-${member}`, { ...base, type: 'area-check', memberId, chunkId: { chunkIds: [candidate], asMembers: false } });
        await measured(`death-${member}`, { type: 'death-estimates', state, snapshotKey, memberId, input, chunkIds: [candidate] });
      }
    }
    stage = 7;
    const { projectPlayState } = await import('../../app/play-view.mjs');
    const { projectDisplayWorld } = await import('../../app/display-world.mjs');
    const { datasetBrowserPayload } = await import('../../app/dataset-catalogues.mjs');
    await encode('state-projection', { format: 'play-v1', schemaVersion: 1, state: projectPlayState(fullState), pools: Object.fromEntries(state.members.map((m, i) => [m.id, { ...pools[i].pool, partnerConnections: pools[i].partnerConnections }])) });
    await encode('definitions-display', { chunks: definitions.chunks });
    await encode('rules', { cacheResources: dataset.capabilities.cacheResources, cacheArchaeology: dataset.capabilities.cacheArchaeology,
      definitions: registry.definitions.map(({ candidates, exclude, ...metadata }) => metadata), defaults: registry.defaults, settings: registry.resolve(state.rules) });
    await encode('display-world', projectDisplayWorld(world));
    await encode('dataset-runtime', await datasetBrowserPayload(dataset));
    await new Promise(resolve => setTimeout(resolve, 2000));
    report.idleRSS = { worker: rss(worker.pid), parent: rss(process.pid) };
    report.peakRSS = { worker: hwm(worker.pid), parent: hwm(process.pid) };
    console.log(JSON.stringify(report));
  } finally { await worker?.terminate(); }
}
async function main() {
  const runs = Number(args.runs);
  if (!args.out?.startsWith('/tmp/') || !Number.isInteger(runs) || runs < (args.profile ? 1 : 5)) throw new TypeError('OptionsError');
  await mkdir(args.out, { recursive: true });
  const trials = [];
  for (let run = 0; run < runs; run++) {
    const traceDir = path.join(args.out, `startup-${run}`); await mkdir(traceDir, { recursive: true });
    const child = spawn(process.execPath, ['--import', new URL('./profile-stack/bootstrap.mjs', import.meta.url).href, fileURLToPath(import.meta.url),
      '--trial', '--data-dir', args['data-dir'], ...(args.profile ? ['--profile'] : []), ...(args.phases ? ['--phases'] : []), ...(args['result-hashes'] ? ['--result-hashes'] : []), ...(args['fresh-preview'] ? ['--fresh-preview'] : []), ...(args['fresh-member'] === undefined ? [] : ['--fresh-member', args['fresh-member']])], { env: { ...process.env, RS3_PROFILE: '1', RS3_PROFILE_DIR: traceDir,
        RS3_ENGINE_PROFILE_PROBE: args.profile ? '1' : '0', RS3_ENGINE_HEAP_PROFILE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    if (code) { console.error(stderr); throw new Error('TrialError'); }
    trials.push(JSON.parse(stdout));
    await writeFile(path.join(args.out, 'measurements.json'), JSON.stringify({ runs: trials.length, profiled: !!args.profile, trials }, null, 2));
    console.error(JSON.stringify({ completed: run + 1 }));
  }
}
try { if (args.trial) await trial(); else await main(); }
catch (error) { console.error(JSON.stringify({ error: error.name, stage, frames: [...(error.stack ?? '').matchAll(/(?:app|scripts)\/[^\s():]+:\d+:\d+/g)].map(m => m[0]).slice(0, 6) })); process.exitCode = 1; }
