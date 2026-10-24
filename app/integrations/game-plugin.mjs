import { randomUUID } from 'node:crypto';
import { RUNE_METRICS_SKILLS, normalizeQuestTitle, QUEST_TITLE_ALIASES, UNMAPPED_QUEST_REASONS } from './runemetrics.mjs';
import { validateRuneMetricsTimestamp, validateObservedSkill } from '../core/game-progress.mjs';
import { lookupPermanentId } from '../tasks/identity.mjs';

const fail = message => { throw Object.assign(new TypeError(message), { status: 400 }); };
export function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`Unknown ${label} field.`);
}
const canonicalQuest = title => { const key = normalizeQuestTitle(title.replaceAll('_', ' ')); return QUEST_TITLE_ALIASES[key] ?? key; };
const skillNames = new Map(RUNE_METRICS_SKILLS.map(name => [name.toUpperCase(), name]));
skillNames.set('RUNECRAFT', 'Runecrafting');
skillNames.set('HITPOINTS', 'Constitution');

export function validatePluginReport(body) {
  fields(body, ['v', 'seq', 'sentAt', 'world', 'position', 'skills', 'quests', 'diagnostics', 'achievements'], 'report');
  if (body.achievements !== undefined) {
    const value = body.achievements;
    fields(value, ['snapshot', 'part', 'parts', 'complete'], 'achievements');
    if (['skills', 'quests', 'diagnostics'].some(key => body[key] !== undefined)) fail('Send achievement parts separately from skills, quests and diagnostics.');
    if (typeof value.snapshot !== 'string' || !/^[a-f0-9]{16}$/.test(value.snapshot)
      || !Number.isInteger(value.parts) || value.parts < 1 || value.parts > 8
      || !Number.isInteger(value.part) || value.part < 1 || value.part > value.parts
      || !Array.isArray(value.complete)) fail('Achievements needs a snapshot, part, parts from 1 to 8 and a complete array.');
    let previous = -1;
    for (const row of value.complete) {
      if (!Array.isArray(row) || row.length !== 4 || !Number.isSafeInteger(row[0]) || row[0] < 0 || row[0] <= previous
        || typeof row[1] !== 'string' || row[1].length < 1 || row[1].length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(row[1])
        || !Number.isSafeInteger(row[2]) || row[2] < -1 || !Number.isSafeInteger(row[3]) || row[3] < -1) fail('Achievement rows need sorted unique IDs, a name of 1 to 120 characters without controls, and integer categories at least -1.');
      previous = row[0];
    }
  }
  // Diagnostics are the plugin's own status lines, shown only to this player and admins.
  if (body.diagnostics !== undefined && (!Array.isArray(body.diagnostics) || body.diagnostics.length > 80
    || body.diagnostics.some(line => typeof line !== 'string' || line.length > 160 || /[\x00-\x1f\x7f]/.test(line)))) fail('Diagnostics must be at most 80 single lines of up to 160 characters.');
  if (body.v !== 1 || !Number.isSafeInteger(body.seq) || body.seq < 0) fail('Use v:1 and a nonnegative integer seq.');
  validateRuneMetricsTimestamp(body.sentAt);
  fields(body.position, ['x', 'z', 'floor'], 'position');
  for (const key of ['x', 'z', 'floor']) if (!Number.isInteger(body.position[key]) || body.position[key] < 0 || body.position[key] > (key === 'floor' ? 3 : 199)) fail('Position needs map-square x/z from 0 to 199 and floor from 0 to 3.');
  if (body.world !== undefined) {
    fields(body.world, ['id', 'beta'], 'world');
    if (!Number.isInteger(body.world.id) || body.world.id < 1 || body.world.id > 10000 || typeof body.world.beta !== 'boolean') fail('World needs an integer id from 1 to 10000 and a beta boolean.');
  }
  const skills = [];
  if (body.skills !== undefined) {
    fields(body.skills, Object.keys(body.skills ?? {}), 'skills');
    if (Object.keys(body.skills).length > RUNE_METRICS_SKILLS.length) fail('Too many skills.');
    const seen = new Set();
    for (const [name, value] of Object.entries(body.skills)) {
      const skill = skillNames.get(name.toUpperCase());
      if (!skill) fail(`Unknown game skill: ${name}.`);
      fields(value, ['level', 'xp'], 'skill'); validateObservedSkill(skill, value);
      if (value.xp > 200000000 || seen.has(skill)) fail('Skill XP must be at most 200000000; do not repeat a skill.');
      seen.add(skill); skills.push({ skill, level: value.level, xp: value.xp });
    }
  }
  if (body.quests !== undefined) {
    fields(body.quests, ['finished', 'started'], 'quests');
    const seen = new Set();
    for (const kind of ['finished', 'started']) {
      if (!Array.isArray(body.quests[kind]) || body.quests[kind].length > 500) fail('Quests needs finished and started arrays, at most 500 each.');
      for (const title of body.quests[kind]) {
        if (typeof title !== 'string' || !title.trim() || title !== title.trim() || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) fail('Quest names must be short, nonempty text.');
        const key = canonicalQuest(title);
        if (!key || seen.has(key)) fail('Do not repeat quest names.');
        seen.add(key);
      }
    }
  }
  return { ...body, skills: body.skills === undefined ? undefined : skills };
}

