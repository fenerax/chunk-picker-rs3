// Reviewed facts adapted from RuneScape Wiki contributors (CC BY-NC-SA 3.0).
// Big Chinchompa starts at half past each hour and allows two plays daily.
// A protea flower is picked inside the activity or bought with its points.
// A sinkhole opens at half past each hour at one of 21 sites for 15 minutes,
// so a chunk-locked map waits for the few sites it owns.
export const activityTimingSources = Object.freeze([
  'https://runescape.wiki/w/Big_Chinchompa',
  'https://runescape.wiki/w/Big_Chinchompa_(achievement)',
  'https://runescape.wiki/w/Protea_flower',
  'https://runescape.wiki/w/Sinkhole',
]);
const tags = Object.freeze(['Timegated', 'DnD']);
const achievementDescription = 'Score 1,111 in a session of the Big Chinchompa minigame.';
const sinkhole = 'Sinkhole';
const chunkNames = chunks => Array.isArray(chunks) ? chunks : chunks && typeof chunks === 'object' ? Object.keys(chunks) : chunks == null ? [] : [chunks];

// R4: farm upgrades belong to repeated farm progression even when an individual
// deed is cheap. Tutorials, a single birth/growth cycle and port entry stay out.
// RuneScape Wiki revisions: Player-owned farm 37110514; Farmers' Market
// 37212772; Player-owned port 37218482; Trip to the East 36928186.
export const progressTimingSources = Object.freeze([
  'https://runescape.wiki/w/Player-owned_farm?oldid=37110514',
  "https://runescape.wiki/w/Farmers%27_Market?oldid=37212772",
  'https://runescape.wiki/w/Player-owned_port?oldid=37218482',
  'https://runescape.wiki/w/Trip_to_the_East?oldid=36928186',
  'https://runescape.wiki/w/E-I-E-I-O?oldid=37000345',
  'https://runescape.wiki/w/E-I-E-DI-NO?oldid=36763452',
  'https://runescape.wiki/w/Royal_dragon?oldid=37176090',
]);
const farmUpgrades = new Set([
  'Unlock the ~|bank chest (player-owned farm)|~',
  ...['small', 'medium', 'large'].map(size => `Unlock the ability for animals in your ~|Player-Owned Farm|~ to breed in ${size} pens`),
  'Unlock all boosts to multiple traits for animals in your ~|Player-Owned Farm|~',
  'Unlock noted produce in your ~|Player-Owned Farm|~',
  'Unlock all farmhands at your ~|Player-Owned Farm|~',
]);
export function progressTimingReason(category, record, label) {
  if (category === 'Extra' && (farmUpgrades.has(label)
    || /^Build both (?:small|medium|large) pens in your ~\|Player-Owned Farm\|~$/.test(label)
    || label === 'Build a dinosaur breeding pen in the ~|Ranch out of Time|~')) return 'farm-upgrades';
  if (['Farming', 'Construction'].includes(category) && /^Build /.test(label)
    && chunkNames(record?.Shops).some(shop => /^Farmers' Market(?:\[\+\])?(?: \(Anachronia\))?$/.test(shop))) return 'farm-upgrades';
  if (category === 'Extra' && label === 'Obtain the ~|Old Mc|~ title'
    || category === 'Diary' && ['~|Completionist achievements#Trimmed Completionist Cape|~ E-I-E-I-O',
      '~|Completionist achievements#Trimmed Completionist Cape|~ E-I-E-DI-NO'].includes(label)) return 'farm-log';
  if (category === 'Extra' && label === '(Dragons) Breed a ~|royal dragon|~') return 'farm-breeding';
  const current = chunkNames(record?.Category);
  if (chunkNames(record?.Chunks).includes('Player-Owned Port') && !current.includes('PortSkills')
    && !(category === 'Diary' && record?.Description === 'Complete the Player Owned Port tutorial.')) return 'port-progression';
  if (category === 'Diary' && label === '~|Completionist achievements#Completionist Cape|~ Trip to the East'
    || category === 'Diary' && label === '~|Activities achievements#Player-Owned Port|~ Complete the Player-Owned Port achievements') return 'port-progression';
  return null;
}

/** Supplement missing activity tags without depending on a dataset's task ID.
 * The sinkhole is matched by its area: the area unlock itself and every task
 * that needs the area, whatever its category. */
export function withActivityTimingTags(category, record, label) {
  const timed = category === 'Diary' && record?.Description === achievementDescription
    || category === 'Nonskill' && label === sinkhole && record?.UnlocksArea
    || chunkNames(record?.Chunks).includes(sinkhole);
  const progress = progressTimingReason(category, record, label);
  if (!timed && !progress) return record;
  const current = record.Category == null ? [] : Array.isArray(record.Category) ? record.Category : [record.Category];
  const missing = (timed ? tags : ['Timegated']).filter(tag => !current.includes(tag));
  return missing.length ? { ...record, Category: [...current, ...missing] } : record;
}

/** Gate the activity's supplies too, so generated equipment goals cannot bypass
 * its rules through a bare spawn or reward-shop record. Other stock is untouched. */
export function activityTimingSourceRules(item, source) {
  if (source === 'Ports Reward Shop') return ['Timegated'];
  return String(item).replaceAll('*', '').toLowerCase() === 'protea flower'
    || source === 'Reward Shop (Big Chinchompa)' ? tags : [];
}
