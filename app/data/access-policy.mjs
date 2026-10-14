import { datasetValue } from "../dataset-runtime.mjs";
// Verified corrections supplement the retained picker data without editing it.
// A free-to-play chunk or dungeon entry does not make every source inside it F2P.
// Keep location-specific restrictions local: the same monster/item may be free
// elsewhere. Evidence is surfaced in access diagnostics rather than hidden in UI.
const verifiedOn = '2026-10-07';
const dungeonEvidence = 'https://runescape.wiki/w/Edgeville_Dungeon';
export const membershipSourcePolicies = datasetValue("app/data/access-policy.mjs#membershipSourcePolicies");
const bySource = new Map(membershipSourcePolicies.map(policy => [`${policy.kind}\u0000${policy.source}`, policy]));

/** A confirmed membership requirement takes precedence over manual admission. */
export function membershipSourceBlocker(kind, source, location, f2p) {
  if (!f2p) return null;
  const policy = bySource.get(`${kind}\u0000${source}`);
  return policy && (!policy.locations || policy.locations.includes(location)) ? policy : null;
}
