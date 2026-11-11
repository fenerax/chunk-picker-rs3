import { identityDictionaryDelta, identityDictionaryFromDelta, countOwnedFullCopyForTests } from '../tasks/identity-dictionary.mjs';
import { adoptResidentState } from '../core/resident-copy.mjs';
import { validateOwnedBaseReference } from './owned-base-schema.mjs';

const json = JSON.stringify;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safe = key => typeof key === 'string' && key.length && !['__proto__', 'constructor', 'prototype'].includes(key);
function requireShape(value, required, optional = []) {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new TypeError('Invalid owned storage metadata.');
}
function recipeValues(recipe, base, replacements, keyOf) {
  if (!Array.isArray(recipe)) throw new TypeError('Invalid owned order recipe.');
  const result = [], seen = new Set(), used = new Set();
  const add = value => {
    const key = keyOf(value);
    if (!safe(key) || seen.has(key)) throw new TypeError('Duplicate owned recipe key.');
    seen.add(key); result.push(value);
  };
  for (const part of recipe) {
    if (typeof part === 'string') {
      if (!Object.hasOwn(replacements, part)) throw new TypeError('Missing owned delta row.');
      used.add(part); add(replacements[part]);
    } else {
      if (!Array.isArray(part) || part.length !== 2 || !part.every(Number.isSafeInteger)
        || part[0] < 0 || part[1] < 1 || part[0] > base.length - part[1]) throw new TypeError('Invalid owned base span.');
      for (let index = part[0]; index < part[0] + part[1]; index++) add(base[index]);
    }
  }
  if (used.size !== Object.keys(replacements).length) throw new TypeError('Unused owned delta row.');
  return result;
}

/** One shared encoding/index per verified base; per-version caches are weak. */
const codecs = new WeakMap();
export function ownedCodec(base, pin) {
  if (codecs.has(base)) return codecs.get(base);
  const rows = new Map(base.tasks.map((row, index) => [row.id, { row, index, bytes: json(row) }]));
  const taskVersions = new WeakMap(), registryVersions = new WeakMap();
  function tasksDelta(tasks) {
    if (taskVersions.has(tasks)) return taskVersions.get(tasks);
    const replacements = Object.create(null), recipe = [], seen = new Set();
    for (const row of tasks) {
      if (!safe(row.id) || seen.has(row.id)) throw new TypeError('Duplicate owned task ID.');
      seen.add(row.id);
      const original = rows.get(row.id);
      if (original && (original.row === row || original.bytes === json(row))) {
        const last = recipe.at(-1);
        if (Array.isArray(last) && last[0] + last[1] === original.index) last[1]++;
        else recipe.push([original.index, 1]);
      } else { replacements[row.id] = row; recipe.push(row.id); }
    }
    const delta = { replacements, recipe };
    taskVersions.set(tasks, delta);
    return delta;
  }
  function registryDelta(registry) {
    if (registry === undefined) return { present: false };
    if (registryVersions.has(registry)) return registryVersions.get(registry);
    const delta = { present: true, keys: Object.keys(registry), schemaVersion: registry.schemaVersion,
      entries: identityDictionaryDelta(registry.entries, base.identityRegistry.entries),
      aliases: identityDictionaryDelta(registry.aliases, base.identityRegistry.aliases), unresolved: registry.unresolved };
    registryVersions.set(registry, delta);
    return delta;
  }
  function inflateDictionary(delta, baseDictionary, resident) {
    requireShape(delta, ['replacements', 'deleted'], ['order']);
    if (!record(delta.replacements) || !Array.isArray(delta.deleted)
      || delta.deleted.some(key => !safe(key) || !Object.hasOwn(baseDictionary, key))
      || new Set(delta.deleted).size !== delta.deleted.length) throw new TypeError('Invalid owned dictionary delta.');
    for (const key of Object.keys(delta.replacements)) if (!safe(key) || delta.deleted.includes(key)) throw new TypeError('Invalid owned identity replacement.');
    if (Object.hasOwn(delta, 'order') && (!Array.isArray(delta.order) || delta.order.some(key => !safe(key)))) throw new TypeError('Invalid owned dictionary order.');
    if (resident) return identityDictionaryFromDelta(baseDictionary, delta);
    countOwnedFullCopyForTests();
    const result = { ...baseDictionary };
    for (const key of delta.deleted) delete result[key];
    for (const [key, value] of Object.entries(delta.replacements)) {
      if (!safe(key) || delta.deleted.includes(key)) throw new TypeError('Invalid owned identity replacement.');
      result[key] = value;
    }
    if (!Object.hasOwn(delta, 'order')) return result;
    if (!Array.isArray(delta.order) || delta.order.length !== Object.keys(result).length
      || new Set(delta.order).size !== delta.order.length || delta.order.some(key => !Object.hasOwn(result, key))) throw new TypeError('Invalid owned dictionary order.');
    const ordered = Object.fromEntries(delta.order.map(key => [key, result[key]]));
    if (json(Object.keys(ordered)) !== json(delta.order)) throw new TypeError('Invalid owned dictionary enumeration order.');
    return ordered;
  }
  const codec = {
    encode(state) {
      const { tasks, identityRegistry, ...payload } = state;
      return { state: payload, storage: { schemaVersion: 2, base: { datasetDigest: pin.dataset.digest, sha256: pin.sha256 },
        delta: { keys: Object.keys(state), tasks: tasksDelta(tasks), identityRegistry: registryDelta(identityRegistry) } } };
    },
    decode(document, { resident = false } = {}) {
      const { storage, state } = document;
      requireShape(storage, ['schemaVersion', 'base', 'delta'], ['fields']);
      if (storage.schemaVersion !== 2) throw new TypeError('Unsupported owned storage version.');
      validateOwnedBaseReference(storage.base, pin);
      requireShape(storage.delta, ['keys', 'tasks', 'identityRegistry']);
      if (!record(state) || Object.hasOwn(state, 'tasks') || Object.hasOwn(state, 'identityRegistry')) throw new TypeError('Invalid owned state payload.');
      const { tasks, identityRegistry, keys } = storage.delta;
      requireShape(tasks, ['replacements', 'recipe']);
      if (!record(tasks.replacements) || Object.entries(tasks.replacements).some(([id, row]) => !safe(id) || !record(row) || row.id !== id)) throw new TypeError('Invalid owned task replacement.');
      const payload = { ...state, tasks: recipeValues(tasks.recipe, base.tasks, tasks.replacements, row => row.id) };
      if (identityRegistry?.present === false) requireShape(identityRegistry, ['present']);
      else {
        requireShape(identityRegistry, ['present', 'keys', 'schemaVersion', 'entries', 'aliases', 'unresolved']);
        if (identityRegistry.present !== true) throw new TypeError('Invalid owned registry presence.');
        const registry = { schemaVersion: identityRegistry.schemaVersion,
          entries: inflateDictionary(identityRegistry.entries, base.identityRegistry.entries, resident),
          aliases: inflateDictionary(identityRegistry.aliases, base.identityRegistry.aliases, resident), unresolved: identityRegistry.unresolved };
        payload.identityRegistry = ordered(registry, identityRegistry.keys);
      }
      const logical = ordered(payload, keys);
      return { ...document, state: resident ? adoptResidentState(logical, base) : structuredClone(logical) };
    },
  };
  codecs.set(base, codec);
  return codec;
}
function ordered(value, keys) {
  if (!Array.isArray(keys) || keys.length !== Object.keys(value).length || new Set(keys).size !== keys.length
    || keys.some(key => !safe(key) || !Object.hasOwn(value, key))) throw new TypeError('Invalid owned presence/order keys.');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
