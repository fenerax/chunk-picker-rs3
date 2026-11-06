import { createHash } from 'node:crypto';

const reusableFields = new Set(['tasks', 'identityRegistry', 'legacy']);
const object = value => value !== null && typeof value === 'object';
const digestJSON = bytes => createHash('sha256').update(bytes).digest('hex');

/** Private storage cache only: inputs are valid JSON, and reused object trees
 * are immutable. Commands and validated hook outputs replace changed trees.
 * Public mutable objects must cross storage's ownership boundary first. */
export function createGameplayFingerprint() {
  const staticDigests = new WeakMap(), provenanceDigests = new WeakMap();
  let previousState, previousFingerprint;
  const fieldDigest = (key, value, serialized) => {
    if (key === 'provenance' && object(value)) {
      if (provenanceDigests.has(value)) return provenanceDigests.get(value);
      const { historyArchive, ...gameplay } = value;
      const digest = Object.keys(gameplay).length ? digestJSON(serialized !== undefined && !Object.hasOwn(value, 'historyArchive')
        ? serialized : JSON.stringify(gameplay)) : undefined;
      provenanceDigests.set(value, digest);
      return digest;
    }
    const reusable = reusableFields.has(key) && object(value);
    if (reusable && staticDigests.has(value)) return staticDigests.get(value);
    const bytes = serialized ?? JSON.stringify(value);
    const digest = bytes === undefined ? undefined : digestJSON(bytes);
    if (reusable) staticDigests.set(value, digest);
    return digest;
  };
  const fingerprint = state => {
    if (!object(state) || Array.isArray(state)) throw new TypeError('Gameplay fingerprint requires a private state object');
    if (state === previousState) return previousFingerprint;
    const fields = [];
    for (const [key, original] of Object.entries(state)) {
      if (key === 'revision' || key === 'history' || key === 'taskClaims' || key === 'progressSnapshots' || key === 'finishLine' || key === 'groupGoals' || key === 'ruleReviews') continue;
      const value = key === 'members' && Array.isArray(original)
        // Preferences, the journal and planning colours never change task results.
        ? original.map(({ preferences, journal, chunkColours, chunkColourNames, ...member }) => member) : original;
      const digest = fieldDigest(key, value);
      if (digest !== undefined) fields.push([key, digest]);
    }
    previousFingerprint = digestJSON(JSON.stringify(fields));
    previousState = state;
    return previousFingerprint;
  };
  // Import workers own the exact validated publication. Carry only its large
  // field digests back, then bind them to the writer's newly hydrated trees.
  // Reuse private durable JSON where it has the same projection. Provenance
  // with retained History references still needs the existing exclusion.
  fingerprint.exportStatic = (state, serializedFields) => Object.fromEntries([...reusableFields, 'provenance']
    .filter(key => object(state[key])).map(key => [key, fieldDigest(key, state[key], serializedFields?.get(state[key]))]));
  fingerprint.seedStatic = (state, digests) => {
    for (const key of [...reusableFields, 'provenance']) if (object(state[key]) && Object.hasOwn(digests, key)) {
      (key === 'provenance' ? provenanceDigests : staticDigests).set(state[key], digests[key]);
    }
  };
  return fingerprint;
}
