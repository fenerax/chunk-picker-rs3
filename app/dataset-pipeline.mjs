import { requireSelectedDataset } from './dataset-runtime.mjs';
import { applyEquipmentCorrections } from './data/equipment-corrections.mjs';
import { applyCacheShops } from './data/cache-shops.mjs';
import { applyDivinationTraining } from './data/divination-training.mjs';
import { applyRetainedTaskCorrections, applySelectedRetainedTaskCorrections } from './data/retained-task-corrections.mjs';
import { applyRetainedUnsupportedCorrections } from './data/retained-unsupported-corrections.mjs';
import { applyMetadataCorrections } from './data/metadata-corrections.mjs';
import { applyDefinitionOverlays } from './data/definition-overlays.mjs';
import { selectedDefinitionOverlays } from './data/selected-definition-overlays.mjs';

const defaultOperations = {
  divinationTraining: data => applyDivinationTraining(data, { enabled: true }),
  retainedTaskCorrections: applyRetainedTaskCorrections,
  retainedUnsupportedCorrections: applyRetainedUnsupportedCorrections,
  metadataCorrections: applyMetadataCorrections,
  equipmentCorrections: applyEquipmentCorrections,
  cacheShops: data => applyCacheShops(data, { enabled: true }),
};
const taskStages = ['divinationTraining', 'retainedTaskCorrections', 'retainedUnsupportedCorrections', 'metadataCorrections', 'equipmentCorrections'];

/** A single preparation ledger keeps server serialization, workers and direct
 * task compilation on the same reviewed definition boundary. */
export function createDefinitionPipeline({ requireDataset = requireSelectedDataset, overlays = selectedDefinitionOverlays,
  operations = defaultOperations, applySelectedCorrections = applySelectedRetainedTaskCorrections } = {}) {
  const prepared = new WeakMap();
  const stagesFor = definitions => [...(prepared.get(definitions)?.stages ?? [])];
  function prepareTaskDefinitions(definitions, dataset, overrides = {}) {
    const capabilities = dataset ? requireDataset(dataset).capabilities : {};
    const policy = Object.fromEntries(taskStages.map(stage => [stage, overrides[stage] ?? capabilities[stage] ?? false]));
    const reviewedOverlays = overrides.reviewedOverlays ?? Boolean(dataset);
    if (typeof reviewedOverlays !== 'boolean') throw new TypeError('reviewedOverlays must be a boolean.');
    const key = JSON.stringify({ ...policy, reviewedOverlays });
    if (prepared.get(definitions)?.key === key) return definitions;
    const stages = new Set(stagesFor(definitions));
    let result = definitions;
    for (const stage of taskStages) if (policy[stage] && !stages.has(stage)) {
      result = operations[stage](result); stages.add(stage);
    }
    if (reviewedOverlays && !stages.has('selectedRetainedTaskCorrections')) {
      result = applySelectedCorrections(result); stages.add('selectedRetainedTaskCorrections');
    }
    if (reviewedOverlays && !stages.has('definitionOverlays')) {
      result = applyDefinitionOverlays(result, overlays); stages.add('definitionOverlays');
    }
    prepared.set(result, { key, stages });
    return result;
  }
  function prepareServerDefinitions(definitions, dataset, { reviewedOverlays = true } = {}) {
    if (typeof reviewedOverlays !== 'boolean') throw new TypeError('reviewedOverlays must be a boolean.');
    const { capabilities } = requireDataset(dataset), stages = new Set(stagesFor(definitions));
    let result = definitions;
    for (const stage of ['equipmentCorrections', 'cacheShops']) if (capabilities[stage] && !stages.has(stage)) {
      result = operations[stage](result); stages.add(stage);
    }
    prepared.set(result, { stages });
    // Legacy datasets retain their existing boundary. Selected reviewed patches
    // must reach /definitions and world/display construction before publication.
    return reviewedOverlays && overlays.length ? prepareTaskDefinitions(result, dataset, { reviewedOverlays }) : result;
  }
  function prepareWorkerDefinitions(definitions, dataset, inherited = [], { reviewedOverlays = true } = {}) {
    if (typeof reviewedOverlays !== 'boolean') throw new TypeError('reviewedOverlays must be a boolean.');
    const { capabilities } = requireDataset(dataset), stages = new Set([...stagesFor(definitions), ...inherited]);
    let result = definitions;
    if (capabilities.equipmentCorrections && !stages.has('equipmentCorrections')) {
      result = operations.equipmentCorrections(result); stages.add('equipmentCorrections');
    }
    prepared.set(result, { stages });
    if (reviewedOverlays && overlays.length) return prepareTaskDefinitions(result, dataset, { reviewedOverlays });
    if (capabilities.retainedTaskCorrections && !stages.has('retainedTaskCorrections')) {
      result = operations.retainedTaskCorrections(result); stages.add('retainedTaskCorrections');
    }
    prepared.set(result, { stages });
    return result;
  }
  return { prepareServerDefinitions, prepareWorkerDefinitions, prepareTaskDefinitions, preparedDefinitionStages: stagesFor };
}

export const { prepareServerDefinitions, prepareWorkerDefinitions, prepareTaskDefinitions, preparedDefinitionStages } = createDefinitionPipeline();
