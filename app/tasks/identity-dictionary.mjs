// Resident-only dictionaries. No Proxy, inherited keys or implicit JSON view.
const versions = new WeakMap(), roots = new WeakMap(), frozenTrees = new WeakSet();
const removed = Symbol('removed');
const indexKey = key => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295;
let callsForTests;
/** Synchronous, opt-in call counts; never a timing assertion or live-path hook. */
export function withIdentityDictionaryCallCountsForTests(callback) {
  const previous = callsForTests, counts = { value: 0, keys: 0, entries: 0, validationEntries: 0 };
  callsForTests = counts;
  try { return callback(counts); }
  finally { callsForTests = previous; }
}
class IdentityDictionary {
  toJSON() { throw new TypeError('Materialize resident identities explicitly'); }
}
Object.freeze(IdentityDictionary.prototype);
function version(data) {
  const view = Object.freeze(new IdentityDictionary());
  versions.set(view, data);
  return view;
}
export const isIdentityDictionary = value => versions.has(value);
export function identityValue(dictionary, key) {
  if (callsForTests) callsForTests.value++;
  const data = versions.get(dictionary);
  if (!data) return dictionary?.[key];
  const value = data.edits.has(key) ? data.edits.get(key) : Object.hasOwn(data.base, key) ? data.base[key] : undefined;
  return value === removed ? undefined : value;
}
export function* identityKeys(dictionary) {
  if (callsForTests) callsForTests.keys++;
  const data = versions.get(dictionary);
  if (!data) { yield* Object.keys(dictionary ?? {}); return; }
  if (data.order) { yield* data.order; return; }
  // Object.keys orders array-index spellings numerically, even after reinsertion.
  const extra = [...data.tail].filter(indexKey).sort((a, b) => Number(a) - Number(b));
  let cursor = 0;
  for (const key of data.keys) if (indexKey(key)) {
    while (cursor < extra.length && Number(extra[cursor]) < Number(key)) yield extra[cursor++];
    if (extra[cursor] === key) cursor++;
    if (identityValue(dictionary, key) !== undefined) yield key;
  }
  yield* extra.slice(cursor);
  for (const key of data.keys) if (!indexKey(key) && !data.tail.has(key) && data.edits.get(key) !== removed) yield key;
  for (const key of data.tail) if (!indexKey(key)) yield key;
}
export function* identityEntries(dictionary) {
  if (callsForTests) callsForTests.entries++;
  for (const key of identityKeys(dictionary)) yield [key, identityValue(dictionary, key)];
}
/** Validation caches are role-specific WeakSets, never key/value indexes. A
 * verified immutable base is checked once; each new version checks its edits. */
export function* identityValidationEntries(dictionary, checked) {
  if (callsForTests) callsForTests.validationEntries++;
  const data = versions.get(dictionary);
  if (!data) { yield* identityEntries(dictionary); return; }
  if (!checked.has(data.base)) { yield* Object.entries(data.base); checked.add(data.base); }
  for (const [key, value] of data.edits) if (value !== removed) yield [key, value];
}
export function freezeIdentityTree(value) {
  if (value && typeof value === 'object' && !frozenTrees.has(value)) {
    frozenTrees.add(value);
    for (const child of Object.values(value)) freezeIdentityTree(child);
    Object.freeze(value);
  }
  return value;
}
/** Base must be deeply frozen by the verified-base boundary. Keys are indexed
 * once per base dictionary, never once per group or version. */
export function createIdentityDictionary(base, source = base) {
  if (!Object.isFrozen(base)) throw new TypeError('Identity base must be frozen');
  let root = roots.get(base);
  if (!root) {
    function frozen(value) {
      if (value && typeof value === 'object') {
        if (!Object.isFrozen(value)) throw new TypeError('Identity base must be deeply frozen');
        for (const child of Object.values(value)) frozen(child);
      }
    }
    frozen(base);
    root = version({ base, keys: Object.freeze(Object.keys(base)), edits: new Map(), tail: new Set() });
    roots.set(base, root);
  }
  if (source === base) return root;
  const changes = [];
  for (const key of identityKeys(base)) if (!Object.hasOwn(source, key)) changes.push({ key, delete: true });
  for (const [key, value] of Object.entries(source)) if (JSON.stringify(value) !== JSON.stringify(base[key])) changes.push({ key, value });
  const result = changes.length ? editIdentityDictionary(root, changes) : root, keys = Object.keys(source);
  if (JSON.stringify([...identityKeys(result)]) !== JSON.stringify(keys)) return version({ ...versions.get(result), order: Object.freeze(keys) });
  return result;
}
export function reconcileIdentityDictionary(previous, source) {
  return createIdentityDictionary(versions.get(previous).base, source);
}
/** A new immutable version; only delta containers and touched values are copied.
 * Deleting and reinserting a key follows ordinary JSON dictionary ordering. */
export function editIdentityDictionary(previous, changes) {
  const data = versions.get(previous);
  if (!data) throw new TypeError('Expected a resident identity dictionary');
  const next = { ...data, edits: new Map(data.edits), tail: new Set(data.tail), order: data.order && [...data.order] };
  const result = version(next);
  for (const change of changes) {
    const { key } = change;
    if (typeof key !== 'string' || !key.trim() || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe identity key');
    const exists = identityValue(result, key) !== undefined;
    if (change.delete === true) {
      next.edits.set(key, removed); next.tail.delete(key);
      if (next.order) next.order = next.order.filter(value => value !== key);
    } else {
      if (change.value === undefined) throw new TypeError('Identity value must be JSON');
      next.edits.set(key, freezeIdentityTree(structuredClone(change.value)));
      if (!exists) {
        next.tail.add(key);
        if (next.order) {
          next.order.push(key);
          next.order = [...next.order.filter(indexKey).sort((a, b) => Number(a) - Number(b)), ...next.order.filter(value => !indexKey(value))];
        }
      }
    }
  }
  if (next.order) Object.freeze(next.order);
  return result;
}
/** Detached flat JSON for portable/hook/worker boundaries. Callers validate the
 * complete logical state before accepting untrusted input. No retained cache. */
export function materializeIdentities(value) {
  function project(item) {
    if (isIdentityDictionary(item)) return Object.fromEntries(identityEntries(item));
    if (Array.isArray(item)) return item.map(project);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, project(child)]));
    return item;
  }
  return JSON.parse(JSON.stringify(project(value)));
}
