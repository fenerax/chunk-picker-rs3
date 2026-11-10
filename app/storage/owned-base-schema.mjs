// Inert format-2 contracts. Existing save readers/writers do not import this module.
export const OWNED_STORAGE_SCHEMA_VERSION = 2;
export const OWNED_BASE_FORMAT = 1;
export const OWNED_BASE_GENERATOR_VERSION = 1;
export const OWNED_BASE_LIMITS = Object.freeze({ compressedBytes: 32 * 1024 ** 2, bytes: 128 * 1024 ** 2,
  tasks: 250000, entries: 500000, aliases: 1000000, depth: 32 });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const baseFailure = message => { throw new TypeError(`Invalid owned catalogue base: ${message}`); };
function keys(value, required, optional = []) {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) baseFailure('schema');
}
const uniqueText = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;

/** Detached JSON only: reject coercions/accessors rather than silently losing data. */
export function copyBaseJson(value, depth = 0, maxDepth = OWNED_BASE_LIMITS.depth) {
  if (depth > maxDepth) baseFailure('JSON depth limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!Array.isArray(value) && !record(value)) baseFailure('JSON value');
  const names = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'));
  if (Array.isArray(value) && (names.length !== value.length || names.some((key, i) => key !== String(i)))) baseFailure('JSON array');
  const entries = names.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
      || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) baseFailure('JSON property');
    return [key, copyBaseJson(descriptor.value, depth + 1, maxDepth)];
  });
  return Object.freeze(Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries));
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
export function validateOwnedBase(value, limits = OWNED_BASE_LIMITS) {
  keys(value, ['baseFormat', 'generatorVersion', 'dataset', 'tasks', 'identityRegistry']);
  validateOwnedDataset(value.dataset);
  if (value.baseFormat !== OWNED_BASE_FORMAT || value.generatorVersion !== OWNED_BASE_GENERATOR_VERSION) baseFailure('version');
  if (!Array.isArray(value.tasks) || value.tasks.length > limits.tasks) baseFailure('task limit');
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
  keys(registry, ['schemaVersion', 'entries', 'aliases', 'unresolved']);
  if (registry.schemaVersion !== 1 || !record(registry.entries) || !record(registry.aliases)
    || !Array.isArray(registry.unresolved) || registry.unresolved.length) baseFailure('identity registry');
  if (Object.keys(registry.entries).length > limits.entries || Object.keys(registry.aliases).length > limits.aliases) baseFailure('identity limit');
  for (const [id, entry] of Object.entries(registry.entries)) {
    if (!text(id) || /^(?:custom:|rs3:task:custom:)/.test(id) || !record(entry) || !text(entry.label) || !text(entry.kind)
      || (Object.hasOwn(entry, 'id') && entry.id !== id)
      || (Object.hasOwn(entry, 'category') && !text(entry.category))
      || (Object.hasOwn(entry, 'aliases') && !uniqueText(entry.aliases))) baseFailure('identity entry');
  }
  for (const [alias, targets] of Object.entries(registry.aliases)) {
    if (!text(alias) || !(typeof targets === 'string' ? text(targets) : uniqueText(targets))) baseFailure('identity alias');
  }
}
