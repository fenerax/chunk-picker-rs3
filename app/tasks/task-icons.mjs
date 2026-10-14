const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';

/** Ordered item names explicitly carried by a row, its Wiki markers, or an Obtain goal.
 * These are lookup candidates, not new item identities. Only the icon catalogue
 * can establish a match; unknown names do not get fuzzy or tier-stripped matches.
 */
export function taskItemNames(task = {}) {
  const names = [], seen = new Set();
  const add = value => {
    const name = clean(value), key = name.toLowerCase();
    if (name && !seen.has(key)) { seen.add(key); names.push(name); }
  };
  add(task.equipmentName); add(task.item);
  for (const label of [task.rawLabel, task.label]) {
    if (typeof label !== 'string') continue;
    for (const match of label.matchAll(/~\|([^|]+)\|~/gu)) {
      // Upstream '#' denotes a Wiki target/anchor suffix. Do not let it
      // change the exact visible item identity before the separator.
      add(match[1].split('#')[0]);
    }
    const plain = label.replace(/~\|([^|]+)\|~/gu, (_, name) => name.split('#')[0]).replace(/\*+$/u, '').trim();
    const obtain = /^Obtain\s+(?:(?:an?|the)\s+)?(.+)$/iu.exec(plain);
    if (obtain) add(obtain[1]);
  }
  return names;
}

/** Return the first catalogue-resolved item icon, or null for the skill fallback. */
export function taskItemIcon(task, itemIcon) {
  for (const name of taskItemNames(task)) {
    const url = itemIcon(name);
    if (url) return url;
  }
  return null;
}

// Existing local category artwork. A category picture describes the task type,
// never a guessed inventory item. Keep inventory identities exact above.
const categoryArtwork = Object.freeze({
  Quest: 'quest', Achievement: 'achievements', Achievements: 'achievements',
  Diary: 'achievements', Activity: 'minigame', Minigame: 'minigame',
  Clue: 'clue', Music: 'music', Combat: 'attack', Nonskill: 'minigame', Extra: 'minigame',
});
const skillCategories = new Set(['Agility', 'Archaeology', 'Attack', 'Constitution', 'Construction', 'Cooking', 'Crafting', 'Defence', 'Divination', 'Dungeoneering', 'Farming', 'Firemaking', 'Fishing', 'Fletching', 'Herblore', 'Hunter', 'Invention', 'Magic', 'Mining', 'Necromancy', 'Prayer', 'Ranged', 'Runecrafting', 'Slayer', 'Smithing', 'Strength', 'Summoning', 'Thieving', 'Woodcutting']);

export function taskCategoryIcon(category, skillIcon = () => null) {
  const artwork = skillCategories.has(category) ? category.toLowerCase()
    : Object.hasOwn(categoryArtwork, category) ? categoryArtwork[category] : null;
  return skillIcon(category) || (artwork ? `/assets/SVG/rs3/${artwork}-rs3.svg` : null);
}

/** One resolution order for task lists, search and Activity Info. */
export function taskIcon(task = {}, { itemIcon = () => null, skillIcon = () => null } = {}) {
  const inventory = taskItemIcon(task, itemIcon), skill = skillIcon(task.category)
    || (skillCategories.has(task.category) ? taskCategoryIcon(task.category) : null);
  if (inventory || skill) return inventory || skill;
  // An explicit inventory goal still needs its own item artwork. Do not hide an
  // unresolved inventory identity behind an unrelated activity picture.
  if (clean(task.equipmentName) || clean(task.item) || task.category === 'BiS') return null;
  return taskCategoryIcon(task.category);
}
