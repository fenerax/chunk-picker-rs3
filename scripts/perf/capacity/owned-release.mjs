import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareOwnedServingRelease, retainOwnedServingRelease, verifyOwnedRuntimeRelease } from '../../../app/storage/owned-serving.mjs';
import { verifyOwnedBaseBytes } from '../../../app/storage/owned-base.mjs';
import { isDeepStrictEqual } from 'node:util';
import { prepareFixtureInputs } from './fixture-inputs.mjs';
import { fixtureMigration } from './fixture-migration.mjs';

export async function prepareCapacityOwnedRelease(directory, inputs) {
  const release = await prepareOwnedServingRelease(inputs);
  const options = await retainOwnedServingRelease(release, { catalogueRoot: path.join(directory, 'catalogue'),
    deletionRoots: ['legacy', 'pickers', 'tombstones', 'registry'].map(name => path.join(directory, name)) });
  await writeFile(path.join(options.catalogueRoot, 'serving.json'), JSON.stringify({ dataset: options.dataset,
    manifestFile: path.basename(options.manifestPath), releaseFile: path.basename(options.releasePath) }), { flag: 'wx' });
  return options;
}
export async function loadCapacityOwnedRelease(directory) {
  const catalogueRoot = path.join(directory, 'catalogue');
  const descriptor = JSON.parse(await readFile(path.join(catalogueRoot, 'serving.json'), 'utf8'));
  for (const file of [descriptor.manifestFile, descriptor.releaseFile]) if (typeof file !== 'string' || path.basename(file) !== file) throw new TypeError('Invalid retained release filename.');
  const manifestPath = path.join(catalogueRoot, descriptor.manifestFile), releasePath = path.join(catalogueRoot, descriptor.releaseFile);
  return { catalogueRoot, dataset: descriptor.dataset, manifestPath, releasePath, retainedManifestPaths: [],
    manifest: JSON.parse(await readFile(manifestPath, 'utf8')), releaseBytes: await readFile(releasePath) };
}

// Read only: verify the retained trust inputs and compare with what the current
// server prepares. Preparing an in-memory base never publishes into the fixture.
export async function verifyCapacityOwnedRelease(directory, profile, pin) {
  const { selectedDataset } = await import('../../../app/dataset-runtime.mjs');
  const { rules, migrationInputs } = await prepareFixtureInputs(profile);
  const current = await prepareOwnedServingRelease({ dataset: selectedDataset, registry: rules,
    migrateState: fixtureMigration(migrationInputs, selectedDataset).migrateState });
  if (!isDeepStrictEqual(pin, current.pin)) throw new Error('Fixture current runtime owned base pin mismatch; rebuild required.');
  const retained = await loadCapacityOwnedRelease(directory);
  verifyOwnedBaseBytes(retained.releaseBytes, retained);
  verifyOwnedRuntimeRelease(retained, current);
}
