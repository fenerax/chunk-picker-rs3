import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { resolveDataset } from '../../app/datasets.mjs';

// Opt-in fixtures only: these scenarios never edit dataset inputs or selection.
// Storage, HTTP, workers and authentication are still created for every case.
// Dataset/startup/pack validation suites continue to resolve fresh providers.
export const fixtureDataset = selectedDataset;
let empty;
let emptyDirectory;
after(async () => { if (emptyDirectory) await rm(emptyDirectory, { recursive: true, force: true }); });
export function emptyMetadataDataset() {
  return empty ??= (async () => {
    emptyDirectory = await mkdtemp(path.join(tmpdir(), 'picker-test-dataset-'));
    return resolveDataset({ mapAssetsDir: path.join(emptyDirectory, 'absent-map'), gameDataDir: path.join(emptyDirectory, 'absent-game') });
  })();
}
