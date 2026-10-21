/** No quest-stage observations are saved today. Full personal completion is
 * sufficient for a partial gate; mere reachable quest tasks, starting a quest,
 * partner completion and challenge-only checkmarks do not prove progress. */
export function personalQuestProgressBlocker(requirement, completedQuests = []) {
  if (!requirement || typeof requirement.quest !== 'string' || !requirement.quest
    || !['partial', 'complete'].includes(requirement.progress)) {
    return { kind: 'unsupported', detail: 'Unreviewed personal quest progress requirement.' };
  }
  if (completedQuests.includes(requirement.quest)) return null;
  return { kind: 'personal-completion', detail: requirement.detail
    ?? `Requires personal completion of ${requirement.quest}.` };
}
