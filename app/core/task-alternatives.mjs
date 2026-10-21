import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';

const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const safeKey = key => typeof key === 'string' && !!key.trim() && !unsafe.has(key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const decodeKey = key => decodeLegacyText(key).replace(/^\*fb\*_/, '');

/** Choices are presentation preferences, never completion or access evidence.
 * General gameplay conversion did not convert altChallenges, so preserve those
 * choices as fallback until an explicit personal choice (including null) masks it.
 * Legacy labels remain exact decoded labels; consumers match them against rows.
 */
export function resolveTaskAlternatives(state, member) {
  const raw = state.legacy?.maps?.[member.sourceMapId]?.chunkinfo?.altChallenges;
  const choices = {};
  if (record(raw)) for (const [rawCategory, rawGroups] of Object.entries(raw)) {
    const category = decodeKey(rawCategory);
    if (!safeKey(category) || !record(rawGroups)) continue;
    const groups = {};
    for (const [rawGroup, rawChoice] of Object.entries(rawGroups)) {
      const group = decodeKey(rawGroup);
      if (safeKey(group) && typeof rawChoice === 'string' && rawChoice.trim()) groups[group] = decodeLegacyText(rawChoice);
    }
    if (Object.keys(groups).length) choices[category] = groups;
  }
  for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) choices[category] = { ...choices[category], ...groups };
  return choices;
}
