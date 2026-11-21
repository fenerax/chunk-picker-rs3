// Conservative retained-heap accounting, independent of wire size. Charge
// uncompressed pointers, object/property storage, UTF-16 strings and complete
// ArrayBuffer allocations. Shared objects are visited once per snapshot;
// String values are deliberately charged at every reference. V8 internalizes
// object property names, so charge each name once, plus the meter's name registry.
// Producer-owned snapshots only grow lazy fields. Revisited mutable containers
// keep their previous charge as slack; a forced refresh starts a fresh walk.
// A finite bound is an admission probe: once exceeded, bytes is a lower bound
// proving the graph cannot be hot. Fitting graphs still receive the full charge.
export function createSnapshotHeapMeter({ byteLimit = Infinity } = {}) {
  const seen = new WeakSet(), propertyNames = new Set();
  let bytes = 2048;
  function visitFast(value, revisit) {
    if (bytes > byteLimit) return;
    const type = typeof value;
    if (type === 'string') { bytes += 32 + 2 * value.length; return; }
    if (value === null || type !== 'object') {
      if (type === 'function' || type === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
      return;
    }
    if (seen.has(value) && !revisit) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const len = value.length;
      bytes += 64 + 16 * len;
      for (let i = 0; i < len; i++) {
        if (bytes > byteLimit) break;
        const child = value[i];
        const ct = typeof child;
        if (ct === 'string') bytes += 32 + 2 * child.length;
        else if (child === null || ct !== 'object') {
          if (ct === 'function' || ct === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
        } else if (!seen.has(child)) visitFast(child, false);
      }
      return;
    }
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) { bytes += 64 + value.byteLength; return; }
    if (ArrayBuffer.isView(value)) { bytes += 128; visitFast(value.buffer, false); return; }
    if (value instanceof Map || value instanceof Set) {
      bytes += 128 + 64 * value.size;
      if (value instanceof Map) for (const [key, child] of value) {
        if (bytes > byteLimit) break;
        if (typeof key === 'string') bytes += 32 + 2 * key.length;
        else visitFast(key, false);
        if (bytes > byteLimit) break;
        const ct = typeof child;
        if (ct === 'string') bytes += 32 + 2 * child.length;
        else if (child === null || ct !== 'object') {
          if (ct === 'function' || ct === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
        } else if (!seen.has(child)) visitFast(child, false);
      }
      else for (const child of value) {
        if (bytes > byteLimit) break;
        const ct = typeof child;
        if (ct === 'string') bytes += 32 + 2 * child.length;
        else if (child === null || ct !== 'object') {
          if (ct === 'function' || ct === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
        } else if (!seen.has(child)) visitFast(child, false);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported hot snapshot prototype.');
    const keys = Object.getOwnPropertyNames(value);
    const keyCount = keys.length;
    bytes += 64 + 32 * keyCount;
    for (let i = 0; i < keyCount; i++) {
      if (bytes > byteLimit) break;
      const key = keys[i];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor)) throw new TypeError('Unsupported hot snapshot accessor.');
      if (!propertyNames.has(key)) {
        propertyNames.add(key);
        bytes += 64; // Conservative storage for the meter's own retained Set slot.
        if (bytes <= byteLimit) bytes += 32 + 2 * key.length;
      }
      if (bytes > byteLimit) continue;
      const child = descriptor.value;
      const ct = typeof child;
      if (ct === 'string') bytes += 32 + 2 * child.length;
      else if (child === null || ct !== 'object') {
        if (ct === 'function' || ct === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
      } else if (!seen.has(child)) visitFast(child, false);
    }
  }
  function visitChecked(value, revisit, checkpoint) {
    checkpoint();
    if (bytes > byteLimit) return;
    if (typeof value === 'string') { bytes += 32 + 2 * value.length; return; }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Unsupported hot snapshot value.');
      return;
    }
    if (seen.has(value) && !revisit) return;
    seen.add(value);
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) { bytes += 64 + value.byteLength; return; }
    if (ArrayBuffer.isView(value)) { bytes += 128; visitChecked(value.buffer, false, checkpoint); return; }
    if (value instanceof Map || value instanceof Set) {
      bytes += 128 + 64 * value.size;
      if (value instanceof Map) for (const [key, child] of value) {
        if (bytes > byteLimit) break;
        visitChecked(key, false, checkpoint); visitChecked(child, false, checkpoint);
      }
      else for (const child of value) { if (bytes > byteLimit) break; visitChecked(child, false, checkpoint); }
      return;
    }
    if (Array.isArray(value)) {
      bytes += 64 + 16 * value.length;
      for (const child of value) { if (bytes > byteLimit) break; visitChecked(child, false, checkpoint); }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported hot snapshot prototype.');
    const keys = Object.getOwnPropertyNames(value);
    bytes += 64 + 32 * keys.length;
    for (const key of keys) {
      if (bytes > byteLimit) break;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor)) throw new TypeError('Unsupported hot snapshot accessor.');
      if (!propertyNames.has(key)) {
        propertyNames.add(key);
        bytes += 64; // Conservative storage for the meter's own retained Set slot.
        visitChecked(key, false, checkpoint);
      }
      visitChecked(descriptor.value, false, checkpoint);
    }
  }
  function visit(value, revisit = false, checkpoint) {
    if (checkpoint) visitChecked(value, revisit, checkpoint);
    else visitFast(value, revisit);
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
    retentionLedger() {
      if (entries.size > entryLimit || bytes > byteLimit) throw new Error('Hot snapshot retention cap exceeded.');
      return { owner: 'hot-snapshot', complete: true, includedInOtherCap: true, dimensions: [
        { unit: 'entries', used: entries.size, cap: entryLimit, enforced: true },
        { unit: 'chargeBytes', used: bytes, cap: byteLimit, enforced: true }],
        accounting: 'Subset of the worker-cache charge: its admission owns both hot graphs and any retained backing. Never add this ledger to the worker-cache total.' };
    },
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
