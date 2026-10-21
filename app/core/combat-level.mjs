// Current formula: Wiki Combat level revision 37182070. The calculator's
// revision 37009630 supplies its explicit F2P rules (Summoning constant 2,
// Necromancy at most 20), which differ from the prose's Summoning claim.
const caps = Object.freeze({ Attack: 120, Strength: 120, Ranged: 120, Magic: 120, Necromancy: 120,
  Defence: 99, Constitution: 99, Prayer: 99, Summoning: 99 });

/** Derive Combat from known base skills without assuming training access.
 * Missing or invalid observations contribute level 1, including Constitution;
 * this deliberately gives a conservative lower bound for incomplete facts.
 * Real skill caps exclude virtual levels and temporary boosts.
 */
export function combatLevelFromSkills(levels = {}, { f2p = false } = {}) {
  const level = skill => {
    const value = levels?.[skill];
    return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, caps[skill]) : 1;
  };
  const offence = Math.max(level('Attack') + level('Strength'),
    2 * level('Magic'), 2 * level('Ranged'), 2 * (f2p ? Math.min(level('Necromancy'), 20) : level('Necromancy')));
  const secondary = level('Defence') + level('Constitution') + Math.floor(level('Prayer') / 2)
    + (f2p ? 1 : Math.floor(level('Summoning') / 2));
  // Multiply the whole formula by 10 first to avoid floating point boundary
  // errors from 1.3; all terms are integers within the current real skill caps.
  return Math.floor((13 * offence + 10 * secondary) / 40);
}
