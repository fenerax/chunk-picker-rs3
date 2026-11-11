// Conservative retained-heap accounting, independent of wire size. Charge
// uncompressed pointers, object/property storage, UTF-16 strings and complete
// ArrayBuffer allocations. Shared objects are visited once per snapshot;
// strings are deliberately charged at every reference, including property names.
// Producer-owned snapshots only grow lazy fields. Revisited mutable containers
// keep their previous charge as slack; a forced refresh starts a fresh walk.
export function createSnapshotHeapMeter() {
  const seen = new WeakSet();
  let bytes = 2048;
  function visit(value, revisit = false, checkpoint = () => {}) {
    checkpoint();
    if (typeof value === 'string') { bytes += 32 + 2 * value.length; return; }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
      return;
    }
    if (seen.has(value) && !revisit) return;
    seen.add(value);
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) { bytes += 64 + value.byteLength; return; }
    if (ArrayBuffer.isView(value)) { bytes += 128; visit(value.buffer, false, checkpoint); return; }
    if (value instanceof Map || value instanceof Set) {
      bytes += 128 + 64 * value.size;
      if (value instanceof Map) for (const [key, child] of value) { visit(key, false, checkpoint); visit(child, false, checkpoint); }
      else for (const child of value) visit(child, false, checkpoint);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      bytes += 64 + 16 * value.length;
      for (const child of value) visit(child, false, checkpoint);
      return;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported hot snapshot prototype.');
    const keys = Object.getOwnPropertyNames(value);
    bytes += 64 + 32 * keys.length;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor)) throw new TypeError('Unsupported hot snapshot accessor.');
      visit(key, false, checkpoint); visit(descriptor.value, false, checkpoint);
    }
  }
  return { visit, get bytes() { return Math.ceil(bytes / 8) * 8; } };
}

// Shared by full and sandbox snapshots in one calculator. A lane keeps only its
// most recently used graph; colder snapshots own bytes. Both entry and heap
// bounds apply, in addition to the existing shared owner/worker byte ledger.
export function createSnapshotHotSet({ entryLimit = 1, byteLimit = 128 * 1024 * 1024 } = {}) {
  for (const value of [entryLimit, byteLimit]) if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid snapshot hot-set bound.');
  const entries = new Map();
  let bytes = 0;
  const forget = record => {
    const entry = entries.get(record);
    if (entry) { bytes -= entry.cost; entries.delete(record); }
  };
  return Object.freeze({
    get bytes() { return bytes; }, get size() { return entries.size; },
    get byteLimit() { return byteLimit; }, get entryLimit() { return entryLimit; },
    forget,
    touch(record) { const entry = entries.get(record); if (entry) { entries.delete(record); entries.set(record, entry); } },
    canHold(cost) { return entryLimit > 0 && cost <= byteLimit; },
    retain(record, cost, demote) {
      forget(record);
      if (!this.canHold(cost)) return false;
      while (entries.size >= entryLimit || bytes + cost > byteLimit) {
        const [oldest, entry] = entries.entries().next().value;
        forget(oldest); entry.demote();
      }
      entries.set(record, { cost, demote }); bytes += cost;
      return true;
    },
  });
}
