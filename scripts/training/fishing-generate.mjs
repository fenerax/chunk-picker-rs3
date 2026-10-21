import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { FISHING_METHODS, FISHING_BOUNDS, FISHING_SOURCES, FISHING_FORMULA, FISHING_UNMODELLED_METHODS } from '../../app/training/fishing-rules.mjs';

export function fishingSuccessRoll(species, level) {
  return Math.max(0, Math.min(256, Math.floor(((99 - level) * species.low + (level - 1) * species.high) / 98)));
}

export function generateFishingCatalogue() {
  const rates = {};
  for (const method of FISHING_METHODS) {
    rates[method.id] = Array.from({length: FISHING_BOUNDS.fishingMax - method.level + 1}, (_, index) => {
      const level = method.level + index;
      return method.species.map(species => level < species.level ? null : fishingSuccessRoll(species, level));
    });
  }
  return {
    schemaVersion: 1, version: 'fishing-2026-10-12-v1', tickSeconds: .6,
    generatedBy: 'node scripts/training/fishing-generate.mjs', supportedLevels: FISHING_BOUNDS,
    licence: 'Numerical facts and adapted RuneScape Wiki calculator excerpts: CC BY-NC-SA 3.0; source exceptions apply.',
    sources: FISHING_SOURCES, formula: FISHING_FORMULA, unmodelledMethods: FISHING_UNMODELLED_METHODS,
    assumptions: [
      'Eight ordinary F2P methods include minnow, crayfish, small-net shrimps/anchovies, sea-bait sardine/herring, fly-fishing trout/salmon, pike, lobster and harpoon tuna/swordfish. Location access and ownership are checked by the caller.',
      'At-spot uninterrupted rates: no banking, dropping, noting, movement, spot relocation, re-click delay or reaction delay. Spot relocation timing is unknown; no relocation timer is invented.',
      'Mixed catches use ordered conditional rolls; locked species are skipped completely. Total fish and XP sum eligible species only.',
      'Pinned Fishing calculator convention: floor the combined level interpolation once; divide by256, clamp to[0,1], without adding one. The generic success article uses a different scaled interpolation/2550001 denominator.',
      'Four ticks per attempt except harpoon tuna/swordfish, which use five ticks; one tick is0.6seconds.',
      'Fishing levels1–99 only, with no visible/invisible boosts, outfits, urns, perks, auras, familiars, extra catches, bonus XP or upgraded members tools.',
      'F2P tools select methods; no verified F2P metal-tool progression or tier setting is assumed. Sea-bait and pike use one Fishing bait per fish; fly-fishing uses one feather per fish; minnow uses no bait.',
      'Six F2P Daemonheim species, vile-fish puzzle and monthly Giant Oyster sea cucumber have explicit unknown-rate coverage records and are excluded from hourly projections. Rainbow fish and big-net bass are members-only.',
      'These are estimates from the published calculator and wiki mechanics, not measured current server rates.',
    ],
    packing: {order: 'method, levels from method unlock through99, species in published roll order',
      field: 'clampedRawSuccessRoll', denominator: 256, precision: 'exact integer; null for locked species'}, rates,
  };
}
const output = new URL('../../app/data/training/fishing-rates.v1.json', import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = `${JSON.stringify(generateFishingCatalogue())}\n`;
  const compressed = gzipSync(json).length;
  if (compressed > 15000) throw new Error(`Fishing catalogue exceeds15KB gzip: ${compressed}`);
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== json) throw new Error('Fishing catalogue needs regeneration.');
  } else await writeFile(output, json);
  console.log(`Fishing catalogue: ${Buffer.byteLength(json)} bytes; ${compressed} bytes gzip.`);
}
