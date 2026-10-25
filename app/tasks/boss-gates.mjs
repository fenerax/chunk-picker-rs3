import { bossGates, DEFAULT_TIER_STYLES } from '../data/boss-gates.mjs';
import { observedSkills } from '../core/game-progress.mjs';

// A closed gate removes its monsters from a player's reachable monsters, so
// drop, kill, challenge and gear tasks that need the boss all wait together.
const skills = new Set(observedSkills);
const LOCKS = Object.freeze({ group: 'group content', 'hard-mode': 'hard mode' });
const level = value => Number.isSafeInteger(value) && value >= 1 && value <= 120;

// Tier gear is a weapon plus body and legs, all in one combat style. Hybrid
// and all-style armour counts for every style.
export const GEAR_PIECES = Object.freeze(['weapon', 'body', 'legs']);
const PIECE_SLOTS = Object.freeze({ 'main hand weapon': 'weapon', '2h weapon': 'weapon', torso: 'body', legs: 'legs' });
const STYLE_CLASSES = Object.freeze({ Attack: 'melee', Strength: 'melee', Ranged: 'ranged', Magic: 'magic', Necromancy: 'necromancy' });
const ANY_CLASS = new Set(['hybrid', 'all']);
const gearClasses = styles => [...new Set(styles.map(skill => STYLE_CLASSES[skill]).filter(Boolean))];

export function validateBossGates(gates = bossGates) {
  const ids = new Set(), monsters = new Map();
  const fail = (gate, message) => { throw new TypeError(`Boss gate ${gate?.id ?? '?'}: ${message}`); };
  for (const gate of gates) {
    if (typeof gate?.id !== 'string' || !/^[a-z0-9-]+$/.test(gate.id)) fail(gate, 'id must be lowercase letters, digits and dashes');
    if (ids.has(gate.id)) fail(gate, 'duplicate id');
    ids.add(gate.id);
    if (typeof gate.boss !== 'string' || !gate.boss.trim()) fail(gate, 'boss name is required');
    if (!Array.isArray(gate.monsters) || !gate.monsters.length || gate.monsters.some(name => typeof name !== 'string' || !name.trim())) fail(gate, 'monsters must be a nonempty list of names');
    for (const name of gate.monsters) {
      if (monsters.has(name)) fail(gate, `${name} is already gated by ${monsters.get(name)}`);
      monsters.set(name, gate.id);
    }
    if (gate.locked !== undefined && !Object.hasOwn(LOCKS, gate.locked)) fail(gate, `locked must be ${Object.keys(LOCKS).join(' or ')}`);
    if (gate.tier !== undefined && !level(gate.tier)) fail(gate, 'tier must be a level from 1 to 120');
    if (gate.styles !== undefined && (!Array.isArray(gate.styles) || !gate.styles.length || gate.styles.some(skill => !skills.has(skill)))) fail(gate, 'styles must name skills');
    if (gate.styles !== undefined && gate.tier === undefined) fail(gate, 'styles need a tier');
    if (gate.tier !== undefined && gate.gear !== false && !gearClasses(gate.styles ?? DEFAULT_TIER_STYLES).length) fail(gate, 'styles need a combat style for the gear check');
    if (gate.gear !== undefined && gate.gear !== false && (!gate.gear || typeof gate.gear !== 'object' || Array.isArray(gate.gear)
      || !Object.keys(gate.gear).length || Object.entries(gate.gear).some(([field, value]) => !['weapon', 'armour'].includes(field) || !level(value)))) fail(gate, 'gear must be false or set weapon and armour tiers');
    if (gate.gear !== undefined && gate.tier === undefined) fail(gate, 'gear needs a tier');
    if (gate.levels !== undefined && (!gate.levels || typeof gate.levels !== 'object' || Array.isArray(gate.levels)
      || Object.entries(gate.levels).some(([skill, value]) => !skills.has(skill) || !level(value)))) fail(gate, 'levels must map skill names to levels');
    if (gate.locked === undefined && gate.tier === undefined && gate.levels === undefined) fail(gate, 'needs a tier, levels or a lock');
    if (gate.notes !== undefined && (!Array.isArray(gate.notes) || gate.notes.some(note => typeof note !== 'string'))) fail(gate, 'notes must be text');
  }
  return gates;
}

