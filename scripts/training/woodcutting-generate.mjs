import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { WOODCUTTING_TREES, WOODCUTTING_HATCHETS, WOODCUTTING_BOUNDS, WOODCUTTING_SOURCES, WOODCUTTING_FORMULA, WOODCUTTING_UNMODELLED_TREES } from '../../app/training/woodcutting-rules.mjs';

// SkillUtils scales before integer division. The hatchet's excess power has
// half weight: low = base * (power + 100) / 200, not base * power / 100.
export function woodcuttingSuccessRoll(tree, hatchet, level) {
  const scaledBase = tree.baseChance * 10000;
  const low = scaledBase + Math.floor(Math.floor(scaledBase / 2) * (hatchet.power - 100) / 100);
  const high = Math.floor(low * tree.ratio / 10000);
  const roll = Math.floor(low * (99 - level) / 98) + Math.floor(high * (level - 1) / 98) + 1;
  return Math.max(0, Math.min(2560000, roll));
}

export function generateWoodcuttingCatalogue() {
  const rates = {};
  for (const tree of WOODCUTTING_TREES) {
    rates[tree.id] = {};
    for (const hatchet of WOODCUTTING_HATCHETS) {
      rates[tree.id][hatchet.id] = Array.from(
        {length: WOODCUTTING_BOUNDS.woodcuttingMax - Math.max(tree.level, hatchet.level) + 1},
        (_, index) => woodcuttingSuccessRoll(tree, hatchet, Math.max(tree.level, hatchet.level) + index),
      );
    }
  }
  return {
    schemaVersion: 1, version: 'woodcutting-2026-10-12-v1', tickSeconds: .6, attemptTicks: 4,
    generatedBy: 'node scripts/training/woodcutting-generate.mjs', supportedLevels: WOODCUTTING_BOUNDS,
    licence: 'Numerical facts and adapted RuneScape Wiki calculator excerpts: CC BY-NC-SA 3.0; source exceptions apply.',
    sources: WOODCUTTING_SOURCES,
    formula: WOODCUTTING_FORMULA, unmodelledTrees: WOODCUTTING_UNMODELLED_TREES,
    assumptions: [
      'Rates cover all seven ordinary overworld F2P tree types. The six F2P Daemonheim tree types have explicit unknown-rate coverage records: their separate dungeon system lacks sourced success parameters. Achey, hollow and bloodwood trees are members-only.',
      'One tree: wait its full respawn after each felling; resume immediately. Expected seconds/log = 2.4/chopChance + fellingChance*respawnSeconds.',
      'No banking, dropping, wood boxes, movement, other woodcutters, nests, spirits, outfits, perks, auras, boosts or reaction delay.',
      'SkillUtils/calculator convention: scale endpoints by 10000, separately floor both interpolation terms, add one, divide by 2560000 and clamp to [0,1]. Levels above 99 continue interpolation through 110.',
      'Hatchet excess power has half weight: scaled low = base*10000 + floor(floor(base*10000/2)*(power-100)/100); high = floor(low*3.125).',
      'Current hatchet powers already include the April 2026 aura overhaul; no additional Lumberjack multiplier applies.',
      'Normal-tree depletion is provisional: retained TreeData gives 96/256; respawn uses the 47.1-second midpoint of the documented random 35.4–58.8-second range, assuming its mean is the midpoint.',
      'The normal-tree article dates multiple logs to 20 January 2025; TreeData revision 36706827 is from 26 April 2025. These are wiki estimates, not measured current server rates.',
      'Other trees use the documented 32/256 felling roll. Uninterrupted rates omit all depletion downtime and are supplied separately for comparison.',
      'The generic success article uses a different interpolation/2550001 denominator. This table deliberately follows the pinned Woodcutting calculator; tests quantify the alternative.',
      'Auto assumes the strongest F2P hatchet allowed by Woodcutting level; ownership and location access are checked by the caller.',
    ],
    packing: {order: 'tree/hatchet, levels from max(tree unlock, hatchet unlock) through110', field: 'clampedSuccessRoll', denominator: 2560000, precision: 'exact integer'},
    rates,
  };
}

const output = new URL('../../app/data/training/woodcutting-rates.v1.json', import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = `${JSON.stringify(generateWoodcuttingCatalogue())}\n`;
  const compressed = gzipSync(json).length;
  if (compressed > 30000) throw new Error(`Woodcutting catalogue exceeds 30KB gzip: ${compressed}`);
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== json) throw new Error('Woodcutting catalogue needs regeneration.');
  } else await writeFile(output, json);
  console.log(`Woodcutting catalogue: ${Buffer.byteLength(json)} bytes; ${compressed} bytes gzip.`);
}
