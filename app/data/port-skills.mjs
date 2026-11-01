// R4 is an all-skills goal. Port entry still needs only one skill at 90.
// Roster: https://runescape.wiki/w/Player-owned_port?oldid=37218482
export const portSkills = Object.freeze(['Agility', 'Construction', 'Cooking', 'Divination',
  'Dungeoneering', 'Fishing', 'Herblore', 'Hunter', 'Prayer', 'Runecrafting', 'Slayer', 'Thieving']);

/** Gate the grouped goal without changing any adventurer's own requirements. */
export function canTrainAllPortSkills(levels, caps) {
  return portSkills.every(skill => levels[skill] >= 90 && caps[skill] >= 90);
}
