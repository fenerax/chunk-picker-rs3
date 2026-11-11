import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareOwnedServingRelease, retainOwnedServingRelease } from '../../../app/storage/owned-serving.mjs';

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
