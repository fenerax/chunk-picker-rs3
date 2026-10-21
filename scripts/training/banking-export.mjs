import fs from 'node:fs/promises';
import { gunzipSync, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Tile direction bits: W,N,E,S,NW,NE,SE,SW. All edges are reciprocal.
export const directions = [[-1, 0], [0, 1], [1, 0], [0, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]];

/** Exact cardinal clipping; diagonal steps additionally clear both side tiles,
 * all four cardinal edges of that square and the reciprocal diagonal wall.
 * This deliberately conservative diagonal rule never cuts a blocked corner. */
export function movementForRegions(regions) {
  const byId = new Map(regions.map(r => [String(r.id), r]));
  const tile = (x, y) => {
    const r = byId.get(String(Math.floor(x / 64) * 256 + Math.floor(y / 64)));
    return r && { r, i: (x & 63) * 64 + (y & 63) };
  };
  const continuous = (a, b) => !a.translation || !b.translation || a.translation.every((v, i) => v === b.translation[i]);
  const cardinal = (a, b, d) => a && b && a.r.labels[a.i] && b.r.labels[b.i] && continuous(a.r, b.r)
    && !(a.r.walls[a.i] & (1 << d)) && !(b.r.walls[b.i] & (1 << ((d + 2) % 4)));
  const movement = new Map();
  for (const r of regions) {
    const moves = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      if (!r.labels[i]) continue;
      const x = r.x * 64 + (i >> 6), y = r.z * 64 + (i & 63), a = { r, i };
      for (let d = 0; d < 4; d++) if (cardinal(a, tile(x + directions[d][0], y + directions[d][1]), d)) moves[i] |= 1 << d;
      for (let d = 4; d < 8; d++) {
        const [dx, dy] = directions[d], b = tile(x + dx, y + dy), h = tile(x + dx, y), v = tile(x, y + dy);
        const hd = dx < 0 ? 0 : 2, vd = dy > 0 ? 1 : 3;
        if (cardinal(a, h, hd) && cardinal(a, v, vd) && cardinal(h, b, vd) && cardinal(v, b, hd)
          && !(r.walls[i] & (1 << d)) && !(b.r.walls[b.i] & (1 << (4 + ((d - 4 + 2) % 4))))) moves[i] |= 1 << d;
      }
    }
    movement.set(String(r.id), moves);
  }
  return movement;
}

export async function exportBankingMasks(inputDirectory, outputFile) {
  const input = await fs.readFile(`${inputDirectory}/walkability.v1.json.gz`);
  const membershipBytes = await fs.readFile(`${inputDirectory}/membership.v1.json`);
  const collision = JSON.parse(gunzipSync(input)), membership = JSON.parse(membershipBytes);
  const freeMasks = new Map(membership.regions.map(r => [r.region, r.maskHex]));
  const regions = collision.regions.filter(r => r.status === 'decoded').map(r => {
    const bytes = Buffer.from(r.masks.components, 'base64');
    return { ...r, labels: Uint16Array.from({ length: 4096 }, (_, i) => bytes.readUInt16LE(i * 2)),
      walls: Buffer.from(r.masks.walls, 'base64'),
      translation: r.provenance ? [(r.provenance.sourceX - r.x) * 64, (r.provenance.sourceY - r.z) * 64,
        (r.provenance.sourcePlane ?? 0) - (r.provenance.destinationPlane ?? 0)] : null };
  });
  const moves = movementForRegions(regions);
  const packed = regions.map(r => {
    const bytes = Buffer.alloc(4096 * 3);
    for (let i = 0; i < 4096; i++) bytes.writeUInt16LE(r.labels[i], i * 2);
    bytes.set(moves.get(r.id), 8192);
    return [r.id, deflateRawSync(bytes, { level: 9 }).toString('base64'), freeMasks.get(r.id) ?? null];
  });
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const data = { schemaVersion: 1, provenance: { reviewed: '2026-10-13', source: 'cache-audit-2026-10-07-v4',
    collisionSha256: sha(input), membershipSha256: sha(membershipBytes), generator: 'scripts/training/banking-export.mjs' },
    encoding: 'per-region-deflate-raw-base64:4096-uint16-le-component-labels,4096-uint8-movement',
    order: 'x*64+y', directions, regions: packed,
    limits: ['Closed static conservative collision; openable doors and conditional morphs can hide gameplay routes.',
      'Diagonal paths prohibit corner cutting; no client movement was observed.',
      'Surface walking only; no stairs, transport, teleport, player-specific scripts or bank interaction durations.',
      'F2P cache membership mask is geographic at 8 by 8 tiles, not a server-exact gate.'] };
  await fs.mkdir(new URL('../../app/data/training/', import.meta.url), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(data) + '\n');
  console.log(`Exported ${packed.length} decoded regions (${JSON.stringify(data).length} bytes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/training/banking-export.mjs <read-only masks directory> [output file]');
  await exportBankingMasks(process.argv[2], process.argv[3] ?? new URL('../../app/data/training/banking-masks.v1.json', import.meta.url));
}
