import { taskRuleValue } from './rules-model.mjs';

export const ruleValueText = value => value === true ? 'On' : value === false ? 'Off' : value == null ? 'No effect' : String(value);
export const reviewRecord = (state, id) => state.ruleReviews?.[id] ?? { reviewed: false, note: '' };
export function reviewRuleLabel(rule) {
  const label = rule.label === rule.id ? rule.description || rule.currentDescription || rule.label : rule.label;
  return String(label || 'Saved rule').replace(/\*+$/g, '').trim();
}
export function reviewValue(state, memberId, rule, registry) {
  return rule.sharedRuleId ? registry.resolve(state.rules)[rule.sharedRuleId] : taskRuleValue(state, memberId, rule).value;
}
export function captureReview(state, rules, registry) {
  return new Map(rules.map(rule => [rule.id, new Map(state.members.map(member => [member.id, reviewValue(state, member.id, rule, registry)]))]));
}
export function reviewChanges(state, rules, baseline, registry) {
  return [...new Map(rules.map(rule => [rule.id, rule])).values()].flatMap(rule => {
    const members = rule.sharedRuleId ? state.members.slice(0, 1) : state.members;
    return members.flatMap(member => {
      if (!baseline?.get(rule.id)?.has(member.id)) return [];
      const before = baseline.get(rule.id).get(member.id), after = reviewValue(state, member.id, rule, registry);
      return Object.is(before, after) ? [] : [{ ruleId: rule.id, label: reviewRuleLabel(rule), member: rule.sharedRuleId ? 'Both players' : member.name, before, after }];
    });
  });
}
export function reviewRules(sections, state, { filter = 'all', changes = [], registry } = {}) {
  const changed = new Set(changes.map(row => row.ruleId));
  const seen = new Set();
  return sections.flatMap(section => section.rules.filter(rule => {
    if (seen.has(rule.id)) return false;
    seen.add(rule.id);
    if (filter === 'unreviewed') return !reviewRecord(state, rule.id).reviewed;
    if (filter === 'different') return state.members.some(member => !Object.is(reviewValue(state, member.id, rule, registry), reviewValue(state, state.members[0].id, rule, registry)));
    if (filter === 'changed') return changed.has(rule.id);
    // Only use explicit membership metadata; rule names alone are not evidence.
    if (filter === 'members') return rule.members === true || rule.membersOnly === true || rule.requiresMembers === true;
    return true;
  }).map(rule => ({ ...rule, sectionId: section.id, sectionName: section.name })));
}
export function reviewSelection(rows, id, direction = 0) {
  if (!rows.length) return null;
  const index = Math.max(0, rows.findIndex(row => row.id === id));
  return rows[Math.max(0, Math.min(rows.length - 1, index + direction))];
}
export function reviewSummary(changes) {
  return ['Changes made during this review', ...changes.map(row => `• ${row.member} · ${row.label}: ${ruleValueText(row.before)} → ${ruleValueText(row.after)}`), ...(!changes.length ? ['No rule values changed.'] : [])].join('\n');
}
