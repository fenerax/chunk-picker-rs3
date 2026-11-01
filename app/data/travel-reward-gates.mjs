// Wiki facts supplied by the orchestrator, fetched 2026-11-01. See
// docs/qa/r2-travel-waits.md for revision citations and unresolved data.
export { EARLY_TRAVEL_UNLOCKS_RULE } from './settings.mjs';
export const travelRewardSources = Object.freeze({
  balloon: 36927642, skillPortal: 37165985, skillPortalLocations: 36984771,
  ranch: 37218892, construction: 37207458, workbench: 37199289, plans: 37180541,
  nexus: 37204416, nexusTeleports: 37125092, cannon: 37197227,
  gold: 37014464, royale: 37014790, respectRewards: 37032396,
});
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const unlockLabel = value => String(value).replace(/~\|([^|]+)\|~/g, (_, name) => name.split('#')[0]);
const balloonNames = new Set([
  'Unlock the balloon transport system route to the Crafting Guild',
  'Unlock the balloon transport system route to the south of Fort Forinthry',
  'Unlock the hot air balloon to Castle Wars',
  'Unlock the balloon transport system route to the Grand Tree',
]);
const cannonNames = new Set([
  'Unlock all three dwarf multicannon upgrades',
  "(Artisans' Workshop) Obtain the gold dwarf multicannon",
  "(Artisans' Workshop) Obtain the royale cannon",
]);
// Only destinations listed in revision 37125092 and already mapped by a spell
// row are eligible. Unknown destinations/coordinates never become hard gates.
const nexusSpells = new Set([
  'Annakarl', 'Ape Atoll', 'Ardougne', 'Barbarian', 'Camelot', 'Carrallanger',
  'Catherby', 'Dareeyak', 'Eastern Anachronia', 'Falador', 'Fishing Guild',
  'Ghorrock', 'God Wars Dungeon', 'Ice Plateau', 'Kharyrll', 'Khazard', 'Lassar',
  'Lumbridge', 'Mazcab', 'Moonclan', 'Mountain Camp', 'North Ardougne',
  'North-western Anachronia', 'Northern Lost Grove', 'Ourania', 'Paddewwa',
  'Senntisten', 'South Falador', 'South Feldip Hills', 'Taverley', 'Trollheim',
  'Trollheim Farm', 'Varrock', 'Watchtower', 'Waterbirth', 'Wendlewick',
  'Western Kharazi Jungle',
]);
export function travelRewardKind(category, label, record) {
  const name = unlockLabel(label);
  if (category === 'Extra') {
    if (balloonNames.has(name) && array(record.Category).includes('Permanent Unlockables')) return 'balloon';
    if (name === 'Unlock the ability to attune the Max Guild portal to the Ranch out of Time') return 'attunement';
    if (name === 'Unlock all teleports in a portal nexus') return 'nexus';
    if (cannonNames.has(name)) return 'cannon';
  }
  if (category === 'Construction' && name.startsWith('Construct ')
    && array(record.Items).some(item => /^Furniture plans:/i.test(item))) return 'furniture';
}
/** First unlock flights start at Entrana, not their landing site. Reuse the
 * declared flight's supplies, skill and dependencies instead of inventing a
 * new requirement language or making its destination a prerequisite. */
export function usefulTravelRecord(category, label, record, definitions, early) {
  if (travelRewardKind(category, label, record) !== 'balloon') return record;
  const flights = Object.entries(record.Tasks ?? {}).filter(([name, category]) => category === 'Firemaking'
    && unlockLabel(name).startsWith('Use the Balloon transport system to travel to '));
  if (flights.length !== 1) return record;
  const [name] = flights[0], flight = definitions.challenges.Firemaking?.[name];
  if (!flight) return record;
  const tasks = { ...record.Tasks }; delete tasks[name];
  return { ...record, Chunks: early ? [] : ['11060'],
    Items: [...new Set([...array(record.Items), ...array(flight.Items)])],
    NPCs: [...new Set([...array(record.NPCs), ...array(flight.NPCs)])],
    Objects: [...new Set([...array(record.Objects), ...array(flight.Objects)])],
    Shops: [...new Set([...array(record.Shops), ...array(flight.Shops)])],
    Requirements: { ...flight.Requirements, ...record.Requirements },
    Skills: { ...flight.SkillsNeeded, ...flight.Skills, ...record.Skills,
      Firemaking: Math.max(flight.Level ?? 1, record.Skills?.Firemaking ?? 1) },
    Tasks: { ...flight.Tasks, ...tasks },
  };
}
export function furnitureWorkbenches(level) {
  return ['Furniture workbench', 'Reinforced steel framed workbench',
    ...(level <= 60 ? ['Steel framed workbench'] : []), ...(level <= 20 ? ['Wooden workbench'] : [])];
}
export function nexusDestinationClauses(definitions) {
  const mapped = id => {
    if (Object.hasOwn(definitions.chunks ?? {}, id)) return true;
    const match = /^(.*)-(\d+)$/.exec(id);
    return !!(match && Object.hasOwn(definitions.sections?.[match[1]] ?? {}, match[2]));
  };
  return Object.entries(definitions.challenges.Magic ?? {}).flatMap(([label, record]) => {
    const spell = /^Cast (.*) [Tt]eleport$/.exec(unlockLabel(label));
    if (!spell || !nexusSpells.has(spell[1])) return [];
    const locations = array(record.Chunks).flatMap(id => definitions.codeItems?.chunksPlus?.[id] ?? [id]).filter(mapped);
    return locations.length ? [{ spell: spell[1], locations }] : [];
  });
}
