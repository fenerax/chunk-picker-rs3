/** Exact cache world-map layout. Coordinates are game tiles; blocks are 8x8.
 * Cache archive IDs are y*128+x, unlike the picker's x*256+y chunk IDs. */
export const SURFACE_MAP_ID = 28;
export const PICKER_CROP = Object.freeze({ minX: 1856, maxX: 4864, minY: 1408, maxY: 4608 });
export const mapsquareId = (x, y) => y * 128 + x;
export const blockKey = (x, y, plane = 0) => `${plane}:${x}:${y}`;
export function unpackCoord(value) {
  return { x: (value >>> 14) & 0x3fff, y: value & 0x3fff, plane: value >>> 28 };
}
export function inCrop(x, y, crop = PICKER_CROP) {
  return x >= crop.minX && x < crop.maxX && y >= crop.minY && y < crop.maxY;
}

export function buildSurfaceLayout(zone, pastes, { mapId = SURFACE_MAP_ID, plane = 0 } = {}) {
  const blocks = new Map(), sourceBlocks = new Map(), disabled = [], conflicts = [];
  function add(row, kind, index) {
    if (row.n_planes === 0) { disabled.push({ kind, index, ...row }); return; }
    const planeOffset = plane - row.new_plane;
    if (planeOffset < 0 || planeOffset >= row.n_planes) return;
    const size = kind === 'square' ? 64 : 8;
    const sourceX = row.original_regionX * 64 + (kind === 'chunk' ? row.original_chunkX * 8 : 0);
    const sourceY = row.original_regionY * 64 + (kind === 'chunk' ? row.original_chunkY * 8 : 0);
    const destinationX = row.new_regionX * 64 + (kind === 'chunk' ? row.new_chunkX * 8 : 0);
    const destinationY = row.new_regionY * 64 + (kind === 'chunk' ? row.new_chunkY * 8 : 0);
    for (let dx = 0; dx < size; dx += 8) for (let dy = 0; dy < size; dy += 8) {
      const source = { x: sourceX + dx, y: sourceY + dy, plane: row.original_plane + planeOffset };
      const destination = { x: destinationX + dx, y: destinationY + dy, plane };
      const key = blockKey(destination.x / 8, destination.y / 8, plane);
      const mapping = { mapId, source, destination, translation: { x: destination.x - source.x,
        y: destination.y - source.y, plane: plane - source.plane }, paste: { kind, index, ...row } };
      if (blocks.has(key)) {
        // Do not silently pick an order when a future cache has overlapping pastes.
        conflicts.push({ key, mappings: [blocks.get(key), mapping] });
        continue;
      }
      blocks.set(key, mapping);
      const sourceKey = blockKey(source.x / 8, source.y / 8, source.plane);
      if (!sourceBlocks.has(sourceKey)) sourceBlocks.set(sourceKey, []);
      sourceBlocks.get(sourceKey).push(mapping);
    }
  }
  pastes.squares.forEach((row, index) => add(row, 'square', index));
  pastes.chunks.forEach((row, index) => add(row, 'chunk', index));
  if (conflicts.length) throw new Error(`Ambiguous map ${mapId} layout: ${conflicts.length} overlapping 8x8 blocks`);
  return { mapId, plane, name: zone.name, internalName: zone.internal_name, zone, width: pastes.width,
    height: pastes.height, blocks, sourceBlocks, disabled, conflicts,
    provenance: { major: 23, zoneArchive: 0, pasteArchive: 1, subid: mapId } };
}

export function loadSurfaceLayout(cache, options = {}) {
  const mapId = options.mapId ?? SURFACE_MAP_ID;
  const zoneBytes = cache.archive(23, 0)?.get(mapId), pasteBytes = cache.archive(23, 1)?.get(mapId);
  if (!zoneBytes || !pasteBytes) throw new Error(`Map ${mapId} identity/layout missing from copied cache`);
  return buildSurfaceLayout(cache.decoders.decode('zones', zoneBytes), cache.decoders.decode('pastes', pasteBytes), options);
}

/** One source block can legitimately appear at several display positions. */
export function sourceToSurface(layout, x, y, plane = 0) {
  const mappings = layout.sourceBlocks.get(blockKey(Math.floor(x / 8), Math.floor(y / 8), plane)) ?? [];
  return mappings.map(mapping => ({ x: x + mapping.translation.x, y: y + mapping.translation.y,
    plane: layout.plane, mapId: layout.mapId, mapping }));
}

export function surfaceToSource(layout, x, y) {
  const mapping = layout.blocks.get(blockKey(Math.floor(x / 8), Math.floor(y / 8), layout.plane));
  return mapping ? { x: x - mapping.translation.x, y: y - mapping.translation.y,
    plane: mapping.source.plane, mapId: layout.mapId, mapping } : null;
}
