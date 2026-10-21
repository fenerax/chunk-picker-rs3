import { taskRuleBehavior } from '../data/settings.mjs';

export const keptRulesSectionId = 'kept-original-rules';
export const keptRulesSectionName = 'Kept from the original picker, not used here';

export function isKeptTaskRule(id) {
  return ['retained-only', 'not-implemented'].includes(taskRuleBehavior(id).status);
}

/** Presentation only: keep the full catalogue and saved values intact. */
export function visibleRulesSections(sections, advanced = false) {
  const kept = new Map();
  const active = sections.flatMap(section => {
    const rules = section.rules.filter(rule => {
      if (rule.sharedRuleId || !isKeptTaskRule(rule.id)) return true;
      kept.set(rule.id, { ...rule, parent: null, depth: 0 });
      return false;
    });
    return rules.length ? [{ ...section, rules }] : [];
  });
  if (advanced && kept.size) active.push({ id: keptRulesSectionId, name: keptRulesSectionName, scope: 'personal', kept: true, rules: [...kept.values()] });
  return active;
}
