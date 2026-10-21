import { datasetJSON } from "../dataset-runtime.mjs";
import { createHash } from 'node:crypto';
const evidence = await datasetJSON("app/data/equipment-corrections.2026-10-08.v1.json");
const weightEvidence = await datasetJSON("app/data/equipment-weights.2026-10-08.v1.json");

export const equipmentCorrections = evidence.corrections;
export const equipmentIdentities = evidence.identities;
export const equipmentWeights = Object.entries(weightEvidence.records).map(([name, row]) => ({ name, ...row }));
const numericFields = new Set(['tier', 'armour', 'prayer', 'accuracy', 'auto_damage', 'melee_damage', 'ranged_damage', 'magic_damage', 'necromancy_damage', 'lp', 'attack_speed_ticks', 'attack_range']);
const slots = new Set(['head', 'back', 'neck', 'body', 'torso', 'legs', 'hands', 'feet', 'ring', 'ammo', 'pocket', 'aura', 'main hand weapon', 'off-hand weapon', '2h weapon', 'off-hand']);
const skills = new Set('Attack Strength Defence Constitution Ranged Prayer Magic Runecrafting Crafting Mining Smithing Fishing Cooking Firemaking Woodcutting Fletching Dungeoneering Agility Herblore Thieving Farming Hunter Slayer Divination Construction Archaeology Summoning Invention Necromancy'.split(' '));
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function correctionPath(field, value) {
  const path = String(field).split('.');
  if (path.some(key => !key || unsafe.has(key))) throw new TypeError(`Unsafe equipment field: ${field}`);
  if (path.length === 1 && field === 'members' && typeof value === 'boolean') return path;
  if (path.length === 1 && field === 'slot' && slots.has(value)) return path;
  if (path.length === 1 && numericFields.has(field) && typeof value === 'number' && Number.isFinite(value) && value >= 0) return path;
  if (path.length === 2 && path[0] === 'requirements' && skills.has(path[1]) && Number.isSafeInteger(value) && value >= 0) return path;
  throw new TypeError(`Unsupported equipment correction: ${field}`);
}

function valueAt(record, path) {
  let value = record;
  for (const key of path) {
    if (value == null || !Object.hasOwn(value, key)) return { present: false, value: null };
    value = value[key];
  }
  return { present: true, value };
}
const matches = (actual, value, present = value !== null) => actual.present === present && (!present || equal(actual.value, value));

/** Reviewed equipment inputs only. Game IDs describe provenance; the picker's
 * permanent item/task identities and authored labels remain unchanged.
 * Each record is atomic, immutable and idempotent, following the metadata overlay.
 */
