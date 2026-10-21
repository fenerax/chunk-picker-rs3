import { datasetValue } from '../dataset-runtime.mjs';
// These are retained BaseQuest families, not task-name matching. Area families
// are every other Diary BaseQuest in the reference's dependency validator.
const nonAreaFamilies = datasetValue("app/tasks/achievements.mjs#nonAreaFamilies");
const enabled = (rules, name) => rules[name] !== undefined && ![false, 'false', 0].includes(rules[name]);

/** The original relaxes tier dependencies, never a task's own access, skill,
 * item, membership or family-rule requirements. Alias options have a stricter
 * Reward-marker condition than ordinary task references (worker.js:1704–1783).
 */
export function relaxesAchievementDependency(category, parent, dependency, target, any) {
  if (category !== 'Diary' || !target) return false;
  const diaryReference = dependency.category === 'Diary';
  if (!diaryReference && (!dependency.token.includes('--') || dependency.alias && dependency.token.includes('[+]x'))) return false;
  if (!(any && !nonAreaFamilies.has(parent.BaseQuest) || target.BaseQuest === 'Combat Mastery achievements')) return false;
  return dependency.alias
    ? Object.hasOwn(target, 'Reward') && !Object.hasOwn(parent, 'Reward')
    : !parent.ManualShow;
}

/** Activity Info's required filter is a family-rule view, independent of active
 * duties, tier completion and the Achievement display switch (index.js:9603–15).
 */
export function achievementFamilyRequired(family, rules = {}) {
  if (family === 'Combat Mastery achievements') return enabled(rules, 'Combat Mastery achievements');
  if (family === 'Combat achievements') return enabled(rules, 'Misc Combat achievements');
  if (family === 'Completionist achievements') return enabled(rules, 'Comp achievements') || enabled(rules, 'MQC achievements');
  if (['Skills achievements', 'Exploration achievements', 'Activities achievements'].includes(family)) return enabled(rules, 'Misc achievements');
  return true;
}
