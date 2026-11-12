import path from 'node:path';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createGroupState } from '../core/state.mjs';
import { buildOwnedBase, verifyOwnedBaseBytes, readOwnedBase } from './owned-base.mjs';
import { createOwnedBaseManifest, resolveOwnedBasePin } from './owned-base-schema.mjs';
import { createPinnedStorage } from './owned-storage.mjs';
import { atomicWrite } from './atomic-write.mjs';

export const ownedDatasetPin = dataset => ({ id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest });
const contains = (parent, child) => { const relative = path.relative(parent, child); return !relative || !relative.startsWith('..') && !path.isAbsolute(relative); };
const refuse = message => { throw Object.assign(new Error(message), { code: 'OWNED_SERVING_REFUSED' }); };

// Resolve existing ancestors too: an absent leaf below a junction is still in
// that junction's deletion tree. Verification never creates a directory.
async function location(value) {
  const absolute = path.resolve(value);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await location(parent), path.basename(absolute));
  }
}
export async function verifyOwnedCatalogueLocation(catalogueRoot, deletionRoots) {
  if (typeof catalogueRoot !== 'string' || !path.isAbsolute(catalogueRoot)) refuse('An absolute external catalogueRoot is required.');
  const catalogue = await location(catalogueRoot);
  for (const tree of deletionRoots) {
    const root = await location(tree);
    if (contains(root, catalogue) || contains(catalogue, root)) refuse('Catalogue must be outside picker and deletion trees.');
  }
  return catalogue;
}

/** Only the same fresh preparation used by owned runtime initialization may
 * produce a release. No saved group, wall clock or saved identity is an input. */
export async function prepareOwnedServingRelease({ dataset, migrateState, registry }) {
  if (typeof migrateState !== 'function') refuse('Owned serving requires a prepared migration catalogue.');
  let state = createGroupState([{ id: 'catalogue-seed', name: 'Synthetic catalogue' }], registry);
  state.provenance = { dataset: ownedDatasetPin(dataset) };
  state = await migrateState(state, { operation: 'initialize' }) ?? state;
  const built = buildOwnedBase({ dataset: ownedDatasetPin(dataset), tasks: state.tasks, identityRegistry: state.identityRegistry });
  return { ...built, dataset: built.pin.dataset, manifest: createOwnedBaseManifest([built.pin]), releaseBytes: built.bytes };
}

/** Offline preparation only. These are independently retained release inputs,
 * never trust reconstructed from a group's saved reference. Hash-named files
 * keep preceding manifests/bytes intact when another release is prepared. */
export async function retainOwnedServingRelease(release, { catalogueRoot, deletionRoots, crash } = {}) {
  const root = await verifyOwnedCatalogueLocation(catalogueRoot, deletionRoots);
  verifyOwnedBaseBytes(release.releaseBytes, release);
  const pin = resolveOwnedBasePin(release.manifest, release.dataset);
  await mkdir(root, { recursive: true });
  const manifestPath = path.join(root, `release-${pin.sha256}.manifest.json`);
  const releasePath = path.join(root, `release-${pin.sha256}.json`);
  await atomicWrite(releasePath, release.releaseBytes, { beforeRename: () => crash?.('release-bytes-temporary-synced') });
  await crash?.('release-bytes-durable');
  await atomicWrite(manifestPath, Buffer.from(JSON.stringify(release.manifest)), { beforeRename: () => crash?.('release-manifest-temporary-synced') });
  await crash?.('release-manifest-durable');
  return { dataset: release.dataset, manifest: release.manifest, releaseBytes: release.releaseBytes, catalogueRoot: root,
    manifestPath, releasePath, retainedManifestPaths: [] };
}

/** Explicit injection, default off. There is deliberately no environment flag.
 * The runtime must be the save's dataset: a catalogue cannot reconstruct a
 * different release's world/providers/calculator. Such saves still refuse. */
