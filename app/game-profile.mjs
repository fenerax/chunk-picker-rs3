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
  // Compatibility route/feature names cover all configured progress sources.
  ['/api/runemetrics/preview', 'runeMetrics'], ['/api/runemetrics/apply', 'runeMetrics'],
  ['/api/original-sync/preview', 'originalSync'], ['/api/training-plan', 'training'],
  ['/original-sync.mjs', 'originalSync'], ['/api/migration', 'originalSync'],
  ['/api/import', 'originalSync'], ['/api/import/preview', 'originalSync'],
  ['/api/area-check', 'training'], ['/api/death-estimates', 'training'], ['/api/helper-drops', 'rsCatalogues'],
  ['/api/helper-progress', 'rsCatalogues'], ['/api/teleports', 'mapMetadata'], ['/api/members-start', 'rsCatalogues'],
]);
const commandFeatures = new Map([
  ['sync-original', 'originalSync'], ['apply-runemetrics', 'runeMetrics'], ['set-runescape-name', 'externalNames'],
  ['go-members', 'rsCatalogues'], ['setup-start', 'rsCatalogues'], ['set-obtained-equipment', 'equipment'],
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

/** Read-only owned-picker checks. Currency proofs must repeat authorization;
 * a matching dataset stamp alone never proves registry membership. */
export function prepareOwnedPickerState(dataset, pickerRegistry, pickerId) {
  const prepare = (state, { operation }) => {
    const registered = pickerRegistry.getPicker(pickerId);
    const ids = state.members.map(member => member.id);
    const required = pickerRegistry.listAccounts().flatMap(a => a.memberships.filter(m => m.pickerId === pickerId && m.role !== 'viewer').map(m => m.memberId));
    if (required.some(id => !ids.includes(id)) || (operation !== 'replace' && ids.some(id => !registered.memberIds.includes(id)))) {
      throw Object.assign(new Error('Picker membership does not match its registry.'), { status: 403 });
    }
    const identity = state.provenance?.dataset;
    if (!identity || identity.id !== dataset.datasetId || identity.contractVersion !== dataset.datasetContractVersion || identity.digest !== dataset.digest) {
      throw Object.assign(new Error('Choose a backup from this picker’s dataset.'), { status: 422 });
    }
    return state;
  };
  const current = (state, operation) => {
    prepare(state, { operation });
    // Even a reusable gameplay migration refreshes this derived count. Give
    // the full preparation path that opportunity after catalogue size changes,
    // without changing the migration's own readiness/reuse semantics.
    const migration = state.legacy?.gameplayMigration;
    return !migration || migration.report?.catalogueTasks === state.tasks.length;
  };
  prepare.isCurrent = state => current(state, 'load');
  prepare.commandIsCurrent = state => current(state, 'command');
  return prepare;
}

export function preserveGameIdentity(dataset, prepareState) {
  if (!dataset.capabilities?.independent) return prepareState;
  const prepare = async (state, context) => {
    const ready = await prepareState?.(state, context) ?? state;
    ready.provenance = { ...ready.provenance, dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
    return ready;
  };
  const identityIsCurrent = state => {
    const identity = state.provenance?.dataset;
    return identity && Object.keys(identity).length === 3 && identity.id === dataset.datasetId
      && identity.contractVersion === dataset.datasetContractVersion && identity.digest === dataset.digest;
  };
  // Compose only explicit synchronous, read-only proofs. Ordinary caller hooks
  // still run on a detached, revalidated copy. Run the caller proof every time
  // so mutable authorization cannot be bypassed by the identity stamp.
  for (const key of ['isCurrent', 'commandIsCurrent']) {
    if (!prepareState) prepare[key] = identityIsCurrent;
    else if (typeof prepareState[key] === 'function') prepare[key] = state =>
      prepareState[key](state) === true && identityIsCurrent(state);
  }
  return prepare;
}
