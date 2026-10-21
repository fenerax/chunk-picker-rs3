// Independent no-bonus port of Fishing chance calculator37011173.
// Parameters/order come directly from the genuine data37011174 fixture.
// This module does not import production rules, generator or lookup.
// Adapted from RuneScape Wiki contributors, CC BY-NC-SA 3.0.
import { readFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(new URL('../../tests/fixtures/fishing/data.37011174.json', import.meta.url), 'utf8')).source;
const blocks = [...source.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
const text = (block, field) => block.match(new RegExp(`\\b${field}\\s*=\\s*["']([^"']+)["']`))?.[1];
const number = (block, field) => Number(block.match(new RegExp(`\\b${field}\\s*=\\s*(-?[\\d.]+)`))?.[1]);
const selected = {
  minnow: 'minnow', crayfish: 'crayfish', 'small-net': 'Net/bait: net', 'sea-bait': 'Net/bait: bait',
  'fly-fishing': 'Lure/bait: lure', pike: 'Lure/bait: bait', lobster: 'lobster', harpoon: 'Cage/harpoon: harpoon',
};
const data = blocks.map(block => ({id: text(block, 'name'), spot: text(block, 'spot') ?? text(block, 'name'),
  level: number(block, 'level'), xp: number(block, 'xp'), low: number(block, 'low'), high: number(block, 'high'),
  delay: number(block, 'delay') || 4}));

function reference({methodId, fishingLevel}, generic) {
  const group = data.filter(fish => fish.spot === selected[methodId] && fish.level <= fishingLevel);
  if (!group.length || !Number.isInteger(fishingLevel) || fishingLevel < 1 || fishingLevel > 99) return null;
  let rollingChance = 0, fishPerHour = 0, xpPerHour = 0;
  const species = [];
  for (const fish of group) {
    const raw = generic
      ? 10000 * (fish.low + Math.floor((fish.high - fish.low) * (fishingLevel - 1) / 98)) / 2550001
      : Math.floor(((99 - fishingLevel) * fish.low + (fishingLevel - 1) * fish.high) / 98) / 256;
    const rawChance = Math.max(Math.min(raw, 1), 0);
    const actualChance = (1 - rollingChance) * rawChance;
    const fph = 3600 / (fish.delay * .6) * actualChance;
    species.push({id: fish.id, rawChance, catchChance: actualChance, fishPerHour: fph, xpPerHour: fph * fish.xp});
    rollingChance += actualChance;
    fishPerHour += fph;
    xpPerHour += fph * fish.xp;
  }
  return {species, fishPerHour, xpPerHour, catchChance: rollingChance};
}
export const wikiFishingReference = args => reference(args, false);
export const genericFishingAlternative = args => reference(args, true);
