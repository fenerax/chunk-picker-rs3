// Diagnostic compatibility for recorded snapshots only; no network client.
import { observedSkills } from '../../app/core/game-progress.mjs';
import { previewProgressSnapshot } from '../../app/integrations/progress-preview.mjs';

export const RUNE_METRICS_SKILLS = observedSkills;
export { createQuestMapping, normalizeQuestTitle, QUEST_TITLE_ALIASES, UNMAPPED_QUEST_REASONS } from '../../app/integrations/quest-mapping.mjs';

export function normalizeRuneMetricsSnapshot(snapshot) {
  const seen = new Set(snapshot.profile.skillvalues.map(row => row.id));
  return { source: 'runemetrics', sourceLabel: 'RuneMetrics', fetchedAt: snapshot.fetchedAt, cached: snapshot.cached,
    skills: snapshot.profile.skillvalues.map(row => ({ ...row, skill: Number.isSafeInteger(row.id) ? RUNE_METRICS_SKILLS[row.id] : undefined, xp: Number.isSafeInteger(row.xp) && row.xp >= 0 && row.xp <= 2_000_000_000 ? row.xp / 10 : NaN })),
    quests: snapshot.quests.quests,
    unmatchedSkills: RUNE_METRICS_SKILLS.flatMap((skill, id) => seen.has(id) ? [] : [{ id, skill, reason: 'Skill was not returned; saved progress will be kept.' }]) };
}
export function previewRuneMetrics(state, memberId, snapshot, questMapping) {
  return previewProgressSnapshot(state, memberId, snapshot.source === 'platform-api' ? snapshot : normalizeRuneMetricsSnapshot(snapshot), questMapping);
}