/** The checks one gate makes, in display order. */
export function gateRequirements(gate) {
  const requirements = [];
  if (gate.tier !== undefined) {
    const styles = gate.styles ?? DEFAULT_TIER_STYLES;
    requirements.push({ skills: ['Defence'], level: gate.tier });
    requirements.push({ skills: [...styles], level: gate.tier });
  }
  for (const [skill, value] of Object.entries(gate.levels ?? {})) requirements.push({ skills: [skill], level: value });
  return requirements;
}

/** The gear one gate asks for, or null when it asks for none. */
export function gateGearRequirement(gate) {
  if (gate.tier === undefined || gate.gear === false) return null;
  const tiers = { weapon: gate.gear?.weapon ?? gate.tier, body: gate.gear?.armour ?? gate.tier, legs: gate.gear?.armour ?? gate.tier };
  return { tiers, classes: gearClasses(gate.styles ?? DEFAULT_TIER_STYLES) };
}

const gearCatalogues = new WeakMap();
/** Tiered weapons, bodies and legs from equipment definitions. */
export function bossGearCatalogue(equipment = {}) {
  let catalogue = gearCatalogues.get(equipment);
  if (catalogue) return catalogue;
  catalogue = [];
  for (const [name, data] of Object.entries(equipment)) {
    const piece = PIECE_SLOTS[data?.slot];
    const tier = Number(data?.tier) || (piece === 'weapon' ? Math.max(Number(data?.damage_tier) || 0, Number(data?.accuracy_tier) || 0) : 0);
    const kind = String(data?.class ?? '').toLowerCase();
    if (!piece || !(tier > 0) || !kind) continue;
    // A hybrid weapon is rare; armour of any style is common and counts everywhere.
    catalogue.push({ name, piece, tier, any: ANY_CLASS.has(kind), kind });
  }
  catalogue.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  gearCatalogues.set(equipment, catalogue);
  return catalogue;
}

/** Best gettable tier per style and piece. `obtainable(name)` says whether the
 * group can get the item; the engine passes its pooled item set. */
export function bestBossGear(catalogue, obtainable) {
  const best = {};
  for (const kind of new Set(Object.values(STYLE_CLASSES))) best[kind] = { weapon: null, body: null, legs: null };
  for (const item of catalogue) {
    const kinds = item.any ? Object.keys(best) : best[item.kind] ? [item.kind] : [];
    if (!kinds.some(kind => !best[kind][item.piece]) || !obtainable(item.name)) continue;
    for (const kind of kinds) best[kind][item.piece] ??= { name: item.name, tier: item.tier };
  }
  return best;
}

const orList = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
const andList = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const requirementText = requirement => `${requirement.level} ${orList(requirement.skills)}`;
const sameTier = tiers => tiers.weapon === tiers.body && tiers.body === tiers.legs;
const tierText = tiers => sameTier(tiers) ? `tier-${tiers.weapon} weapon, body and legs` : `tier-${tiers.weapon} weapon with tier-${tiers.body} body and legs`;
const pieceText = (tiers, pieces, style) => sameTier(tiers) ? `tier-${tiers.weapon} ${style}${andList(pieces)}` : andList(pieces.map(piece => `tier-${tiers[piece]} ${style}${piece}`));
const article = pieces => pieces.length === 1 && pieces[0] === 'legs' ? '' : 'a ';

/** Whether the group can get tier gear for a gate. `gear` comes from
 * bestBossGear; null means nothing is known and the check fails. */
