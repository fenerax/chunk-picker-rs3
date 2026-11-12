import { openStore } from '../../app/storage/store.mjs';
import { datasetWithEvidenceHistory } from '../../app/dataset-evidence.mjs';
import { storageOptions, syntheticDataset } from './dataset-evidence.mjs';
const dataDir = process.argv[2];
const dataset = await datasetWithEvidenceHistory(dataDir, syntheticDataset({ evidence: 'new source' }));
await openStore({ ...storageOptions(dataDir, dataset), beforeCommit({ operation }) {
  if (operation === 'catalogue-refresh') process.exit(73);
} });
throw new Error('Expected publication crash was not reached.');
