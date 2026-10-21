import { mapsquareId } from './surface.mjs';
import { sha256 } from '../lib/provenance-hash.mjs';

/** Assemble exactly the destination blocks, including partial 8x8 pastes.
 * Every tile is remapped into an isolated plane zero for rasterisation. A map's
 * display planes therefore do not bleed into each other's independent images. */
export function assembleInteriorSquare(cache, layout, x, y) {
  const tiles = Array(4096), nxt = Array(66 * 66), locations = [], archives = new Map();
  const rows = [...layout.blocks.values()].filter(r => Math.floor(r.destination.x / 64) === x && Math.floor(r.destination.y / 64) === y);
  for (const row of rows) {
    const id = mapsquareId(Math.floor(row.source.x / 64), Math.floor(row.source.y / 64));
    if (!archives.has(id)) {
      const archive = cache.archive(5, id);
      if (!archive?.has(3)) throw new Error(`Missing source terrain ${id}`);
      archives.set(id, { tiles: cache.decoders.decode('tiles', archive.get(3)).tiles,
        nxt: archive.has(5) ? cache.decoders.decode('nxt', archive.get(5)) : null,
        locations: archive.has(0) ? cache.decoders.decode('locations', archive.get(0)).locations : [],
        provenance: { major: 5, minor: id, version: cache.table(5).entries.get(id)?.version,
          sha256: sha256(cache.file(5, id)), subfiles: [...archive.keys()] } });
    }
    const raw = archives.get(id), sx = row.source.x % 64, sy = row.source.y % 64,
      dx = row.destination.x % 64, dy = row.destination.y % 64, p = row.source.plane;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      tiles[(dx + i) * 64 + dy + j] = raw.tiles[p * 4096 + (sx + i) * 64 + sy + j];
      nxt[(dx + i + 1) * 66 + dy + j + 1] = raw.nxt?.[`level${p}`]?.[(sx + i + 1) * 66 + sy + j + 1];
    }
    for (const loc of raw.locations) {
      const uses = loc.uses.filter(u => u.plane === p && u.x >= sx && u.x < sx + 8 && u.y >= sy && u.y < sy + 8)
        .map(u => ({ ...u, x: u.x + dx - sx, y: u.y + dy - sy, plane: 0 }));
      if (uses.length) locations.push({ ...loc, uses });
    }
  }
  return { x, z: y, tiles: { tiles }, nxttiles: { level0: nxt }, locations: { locations },
    provenance: { mapId: layout.mapId, plane: layout.plane, archives: [...archives.values()].map(r => r.provenance),
      blocks: rows.map(r => ({ source: r.source, destination: r.destination, translation: r.translation, paste: r.paste })) } };
}

export function interiorBounds(blocks) {
  const rows = [...blocks.values()];
  if (!rows.length) return null;
  return { minX: Math.min(...rows.map(r => r.destination.x)), minY: Math.min(...rows.map(r => r.destination.y)),
    maxX: Math.max(...rows.map(r => r.destination.x)) + 8, maxY: Math.max(...rows.map(r => r.destination.y)) + 8 };
}
