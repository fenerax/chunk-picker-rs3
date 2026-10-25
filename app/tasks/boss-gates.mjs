import { bossGates, DEFAULT_TIER_STYLES } from '../data/boss-gates.mjs';
import { observedSkills } from '../core/game-progress.mjs';

// A closed gate removes its monsters from a player's reachable monsters, so
// drop, kill, challenge and gear tasks that need the boss all wait together.
const skills = new Set(observedSkills);
const LOCKS = Object.freeze({ group: 'group content', 'hard-mode': 'hard mode' });
const level = value => Number.isSafeInteger(value) && value >= 1 && value <= 120;

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

const orList = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
const requirementText = requirement => `${requirement.level} ${orList(requirement.skills)}`;

/** One gate's state for a player. `levels` holds synced levels by skill; a
 * missing skill counts as not met. `unlocks` holds the player's manual opens. */
export function evaluateBossGate(gate, levels = {}, unlocks = {}) {
  const checks = gateRequirements(gate).map(requirement => {
    const known = requirement.skills.filter(skill => Number.isFinite(levels[skill]));
    const have = known.length ? Math.max(...known.map(skill => levels[skill])) : null;
    return { ...requirement, text: requirementText(requirement), have, met: have !== null && have >= requirement.level };
  });
  const manual = unlocks?.[gate.id] === true;
  const byLevels = gate.locked === undefined && checks.every(check => check.met);
  const open = manual || byLevels;
  const wants = [...(gate.locked ? [`${LOCKS[gate.locked]}, unlocked by hand`] : []), ...checks.map(check => check.text)];
  const missing = checks.filter(check => !check.met).map(check => check.have === null ? `${orList(check.skills)} not synced` : `${check.text} (have ${check.have})`);
  return {
    id: gate.id, boss: gate.boss, monsters: [...gate.monsters], open, openedBy: manual ? 'manual' : byLevels ? 'levels' : null,
    locked: gate.locked ?? null, checks, notes: [...(gate.notes ?? [])],
    reason: open ? (manual ? 'Unlocked by hand.' : `Met: ${checks.map(check => check.text).join(', ')}.`)
      : `Locked until ${wants.join(' and ')}${!gate.locked && missing.length ? ` (${missing.join('; ')})` : ''}.`,
  };
}

export function evaluateBossGates(levels = {}, unlocks = {}, gates = bossGates) {
  return gates.map(gate => evaluateBossGate(gate, levels, unlocks));
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