export async function verifyOwnedServingConfiguration(options, { dataset, deletionRoots }) {
  if (!options || typeof options !== 'object' || !isDeepStrictEqual(options.dataset, ownedDatasetPin(dataset))) refuse('Owned serving dataset must match the explicitly selected pinned runtime.');
  if (options.retainedManifestPaths !== undefined && !Array.isArray(options.retainedManifestPaths)) refuse('retainedManifestPaths must be an array.');
  const catalogueRoot = await verifyOwnedCatalogueLocation(options.catalogueRoot, deletionRoots);
  if (typeof options.manifestPath !== 'string' || typeof options.releasePath !== 'string') refuse('Independently retained manifestPath and releasePath are required.');
  for (const file of [options.manifestPath, options.releasePath, ...(options.retainedManifestPaths ?? [])]) {
    if (typeof file !== 'string' || !contains(catalogueRoot, await location(file))) refuse('Retained release inputs must live in the external catalogue directory.');
  }
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'));
  const releaseBytes = await readFile(options.releasePath);
  if (!isDeepStrictEqual(manifest, options.manifest) || !Buffer.isBuffer(options.releaseBytes) || !releaseBytes.equals(options.releaseBytes)) refuse('Retained release inputs disagree with supplied manifest/bytes.');
  const base = verifyOwnedBaseBytes(releaseBytes, { dataset: options.dataset, manifest });
  const retainedManifests = await Promise.all((options.retainedManifestPaths ?? []).map(async file => {
    const value = JSON.parse(await readFile(file, 'utf8'));
    // Validate every pin, including manifests that are not selected at startup.
    for (const pin of Object.values(value.bases ?? {})) resolveOwnedBasePin(value, pin.dataset);
    if (value.schemaVersion !== 1 || !Object.keys(value.bases ?? {}).length) refuse('Invalid retained release manifest.');
    for (const pin of Object.values(value.bases)) await readOwnedBase(catalogueRoot,
      { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, { dataset: pin.dataset, manifest: value });
    return value;
  }));
  return { dataset: structuredClone(options.dataset), manifest, releaseBytes, catalogueRoot, retainedManifests, base, crash: options.crash };
}

export function verifyOwnedRuntimeRelease(configuration, preparedRelease) {
  if (!configuration.releaseBytes.equals(preparedRelease.releaseBytes)) refuse('Owned release is not the canonical catalogue from this prepared runtime and migration identities.');
}

/** Select the save's independent pin before binding, preparation or recovery.
 * Existing format-1 saves require a separately authorized stopped conversion. */
export async function selectOwnedServingPicker(configuration, pickerId, dataDir) {
  let document;
  try { document = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (document && document.storage?.schemaVersion !== 2) refuse('Owned serving will not convert an existing format-1 save.');
  let manifest = configuration.manifest, dataset = configuration.dataset;
  if (document) {
    const reference = document.storage.base;
    manifest = [manifest, ...configuration.retainedManifests].find(value => value.bases?.[reference.datasetDigest]?.sha256 === reference.sha256);
    if (!manifest) refuse('Save has no independently retained release manifest.');
    dataset = manifest.bases[reference.datasetDigest].dataset;
    if (!isDeepStrictEqual(dataset, configuration.dataset)) refuse('Save requires its pinned dataset runtime; explicit upgrade staging is required.');
  }
  const ownedFormat2 = { ...configuration, pickerId, dataset, manifest,
    servingPin: resolveOwnedBasePin(manifest, dataset),
    retainedManifests: [configuration.manifest, ...configuration.retainedManifests].filter(value => value !== manifest) };
  if (manifest !== configuration.manifest) delete ownedFormat2.releaseBytes;
  const storage = createPinnedStorage(ownedFormat2, dataDir, { readOnly: true });
  if (document) await storage.read(document.storage.base); else await storage.codec();
  await configuration.crash?.('serving-pin-selected');
  return { ownedFormat2, base: storage.base };
}
