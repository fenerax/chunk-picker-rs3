// Disposable process owns its worker and all compiled caches.
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { attest } from './inputs.mjs';
import { requireNode, publicEnvironment } from '../y03-fuzz-ci/semantic.mjs';
requireNode(); publicEnvironment();
const [root, mode, scratch] = process.argv.slice(2);
// Selected before importing application modules on first init.

process.env.RS3_PACKS_DIR = path.join(scratch, 'packs');
process.env.RS3_MAP_ASSETS_DIR = path.join(scratch, 'maps');
process.env.RS3_GAME_DATA_DIR = path.join(scratch, 'data');
let worker, bundle, sequence = 0;
const load = file => import(pathToFileURL(path.join(root, file)));
const send = value => { if (process.connected) process.send(value); };
function decode(bytes) { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
function reuse(value) {
  if (!value) return undefined;
  const { playJSON, duoJSON, duoSidebarJSON, gzipJSONPrefixes, gzipJSONPrefixMetadata, ...metadata } = value;
  return { ...metadata, play: decode(playJSON), duo: decode(duoJSON), sidebar: decode(duoSidebarJSON) };
}
async function startWorker() {
  const owned = worker = new Worker(pathToFileURL(path.join(root, 'app/tasks/worker.mjs')), {
    workerData: structuredClone(bundle), resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 16 },
    stdout: true, stderr: true,
  });
  owned.stdout.resume(); owned.stderr.resume();
  owned.on('error', () => process.exit(72));
  owned.on('exit', code => { if (code && worker === owned) process.exit(72); });
  return new Promise(resolve => owned.once('message', ready => {
    if (ready.type !== 'ready') process.exit(73);
    resolve(ready);
  }));
}
async function stopWorker() { const owned = worker; worker = null; await owned?.terminate(); }
process.once('disconnect', () => { void stopWorker().finally(() => process.exit()); });
process.on('message', async message => {
  try {
    if (message.init) {
      await stopWorker();
      process.env.RS3_DATASET = message.datasetId;
      const [{ selectedDataset, materializeDatasetValues }, { buildWorld }] = await Promise.all([load('app/dataset-runtime.mjs'), load('app/data/world.mjs')]);
      if (selectedDataset.datasetId !== message.datasetId) throw Error('Dataset switching requires a fresh bridge');
      const definitions = JSON.parse(message.definitionBytes), datasetOptions = message.datasetOptions;
      const inputs = await attest(selectedDataset, materializeDatasetValues, message, root);
      const world = buildWorld(definitions, { ...datasetOptions, dataset: selectedDataset });
      bundle = { definitions, datasetOptions, extraRules: message.extraRules ?? [], datasetSelection: selectedDataset.workerSelection(),
        datasetDigest: selectedDataset.digest, world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, omitReadyCatalogue: true };
      const ready = await startWorker();
      if (mode === 'cold') await stopWorker();
      send({ ready: true, supports: ready.supports, datasetDigest: ready.datasetDigest, inputs }); return;
    }
    if (!worker) await startWorker();
    const id = ++sequence, progress = [];
    const result = await new Promise(resolve => {
      const listener = reply => {
        if (reply.id !== id) return;
        if (reply.type === 'progress') return;
        if (reply.type === 'prediction-prepared') { progress.push(reuse(reply.unlockReuse)); return; }
        worker.off('message', listener); resolve(reply);
      };
      worker.on('message', listener);
      worker.postMessage({ ...message.request, state: message.state, id });
    });
    const { resultJSON, playJSON, duoJSON, duoSidebarJSON, sandboxJSON, unlockReuse, partnerUnlockReuse, ...plain } = result;
    const response = { ...plain, ...(resultJSON ? { full: decode(resultJSON) } : {}), ...(playJSON ? { play: decode(playJSON) } : {}),
      ...(duoJSON ? { duo: decode(duoJSON) } : {}), ...(duoSidebarJSON ? { sidebar: decode(duoSidebarJSON) } : {}),
      ...(sandboxJSON ? { sandbox: decode(sandboxJSON) } : {}), ...(unlockReuse ? { ownerReuse: reuse(unlockReuse) } : {}),
      ...(partnerUnlockReuse ? { partnerReuse: reuse(partnerUnlockReuse) } : {}), ...(progress.length ? { prepared: progress } : {}) };
    if (mode === 'cold') await stopWorker();
    send({ response });
  } catch (error) { send({ bridgeError: true }); }
});
