import { datasetJSON } from "../dataset-runtime.mjs";
import { FISHING_METHODS, lookupFishingRate } from '../training/fishing-rates.mjs';
const catalogue = await datasetJSON("app/data/training/fishing-rates.v1.json");

export function fishingMetrics(method, level) {
  if (!method.fishingCurve) return {};
  const fishing = lookupFishingRate({ methodId: method.fishingCurve.methodId, fishingLevel: level }, catalogue);
  return { fishing, fishPerHour: fishing?.fishPerHour ?? null, species: fishing?.species ?? [],
    modelAssumptions: fishing?.assumptions ?? [] };
}

// Expected catches follow the level curve, including the conditional mixed rolls.
// They describe catch throughput; the catalogue decides which catches are kept.
export function fishingSegment(rate, hours) {
  return { fishing: rate, fishPerHour: rate.fishPerHour, fishProduced: rate.fishPerHour * hours,
    species: rate.species.map(fish => ({ ...fish, fishProduced: fish.fishPerHour * hours,
      fishPerHourStart: fish.fishPerHour, fishPerHourEnd: fish.fishPerHour })),
    modelAssumptions: rate.assumptions, xpPerHourStart: rate.xpPerHour, xpPerHourEnd: rate.xpPerHour,
    fishPerHourStart: rate.fishPerHour, fishPerHourEnd: rate.fishPerHour };
}

export function fishingOutputQuantity(rate, output, hours) {
  const fish = rate.species.find(species => species.item === output.item);
  if (fish) return fish.fishPerHour * hours;
  const locked = FISHING_METHODS.find(method => method.id === rate.methodId)?.species
    .some(species => species.item === output.item && species.level > rate.fishingLevel);
  return locked ? 0 : null;
}

export function canMergeFishing(previous, segment) {
  return previous?.methodId === segment.methodId && previous.fishing
    && previous.species.map(fish => fish.id).join(',') === segment.species.map(fish => fish.id).join(',');
}

export function mergeFishingSegment(previous, segment) {
  previous.toLevel = segment.toLevel; previous.toXp = segment.toXp;
  previous.xpNeeded += segment.xpNeeded; previous.xpEarned += segment.xpEarned; previous.hours += segment.hours;
  previous.fishProduced += segment.fishProduced;
  previous.xpPerHour = previous.xpEarned / previous.hours; previous.fishPerHour = previous.fishProduced / previous.hours;
  previous.xpPerHourEnd = segment.xpPerHour; previous.fishPerHourEnd = segment.fishPerHour;
  previous.fishingEnd = segment.fishing;
  for (const fish of previous.species) {
    const added = segment.species.find(row => row.id === fish.id);
    fish.fishProduced += added.fishProduced;
    fish.fishPerHour = fish.fishProduced / previous.hours;
    fish.xpPerHour = fish.fishPerHour * fish.xpPerFish;
    fish.fishPerHourEnd = added.fishPerHour;
  }
  for (const key of ['netGp', 'costGp', 'profitGp']) previous[key] = previous[key] === null || segment[key] === null ? null : previous[key] + segment[key];
  previous.gpPerHour = previous.netGp === null ? null : previous.netGp / previous.hours;
  for (const key of ['inputs', 'outputs']) for (let index = 0; index < previous[key].length; index++) {
    const before = previous[key][index].totalQuantity, added = segment[key][index].totalQuantity;
    previous[key][index].totalQuantity = before === null || added === null ? null : before + added;
  }
}
