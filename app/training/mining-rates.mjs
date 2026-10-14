// Browser-safe constant-time lookup; formulas run in the offline generator.
import { MINING_ROCKS, MINING_PICKAXES, MINING_PROFILES, MINING_STAMINA_MILESTONES, MINING_BOUNDS } from './mining-rules.mjs';
export { MINING_ROCKS, MINING_PICKAXES, MINING_PROFILES, MINING_STAMINA_MILESTONES, MINING_BOUNDS } from './mining-rules.mjs';

const rockById = new Map(MINING_ROCKS.map(row => [row.id, row]));
const pickById = new Map(MINING_PICKAXES.map(row => [row.id, row]));
const profileById = new Map(MINING_PROFILES.map(row => [row.id, row]));
const validLevel = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;

/** The caller checks rock access. Tools are estimate assumptions; auto follows Mining level. */
export function lookupMiningRate({ rockId, miningLevel, strengthLevel = 1, pickaxeId = 'auto', profileId = 'active', doubleOre = true } = {}, catalogue) {
  if (!validLevel(miningLevel, MINING_BOUNDS.miningMax) || !validLevel(strengthLevel, MINING_BOUNDS.strengthMax)
    || typeof doubleOre !== 'boolean' || catalogue?.schemaVersion !== 1 || catalogue.supportedLevels?.strengthBands !== MINING_BOUNDS.strengthBands) return null;
  const rock = rockById.get(rockId), profile = profileById.get(profileId);
  const pick = pickaxeId === 'auto' ? MINING_PICKAXES.findLast(p => p.level <= miningLevel) : pickById.get(pickaxeId);
  if (!rock || !profile || !pick || miningLevel < rock.level || miningLevel < pick.level) return null;
  const strengthBand = Math.floor(strengthLevel / 10);
  const start = Math.max(rock.level, pick.level);
  const profileIndex = MINING_PROFILES.findIndex(p => p.id === profileId);
  // Four packed values per level and Strength band: uncapped damage, then
  // capped expected ore progress for active / partial / drained stamina.
  const index = ((miningLevel - start) * MINING_BOUNDS.strengthBands + strengthBand) * 4;
  const row = catalogue.rates?.[rockId]?.[pick.id];
  const meanDamage = row?.[index], oreProgress = row?.[index + 1 + profileIndex];
  if (!Number.isFinite(meanDamage) || !Number.isFinite(oreProgress)) return null;
  const staminaMultiplier = miningLevel < 15 ? 1 : profile.staminaMultiplier;
  const damagePerSwing = meanDamage * staminaMultiplier;
  const xpPerHour = meanDamage * rock.xpMultiplier * .4 * 1500 * staminaMultiplier;
  const doubleOreChance = doubleOre ? rock.doubleOreLevels.filter(level => miningLevel >= level).length * .05 : 0;
  const orePerHour = oreProgress / rock.durability * 1500 * (1 + doubleOreChance);
  // Fixed attention proxies do not require an Agility input; capacity is
  // explanatory metadata, with Agility1 stated explicitly.
  const staminaCapacity = miningLevel < 15 ? null : MINING_STAMINA_MILESTONES.findLast(m => m.level <= miningLevel).capacity + 1;
  return {
    xpPerHour, orePerHour, xpPerOre: xpPerHour / orePerHour, damagePerSwing,
    swingsPerOre: rock.durability / oreProgress, swingsPerGatheredOre: 1500 / orePerHour,
    pickaxeId: pick.id, pickaxeLabel: pick.label, rockId, miningLevel, strengthBand, profileId,
    staminaMultiplier, doubleOreChance, sourceVersion: catalogue.version,
    staminaCapacity, staminaAgilityAssumption: 1, staminaDrainPerSwing: 10,
    swingsBeforeDrained: staminaCapacity === null ? null : Math.ceil(staminaCapacity / 10),
    assumptions: [...(catalogue.assumptions ?? []), profile.description,
      ...(miningLevel < 15 ? ['Stamina is not unlocked below Mining 15; attention profiles coincide.'] : [])],
  };
}
