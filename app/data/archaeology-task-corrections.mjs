import { datasetJSON } from "../dataset-runtime.mjs";
const bundle = await datasetJSON("app/data/archaeology-task-corrections.2026-10-08.v1.json");
import { cacheArchaeologyContentsEnabled } from './cache-archaeology.mjs';

export const archaeologyTaskCorrections = bundle;

/** The exact old value and object selector must match. Custom records survive. */
export function applyArchaeologyTaskCorrections(definitions, { enabled = cacheArchaeologyContentsEnabled() } = {}) {
  if (!enabled) return definitions;
  let result = definitions;
  for (const correction of bundle.corrections) {
    const record = result.challenges?.[correction.category]?.[correction.label];
    if (!record || record.Level !== correction.before
      || JSON.stringify(record.Objects) !== JSON.stringify(correction.expectedObjects)) continue;
    result = { ...result, challenges: { ...result.challenges, [correction.category]: {
      ...result.challenges[correction.category], [correction.label]: { ...record, Level: correction.after },
    } } };
  }
  return result;
}
