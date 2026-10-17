import { createHash } from 'node:crypto';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const safePath = value => Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string'
  && part.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(part));
const fail = detail => { throw new TypeError(`Definition overlay ${detail}`); };
function lookup(root, path) {
  let value = root;
  for (const part of path) {
    if (!plain(value)) fail(`missing parent: ${path.join('/')}`);
    if (!Object.hasOwn(value, part)) return { present: false };
    value = value[part];
  }
  return { present: true, value };
}
function replace(root, path, present, value) {
  const [head, ...tail] = path;
  if (!plain(root)) fail(`missing parent: ${path.join('/')}`);
  const copy = { ...root };
  if (tail.length) copy[head] = replace(root[head], tail, present, value);
  else if (present) copy[head] = structuredClone(value);
  else delete copy[head];
  return copy;
}

/** Versioned operator data, applied atomically without mutating frozen exports.
 * Every changed record has a complete before/after guard. Reapplying is a no-op;
 * a partly matching or drifted record fails instead of silently skipping it. */
export function applyDefinitionOverlays(definitions, overlays = []) {
  let result = definitions;
  for (const overlay of overlays) {
    if (!plain(overlay) || overlay.schemaVersion !== 1 || typeof overlay.id !== 'string' || !overlay.id
      || typeof overlay.version !== 'string' || !overlay.version || !Array.isArray(overlay.patches)) fail('invalid document');
    for (const guard of overlay.guards ?? []) {
      if (!safePath(guard.path) || !/^[a-f0-9]{64}$/.test(guard.sha256 ?? '')) fail('invalid guard');
      const current = lookup(result, guard.path);
      if (!current.present || hash(current.value) !== guard.sha256) fail(`guard drift: ${guard.path.join('/')}`);
    }
    for (const patch of overlay.patches) {
      if (!safePath(patch.path) || typeof patch.beforePresent !== 'boolean' || typeof patch.afterPresent !== 'boolean'
        || patch.beforePresent && (!Object.hasOwn(patch, 'before') || hash(patch.before) !== patch.beforeRecordSha256)
        || patch.afterPresent && !Object.hasOwn(patch, 'after')) fail('invalid patch');
      const current = lookup(result, patch.path);
      const before = current.present === patch.beforePresent && (!current.present || same(current.value, patch.before));
      const after = current.present === patch.afterPresent && (!current.present || same(current.value, patch.after));
      if (!before && !after) fail(`record drift: ${patch.path.join('/')}`);
      if (!after) result = replace(result, patch.path, patch.afterPresent, patch.after);
    }
  }
  return result;
}
