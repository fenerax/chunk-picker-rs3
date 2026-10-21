/** Standard RS3 XP curve. Invention uses a different curve and is excluded. */
export function xpForLevel(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 120) throw new RangeError('Standard skill level must be between 1 and 120.');
  let points = 0;
  for (let current = 1; current < level; current++) points += Math.floor(current + 300 * 2 ** (current / 7));
  return Math.floor(points / 4);
}

export function levelForXp(xp) {
  let level = 1;
  while (level < 120 && xp >= xpForLevel(level + 1)) level++;
  return level;
}
