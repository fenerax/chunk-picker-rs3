import { datasetValue } from "../dataset-runtime.mjs";
// Authored permanent identities. Maintained by scripts/update-identities.mjs.
// Tokens are minted once; never reorder and remint, remove rows, or recycle IDs.
export const identityRegistryVersion = datasetValue("app/data/identity-registry.mjs#identityRegistryVersion");
export const authoredTasks = datasetValue("app/data/identity-registry.mjs#authoredTasks");
export const authoredEntities = datasetValue("app/data/identity-registry.mjs#authoredEntities");
export const authoredGoals = datasetValue("app/data/identity-registry.mjs#authoredGoals");
export const authoredSources = datasetValue("app/data/identity-registry.mjs#authoredSources");
