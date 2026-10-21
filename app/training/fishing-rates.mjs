// Browser-safe lookup of the pinned offline raw-roll table.
import { FISHING_METHODS, FISHING_BOUNDS } from './fishing-rules.mjs';
export { FISHING_METHODS, FISHING_SPECIES, FISHING_BOUNDS, FISHING_SOURCES, FISHING_FORMULA, FISHING_UNMODELLED_METHODS } from './fishing-rules.mjs';
const methods = new Map(FISHING_METHODS.map(row => [row.id, row]));

/** At-spot estimate; the caller separately checks access and equipment. */
export function lookupFishingRate(input = {}, catalogue) {
  if (!input || typeof input !== 'object') return null;
  const {methodId, fishingLevel} = input;
  if (!Number.isInteger(fishingLevel) || fishingLevel < FISHING_BOUNDS.fishingMin
    || fishingLevel > FISHING_BOUNDS.fishingMax || catalogue?.schemaVersion !== 1
    || catalogue.supportedLevels?.fishingMax !== FISHING_BOUNDS.fishingMax
    || catalogue.packing?.denominator !== 256 || catalogue.tickSeconds !== .6) return null;
  const method = methods.get(methodId);
  if (!method || fishingLevel < method.level) return null;
  const rolls = catalogue.rates?.[methodId]?.[fishingLevel - method.level];
  if (!Array.isArray(rolls) || rolls.length !== method.species.length) return null;
  const species = [];
  const attemptsPerHour = 3600 / (.6 * method.attemptTicks);
  let remaining = 1, fishPerHour = 0, xpPerHour = 0;
  for (const [index, fish] of method.species.entries()) {
    const roll = rolls[index];
    if (fishingLevel < fish.level) {
      if (roll !== null) return null;
      continue;
    }
    if (!Number.isInteger(roll) || roll < 0 || roll > 256) return null;
    const rawChance = roll / 256;
    const catchChance = remaining * rawChance;
    const catches = attemptsPerHour * catchChance;
    const xp = catches * fish.xpPerFish;
    species.push({...fish, rawChance, catchChance, fishPerHour: catches, xpPerHour: xp});
    remaining -= catchChance;
    fishPerHour += catches;
    xpPerHour += xp;
  }
  return {
    methodId, methodLabel: method.label, fishingLevel, toolLabel: method.toolLabel, baitItem: method.baitItem,
    attemptTicks: method.attemptTicks, attemptSeconds: .6 * method.attemptTicks, attemptsPerHour,
    catchChance: 1 - remaining, nothingChance: remaining, fishPerHour, xpPerHour, species,
    sourceVersion: catalogue.version, assumptions: [...(catalogue.assumptions ?? [])],
  };
}
