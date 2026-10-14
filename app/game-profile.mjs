import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { bindDatasetStorage, verifyDatasetBinding } from './dataset-binding.mjs';

export const datasetFeature = (dataset, feature) => dataset.capabilities?.features?.[feature] !== false;
export const defaultGameDirectory = (root, dataset) => path.join(root, '.local', dataset.capabilities?.independent ? 'open-starter' : 'duo');

function storageError() {
  return Object.assign(new Error('Start this game in its own fresh storage directory.'), { code: 'DATASET_BINDING_MISMATCH' });
}

/** Independent games never adopt unbound existing storage or the private default. */
export async function prepareGameStorage(dataDir, dataset) {
  if (dataset.capabilities?.independent) {
    const directory = path.resolve(dataDir);
    if (path.basename(directory).toLowerCase() === 'duo' && path.basename(path.dirname(directory)).toLowerCase() === '.local') throw storageError();
  }
  const checked = await verifyDatasetBinding(dataDir, dataset);
  if (!dataset.capabilities?.independent || checked.bound) return checked;
  try { if ((await readdir(dataDir)).length) throw storageError(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return bindDatasetStorage(dataDir, dataset);
}

const routeFeatures = new Map([
  ['/api/runemetrics/preview', 'runeMetrics'], ['/api/runemetrics/apply', 'runeMetrics'],
  ['/api/original-sync/preview', 'originalSync'], ['/api/training-plan', 'training'],
  ['/original-sync.mjs', 'originalSync'], ['/api/migration', 'originalSync'],
  ['/api/import', 'originalSync'], ['/api/import/preview', 'originalSync'],
  ['/api/area-check', 'training'], ['/api/death-estimates', 'training'], ['/api/helper-drops', 'rsCatalogues'],
  ['/api/helper-progress', 'rsCatalogues'], ['/api/teleports', 'mapMetadata'], ['/api/members-start', 'rsCatalogues'],
]);
const commandFeatures = new Map([
  ['sync-original', 'originalSync'], ['apply-runemetrics', 'runeMetrics'], ['set-runescape-name', 'externalNames'],
  ['go-members', 'rsCatalogues'], ['set-obtained-equipment', 'equipment'],
  ['set-skill-levels', 'training'], ['set-slayer-lock', 'rsCatalogues'],
]);
export function unavailableDatasetFeature(dataset, route, commandType) {
  const feature = commandType ? commandFeatures.get(commandType) : routeFeatures.get(route);
  return feature && !datasetFeature(dataset, feature) ? feature : null;
}

export function gameArtOptions(dataset, options) {
  if (!dataset.capabilities?.independent) return options;
  // The starter coordinate system has no artwork provider. Operator defaults
  // and environment inherited from another game cannot introduce private art.
  return { selection: { schemaVersion: 1, art: null }, overrides: {}, defaults: {} };
}

export function requireGameBackup(dataset, backup) {
  if (!dataset.capabilities?.independent) return backup;
  const identity = backup?.state?.provenance?.dataset;
  if (!identity || identity.id !== dataset.datasetId || identity.contractVersion !== dataset.datasetContractVersion || identity.digest !== dataset.digest) {
    throw Object.assign(new Error('Choose a backup from this starter game dataset.'), { status: 422, code: 'DATASET_BINDING_MISMATCH' });
  }
  return backup;
}

export function preserveGameIdentity(dataset, prepareState) {
  if (!dataset.capabilities?.independent) return prepareState;
  return async (state, context) => {
    const ready = await prepareState?.(state, context) ?? state;
    ready.provenance = { ...ready.provenance, dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
    return ready;
  };
}
