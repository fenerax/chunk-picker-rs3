// Component and finishing-blow facts adapted from RuneScape Wiki contributors
// (CC BY-NC-SA 3.0); see WIKI-NOTICE.md. No dataset task records are copied here.
export const slayerUnlockSources = Object.freeze([
  'https://runescape.wiki/w/Slayer_helmet',
  'https://runescape.wiki/w/Slayer_Rewards',
  'https://runescape.wiki/w/Morvran%27s_Dungeon',
  'https://runescape.wiki/w/Sunken_Pyramid',
  'https://runescape.wiki/w/The_Jack_of_Spades/Quick_guide',
]);

export const FUTURE_SLAYER_UNLOCKS_RULE = 'Future Slayer unlocks';
export const futureSlayerUnlocksRule = Object.freeze({
  id: FUTURE_SLAYER_UNLOCKS_RULE,
  label: "Also require unlocks for a monster, area or item you don't have yet",
  description: 'Include Slayer Rewards before their target is available. Helmet parts and quick-kill monsters are still required.',
  type: 'boolean', default: false, category: 'Miscellaneous',
  parent: 'Permanent Unlockables', difficultyMarker: 'extreme-supreme',
});
export const futureSlayerUnlocksExplanation = {
  what: 'Includes the eight Slayer Rewards even before their monster, area or item is available. Helmet parts and quick-kill monsters are still required.',
  example: 'With this off, adding a bonecrusher to the tool belt waits until you can obtain a bonecrusher. With this on, the reward can appear as soon as its shop is available.',
  grindWarning: 'Turning this on can add Slayer point grinds for rewards you cannot use yet.',
  sources: [{ title: 'Slayer Rewards', url: 'https://runescape.wiki/w/Slayer_Rewards?oldid=37121235' }],
};

export const slayerHelmetComponents = Object.freeze(['Black mask', 'Earmuffs', 'Face mask', 'Nose peg', 'Spiny helmet']);
// Picker monster names, including all three desert lizard variants.
export const quickKillMonsters = Object.freeze(['Gargoyle', 'Rock slug', 'Desert lizard', 'Small lizard', 'Lizard', 'Mutated zygomite']);

const helmet = Object.freeze({ kind: 'items', targets: slayerHelmetComponents,
  // Charged masks can have their charges removed before assembly.
  itemAlternatives: Object.freeze({ 'Black mask': Object.freeze(Array.from({ length: 10 }, (_, i) => `Black mask (${i + 1})`)) }),
  condition: 'All slayer helmet parts are obtainable: black mask, earmuffs, face mask, nose peg and spiny helmet.' });
const target = (kind, name, entrance) => Object.freeze({ kind, targets: Object.freeze([name]), future: true, ...(entrance ? { entrance: Object.freeze(entrance) } : {}),
  condition: `${name} ${kind === 'items' ? 'is obtainable' : 'is available'}.` });
export const slayerUnlockGates = Object.freeze({
  'Learn how to craft a slayer helmet': helmet,
  'Learn how to fuse rings to a full Slayer helmet': helmet,
  'Learn how to deliver killing blows quicker from a Slayer Master': Object.freeze({ kind: 'monsters', targets: quickKillMonsters,
    condition: 'A gargoyle, rockslug, desert lizard or zygomite is available.' }),
  'Learn how to how to attack ice stykewyrms without a fire cape': target('monsters', 'Ice strykewyrm'),
  // Some packs model the entrance NPC rather than a named interior. These
  // equivalent Wiki-backed routes keep the gate usable with either model.
  "Unlock the use of ferocious rings in Morvran's dungeon": target('areas', "Morvran's dungeon",
    { npc: 'Morvran', questTask: "Plague's End Complete the quest" }),
  'Learn how to how to move souls in the Sunken Pyramid': target('areas', 'Sunken Pyramid',
    { npc: 'Portmaster Kags', questTask: 'The Jack of Spades 3', slayer: 99 }),
  ...Object.fromEntries(['bonecrusher', 'herbicide', 'seedicide', 'charming imp', 'gold accumulator'].map(name =>
    [`Learn how to how to attach a ${name} to your tool belt`, target('items', name[0].toUpperCase() + name.slice(1))])),
});

export const slayerUnlockTaskName = label => String(label).replace(/~\|([^|]*)\|~/g, (_, name) => name.split('#')[0]);
/** Match only the named Extra shop tasks; leave pack records and identities intact. */
export function slayerUnlockGate(category, label, record) {
  return category === 'Extra' && record.Shops?.includes('Slayer Rewards')
    && record.Category?.includes('Permanent Unlockables') ? slayerUnlockGates[slayerUnlockTaskName(label)] : undefined;
}
