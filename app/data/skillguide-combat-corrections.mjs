import { datasetJSON } from "../dataset-runtime.mjs";
import { createHash } from 'node:crypto';
const evidence = await datasetJSON("app/data/skillguide-combat-corrections.2026-10-08.v1.json");
export const skillguideCombatCorrections = evidence.corrections;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const skills = new Set(['Attack', 'Strength', 'Defence', 'Ranged', 'Constitution', 'Magic', 'Prayer', 'Necromancy']);
/** Exact authored task identity, atomic numeric changes, copy on write. The caller
 * controls its default-OFF availability switch; this module never changes rules.
 */
export function applySkillguideCombatCorrections(definitions, { corrections = skillguideCombatCorrections, strict = false } = {}) {
  let result = definitions;
  for (const row of corrections) {
    if (!skills.has(row.skill) || typeof row.label !== 'string' || !Array.isArray(row.changes) || !row.changes.length) throw new TypeError('Invalid combat correction identity');
    for (const c of row.changes) if (c.field !== 'Level' || !Number.isSafeInteger(c.before) || !Number.isSafeInteger(c.after) || c.before < 0 || c.after < 0 || c.after > 120) throw new TypeError('Unsupported combat correction field');
    if (new Set(row.changes.map(c=>c.field)).size !== row.changes.length) throw new TypeError('Duplicate combat correction field');
    const original = result?.challenges?.[row.skill]?.[row.label];
    if (!original) { if (strict) throw new TypeError(`Missing combat correction target: ${row.label}`); continue; }
    const baseline = { ...original };
    for (const c of row.changes) if (Object.hasOwn(baseline,c.field) && baseline[c.field] === c.after) baseline[c.field] = c.before;
    if (row.beforeRecordSha256 && hash(baseline) !== row.beforeRecordSha256 || row.changes.some(c => !Object.hasOwn(original,c.field) || original[c.field] !== c.before && original[c.field] !== c.after)) {
      if (strict) throw new TypeError(`Combat correction drift: ${row.label}`); continue;
    }
    if (row.changes.every(c=>original[c.field] === c.after)) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    if (result.challenges[row.skill] === definitions.challenges[row.skill]) result.challenges[row.skill] = { ...definitions.challenges[row.skill] };
    result.challenges[row.skill][row.label] = { ...original, ...Object.fromEntries(row.changes.map(c=>[c.field,c.after])) };
  }
  return result;
}
