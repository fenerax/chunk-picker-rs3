// owner decision, 2026-11-11: 100 active groups, 750 MiB hard total.
// Reserve 256 MiB for worker caches, 128 MiB for engines, 32 MiB for parsed
// inputs and 128 MiB for scheduler results. Responses take the last 128 MiB
// of the 672 MiB managed budget, leaving 78 MiB below the hard reject line.
// This bounds cache residency, not the service's measured heap or RSS.
import { DEFAULT_RESPONSE_CACHE_BYTES, serviceMemoryBudget } from './service-memory-budget.mjs';
export { DEFAULT_RESPONSE_CACHE_BYTES } from './service-memory-budget.mjs';

export function createResponseCacheBudget({ maxBytes = DEFAULT_RESPONSE_CACHE_BYTES, maxEntries = 4096,
  groupFloorBytes = 64 * 1024 } = {}) {
  if (![maxBytes, maxEntries, groupFloorBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError('Invalid service response cache budget.');
  const rows = new Map(), groups = new Map();
  let bytes = 0;
  function forget(token) {
    const row = rows.get(token);
    if (!row) return;
    rows.delete(token); bytes -= row.bytes;
    const left = groups.get(row.group) - row.bytes;
    if (left) groups.set(row.group, left); else groups.delete(row.group);
    return row;
  }
  function trim() {
    while (bytes > maxBytes || rows.size > maxEntries) {
      // Prefer groups above their small floor, then ordinary global LRU.
      // Floors are soft: many groups or pinned decoders cannot defeat the cap.
      const candidates = [...rows].filter(([, row]) => !row.pinned());
      const candidate = candidates.find(([, row]) => groups.get(row.group) - row.bytes >= groupFloorBytes) ?? candidates[0];
      if (!candidate) throw new Error('Pinned response reservations exceeded admission.');
      const [token] = candidate, row = forget(token);
      row.evict();
    }
  }
  return Object.freeze({
    forget,
    touch(token) { const row = rows.get(token); if (row) { rows.delete(token); rows.set(token, row); } },
    admit(token, { group, cost, pinned, evict }) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      const pinnedRows = [...rows.values()].filter(row => row.pinned());
      if (cost > maxBytes || !maxEntries || pinnedRows.length >= maxEntries
        || cost + pinnedRows.reduce((sum, row) => sum + row.bytes, 0) > maxBytes) return false;
      rows.set(token, { group, bytes: cost, pinned, evict }); bytes += cost;
      groups.set(group, (groups.get(group) ?? 0) + cost); trim();
      return rows.has(token);
    },
    resize(token, cost) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      const row = rows.get(token); if (!row) return;
      const delta = cost - row.bytes;
      row.bytes = cost; bytes += delta; groups.set(row.group, groups.get(row.group) + delta); trim();
    },
    get bytes() { return bytes; }, get size() { return rows.size; },
    retentionLedger() {
      if (bytes > maxBytes || rows.size > maxEntries) throw new Error('Service response cache cap exceeded.');
      return { owner: 'response-caches', complete: true, dimensions: [
        { unit: 'entries', used: rows.size, cap: maxEntries, enforced: true },
        { unit: 'chargeBytes', used: bytes, cap: maxBytes, enforced: true }],
      accounting: 'One service-wide response charge, including all groups, sandbox pools, static responses and pinned saved-Why reservations. Group ledgers are subsets.' };
    },
  });
}

export const serviceResponseCacheBudget = createResponseCacheBudget({
  maxBytes: serviceMemoryBudget().responseBytes,
});
