import { datasetJSON } from "../dataset-runtime.mjs";
const dataset = await datasetJSON("app/data/equipment-permanence.2026-10-08.v1.json");

export const equipmentPermanence = dataset.records;
export const equipmentPermanenceEvidence = dataset;

/** Exact picker names preserve the same identity used by equipment goals.
 * A supplied corrected cache identity must be one of the reviewed states.
 * Custom/unknown records are retained, rather than guessed consumable.
 */
export function getEquipmentPermanence(name, data = {}) {
  if (!Object.hasOwn(equipmentPermanence, name)) return null;
  const record = equipmentPermanence[name];
  const id = data?.cacheIdentity?.id;
  if (id !== undefined && !record.cacheIds.includes(id)) return null;
  return record;
}

export function isNonPermanentEquipment(name, data = {}) {
  return getEquipmentPermanence(name, data)?.permanent === false;
}
