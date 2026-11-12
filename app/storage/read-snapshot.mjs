import { freezeIdentityTree, materializeIdentities } from '../tasks/identity-dictionary.mjs';

/** A reader owns frozen copies of fields it actually visits. Unchanged field
 * identities reuse those copies across revisions. Never freeze storage's mutable
 * normalization inputs, or let a reader acquire a reference to them. */
export function createReadSnapshot(copy = structuredClone) {
  const fields = new WeakMap();
  function field(value, key) {
    if (value === null || typeof value !== 'object') return value;
    if (!fields.has(value)) fields.set(value, freezeIdentityTree(key === 'identityRegistry'
      ? materializeIdentities(value) : copy(value)));
    return fields.get(value);
  }
  return source => Object.freeze(Object.defineProperties({}, Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, { enumerable: true, get: () => field(value, key) }]))));
}
