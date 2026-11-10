// Inert format-2 contracts. Existing save readers/writers do not import this module.
export const OWNED_STORAGE_SCHEMA_VERSION = 2;
export const OWNED_BASE_FORMAT = 1;
export const OWNED_BASE_GENERATOR_VERSION = 1;
export const OWNED_BASE_LIMITS = Object.freeze({ compressedBytes: 32 * 1024 ** 2, bytes: 128 * 1024 ** 2,
  tasks: 250000, entries: 500000, aliases: 1000000, depth: 32, nodes: 4000000 });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const baseFailure = message => { throw new TypeError(`Invalid owned catalogue base: ${message}`); };
function keys(value, required, optional = []) {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key))) baseFailure('schema');
  let count = 0;
  for (const key in value) if (Object.hasOwn(value, key)) {
    if (!required.includes(key) && !optional.includes(key)) baseFailure('schema');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value')) baseFailure('JSON property');
    count++;
  }
  if (Reflect.ownKeys(value).length !== count) baseFailure('JSON property');
}
const uniqueText = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;

function countKeys(value, maximum, message) {
  let count = 0;
  // Do not allocate Object.keys/entries arrays before checking dictionary budgets.
  for (const key in value) if (Object.hasOwn(value, key) && ++count > maximum) baseFailure(message);
}
function walkBaseJson(value, limits, mode, startDepth = 0) {
  let remaining = limits.nodes, remainingKeys = limits.nodes - 1;
  function visit(value, depth) {
    if (depth > limits.depth) baseFailure('JSON depth limit');
    if (--remaining < 0) baseFailure('JSON node limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    const array = Array.isArray(value);
    if (!array && !record(value)) baseFailure('JSON value');
    // Reserve child key slots globally, including siblings not visited yet. Otherwise
    // nested wide objects could retain depth * nodes keys before visiting those siblings.
    const room = Math.min(remaining, remainingKeys);
    if (array && value.length > room) baseFailure('JSON node limit');
    if (!array) countKeys(value, room, 'JSON node limit');
    const names = Reflect.ownKeys(value);
    const children = names.length - (array ? 1 : 0);
    if (children > room) baseFailure('JSON node limit');
    remainingKeys -= children;
    if (array && names.length !== value.length + 1) baseFailure('JSON array');
    const result = mode === 'copy' ? (array ? [] : {}) : value;
    let index = 0;
    for (const key of names) {
      if (array && key === 'length') continue;
      if (array && key !== String(index++)) baseFailure('JSON array');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
        || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) baseFailure('JSON property');
      const child = visit(descriptor.value, depth + 1);
      if (mode === 'copy') result[key] = child;
    }
    return mode === 'check' ? result : Object.freeze(result);
  }
  return visit(value, startDepth);
}
/** Check without allocating a second tree; freeze only data owned by the caller. */
export const checkBaseJson = (value, limits) => walkBaseJson(value, limits, 'check');
export const freezeBaseJson = (value, limits) => walkBaseJson(value, limits, 'freeze');
/** Detached JSON only: bounded copying, with no per-property tuple arrays. */
export function copyBaseJson(value, depth = 0, maxDepth = OWNED_BASE_LIMITS.depth, maxNodes = OWNED_BASE_LIMITS.nodes) {
  return walkBaseJson(value, { depth: maxDepth, nodes: maxNodes }, 'copy', depth);
}
export function ownedBaseLimits(overrides = {}) {
  keys(overrides, [], Object.keys(OWNED_BASE_LIMITS));
  const limits = { ...OWNED_BASE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > OWNED_BASE_LIMITS[key]) baseFailure('limits');
  return limits;
}
export function validateOwnedDataset(value) {
  keys(value, ['id', 'contractVersion', 'digest']);
  if (!text(value.id) || !Number.isSafeInteger(value.contractVersion) || value.contractVersion < 1 || !hash(value.digest)) baseFailure('dataset identity');
}
export function validateOwnedBasePin(value) {
  keys(value, ['dataset', 'sha256', 'generatorVersion']); validateOwnedDataset(value.dataset);
  if (!hash(value.sha256) || value.generatorVersion !== OWNED_BASE_GENERATOR_VERSION) baseFailure('release pin');
}
/** A release binds each dataset digest to exactly one base and builder version. */
export function createOwnedBaseManifest(pins) {
  if (!Array.isArray(pins)) baseFailure('release manifest');
  const bases = Object.create(null);
  for (const input of pins) {
    const pin = copyBaseJson(input); validateOwnedBasePin(pin);
    if (Object.hasOwn(bases, pin.dataset.digest)) baseFailure('duplicate dataset pin');
    bases[pin.dataset.digest] = pin;
  }
  return copyBaseJson({ schemaVersion: 1, bases });
}
export function resolveOwnedBasePin(manifest, dataset) {
  validateOwnedDataset(dataset); keys(manifest, ['schemaVersion', 'bases']);
  if (manifest.schemaVersion !== 1 || !record(manifest.bases)) baseFailure('release manifest');
  for (const [digest, pin] of Object.entries(manifest.bases)) {
    validateOwnedBasePin(pin);
    if (digest !== pin.dataset.digest) baseFailure('release manifest key');
  }
  const pin = manifest.bases[dataset.digest];
  if (!pin || pin.dataset.id !== dataset.id || pin.dataset.contractVersion !== dataset.contractVersion) baseFailure('dataset pin mismatch');
  return copyBaseJson(pin);
}
/** Only the base-reference part of storage schema 2; delta codecs land later. */
export function validateOwnedBaseReference(value, pin) {
  validateOwnedBasePin(pin); keys(value, ['datasetDigest', 'sha256']);
  if (value.datasetDigest !== pin.dataset.digest || value.sha256 !== pin.sha256) baseFailure('base reference mismatch');
}
/** Check shapes and cardinalities before any recursive walk, clone or freeze. */
export function validateOwnedBaseStructure(value, limits = OWNED_BASE_LIMITS, projection = false) {
  keys(value, projection ? ['dataset', 'tasks', 'identityRegistry'] : ['baseFormat', 'generatorVersion', 'dataset', 'tasks', 'identityRegistry']);
  validateOwnedDataset(value.dataset);
  if (!projection && (value.baseFormat !== OWNED_BASE_FORMAT || value.generatorVersion !== OWNED_BASE_GENERATOR_VERSION)) baseFailure('version');
  if (!Array.isArray(value.tasks) || value.tasks.length > limits.tasks) baseFailure('task limit');
  const registry = value.identityRegistry;
  keys(registry, ['schemaVersion', 'entries', 'aliases', 'unresolved']);
  if (registry.schemaVersion !== 1 || !record(registry.entries) || !record(registry.aliases)
    || !Array.isArray(registry.unresolved) || registry.unresolved.length) baseFailure('identity registry');
  countKeys(registry.entries, limits.entries, 'identity limit');
  countKeys(registry.aliases, limits.aliases, 'identity limit');
}
export function validateOwnedBase(value, limits = OWNED_BASE_LIMITS) {
  validateOwnedBaseStructure(value, limits);
  const ids = new Set();
  for (const task of value.tasks) {
    keys(task, ['id', 'label', 'category'], ['completionIds', 'skill', 'level']);
    if (![task.id, task.label, task.category].every(text) || ids.has(task.id)
      || /^(?:custom:|rs3:task:custom:)/.test(task.id)) baseFailure('task row');
    if (Object.hasOwn(task, 'completionIds') && !uniqueText(task.completionIds)) baseFailure('completion IDs');
    if (Object.hasOwn(task, 'skill') && (!text(task.skill) || task.skill !== task.category)) baseFailure('task skill');
    if (Object.hasOwn(task, 'level') && (!Object.hasOwn(task, 'skill') || !Number.isSafeInteger(task.level) || task.level < 1 || task.level > 120)) baseFailure('task level');
    ids.add(task.id);
  }
  const registry = value.identityRegistry;
  for (const id in registry.entries) {
    if (!Object.hasOwn(registry.entries, id)) continue;
    const entry = registry.entries[id];
    if (!text(id) || /^(?:custom:|rs3:task:custom:)/.test(id) || !record(entry) || !text(entry.label) || !text(entry.kind)
      || (Object.hasOwn(entry, 'id') && entry.id !== id)
      || (Object.hasOwn(entry, 'category') && !text(entry.category))
      || (Object.hasOwn(entry, 'aliases') && !uniqueText(entry.aliases))) baseFailure('identity entry');
  }
  for (const alias in registry.aliases) {
    if (!Object.hasOwn(registry.aliases, alias)) continue;
    const targets = registry.aliases[alias];
    if (!text(alias) || !(typeof targets === 'string' ? text(targets) : uniqueText(targets))) baseFailure('identity alias');
  }
}
