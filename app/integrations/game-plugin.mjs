import { randomUUID } from 'node:crypto';
import { RUNE_METRICS_SKILLS, normalizeQuestTitle, QUEST_TITLE_ALIASES } from './runemetrics.mjs';
import { validateRuneMetricsTimestamp, validateObservedSkill } from '../core/game-progress.mjs';

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
  fields(body, ['v', 'seq', 'sentAt', 'world', 'position', 'skills', 'quests'], 'report');
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
    const candidates = questMapping.get(canonicalQuest(title)) ?? [];
    const match = candidates.length === 1 && state.tasks.some(task => task.id === candidates[0].taskId && task.category === 'Quest') ? candidates[0] : null;
    if (!match) { unmatched.quests.push({ title, reason: candidates.length > 1 ? 'Several quest completions match. Review manually.' : 'No whole-quest completion matches this name.' }); continue; }
    if (kind !== 'finished') continue;
    observedQuests.push({ taskId: match.taskId, title: match.title });
    if (!member.completedTasks.includes(match.taskId)) quests.push({ ...match });
  }
  return { preview: { previewId: randomUUID(), stateRevision: state.revision, memberId, fetchedAt: report.sentAt,
    world: report.world ?? null, skills, quests, unmatched, startedQuests: report.quests?.started ?? [] },
  command: { type: 'apply-game-progress', memberId, fetchedAt: report.sentAt, skills: report.skills ?? [], quests: observedQuests } };
}
