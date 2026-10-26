// Public/synthetic request transport benchmark. No installed saves or network.
// node --expose-internals --expose-gc --max-old-space-size=3072 --import ./scripts/perf/request-path-probe.mjs scripts/perf/request-path.mjs --companion DIR --output FILE
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const sourceRoot = path.resolve(option('root') ?? '.');
const load = file => import(pathToFileURL(path.join(sourceRoot, file)).href);
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';
function option(name) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
const root = path.resolve(option('companion'));
const receipt = JSON.parse(await readFile(path.join(root, 'companion.json'), 'utf8'));
const provenance = JSON.parse(await readFile(path.join(root, 'packs', 'duo-data', receipt.packs.data.version, 'provenance.json'), 'utf8'));
if (provenance.synthetic !== true || provenance.generator !== 'scripts/perf/scale-dataset.mjs') throw new Error('Only scale-dataset synthetic companions are accepted.');
Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(root, receipt.profile.path),
  RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(root, 'packs'), RS3_PACK_SELECTION: path.join(root, 'selection.json') });
process.env.RS3_REQUEST_PATH_LOG = option('output') + '.jsonl';
await writeFile(process.env.RS3_REQUEST_PATH_LOG, '');
const { selectedDataset } = await load('app/dataset-runtime.mjs');
const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
const { prepareServerDefinitions } = await load('app/dataset-pipeline.mjs');
const { buildWorld } = await load('app/data/world.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const { migrateOwnedGameplay } = await load('app/tasks/migration.mjs');
const { ProcessWorker } = await load('app/tasks/process-worker.mjs');
const { sharedJSONBytes } = await load('app/tasks/shared-bytes.mjs');
const input = await loadDatasetInputs(selectedDataset);
const definitions = prepareServerDefinitions(JSON.parse(input.definitionBytes.toString()), selectedDataset);
const world = buildWorld(definitions, { dataset: selectedDataset });
const worker = new ProcessWorker({ definitionBytes: sharedJSONBytes(definitions).buffer, world: { chunks: world.chunks, surface: world.surface },
  datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
  omitReadyCatalogue: false }, { probeImport: new URL('./request-path-probe.mjs', import.meta.url).href });
worker.on('error', error => console.error(error));
try {
  const [ready] = await once(worker, 'message');
  const members = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
  const state = migrateOwnedGameplay(createGroupState(members), { definitions, catalogue: ready.catalogue, dynamicCatalogue: ready.dynamicCatalogue,
    taskMap: JSON.parse(input.taskBytes.toString()) }).state;
  const chunks = [...world.chunks.keys()];
  for (const member of state.members) member.unlocked = chunks.slice(0, 3);
  const t = performance.now(), json = sharedJSONBytes(state), stringifyMs = performance.now() - t;
  const report = { node: process.version, signatures: [], tasks: ready.catalogue.length, stateJSONBytes: json.byteLength, stateV8Bytes: serialize(state).byteLength,
    stringifyMs, transport: option('transport') ?? 'object', requests: [] };
  for (let id = 1; id <= Number(option('requests') ?? 3); id++) {
    globalThis.gc?.();
    const start = performance.now();
    globalThis.__requestPath('requestStart', { id });
    const cloneStart = performance.now(), captured = option('transport') === 'json' ? undefined : structuredClone(state), cloneMs = performance.now() - cloneStart;
    const response = new Promise((resolve, reject) => {
      const listener = message => { if (message.id === id && !['progress', 'prediction-prepared'].includes(message.type)) { worker.off('message', listener); resolve(message); } };
      worker.on('message', listener); worker.once('error', reject);
    });
    worker.postMessage({ id, type: 'evaluate', state: captured,
      ...(option('transport') === 'json' ? { stateTransport: 'json-shared-v1', stateJSON: json.buffer, stateJSONBytes: json.byteLength,
        stateRevision: state.revision, stateMemberIds: state.members.map(m => m.id), input: 'synthetic', snapshotKey: JSON.stringify([state.revision, 'synthetic']) } : {}), memberId: id % 2 ? 'one' : 'two', cancellation: new SharedArrayBuffer(4),
      resultTransport: 'json-shared-v1', resultView: 'play-v1' });
    const result = await response;
    if (result.error) throw new Error(JSON.stringify(result.error));
    globalThis.__requestPath('requestEnd', { id });
    report.signatures.push(createHash('sha256').update(JSON.stringify(JSON.parse(Buffer.from(result.playJSON).toString()),
      (key, value) => key === 'elapsedMs' ? undefined : value)).digest('hex'));
    report.requests.push({ id, cloneMs, roundTripMs: performance.now() - start, evaluationMs: result.evaluationMs, timingMs: result.timingMs,
      responseBytes: result.playJSON?.byteLength, serverPeakRSS: process.resourceUsage().maxRSS * 1024,
      workerRSS: (await worker.getMemoryUsage()).main.rss });
    console.error(JSON.stringify(report.requests.at(-1)));
  }
  const events = (await readFile(process.env.RS3_REQUEST_PATH_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
  report.events = events;
  await writeFile(option('output'), JSON.stringify(report, null, 2) + '\n');
} finally { await worker.terminate(); }
