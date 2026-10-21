const whole = value => Math.round(value).toLocaleString('en-CA');
const known = value => Number.isFinite(value) && value >= 0;
const range = (start, end, value) => known(start) && known(end) && Math.round(start) !== Math.round(end)
  ? `${whole(start)}–${whole(end)}` : whole(value);

export function fishingRateText(method) {
  const xp = known(method.xpPerHour) ? `${range(method.xpPerHourStart, method.xpPerHourEnd, method.xpPerHour)} XP/hour estimated` : 'XP/hour unknown';
  const catches = known(method.fishPerHour) ? `${range(method.fishPerHourStart, method.fishPerHourEnd, method.fishPerHour)} fish/hour estimated` : 'fish/hour unknown';
  const species = method.species ?? method.fishing?.species ?? [];
  const mixedSpot = ['small-net', 'sea-bait', 'fly-fishing', 'harpoon'].includes(method.fishing?.methodId);
  const mixed = species.length && (species.length > 1 || mixedSpot) ? ` (${species.map(fish => `${range(fish.fishPerHourStart, fish.fishPerHourEnd, fish.fishPerHour)} ${fish.label.toLowerCase()}/hour`).join(', ')})` : '';
  return `${xp} · ${catches}${mixed}`;
}

export const fishingSpotAssumption = 'At the spot, no banking, not counting spot moves.';
export const fishingExclusions = 'Dropping, storing the catch, travel, urns, outfits, boosts and other bonuses add time or change rates and are excluded.';
export const fishingSupplyLabel = (item, quantity) => item === 'Feather' ? quantity === 1 ? 'feather' : 'feathers' : item === 'Fishing bait' ? 'fishing bait' : item;

export function fishingChanceNotes(rate, end) {
  const percent = value => `${(value * 100).toLocaleString('en-CA', { maximumFractionDigits: 2 })}%`;
  const chanceRange = (start, finish) => end && percent(start) !== percent(finish) ? `${percent(start)}–${percent(finish)}` : percent(start);
  const rows = [`One catch attempt every ${rate.attemptTicks} ticks (${rate.attemptTicks * 0.6} seconds).`];
  for (const fish of rate.species) {
    const last = end?.species.find(row => row.id === fish.id) ?? fish;
    rows.push(`${fish.label} roll chance: ${chanceRange(fish.rawChance, last.rawChance)}; catch chance per attempt: ${chanceRange(fish.catchChance, last.catchChance)}.`);
  }
  if (rate.species.length > 1) rows.push('Fish are rolled in this order. Each later roll only runs after the earlier rolls fail.');
  if (rate.sourceVersion) rows.push(`Rate source version: ${rate.sourceVersion}`);
  return rows;
}
