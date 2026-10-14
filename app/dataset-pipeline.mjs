import { requireSelectedDataset } from './dataset-runtime.mjs';
import { applyEquipmentCorrections } from './data/equipment-corrections.mjs';
import { applyCacheShops } from './data/cache-shops.mjs';
import { applyDivinationTraining } from './data/divination-training.mjs';
import { applyRetainedTaskCorrections } from './data/retained-task-corrections.mjs';
import { applyRetainedUnsupportedCorrections } from './data/retained-unsupported-corrections.mjs';
import { applyMetadataCorrections } from './data/metadata-corrections.mjs';

const prepared = new WeakMap();
export function prepareServerDefinitions(definitions, dataset) {
  const { capabilities } = requireSelectedDataset(dataset);
  const result = applyCacheShops(capabilities.equipmentCorrections ? applyEquipmentCorrections(definitions) : definitions,
    { enabled: capabilities.cacheShops });
  prepared.set(result, { stages: new Set([
    ...(capabilities.equipmentCorrections ? ['equipmentCorrections'] : []),
    ...(capabilities.cacheShops ? ['cacheShops'] : []),
  ]) });
  return result;
}

export function prepareWorkerDefinitions(definitions, dataset, inherited = []) {
  const { capabilities } = requireSelectedDataset(dataset), stages = new Set(inherited);
  let result = definitions;
  if (capabilities.equipmentCorrections && !stages.has('equipmentCorrections')) {
    result = applyEquipmentCorrections(result); stages.add('equipmentCorrections');
  }
  if (capabilities.retainedTaskCorrections) {
    result = applyRetainedTaskCorrections(result); stages.add('retainedTaskCorrections');
  }
  prepared.set(result, { stages });
  return result;
}

/** The legacy order is explicit. Reusing prepared inputs never reapplies it. */
export function prepareTaskDefinitions(definitions, dataset, overrides = {}) {
  const capabilities = dataset ? requireSelectedDataset(dataset).capabilities : {};
  const policy = Object.fromEntries(['divinationTraining', 'retainedTaskCorrections', 'retainedUnsupportedCorrections',
    'metadataCorrections', 'equipmentCorrections'].map(key => [key, overrides[key] ?? capabilities[key] ?? false]));
  const key = JSON.stringify(policy);
  if (prepared.get(definitions)?.key === key) return definitions;
  const stages = new Set(prepared.get(definitions)?.stages);
  const operations = { divinationTraining: data => applyDivinationTraining(data, { enabled: true }),
    retainedTaskCorrections: applyRetainedTaskCorrections, retainedUnsupportedCorrections: applyRetainedUnsupportedCorrections,
    metadataCorrections: applyMetadataCorrections, equipmentCorrections: applyEquipmentCorrections };
  let result = definitions;
  for (const [stage, operation] of Object.entries(operations)) if (policy[stage] && !stages.has(stage)) {
    result = operation(result); stages.add(stage);
  }
  prepared.set(result, { key, stages });
  return result;
}
