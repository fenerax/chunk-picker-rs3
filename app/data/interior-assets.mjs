export const INTERIOR_ASSET_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** Only pinned rendered tiles become HTTP paths. Area names are never paths. */
export function createInteriorAssetCatalogue(catalogue) {
  const { directory, manifestPath, manifestSha256 } = catalogue.assets ?? {};
  if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.maps)
    || !/^interiors\.cache-[A-Za-z0-9_-]+$/.test(directory ?? '')
    || manifestPath !== `${directory}/manifest.json` || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? '')) {
    throw new TypeError('Invalid interior asset catalogue.');
  }
  const files = new Map();
  for (const map of catalogue.maps) {
    if (!Number.isSafeInteger(map.mapId) || map.mapId < 0 || !Number.isInteger(map.plane)
      || map.plane < 0 || map.plane > 3 || !Array.isArray(map.tiles)) throw new TypeError('Invalid interior map.');
    for (const tile of map.tiles) {
      if (tile.status !== 'rendered') continue;
      const relative = `${directory}/${map.mapId}/2/${map.plane}_${tile.x}_${tile.y}.png`;
      if (![tile.x, tile.y].every(value => Number.isSafeInteger(value) && value >= 0)
        || tile.plane !== map.plane || tile.path !== relative || !/^[a-f0-9]{64}$/.test(tile.sha256 ?? '')
        || !Number.isSafeInteger(tile.bytes) || tile.bytes < 1) throw new TypeError('Invalid interior tile.');
      const route = `/assets/map/${relative}`, previous = files.get(route);
      if (previous && (previous.sha256 !== tile.sha256 || previous.bytes !== tile.bytes)) throw new TypeError('Conflicting interior tile.');
      files.set(route, { relative, sha256: tile.sha256, bytes: tile.bytes });
    }
  }
  return { files, manifest: { relative: manifestPath, sha256: manifestSha256 }, directory };
}
