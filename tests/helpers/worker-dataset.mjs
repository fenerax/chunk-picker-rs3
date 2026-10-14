import { selectedDataset } from '../../app/dataset-runtime.mjs';

/** Synthetic worker fixtures declare their geography instead of inheriting
 * the selected native world's walking capability. Explicit scenario flags win. */
export function genericWorkerData(input) {
  return { ...input,
    datasetSelection: input.datasetSelection ?? selectedDataset.workerSelection(),
    datasetDigest: input.datasetDigest ?? selectedDataset.digest,
    datasetOptions: { cacheWalking: false, ...input.datasetOptions },
  };
}
