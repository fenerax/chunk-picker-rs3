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

/** Supplement missing activity tags without depending on a dataset's task ID.
 * The sinkhole is matched by its area: the area unlock itself and every task
 * that needs the area, whatever its category. */
export function withActivityTimingTags(category, record, label) {
  const timed = category === 'Diary' && record?.Description === achievementDescription
    || category === 'Nonskill' && label === sinkhole && record?.UnlocksArea
    || chunkNames(record?.Chunks).includes(sinkhole);
  if (!timed) return record;
  const current = record.Category == null ? [] : Array.isArray(record.Category) ? record.Category : [record.Category];
  const missing = tags.filter(tag => !current.includes(tag));
  return missing.length ? { ...record, Category: [...current, ...missing] } : record;
}

/** Gate the activity's supplies too, so generated equipment goals cannot bypass
 * its rules through a bare spawn or reward-shop record. Other stock is untouched. */
export function activityTimingSourceRules(item, source) {
  return String(item).replaceAll('*', '').toLowerCase() === 'protea flower'
    || source === 'Reward Shop (Big Chinchompa)' ? tags : [];
}
