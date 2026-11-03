// Online preparation from an explicitly captured copy. No server, store,
// listener, credentials, or writes to the copied gameplay inputs.
import path from 'node:path';
import { warmStoreAllowed } from '../../app/tasks/warm-store.mjs';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { getPriority, setPriority } from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

export async function prewarmCandidate({ settings, candidate, dataDir, execute = spawn }) {
  // Root deployments deliberately defer warming to the service's first start.
  // Do not even inspect a candidate script or spawn an older root publisher.
  if (!warmStoreAllowed()) return false;
  // Old releases remain deployable. This optional preparation never extends
  // the writer pause and cannot turn a failed warm-up into a deployment failure.
  try {
    const script = path.join(candidate.config.coreRoot, 'scripts/linux/prewarm.mjs');
    await access(script);
    const { runtimeEnvironment } = await import('./runtime.mjs');
    return await new Promise(resolve => {
      const child = execute(candidate.config.nodePath ?? process.execPath, [script, '--root', candidate.config.coreRoot,
        '--data-dir', dataDir, '--warm-dir', path.join(settings.dataDir, 'warm-store')],
      { env: runtimeEnvironment(candidate.config, { probe: true }), stdio: 'ignore', windowsHide: true });
      try { if (Number.isSafeInteger(child.pid)) setPriority(child.pid, Math.max(10, getPriority(child.pid))); } catch { /* Best-effort OS priority; bounded calculator remains optional. */ }
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 180000);
      child.once('error', () => { clearTimeout(timer); resolve(false); });
      child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
    });
  } catch { return false; }
}

export async function prewarmCalculation({ root, dataDir, warmDirectory, maxMembers = 8 }) {
  if (!warmStoreAllowed()) return false;
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 8) throw Error('Invalid warm bound.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 20) throw Error('Unsupported Node.');
  const load = file => import(pathToFileURL(path.join(root, file)));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, codec, { ProcessWorker }, preparation, reuse] = await Promise.all([
    load('app/dataset-runtime.mjs'), load('app/dataset-bootstrap.mjs'), load('app/dataset-pipeline.mjs'), load('app/data/world.mjs'),
    load('app/core/rules.mjs'), load('app/core/state.mjs'), load('app/storage/completion-codec.mjs'), load('app/tasks/process-worker.mjs'),
    load('app/tasks/prepared-collection.mjs'), load('app/tasks/unlock-reuse.mjs')]);
  const document = codec.decodeCompletionDocument(JSON.parse(await readFile(path.join(dataDir, 'state.json'))));
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
      || !/^[a-f0-9]{64}$/.test(reference.sha256) || reference.id !== `static-${reference.sha256}.json.gz`) throw Error('Invalid copied reference.');
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'static', reference.id)));
    if (sha(bytes) !== reference.sha256) throw Error('Copied reference mismatch.');
    document.state[key] = JSON.parse(bytes);
  }
  const full = core.importBackup(document, rules.createRuleRegistry());
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = full;
  const randomStarts = full.members.filter(member => core.hasRandomStartChoices(full, member)).map(member => [member.id, member.pendingRoll]);
  state.history = randomStarts.length ? history : [];
  const fingerprint = reuse.createTaskReuseFingerprint()(state);
  const input = randomStarts.length ? sha(JSON.stringify([fingerprint, randomStarts])) : fingerprint;
  const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset, reviewedOverlays: true });
  const rollInput = rules.createRollPoolCache(world, rules.createRuleRegistry(), { inputKey: reuse.createTaskReuseFingerprint() }).input(state);
  const bytes = Buffer.from(JSON.stringify(definitions)), shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
  const data = { definitionBytes: shared, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
    world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules: [], warmStoreDirectory: warmDirectory };
  const prepared = preparation.createWorkerPreparation(data, { persistentDirectory: warmDirectory });
  let worker, sequence = 0;
  const started = performance.now();
  const request = (type, memberId, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { clean(); reject(Error('Warm timeout.')); }, 120000);
    function clean() { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); }
    function fail() { clean(); reject(Error('Warm worker unavailable.')); }
    function receive(message) {
      if (message.id !== id || ['progress', 'prediction-prepared'].includes(message.type)) return;
      clean(); message.error ? reject(Error('Warm calculation unavailable.')) : resolve(message);
    }
    worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
    worker.postMessage({ id, type, state, memberId, input: type === 'roll-pool' ? rollInput : input, ...extra });
  });
  try {
    worker = new ProcessWorker(prepared.input());
    const [ready] = await once(worker, 'message');
    if (ready.type !== 'ready') throw Error('Warm startup unavailable.');
    prepared.accept(ready); await prepared.settled();
    for (const member of state.members.slice(0, maxMembers)) {
      await request('evaluate', member.id, { resultTransport: 'json-shared-v1' });
      for (const projection of [{}, { duoSidebarProjection: true }, { duoProjection: true }]) await request('evaluate', member.id,
        { resultTransport: 'json-shared-v1', resultView: 'play-v1', ...projection });
      const pool = await request('roll-pool', member.id);
      const eligible = pool.result.pool.eligible.map(row => row.id);
      const chunkId = [...member.pendingRoll, ...member.selected, eligible[0]].find(id => eligible.includes(id));
      if (chunkId) await request('predict', member.id, { chunkId, predictionProgress: true, previewProgress: true });
    }
    return { members: Math.min(state.members.length, maxMembers), requests: sequence, durationMs: performance.now() - started };
  } finally { await worker?.terminate(); await prepared.clear(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    registerHooks({ load(url, context, next) {
      if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw Error('Forbidden warm import.');
      return next(url, context);
    } });
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'data-dir': { type: 'string' }, 'warm-dir': { type: 'string' } } });
    const result = await prewarmCalculation({ root: path.resolve(values.root), dataDir: path.resolve(values['data-dir']), warmDirectory: path.resolve(values['warm-dir']) });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch { process.stderr.write('Calculator preparation unavailable.\n'); process.exitCode = 1; }
}
