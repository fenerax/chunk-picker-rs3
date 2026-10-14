import { datasetJSON } from "../dataset-runtime.mjs";
const evidence = await datasetJSON("app/data/poh-storage.2026-10-08.v1.json");

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Current RS3 furniture; historical costume-room names are research aliases. */
export const houseStorageCatalogue = freeze(evidence);
export const houseStorageRule = 'House storage tasks';
