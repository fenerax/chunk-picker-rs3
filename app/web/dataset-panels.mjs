import { selectedDataset } from '../dataset-runtime.mjs';
import { loadOriginalSyncPanel } from './original-sync-loader.mjs';

export const createOriginalSync = await loadOriginalSyncPanel(selectedDataset);
