import { observedSkills as observedSkillNames, validateRuneMetricsTimestamp, progressBelongsToMember } from '../core/game-progress.mjs';
import { canonicalTitle, UNMAPPED_QUEST_REASONS } from './quest-mapping.mjs';

export function previewProgressSnapshot(state, memberId, snapshot, questMapping) {
  if (!['runemetrics', 'game-plugin', 'official-api', 'hiscores'].includes(snapshot.source)) throw new TypeError('Unknown progress source.');
  validateRuneMetricsTimestamp(snapshot.fetchedAt, 'Progress');
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}`);
  const skills = [], observedSkills = [], quests = [], observedQuests = [];
  const unmatched = { skills: [...(snapshot.unmatchedSkills ?? [])], quests: [] }, seenSkills = new Set(), seenQuests = new Set();
  for (const row of snapshot.skills) {
    const skill = observedSkillNames.includes(row.skill) ? row.skill : undefined;
    if (!skill) { unmatched.skills.push({ id: row.id ?? null, reason: 'Unknown skill.' }); continue; }
    if (seenSkills.has(skill)) throw progressError('BAD_RESPONSE', `Progress source returned duplicate ${skill} rows.`, 502);
    seenSkills.add(skill);
    if (!Number.isSafeInteger(row.level) || row.level < 1 || row.level > 120 || typeof row.xp !== 'number' || !Number.isFinite(row.xp) || row.xp < 0 || row.xp > 200_000_000) {
      unmatched.skills.push({ id: row.id, skill, reason: 'Invalid level or XP; this row will not be applied.' }); continue;
    }
    const after = { level: row.level, xp: row.xp }, saved = member.skillProgress?.[skill];
    // The server may have newer saved facts than the member used for fetching.
    if (snapshot.source === 'hiscores' && row.provenance?.source !== 'game-plugin'
      && progressBelongsToMember(saved, member) && (after.level < saved.level || after.xp < saved.xp)) continue;
    observedSkills.push({ skill, ...after, ...(row.provenance ? { provenance: row.provenance } : {}) });
    if (!saved || saved.level !== after.level || saved.xp !== after.xp) skills.push({ skill, before: saved ? { level: saved.level, xp: saved.xp } : null, after });
  }
  let completedQuests = 0, matchedQuests = 0;
  for (const row of snapshot.quests) {
    checkQuestRow(row);
    if (row.status !== 'COMPLETED') continue;
    const key = canonicalTitle(row.title);
    if (seenQuests.has(key)) throw progressError('BAD_RESPONSE', `Progress source returned duplicate quest titles: ${row.title}.`, 502);
    seenQuests.add(key); completedQuests++;
    const candidates = questMapping.get(key) ?? [];
    if (candidates.length !== 1) {
      unmatched.quests.push({ title: row.title, reason: candidates.length ? 'Several whole-quest tasks match; manual review is required.'
        : UNMAPPED_QUEST_REASONS[key] ?? 'No whole-quest completion task matches this title.' }); continue;
    }
    const match = { ...candidates[0], title: row.title };
    // The prepared state catalogue is the authority for personal completions.
    if (!state.tasks.some(task => task.id === match.taskId && task.category === 'Quest')) {
      unmatched.quests.push({ title: row.title, reason: 'The mapped quest is absent from the saved catalogue.' }); continue;
    }
    matchedQuests++; observedQuests.push({ taskId: match.taskId, title: row.title, ...(row.provenance ? { provenance: row.provenance } : {}) });
    if (!member.completedTasks.includes(match.taskId)) quests.push(match);
  }
  return {
    preview: { stateRevision: state.revision, memberId, runescapeName: member.runescapeName ?? '',
      ...(snapshot.message ? { message: snapshot.message } : {}),
      source: snapshot.source, sourceLabel: snapshot.sourceLabel, fetchedAt: snapshot.fetchedAt, cached: snapshot.cached, skills, quests, unmatched,
      counts: { completedQuests, matchedQuests, unmatchedQuests: unmatched.quests.length } },
    command: { type: snapshot.source === 'game-plugin' ? 'apply-game-progress' : 'apply-runemetrics', memberId,
      ...(snapshot.source === 'game-plugin' ? { achievements: [] } : { runescapeName: member.runescapeName, ...(['official-api', 'hiscores'].includes(snapshot.source) ? { source: snapshot.source } : {}) }),
      fetchedAt: snapshot.fetchedAt, skills: observedSkills, quests: observedQuests },
  };
}

function progressError(code, message, status) { return Object.assign(new Error(message), { code, status }); }
function checkQuestRow(row) {
  if (typeof row.title !== 'string' || !row.title.trim() || !['COMPLETED', 'STARTED', 'NOT_STARTED'].includes(row.status)) {
    throw progressError('BAD_RESPONSE', 'Progress source returned a quest without a valid title or completion status.', 502);
  }
}
