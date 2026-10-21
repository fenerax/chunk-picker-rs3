import { datasetJSON } from "../dataset-runtime.mjs";
import { createHash } from 'node:crypto';
import { selectedRetainedTaskCorrections } from './selected-definition-overlays.mjs';
const evidence = await datasetJSON("app/data/retained-task-corrections.2026-10-09.v1.json");
const entryEvidence = await datasetJSON("app/data/retained-entry-corrections.2026-10-12.v2.json");
const wordingEvidence = await datasetJSON("app/data/retained-wording-corrections.2026-10-12.v1.json");

export const retainedTaskCorrections = evidence;
export const retainedEntryCorrections = entryEvidence;
export const retainedWordingCorrections = wordingEvidence;
const reviewedCorrections = [...evidence.corrections, ...entryEvidence.corrections, ...wordingEvidence.corrections];
const reviewedKeys = new Set(reviewedCorrections.map(row => JSON.stringify(row)));
const selectedCorrections = selectedRetainedTaskCorrections.filter(row => !reviewedKeys.has(JSON.stringify(row)));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields = new Set(['Level', 'Description', 'RequirementAlternatives', 'RequirementAlternativesDescription', 'Skills']);

/** Reviewed requirement corrections keep exact authored identities. All old
 * fields must still match, including fields outside the correction. Apply each
 * record atomically; an already-applied overlay returns the same object.
 */
export function applyRetainedTaskCorrections(definitions, { corrections = reviewedCorrections, strict = false } = {}) {
  let result = definitions;
  for (const correction of corrections) {
    if (typeof correction.category !== 'string' || typeof correction.label !== 'string'
      || !Array.isArray(correction.changes) || !correction.changes.length
      || correction.changes.some(change => !fields.has(change.field))
      || new Set(correction.changes.map(change => change.field)).size !== correction.changes.length) {
      throw new TypeError('Unsupported retained task correction');
    }
    const original = result?.challenges?.[correction.category]?.[correction.label];
    if (!original) {
      if (strict) throw new TypeError(`Missing retained task target: ${correction.label}`);
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
    if (drift || hash(baseline) !== correction.beforeRecordSha256) {
      if (strict) throw new TypeError(`Retained task correction drift: ${correction.label}`);
      continue;
    }
    if (complete) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    if (result.challenges[correction.category] === definitions.challenges[correction.category]) {
      result.challenges[correction.category] = { ...definitions.challenges[correction.category] };
    }
    result.challenges[correction.category][correction.label] = {
      ...original, ...Object.fromEntries(correction.changes.map(change => [change.field, structuredClone(change.after)])),
    };
  }
  return result;
}

/** Only the selected full-dataset preparation boundary enables successors. */
export function applySelectedRetainedTaskCorrections(definitions) {
  return applyRetainedTaskCorrections(definitions, { corrections: selectedCorrections, strict: true });
}
