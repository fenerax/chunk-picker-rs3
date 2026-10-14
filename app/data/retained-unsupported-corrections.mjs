import { datasetJSON } from "../dataset-runtime.mjs";
import { createHash } from 'node:crypto';
const evidence = await datasetJSON("app/data/retained-unsupported-corrections.2026-10-13.v1.json");

export const retainedUnsupportedCorrections = evidence;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields = new Set(['Items', 'Tasks', 'Chunks', 'Not F2P']);
const aliasGroups = new Set(['itemsPlus', 'chunksPlus', 'objectsPlus', 'npcsPlus', 'monstersPlus', 'shopsPlus', 'mixPlus', 'tasksPlus']);

/** Narrow H4 repairs, never fuzzy name matching or a general parser relaxation.
 * Each original record and alias source must match; all changes for that record
 * are admitted together. Unreviewed/changed definitions keep their hard gates.
 */
export function applyRetainedUnsupportedCorrections(definitions, { corrections = evidence.corrections, strict = false } = {}) {
  let result = definitions;
  for (const correction of corrections) {
    const aliases = correction.aliases ?? [];
    const dependencies = correction.dependencies ?? [];
    if (typeof correction.category !== 'string' || typeof correction.label !== 'string'
      || !Array.isArray(correction.changes) || !Array.isArray(aliases) || !Array.isArray(dependencies)
      || (!correction.changes.length && !aliases.length)
      || correction.changes.some(change => !fields.has(change.field))
      || new Set(correction.changes.map(change => change.field)).size !== correction.changes.length
      || aliases.some(alias => alias.group !== 'itemsPlus' || typeof alias.name !== 'string' || !alias.name.endsWith('[+]')
        || !Array.isArray(alias.values) || !alias.values.length || alias.values.some(value => typeof value !== 'string')
        || typeof alias.sourceName !== 'string' || !/^[a-f0-9]{64}$/.test(alias.sourceSha256))
      || dependencies.some(dependency => !aliasGroups.has(dependency.group) || typeof dependency.name !== 'string'
        || !dependency.name.endsWith('[+]') || !/^[a-f0-9]{64}$/.test(dependency.sha256))) {
      throw new TypeError('Unsupported H4 retained correction');
    }
    const original = result?.challenges?.[correction.category]?.[correction.label];
    if (!original) {
      if (strict) throw new TypeError(`Missing H4 retained task: ${correction.label}`);
      continue;
    }
    const baseline = { ...original };
    let drift = false, complete = true;
    for (const change of correction.changes) {
      const present = Object.hasOwn(original, change.field);
      const beforeMatches = present === change.beforePresent && (!present || hash(original[change.field]) === hash(change.before));
      const afterMatches = present && hash(original[change.field]) === hash(change.after);
      drift ||= !beforeMatches && !afterMatches;
      complete &&= afterMatches;
      if (change.beforePresent) baseline[change.field] = change.before;
      else delete baseline[change.field];
    }
    for (const alias of aliases) {
      const source = result?.codeItems?.[alias.group]?.[alias.sourceName];
      const target = result?.codeItems?.[alias.group]?.[alias.name];
      drift ||= source === undefined || hash(source) !== alias.sourceSha256 || (target !== undefined && hash(target) !== hash(alias.values));
      complete &&= target !== undefined && hash(target) === hash(alias.values);
    }
    for (const dependency of dependencies) {
      const value = result?.codeItems?.[dependency.group]?.[dependency.name];
      drift ||= value === undefined || hash(value) !== dependency.sha256;
    }
    if (drift || hash(baseline) !== correction.beforeRecordSha256) {
      if (strict) throw new TypeError(`H4 retained correction drift: ${correction.label}`);
      continue;
    }
    if (complete) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    if (result.challenges[correction.category] === definitions.challenges[correction.category]) result.challenges[correction.category] = { ...definitions.challenges[correction.category] };
    result.challenges[correction.category][correction.label] = { ...original, ...Object.fromEntries(correction.changes.map(change => [change.field, structuredClone(change.after)])) };
    if (aliases.length) {
      if (result.codeItems === definitions.codeItems) result.codeItems = { ...definitions.codeItems };
      if (result.codeItems.itemsPlus === definitions.codeItems.itemsPlus) result.codeItems.itemsPlus = { ...definitions.codeItems.itemsPlus };
      for (const alias of aliases) result.codeItems[alias.group][alias.name] = structuredClone(alias.values);
    }
  }
  return result;
}
