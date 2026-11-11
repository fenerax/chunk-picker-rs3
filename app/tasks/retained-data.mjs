import { identityRetentionRoots, isIdentityDictionary } from './identity-dictionary.mjs';

// Conservative data-graph charge, never a heap subtraction. Explicit roots
// must include closure-owned data; functions themselves receive fixed slack.
// A fresh walk deduplicates object identities and complete backing allocations.
export function retainedDataBytes(roots) {
  const seen = new WeakSet();
  let bytes = 0;
  function visit(value) {
    if (typeof value === 'string') { bytes += 32 + 2 * value.length; return; }
    if (value === null || !['object', 'function'].includes(typeof value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'function') { bytes += 256; return; }
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) { bytes += 64 + value.byteLength; return; }
    if (ArrayBuffer.isView(value)) { bytes += 128; visit(value.buffer); return; }
    if (isIdentityDictionary(value)) {
      bytes += 256;
      visit(identityRetentionRoots(value));
      return;
    }
    if (value instanceof Map || value instanceof Set) {
      bytes += 128 + value.size * 64;
      if (value instanceof Map) for (const [key, child] of value) { visit(key); visit(child); }
      else for (const child of value) visit(child);
      return;
    }
    if (Array.isArray(value)) { bytes += 64 + value.length * 16; for (const child of value) visit(child); return; }
    bytes += 64;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      bytes += 32; visit(key);
      if ('value' in descriptor) visit(descriptor.value);
      else { visit(descriptor.get); visit(descriptor.set); }
    }
  }
  for (const root of roots) visit(root);
  return Math.ceil(bytes / 8) * 8;
}

export function createStateSnapshotCache({ maxEntries = 2, maxBytes = null, onEvict = () => {} } = {}) {
  if (![maxEntries, maxBytes].every(n => n === null || Number.isSafeInteger(n) && n >= 0)) throw new TypeError('Invalid state input cap.');
  const byteCeiling = maxBytes ?? Infinity, entryCeiling = maxEntries ?? Infinity;
  const rows = new Map(), sizes = new WeakMap();
  let bytes = 0;
  function remove(key, notify = true) {
    const row = rows.get(key); if (!row) return;
    rows.delete(key); bytes -= row.bytes; if (notify) onEvict(key);
  }
  return Object.freeze({
    get(key) { const row = rows.get(key); if (row) { rows.delete(key); rows.set(key, row); } return row?.state; },
    set(key, state) {
      remove(key, false);
      let cost = sizes.get(state);
      if (cost === undefined) { cost = retainedDataBytes([state]); sizes.set(state, cost); }
      cost += retainedDataBytes([key]) + 256;
      if (!entryCeiling || cost > byteCeiling) { onEvict(key); return; }
      while (rows.size >= entryCeiling || bytes + cost > byteCeiling) remove(rows.keys().next().value);
      rows.set(key, { state, bytes: cost }); bytes += cost;
    },
    get size() { return rows.size; }, get bytes() { return bytes; },
    retentionLedger() {
      if (rows.size > entryCeiling || bytes > byteCeiling) throw new Error('State input retention cap exceeded.');
      return { owner: 'stateSnapshots', complete: maxBytes !== null && maxEntries !== null, dimensions: [
        { unit: 'entries', used: rows.size, cap: maxEntries, enforced: maxEntries !== null },
        { unit: 'chargeBytes', used: bytes, cap: maxBytes, enforced: maxBytes !== null }],
      accounting: 'Conservative input graph bytes, including resident identity payloads and keys. Each input is charged independently, never converted to V8 heap bytes.' };
    },
  });
}
