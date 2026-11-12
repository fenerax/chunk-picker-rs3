// owner decision, 2026-11-11: 100 active groups, 750 MiB hard total.
// Reserve 256 MiB for worker caches, 128 MiB for engines, 32 MiB for parsed
// inputs and 128 MiB for scheduler results. Responses take the last 128 MiB
// of the opt-in 672 MiB managed budget, leaving 78 MiB below the hard reject line.
// This bounds cache residency, not the service's measured heap or RSS.
import { BUDGET_RESPONSE_CACHE_BYTES, serviceMemoryBudget } from './service-memory-budget.mjs';

export function createResponseCacheBudget({ maxBytes = BUDGET_RESPONSE_CACHE_BYTES, maxEntries = 4096,
  groupFloorBytes = 64 * 1024, maxPendingDecodes = 4,
  maxDecodeBytes = Math.min(64 * 1024 ** 2, maxBytes ?? 128 * 1024 ** 2) } = {}) {
  if (![maxBytes, maxEntries].every(n => n === null || Number.isSafeInteger(n) && n >= 0)
    || ![groupFloorBytes, maxPendingDecodes, maxDecodeBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError('Invalid service response cache budget.');
  const byteCeiling = maxBytes ?? Infinity, entryCeiling = maxEntries ?? Infinity;
  const rows = new Map(), groups = new Map();
  const entries = () => [...rows.values()].filter(row => row.entry).length;
  let bytes = 0, oversizedEncodingObserved = false, closed = false, encodingStarts = 0;
  let activeEncodings = 0, activeDecodes = 0, decodeBytes = 0, decodeStarts = 0;
  function forget(token) {
    const row = rows.get(token);
    if (!row) return;
    rows.delete(token); bytes -= row.bytes;
    const left = groups.get(row.group) - row.bytes;
    if (left) groups.set(row.group, left); else groups.delete(row.group);
    return row;
  }
  function trim() {
    while (bytes > byteCeiling || entries() > entryCeiling) {
      // Prefer groups above their small floor, then ordinary global LRU.
      // Floors are soft: many groups or pinned decoders cannot defeat the cap.
      const candidates = [...rows].filter(([, row]) => !row.pinned());
      const candidate = candidates.find(([, row]) => groups.get(row.group) - row.bytes >= groupFloorBytes) ?? candidates[0];
      if (!candidate) throw new Error('Pinned response reservations exceeded admission.');
      const [token] = candidate, row = forget(token);
      row.evict();
    }
  }
  function reserve({ cost, uncachedCost = cost, pin = () => {}, unpin = () => {} }, decode = false) {
    if (!budget.enforced) return () => {};
    if (closed) return;
    if (!decode && uncachedCost() > byteCeiling) { oversizedEncodingObserved = true; return; }
    const charge = cost();
    if (decode && (activeDecodes >= maxPendingDecodes || decodeBytes + charge > maxDecodeBytes)) return;
    pin();
    const token = {};
    if (!budget.admit(token, { group: Symbol('active-response'), cost: charge, pinned: () => true, evict() {}, entry: false })) { unpin(); return; }
    if (decode) { activeDecodes++; decodeBytes += charge; decodeStarts++; }
    else { activeEncodings++; encodingStarts++; }
    let released = false;
    return () => {
      if (released) return; released = true;
      if (decode) { activeDecodes--; decodeBytes -= charge; } else activeEncodings--;
      forget(token); unpin();
    };
  }
  const budget = Object.freeze({
    enforced: maxBytes !== null || maxEntries !== null,
    forget,
    touch(token) { const row = rows.get(token); if (row) { rows.delete(token); rows.set(token, row); } },
    admit(token, { group, cost, pinned, evict, entry = true }) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      if (closed) return false;
      if (maxBytes !== null || maxEntries !== null) {
        const pinnedRows = [...rows.values()].filter(row => row.pinned());
        if (cost > byteCeiling || entry && pinnedRows.filter(row => row.entry).length >= entryCeiling
          || cost + pinnedRows.reduce((sum, row) => sum + row.bytes, 0) > byteCeiling) return false;
      }
      rows.set(token, { group, bytes: cost, pinned, evict, entry }); bytes += cost;
      groups.set(group, (groups.get(group) ?? 0) + cost); trim();
      return rows.has(token);
    },
    resize(token, cost) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      const row = rows.get(token); if (!row) return;
      const delta = cost - row.bytes;
      row.bytes = cost; bytes += delta; groups.set(row.group, groups.get(row.group) + delta); trim();
    },
    // One synchronous attempt; refused work retains no inputs or callbacks.
    reserveEncoding: reserve,
    reserveDecode: ({ cost }) => reserve({ cost: () => cost }, true),
    close() { closed = true; },
    get bytes() { return bytes; }, get size() { return entries(); },
    retentionLedger() {
      if (bytes > byteCeiling || entries() > entryCeiling) throw new Error('Service response cache cap exceeded.');
      return { owner: 'response-caches', complete: maxBytes !== null && maxEntries !== null && !oversizedEncodingObserved,
        blockers: oversizedEncodingObserved ? ['uncacheable-encoding-exceeds-response-quota'] : [], dimensions: [
        { unit: 'entries', used: budget.size, cap: maxEntries, enforced: maxEntries !== null },
        { unit: 'chargeBytes', used: bytes, cap: maxBytes, enforced: maxBytes !== null },
        { unit: 'pendingEncodings', used: activeEncodings,
          cap: maxBytes === null ? null : Math.floor(maxBytes / 65536), enforced: maxBytes !== null },
        { unit: 'pendingDecodes', used: activeDecodes, cap: maxPendingDecodes, enforced: true },
        { unit: 'decodeBytes', used: decodeBytes, cap: maxDecodeBytes, enforced: true }], encodingStarts, decodeStarts,
      accounting: 'Service response charge includes backing, saved-Why pins and active encoding/decode reservations. Admission is synchronous; refused work retains no input or metadata.' };
    },
  });
  return budget;
}

const serviceBudget = serviceMemoryBudget();
export const serviceResponseCacheBudget = createResponseCacheBudget({
  maxBytes: serviceBudget.responseBytes, maxEntries: serviceBudget.responseEntries,
});
