// Independent no-bonus port of SkillUtils36640342 and calculator37183488.
// Reference numerical parameters are parsed from genuine pinned Lua fixtures;
// this module does not import the production rules, generator or lookup.
// Adapted from RuneScape Wiki contributors, CC BY-NC-SA 3.0.
import { readFileSync } from 'node:fs';
const fixture = name => JSON.parse(readFileSync(new URL(`../../tests/fixtures/woodcutting/${name}.json`, import.meta.url), 'utf8')).source;
const treeSource = fixture('tree-data.36706827');
const hatchetSource = fixture('hatchet-data.37170712');
const treeNames = {normal: 'Tree', oak: 'Oak', willow: 'Willow', teak: 'Teak', maple: 'Maple Tree', acadia: 'Acadia tree', yew: 'Yew'};
const blocks = [...treeSource.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
const numeric = (block, field) => Number(block.match(new RegExp(`\\b${field}\\s*=\\s*([\\d.]+)`))?.[1]);
const treeData = Object.fromEntries(Object.entries(treeNames).map(([id, name]) => {
  const block = blocks.find(value => value.includes(`name='${name}'`));
  return [id, Object.fromEntries(['level', 'chance', 'ratio', 'xp', 'fell'].map(field => [field, numeric(block, field)]))];
}));
const hatchetData = Object.fromEntries([...hatchetSource.matchAll(/short = '([^']+)'[^\n]+level = (\d+), power = (\d+)/g)]
  .map(([, id, level, power]) => [id, {level: Number(level), power: Number(power)}]));

export function wikiWoodcuttingReference({treeId, woodcuttingLevel, hatchetId}) {
  const tree = treeData[treeId], hatchet = hatchetData[hatchetId];
  if (!tree || !hatchet || woodcuttingLevel < tree.level || woodcuttingLevel < hatchet.level) return null;
  // Preserve the published function boundaries instead of production's packed roll.
  const simpleScale = (value, from, to) => Math.floor(value * to / from);
  const base = tree.chance * 10000;
  const lo = base + simpleScale(Math.floor(base / 2), 100, hatchet.power - 100);
  const hi = simpleScale(lo, 10000, tree.ratio);
  const interpolate = (low, high, level) => Math.floor(low * (99 - level) / 98) + Math.floor(high * (level - 1) / 98);
  const chance = Math.min((interpolate(lo, hi, woodcuttingLevel) + 1) / (256 * 10000), 1);
  const logsPerHour = 6000 / 4 * chance;
  return {chopChance: chance, logsPerHour, xpPerHour: logsPerHour * tree.xp, low: lo, high: hi, fellingChance: tree.fell / 256};
}

// Generic article37009675 applied with Woodcutting's explicitly pre-scaled
// endpoints: low + floor((high-low)*(level-1)/98), divided by2550001.
// Scaling again would incorrectly count the Woodcutting scale twice.
export function genericWoodcuttingAlternative(args) {
  const reference = wikiWoodcuttingReference(args);
  if (!reference) return null;
  const {low, high} = reference;
  const chopChance = Math.min(1, Math.max(0, (low + Math.floor((high - low) * (args.woodcuttingLevel - 1) / 98)) / 2550001));
  return {chopChance, logsPerHour: chopChance * 1500, xpPerHour: chopChance * 1500 * treeData[args.treeId].xp};
}
