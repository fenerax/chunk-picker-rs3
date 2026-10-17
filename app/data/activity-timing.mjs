// Reviewed facts adapted from RuneScape Wiki contributors (CC BY-NC-SA 3.0).
// Big Chinchompa starts at half past each hour and allows two plays daily.
// A protea flower is picked inside the activity or bought with its points.
export const activityTimingSources = Object.freeze([
  'https://runescape.wiki/w/Big_Chinchompa',
  'https://runescape.wiki/w/Big_Chinchompa_(achievement)',
  'https://runescape.wiki/w/Protea_flower',
]);
const tags = Object.freeze(['Timegated', 'DnD']);
const achievementDescription = 'Score 1,111 in a session of the Big Chinchompa minigame.';

/** Supplement missing activity tags without depending on a dataset's task ID. */
export function withActivityTimingTags(category, record) {
  if (category !== 'Diary' || record?.Description !== achievementDescription) return record;
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
