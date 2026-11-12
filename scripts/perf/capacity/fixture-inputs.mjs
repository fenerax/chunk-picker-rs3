import { catalogue, syntheticWorld } from './model.mjs';

// Share the builder's exact preparation with the read-only format-2 reuse check.
// In particular, do not substitute a raw task engine for the server handshake.
export async function prepareFixtureInputs(profile) {
  const [{ createRuleRegistry }, { buildWorld }, { selectedDataset }, { createTaskScheduler },
    { prepareServerDefinitions, preparedDefinitionStages }] = await Promise.all([
    import('../../../app/core/rules.mjs'), import('../../../app/data/world.mjs'), import('../../../app/dataset-runtime.mjs'),
    import('../../../app/tasks/scheduler.mjs'), import('../../../app/dataset-pipeline.mjs')]);
  const data = catalogue(profile.catalogue), rules = createRuleRegistry();
  const definitions = prepareServerDefinitions(structuredClone(data), selectedDataset, { reviewedOverlays: false });
  const calculator = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, datasetOptions: { reviewedOverlays: false, cacheWalking: false },
    preparedDatasetStages: preparedDefinitionStages(definitions), world: { ...syntheticWorld(data, buildWorld) } } });
  try {
    return { data, rules, migrationInputs: { definitions, catalogue: calculator.catalogue, dynamicCatalogue: calculator.dynamicCatalogue,
      taskMap: {}, taskMapHistory: selectedDataset.capabilities.legacyHistory === false ? {} : await selectedDataset.json('app/data/legacy-task-history.json') } };
  } finally { await calculator.close(); }
}
