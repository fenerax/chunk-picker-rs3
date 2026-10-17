import { selectedDataset, datasetJSON } from '../dataset-runtime.mjs';

export const selectedDefinitionOverlays = await Promise.all((selectedDataset.definitionOverlays ?? []).map(datasetJSON));
export const selectedRetainedTaskCorrections = (await Promise.all(selectedDefinitionOverlays.flatMap(row => row.retainedTaskCorrections ?? [])
  .map(datasetJSON))).flatMap(row => row.corrections);