export function applyEquipmentCorrections(definitions, options = {}) {
  const custom = options.corrections !== undefined || options.weights !== undefined || options.identities !== undefined;
  const corrections = options.corrections ?? (custom ? [] : equipmentCorrections);
  const weightRows = options.weights ?? (custom ? [] : equipmentWeights);
  const weights = Array.isArray(weightRows) ? weightRows : Object.entries(weightRows).map(([name, row]) => ({ name, ...row }));
  const identities = options.identities ?? (custom ? [] : equipmentIdentities);
  const strict = options.strict ?? false;
  const correctionByName = new Map(corrections.map(row => [row.name, row]));
  const weightByName = new Map(weights.map(row => [row.name, row]));
  const identityByName = new Map(identities.map(row => [row.name, row]));
  const baselineHashes = new Map();
  function baselineHash(name) {
    if (baselineHashes.has(name)) return baselineHashes.get(name);
    const record = { ...definitions.equipment[name] };
    // Reconstruct the reviewed input for a serialized, already applied overlay.
    // Unrelated authored edits remain in this projection and fail its fingerprint.
    for (const change of correctionByName.get(name)?.changes ?? []) {
      const path = correctionPath(change.field, change.after);
      if (!matches(valueAt(record, path), change.after, change.afterPresent)) continue;
      let target = record;
      for (const key of path.slice(0, -1)) { target[key] = { ...target[key] }; target = target[key]; }
      const key = path.at(-1);
      if (change.beforePresent === false || change.before === null && change.beforePresent !== true) delete target[key];
      else target[key] = change.before;
    }
    const weight = weightByName.get(name);
    if (weight) for (const key of ['weight', 'inventoryWeight', 'wornWeight']) {
      if (Object.hasOwn(record, key) && equal(record[key], weight[key])) {
        if (key === 'weight' && weight.beforePresent === true) record[key] = weight.before;
        else delete record[key];
      }
    }
    const identity = identityByName.get(name) ?? correctionByName.get(name);
    if (identity && record.cacheIdentity?.id === identity.cacheId && record.cacheIdentity?.variant === identity.variant) delete record.cacheIdentity;
    const value = hash(record);
    baselineHashes.set(name, value);
    return value;
  }
  let result = definitions;
  function replace(name, record) {
    if (result === definitions) result = { ...definitions, equipment: { ...definitions.equipment } };
    result.equipment[name] = record;
  }
  for (const correction of corrections) {
    const original = result?.equipment?.[correction.name];
    if (!original) {
      if (strict) throw new TypeError(`Missing equipment correction target: ${correction.name}`);
      continue;
    }
    if (correction.beforeRecordSha256 && baselineHash(correction.name) !== correction.beforeRecordSha256) {
      if (strict) throw new TypeError(`Equipment correction identity drift: ${correction.name}`);
      continue;
    }
    const changes = correction.changes.map(change => ({ ...change, path: correctionPath(change.field, change.after) }));
    if (changes.some(change => {
      const actual = valueAt(original, change.path);
      return !matches(actual, change.before, change.beforePresent) && !matches(actual, change.after, change.afterPresent);
    })) {
      if (strict) throw new TypeError(`Equipment correction drift: ${correction.name}`);
      continue;
    }
    let record = original;
    for (const change of changes) {
      if (matches(valueAt(record, change.path), change.after, change.afterPresent)) continue;
      if (record === original) record = { ...original };
      let target = record;
      for (const key of change.path.slice(0, -1)) { target[key] = { ...target[key] }; target = target[key]; }
      target[change.path.at(-1)] = change.after;
    }
    if (record !== original) replace(correction.name, record);
  }
  for (const row of weights) {
    const original = result?.equipment?.[row.name];
    if (!original) {
      if (strict) throw new TypeError(`Missing equipment weight target: ${row.name}`);
      continue;
    }
    if (typeof row.weight !== 'number' || !Number.isFinite(row.weight)) throw new TypeError(`Invalid equipment weight: ${row.name}`);
    const actual = valueAt(original, ['weight']);
    if (row.equipmentBeforeSha256 && baselineHash(row.name) !== row.equipmentBeforeSha256) {
      if (strict) throw new TypeError(`Equipment weight identity drift: ${row.name}`);
      continue;
    }
    if (actual.present && actual.value !== null && !equal(actual.value, row.weight)) {
      if (strict) throw new TypeError(`Equipment weight drift: ${row.name}`);
      continue;
    }
    const fields = { weight: row.weight };
    for (const field of ['inventoryWeight', 'wornWeight']) if (typeof row[field] === 'number' && Number.isFinite(row[field])) fields[field] = row[field];
    if (Object.entries(fields).some(([key, value]) => !equal(original[key], value))) replace(row.name, { ...original, ...fields });
  }
  for (const row of identities) {
    const original = definitions?.equipment?.[row.name];
    if (!original) {
      if (strict) throw new TypeError(`Missing equipment identity target: ${row.name}`);
      continue;
    }
    const identity = { id: row.cacheId, variant: row.variant, wiki: row.wiki };
    const current = result.equipment[row.name];
    if (equal(current.cacheIdentity, identity)) continue;
    // A same-name custom row does not inherit a verified game's identity.
    if (row.beforeRecordSha256 && baselineHash(row.name) !== row.beforeRecordSha256) {
      if (strict) throw new TypeError(`Equipment identity drift: ${row.name}`);
      continue;
    }
    if (!Number.isSafeInteger(row.cacheId) || row.cacheId < 0 || typeof row.variant !== 'string') throw new TypeError(`Invalid equipment identity: ${row.name}`);
    replace(row.name, { ...current, cacheIdentity: identity });
  }
  return result;
}