// Saved display labels flatten wiki links. Only retained raw labels with the
// explicit family/group syntax identify an achievement; never guess a suffix.
export function matchPluginAchievements(state, memberId, rows) {
  const member = state.members.find(row => row.id === memberId);
  if (!member) throw new RangeError('Unknown player.');
  const mapping = new Map(), completed = new Set(member.completedTasks), matched = new Set();
  for (const task of state.tasks) {
    if (task.category !== 'Diary') continue;
    const raw = task.rawLabel ?? state.identityRegistry?.entries?.[task.id]?.rawLabel ?? lookupPermanentId(task.id)?.rawLabel ?? task.label;
    const match = typeof raw === 'string' && /^~\|([^|#]+)#([^|#]+)\|~ (.+)$/.exec(raw);
    if (!match) continue;
    const key = normalizeQuestTitle(match[3]);
    if (!key) continue;
    const candidates = mapping.get(key) ?? [];
    candidates.push({ taskId: task.id, label: task.label }); mapping.set(key, candidates);
  }
  const candidates = [], unclear = [], seen = new Set(); let unmatchedCount = 0;
  for (const [achievementId, title] of rows) {
    if (seen.has(achievementId)) continue;
    seen.add(achievementId);
    const tasks = mapping.get(normalizeQuestTitle(title)) ?? [];
    for (const task of tasks) matched.add(task.taskId);
    if (!tasks.length) { unmatchedCount++; continue; }
    if (tasks.every(task => completed.has(task.taskId))) continue;
    const row = { achievementId, title, candidates: tasks };
    if (tasks.length === 1) candidates.push(row); else unclear.push({ ...row, reason: 'unclear' });
  }
  return { candidates, unclear, completeCount: seen.size, matchedTaskCount: matched.size, unmatchedCount };
}

export const ACHIEVEMENT_REVIEW_LIMIT = 200;

export function pluginProposal(state, memberId, report, questMapping) {
  const member = state.members.find(member => member.id === memberId);
  if (!member) throw new RangeError('Unknown player.');
  const skills = [], quests = [], observedQuests = [], unmatched = { skills: [], quests: [] };
  for (const observation of report.skills ?? []) {
    const before = member.skillProgress?.[observation.skill];
    if (!before || before.level !== observation.level || before.xp !== observation.xp) skills.push({ skill: observation.skill,
      before: before ? { level: before.level, xp: before.xp } : null, after: { level: observation.level, xp: observation.xp } });
  }
  for (const kind of ['finished', 'started']) for (const title of report.quests?.[kind] ?? []) {
    const key = canonicalQuest(title), candidates = questMapping.get(key) ?? [];
    const match = candidates.length === 1 && state.tasks.some(task => task.id === candidates[0].taskId && task.category === 'Quest') ? candidates[0] : null;
    if (!match) { unmatched.quests.push({ title, reason: candidates.length > 1 ? 'Several quest completions match. Review manually.'
      : UNMAPPED_QUEST_REASONS[key] ?? (/\(miniquest\)$/i.test(title) ? 'Miniquest. The picker has no completion task for it.' : 'No whole-quest completion matches this name.') }); continue; }
    if (kind !== 'finished') continue;
    observedQuests.push({ taskId: match.taskId, title: match.title });
    if (!member.completedTasks.includes(match.taskId)) quests.push({ ...match });
  }
  const achievements = (report.achievementReview ?? []).filter(row => row.candidates.some(task => !member.completedTasks.includes(task.taskId)));
  return { preview: { previewId: randomUUID(), stateRevision: state.revision, memberId, fetchedAt: report.sentAt,
    world: report.world ?? null, skills, quests, unmatched, startedQuests: report.quests?.started ?? [],
    achievements: achievements.slice(0, ACHIEVEMENT_REVIEW_LIMIT), achievementsMore: report.achievementsMore ?? 0 },
  command: { type: 'apply-game-progress', memberId, fetchedAt: report.sentAt, skills: report.skills ?? [], quests: observedQuests, achievements: [] } };
}
