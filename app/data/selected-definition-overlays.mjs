import { selectedDataset, datasetJSON } from '../dataset-runtime.mjs';
import referenceCorrections from './reference-corrections.2026-10-31.v1.mjs';
import requirementsCorrections from './requirements-corrections.2026-10-31.v1.mjs';
import questRequirementsCorrections from './quest-requirements-corrections.2026-10-31.v1.mjs';

// Core-owned factual repairs also cover already-issued immutable legacy packs.
// Independent datasets and injected fixtures do not inherit legacy selectors.
const legacyReview = (selectedDataset.definitionOverlays ?? []).includes('app/data/reviewed-definition-overlays.2026-10-17.v1.json');
export const selectedDefinitionOverlays = [
  ...await Promise.all((selectedDataset.definitionOverlays ?? []).map(datasetJSON)),
  ...(legacyReview ? [referenceCorrections, requirementsCorrections, questRequirementsCorrections] : []),
];
export const selectedRetainedTaskCorrections = (await Promise.all(selectedDefinitionOverlays.flatMap(row => row.retainedTaskCorrections ?? [])
  .map(datasetJSON))).flatMap(row => row.corrections);
