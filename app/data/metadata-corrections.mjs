import { datasetJSON } from "../dataset-runtime.mjs";
const evidence = await datasetJSON("app/data/metadata-corrections.2026-10-08.v1.json");

export const metadataCorrections = evidence.corrections;
// Some access and partial-quest facts are documented only by the Wiki. Keep
// their provenance separate from the cache-backed scalar audit.
export const wikiMetadataCorrections = evidence.wikiCorrections ?? [];
const reviewedCorrections = [...metadataCorrections, ...wikiMetadataCorrections];
const scalarFields = new Set(['QuestPoints', 'Not F2P', 'BaseQuest', 'RuneScore', 'Difficulty', 'Length', 'QuestPointsNeeded']);
const numericMaps = new Set(['Skills', 'SkillsNeeded', 'Requirements']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function pathOf(field, value) {
  const path = String(field).split('.');
  if (path.some(key => !key || unsafe.has(key))) throw new TypeError(`Unsafe metadata field: ${field}`);
  if (path.length === 1 && (scalarFields.has(field) || field === 'Chunks')) return path;
  if (path.length === 2 && numericMaps.has(path[0]) && Number.isSafeInteger(value) && value >= 0) return path;
  throw new TypeError(`Unsupported metadata correction: ${field}`);
}

function valueAt(record, path) {
  let value = record;
  for (const key of path) {
    if (value == null || !Object.hasOwn(value, key)) return { present: false, value: null };
    value = value[key];
  }
  return { present: true, value };
}

function matches(actual, value, present = value !== null) {
  return actual.present === present && (!present || equal(actual.value, value));
}

/** Apply only reviewed fields to exact authored labels with matching old values.
 * The archival export, labels, task IDs and all other authored fields survive.
 * Custom datasets with different values are left alone; strict audits reject drift.
 */
export function applyMetadataCorrections(definitions, { corrections = reviewedCorrections, strict = false } = {}) {
  let result = definitions;
  for (const correction of corrections) {
    const original = result?.challenges?.[correction.category]?.[correction.label];
    if (!original) {
      if (strict) throw new TypeError(`Missing correction target: ${correction.category}: ${correction.label}`);
      continue;
    }
    const changes = correction.changes.map(change => ({ ...change, path: pathOf(change.field, change.after) }));
    // Do not partially rewrite a record when any reviewed precondition has drifted.
    if (changes.some(change => {
      const actual = valueAt(original, change.path);
      return !matches(actual, change.before, change.beforePresent) && !matches(actual, change.after, change.afterPresent);
    })) {
      if (strict) throw new TypeError(`Metadata correction drift: ${correction.category}: ${correction.label}`);
      continue;
    }
    let record = original;
    for (const change of changes) {
      if (matches(valueAt(record, change.path), change.after, change.afterPresent)) continue;
      if (record === original) record = { ...original };
      let target = record;
      for (const key of change.path.slice(0, -1)) { target[key] = { ...target[key] }; target = target[key]; }
      const key = change.path.at(-1);
      if (change.afterPresent === false || change.after === null && change.afterPresent !== true) delete target[key];
      else target[key] = structuredClone(change.after);
    }
    if (record === original) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    result.challenges[correction.category] = { ...result.challenges[correction.category], [correction.label]: record };
  }
  return result;
}
