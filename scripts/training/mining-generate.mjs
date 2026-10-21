import { writeFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { MINING_ROCKS, MINING_PICKAXES, MINING_PROFILES, MINING_STAMINA_MILESTONES, MINING_CRITICAL_LEVELS, MINING_SOURCES, MINING_BOUNDS } from '../../app/training/mining-rules.mjs';

export const CRITICAL_LEVELS = MINING_CRITICAL_LEVELS;
export function miningExpectations(rock, pick, level, band) {
  const criticalBonus = 5 * CRITICAL_LEVELS.filter(n => level >= n).length;
  const criticalChance = .1 + (level >= 59 ? .05 : 0) + (level >= 85 ? .05 : 0)
    + .05 * rock.critLevels.filter(n => level >= n).length;
  const hardnessPenalty = Math.min(0, pick.penetration - rock.hardness);
  const width = pick.maxDamage - pick.minDamage + 1;
  let damage = 0;
  const progress = [0, 0, 0];
  // Inclusive uniform integer pickaxe rolls, independent critical Bernoulli roll.
  for (let roll = pick.minDamage; roll <= pick.maxDamage; roll++) {
    for (const [bonus, probability] of [[0, 1 - criticalChance], [criticalBonus, criticalChance]]) {
      const hit = Math.max(1, level + band + roll + bonus + hardnessPenalty);
      const weight = probability / width;
      damage += hit * weight;
      MINING_PROFILES.forEach((profile, index) => {
        const stamina = level < 15 ? 1 : profile.staminaMultiplier;
        progress[index] += Math.min(rock.durability, hit * stamina) * weight;
      });
    }
  }
  return [damage, ...progress].map(n => Math.round(n * 1e4) / 1e4);
}

export function generateMiningCatalogue() {
  const rates = {};
  for (const rock of MINING_ROCKS) {
    rates[rock.id] = {};
    for (const pick of MINING_PICKAXES) {
      const values = [];
      for (let level = Math.max(rock.level, pick.level); level <= MINING_BOUNDS.miningMax; level++) {
        for (let band = 0; band < MINING_BOUNDS.strengthBands; band++) values.push(...miningExpectations(rock, pick, level, band));
      }
      rates[rock.id][pick.id] = values;
    }
  }
  return {
    schemaVersion: 1, version: 'mining-2026-10-12-v1', tickSeconds: .6, swingTicks: 4,
    generatedBy: 'node scripts/training/mining-generate.mjs',
    supportedLevels: MINING_BOUNDS,
    stamina: {unlockLevel:15, milestones:MINING_STAMINA_MILESTONES, agilityAssumption:1, drainPerSwing:10, capacityRule:'Mining milestone capacity + Agility level; fixed attention profiles do not simulate a click schedule.'},
    licence: 'Numerical facts and adapted RuneScape Wiki calculator excerpts: CC BY-NC-SA 3.0; source exceptions apply.',
    sources: MINING_SOURCES,
    assumptions: [
      'Uninterrupted wiki mechanics estimate; no banking, dropping, movement, rockertunities, ore boxes, outfits, spirits, perks or boosts.',
      'Uniform inclusive integer pickaxe damage roll; critical roll independent; damage minimum one before stamina.',
      'XP follows uncapped expected damage. Ore follows expected per-swing capped progress, carried between ores, plus natural double ore.',
      'Mining article global critical bonuses at 59/85 and critical damage milestone at 105 apply; the pinned calculator omits them.',
      'The pinned calculator caps average damage and applies hardness again to critical bonus; this model uses the article equation on every roll.',
      'XP uses unrounded damage expectation; the pinned calculator floors mean XP to tenths before stamina. Displayed estimates are not measurements.',
      'Mining levels 1–110 and Strength 1–120 preserve existing F2P planning bounds; requested levels 1–99 are included. Strength grouped by floor(level/10); probabilities and progress stored to four decimal places.',
    ],
    packing: { order: 'rock/pick, levels from max unlock to110, Strength bands0..12, four values', fields: ['uncappedDamage','activeProgress','occasionalProgress','afkProgress'], precision: .0001 },
    rates,
  };
}

const output = new URL('../../app/data/training/mining-rates.v1.json', import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = `${JSON.stringify(generateMiningCatalogue())}\n`;
  const bytes = gzipSync(json).length;
  if (bytes > 300_000) throw new Error(`Mining catalogue exceeds 300KB gzip: ${bytes}`);
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== json) throw new Error('Mining catalogue needs regeneration.');
  } else await writeFile(output, json);
  console.log(`Mining catalogue: ${Buffer.byteLength(json)} bytes; ${bytes} bytes gzip.`);
}
