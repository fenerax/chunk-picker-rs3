// Calculator-only copied-save reader. Never import the store or create credentials.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const sharedJSON = value => {
  const bytes = Buffer.from(JSON.stringify(value)), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes); return shared;
};
export function pruneCalculatorState(full) {
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = full;
  // Ordinary offers also need their origin's handSelected data when cancelled.
  state.history = full.members.some(member => member.pendingRoll?.length) ? history : [];
  return state;
}
export async function calculatorInput(directory) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
  const root = await realpath(directory);
  if (!root.startsWith('/tmp/')) throw Error('InputLocationError');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, codec] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'),
    import('../../app/data/world.mjs'), import('../../app/core/rules.mjs'), import('../../app/core/state.mjs'),
    import('../../app/storage/completion-codec.mjs'),
  ]);
  const stateFile = await realpath(path.join(root, 'state.json'));
  if (path.dirname(stateFile) !== root) throw Error('ReferenceError');
  const bytes = await readFile(stateFile);
  const document = codec.decodeCompletionDocument(JSON.parse(bytes));
  if (document.storage !== undefined) {
    const storage = document.storage;
    if (storage.schemaVersion !== 1 || Object.keys(storage).some(k => !['schemaVersion', 'fields'].includes(k))) throw Error('StorageError');
    const staticRoot = await realpath(path.join(root, 'static'));
    if (!staticRoot.startsWith(root + path.sep)) throw Error('ReferenceError');
    for (const [key, ref] of Object.entries(storage.fields)) {
      if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
        || ref.id !== `static-${ref.sha256}.json.gz` || !/^static-[a-f0-9]{64}\.json\.gz$/.test(ref.id)
        || Object.keys(ref).some(k => !['id', 'sha256'].includes(k))) throw Error('ReferenceError');
      const file = await realpath(path.join(staticRoot, ref.id));
      if (path.dirname(file) !== staticRoot) throw Error('ReferenceError');
      const content = gunzipSync(await readFile(file));
      if (sha(content) !== ref.sha256) throw Error('ChecksumError');
      document.state[key] = JSON.parse(content);
    }
  }
  const registry = rules.createRuleRegistry(), full = core.importBackup(document, registry);
  const state = pruneCalculatorState(full);
  const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset });
  return { dataset, definitions, world, state, core, registry,
    hashes: { dataset: dataset.digest, source: sha(bytes), state: sha(JSON.stringify(state)) },
    workerData: { definitionBytes: sharedJSON(definitions), datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
      world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [], omitReadyCatalogue: true } };
}
