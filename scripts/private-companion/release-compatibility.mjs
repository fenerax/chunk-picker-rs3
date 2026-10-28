import { assertPreserved, assertStableIdentities } from './release-pack-check.mjs';
import { digestValue } from './release-identity.mjs';

// Infer candidates only from new saved keys. The existing strict validator
// proves both newly authored status and that every other resolution is intact.
export function deriveSavedIdentityAdditions(before, after) {
  const additions = Object.keys(after.saved).sort().flatMap(key => {
    const resolution = after.saved[key], target = resolution?.id;
    return !Object.hasOwn(before.saved, key) && resolution?.status === 'resolved'
      && after.datasetAuthored?.[key] === target && after.datasetAuthored?.[target] === target
      && !Object.hasOwn(before.datasetAuthored ?? {}, target)
      ? [{ key, target }] : [];
  });
  assertStableIdentities(before, after, additions);
  return additions;
}

// Shared by PC and Linux: only the first forward opening may add identities.
// Every later opening must also retain the complete saved registry.
export function assertCompatibleStep(before, after, { forward = false, declaredAdditions } = {}) {
  if (after.tasksServed !== true) throw new Error('Compatibility probe did not serve tasks.');
  if (after.migrationSummary?.lostRecords !== 0) throw new Error('Migration reports lost saved records.');
  if (!before) return [];
  const additions = forward ? deriveSavedIdentityAdditions(before, after) : [];
  if (!forward) assertStableIdentities(before, after);
  if (declaredAdditions !== undefined && digestValue(additions) !== digestValue(declaredAdditions)) {
    throw new Error('Derived saved identity additions differ from the reviewed list.');
  }
  assertPreserved(before, after);
  if (!forward && before.registryDigest !== after.registryDigest) throw new Error('Reopening changed saved registry data.');
  return additions;
}