function evaluateGateGear(requirement, gear) {
  const styles = requirement.classes.map(kind => {
    const pieces = Object.fromEntries(GEAR_PIECES.map(piece => {
      const item = gear?.[kind]?.[piece];
      return [piece, item && item.tier >= requirement.tiers[piece] ? item : null];
    }));
    const missing = GEAR_PIECES.filter(piece => !pieces[piece]);
    return { style: kind, pieces, missing };
  });
  // Name the style closest to done, in the gate's own style order on ties.
  const closest = styles.reduce((best, entry) => entry.missing.length < best.missing.length ? entry : best);
  const met = closest.missing.length === 0;
  const missing = met ? null : closest.missing.length === GEAR_PIECES.length && requirement.classes.length > 1
    ? `needs a ${tierText(requirement.tiers)} in one style`
    : `needs ${article(closest.missing)}${pieceText(requirement.tiers, closest.missing, `${closest.style} `)}`;
  return { tiers: { ...requirement.tiers }, styles: [...requirement.classes], met,
    style: met ? closest.style : null, items: met ? GEAR_PIECES.map(piece => closest.pieces[piece].name) : [], missing };
}

/** One gate's state for a player. `levels` holds synced levels by skill; a
 * missing skill counts as not met. `unlocks` holds the player's manual opens.
 * `gear` is the group's best gettable gear from bestBossGear. */
export function evaluateBossGate(gate, levels = {}, unlocks = {}, gear = null) {
  const checks = gateRequirements(gate).map(requirement => {
    const known = requirement.skills.filter(skill => Number.isFinite(levels[skill]));
    const have = known.length ? Math.max(...known.map(skill => levels[skill])) : null;
    return { ...requirement, text: requirementText(requirement), have, met: have !== null && have >= requirement.level };
  });
  const gearRequirement = gateGearRequirement(gate);
  const gearCheck = gearRequirement ? evaluateGateGear(gearRequirement, gear) : null;
  const manual = unlocks?.[gate.id] === true;
  const byLevels = gate.locked === undefined && checks.every(check => check.met) && (!gearCheck || gearCheck.met);
  const open = manual || byLevels;
  const gearWant = gearRequirement ? `the group can get a ${tierText(gearRequirement.tiers)} in ${gearRequirement.classes.length === 1 ? `${gearRequirement.classes[0]} style` : 'one style'}` : null;
  const wants = [...(gate.locked ? [`${LOCKS[gate.locked]}, unlocked by hand`] : []), ...checks.map(check => check.text), ...(gearWant ? [gearWant] : [])];
  const missing = gate.locked ? [] : [...checks.filter(check => !check.met).map(check => check.have === null ? `${orList(check.skills)} not synced` : `${orList(check.skills)} ${check.have}/${check.level}`),
    ...(gearCheck && !gearCheck.met ? [gearCheck.missing] : [])];
  const metGear = gearCheck?.met ? ` and the group can get tier gear (${gearCheck.style}: ${gearCheck.items.join(', ')})` : '';
  return {
    id: gate.id, boss: gate.boss, monsters: [...gate.monsters], open, openedBy: manual ? 'manual' : byLevels ? 'levels' : null,
    locked: gate.locked ?? null, checks, gear: gearCheck, condition: wants.join(' and '), missing, notes: [...(gate.notes ?? [])],
    reason: open ? (manual ? 'Unlocked by hand.' : `Met: ${checks.map(check => check.text).join(', ')}${metGear}.`)
      : `Locked until ${wants.join(' and ')}${missing.length ? ` (${missing.join('; ')})` : ''}.`,
  };
}

export function evaluateBossGates(levels = {}, unlocks = {}, gates = bossGates, gear = null) {
  return gates.map(gate => evaluateBossGate(gate, levels, unlocks, gear));
}

/** Closed gates by monster name. */
export function closedBossMonsters(statuses) {
  const closed = new Map();
  for (const status of statuses) if (!status.open) for (const monster of status.monsters) closed.set(monster, status);
  return closed;
}

export function bossGateById(id, gates = bossGates) {
  return gates.find(gate => gate.id === id);
}

validateBossGates();
