/** Display-only catalogue index. No evaluator, state or ownership imports. */
export function buildInteriorMapIndex(catalogue) {
  if (catalogue?.schemaVersion !== 1 || catalogue.displayOnly !== true || catalogue.accessEffect !== 'none') throw new TypeError('Expected display-only interior catalogue');
  const directory = catalogue.assets?.directory;
  if (!/^interiors\.cache-[a-zA-Z0-9_-]+$/.test(directory ?? '') || !/^[a-f0-9]{64}$/.test(catalogue.assets?.manifestSha256 ?? '')) throw new TypeError('Invalid interior asset version');
  const maps = new Map(), areas = new Map(), tiles = new Map();
  for (const map of catalogue.maps ?? []) {
    const offSurface28 = map.mapId === 28 && map.offSurface === true && map.boundsKind === 'exact-selected-off-surface-paste-coverage';
    if (!Number.isInteger(map.mapId) || map.mapId < 0 || (map.mapId === 28 && !offSurface28) || !Number.isInteger(map.plane) || map.plane < 0 || map.plane > 3) throw new TypeError('Invalid interior map layer');
    const key = `${map.mapId}:${map.plane}`;
    if (maps.has(key)) throw new TypeError('Duplicate interior layer');
    const b = map.bounds;
    if (!b || !['minX', 'minY', 'maxX', 'maxY'].every(k => Number.isInteger(b[k])) || b.minX >= b.maxX || b.minY >= b.maxY) throw new TypeError('Invalid interior bounds');
    maps.set(key, map);
    for (const tile of map.tiles ?? []) {
      const path = `${directory}/${map.mapId}/2/${map.plane}_${tile.x}_${tile.y}.png`;
      if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || tile.x < 0 || tile.y < 0 || tile.plane !== map.plane || tile.path !== path || tile.status !== 'rendered'
        || !Number.isInteger(tile.bytes) || tile.bytes <= 0 || !/^[a-f0-9]{64}$/.test(tile.sha256)) throw new TypeError('Invalid interior tile');
      const tileKey = `${key}:${tile.x}:${tile.y}`;
      if (tiles.has(tileKey)) throw new TypeError('Duplicate interior tile');
      tiles.set(tileKey, tile);
    }
  }
  for (const area of catalogue.areas ?? []) {
    if (typeof area.areaId !== 'string' || !area.areaId || areas.has(area.areaId) || !['mapped', 'unknown'].includes(area.status)) throw new TypeError('Invalid interior area');
    if ((area.layers ?? []).some(layer => !maps.has(`${layer.mapId}:${layer.plane}`))) throw new TypeError('Interior area refers to missing layer');
    for (const layer of area.layers ?? []) if (layer.bounds) {
      const b = layer.bounds, mapBounds = maps.get(`${layer.mapId}:${layer.plane}`).bounds;
      if (!['minX', 'minY', 'maxX', 'maxY'].every(k => Number.isInteger(b[k])) || b.minX >= b.maxX || b.minY >= b.maxY
        || b.minX < mapBounds.minX || b.minY < mapBounds.minY || b.maxX > mapBounds.maxX || b.maxY > mapBounds.maxY) throw new TypeError('Interior area bounds escape rendered layer');
    }
    if ((area.status === 'mapped') !== ((area.layers ?? []).length > 0)) throw new TypeError('Interior mapping has no rendered layer');
    areas.set(area.areaId, area);
  }
  return { catalogue, maps, areas, tiles };
}
export const getInteriorMap = (index, mapId, plane = 0) => index.maps.get(`${mapId}:${plane}`) ?? null;
export const getInteriorTile = (index, mapId, plane, x, y) => index.tiles.get(`${mapId}:${plane}:${x}:${y}`) ?? null;
export function getInteriorArea(index, areaId) {
  const area = index.areas.get(String(areaId));
  if (!area) return null;
  return { ...area, maps: area.layers.map(layer => getInteriorMap(index, layer.mapId, layer.plane)) };
}
export const getInteriorEntrances = (index, areaId) => index.areas.get(String(areaId))?.entrances ?? [];

/** Exact coordinate conversion: no nearest-square or centre substitution. */
export function interiorTileAddress(index, mapId, plane, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tile = getInteriorTile(index, mapId, plane, Math.floor(x / 64), Math.floor(y / 64));
  return tile ? { tile, pixelX: (x - tile.x * 64) * 4, pixelY: (tile.y * 64 + 64 - y) * 4 } : null;
}
