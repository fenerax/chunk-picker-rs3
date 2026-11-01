import { parentPort } from 'node:worker_threads';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { prepareServerDefinitions, preparedDefinitionStages } from '../../app/dataset-pipeline.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { buildWorld } from '../../app/data/world.mjs';
parentPort.on('message', ({ id, definitions, extraRules }) => {
  try {
    const options = { reviewedOverlays: false, cacheWalking: false };
    definitions = prepareServerDefinitions(definitions, selectedDataset, options);
    const indexed = buildWorld(definitions, { dataset: selectedDataset, ...options });
    const world = { chunks: indexed.chunks, areas: indexed.areas, surface: indexed.surface };
    const catalogue = createTaskEngine(definitions, { dataset: selectedDataset, ...options }).catalogue.map(({ id, label, category, aliases }) => ({ id, label, category, aliases }));
    parentPort.postMessage({ id, input: { world, catalogue, bundle: { definitions, extraRules, world, datasetOptions: options,
      datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
      preparedDatasetStages: preparedDefinitionStages(definitions), omitReadyCatalogue: true } } });
  } catch { parentPort.postMessage({ id, error: 'invalid' }); }
});
