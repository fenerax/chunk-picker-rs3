import { datasetJSON } from "../dataset-runtime.mjs";
const evidence = await datasetJSON("app/data/skill-guides.2026-10-08.v1.json");

export { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from './skill-guide-rules.mjs';
export const skillGuideCatalogue = evidence;
const safeFields = new Set(['PickerId', 'Level', 'Primary', 'Category', 'Items', 'Objects', 'NPCs', 'Monsters', 'Chunks',
  'Skills', 'Tasks', 'Output', 'Description', 'NoBoost', 'Not F2P']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);

/** Explicit reviewed selectors only. Guide item icons do not generate tasks.
 * The engine calls this overlay only after the OFF-by-default task switch is on.
 * Existing/custom labels survive, and generated identities remain stable. */
export function applySkillGuideTasks(definitions, { catalogue = skillGuideCatalogue, includeInformationalMilestones = true } = {}) {
  let result = definitions;
  const identities = new Set();
  const entries = new Map((catalogue.entries ?? []).map(entry => [entry.id, entry]));
  const existingIds = new Set(Object.values(definitions.challenges ?? {}).flatMap(tasks =>
    Object.values(tasks).map(record => record.PickerId).filter(Boolean)));
  for (const task of catalogue.generatedTasks ?? []) {
    if (!task || typeof task.category !== 'string' || typeof task.label !== 'string'
      || unsafe.has(task.category) || unsafe.has(task.label) || !task.record || !task.entryIds?.length
      || !task.selectorEvidence || !Object.keys(task.selectorEvidence).length) throw new TypeError('Generated guide task needs identity, entry IDs and reviewed selector evidence.');
    const record = task.record;
    if (!/^rs3:task:skill-guide:[a-z0-9:-]+$/.test(record.PickerId ?? '') || !Number.isSafeInteger(record.Level)
      || record.Level < 1 || record.Level > 120 || Object.keys(record).some(field => !safeFields.has(field))
      || record['Not F2P'] === true) throw new TypeError(`Invalid free guide task: ${task.label}`);
    if (identities.has(record.PickerId)) throw new TypeError(`Duplicate generated guide identity: ${record.PickerId}`);
    identities.add(record.PickerId);
    if (task.entryIds.some(id => !entries.has(id) || entries.get(id).skill !== task.category
      || entries.get(id).members !== false || entries.get(id).level !== record.Level)) throw new TypeError(`Unverified guide entry: ${task.label}`);
    if (!['Items', 'Objects', 'NPCs', 'Monsters', 'Chunks'].some(field => Array.isArray(record[field]) && record[field].length
      && record[field].every(value => typeof value === 'string' && value))) throw new TypeError(`Guide task needs an exact selector: ${task.label}`);
    for (const field of ['Items', 'Objects', 'NPCs', 'Monsters', 'Chunks']) if (record[field] !== undefined
      && (!Array.isArray(record[field]) || !record[field].every(value => typeof value === 'string' && value))) throw new TypeError(`Invalid guide selector: ${task.label}`);
    if (!includeInformationalMilestones && isInformationalSkillGuideMilestone(task)) continue;
    if (definitions.challenges?.[task.category]?.[task.label] || existingIds.has(record.PickerId)) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    result.challenges[task.category] = { ...result.challenges[task.category], [task.label]: structuredClone(record) };
  }
  return result;
}

/** A guide level threshold without an action output is information. Explicit
 * opt-in can make it a personal goal; ordinary guide additions cannot. */
export function isInformationalSkillGuideMilestone(task) {
  const record = task?.record ?? {};
  return (record.Category ?? []).includes('Skill guide unlock')
    && !['Output', 'Reward', 'Output Object', 'XpReward'].some(field => record[field] !== undefined);
}

/** Independently reviewed guide/method agreements. Metadata only; callers must
 * not treat these as new methods, rates, access grants or observed player XP. */
export function skillGuideBreakpoints(skill, { catalogue = skillGuideCatalogue, members = false } = {}) {
  return (catalogue.trainingBreakpoints ?? []).filter(row => row.skill === skill && (members || row.members === false))
    .map(row => structuredClone(row)).sort((left, right) => left.level - right.level);
}
