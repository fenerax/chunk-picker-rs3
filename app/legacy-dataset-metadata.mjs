import path from 'node:path';
import { createArtProvider } from './art-provider.mjs';
import { packRelative } from './packs.mjs';

/** Milestone-1 compatibility only: metadata follows the existing art providers
 * until an explicit complete dataset freezes it as ordinary data inputs. */
export async function createLegacyMetadataResolver({ root, packsDir, selectionPath, selection, mapAssetsDir, keys } = {}) {
  if (!keys) { const { DATASET_INPUTS } = await import('./dataset-inputs.mjs'); keys = DATASET_INPUTS.filter(key => key.startsWith('local-map/')); }
  const allowed = keys.map(key => {
    packRelative(key);
    if (!key.startsWith('local-map/') || !key.endsWith('.json')) throw new TypeError('Invalid legacy metadata key.');
    return key;
  });
  const art = await createArtProvider({ packsDir, selectionPath, selection,
    overrides: { mapAssets: mapAssetsDir }, defaults: { mapAssets: mapAssetsDir ?? path.join(root, '.local', 'map-assets') } });
  const permitted = new Set(allowed);
  return Object.freeze({
    async file(key) {
      if (!permitted.has(key)) return null;
      return art.file('mapAssets', key.slice('local-map/'.length));
    },
    expected: filename => art.pack.expected(filename),
  });
}
