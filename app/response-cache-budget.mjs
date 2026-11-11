// owner decision, 2026-11-11: 100 active groups, 750 MiB hard total.
// Reserve 256 MiB for worker caches, 128 MiB for engines, 32 MiB for parsed
// inputs and 128 MiB for scheduler results. Responses take the last 128 MiB
// of the opt-in 672 MiB managed budget, leaving 78 MiB below the hard reject line.
// This bounds cache residency, not the service's measured heap or RSS.
import { BUDGET_RESPONSE_CACHE_BYTES, serviceMemoryBudget } from './service-memory-budget.mjs';

export function createResponseCacheBudget({ maxBytes = BUDGET_RESPONSE_CACHE_BYTES, maxEntries = 4096,
  groupFloorBytes = 64 * 1024 } = {}) {
  if (![maxBytes, maxEntries].every(n => n === null || Number.isSafeInteger(n) && n >= 0)
    || !Number.isSafeInteger(groupFloorBytes) || groupFloorBytes < 0) throw new TypeError('Invalid service response cache budget.');
  const byteCeiling = maxBytes ?? Infinity, entryCeiling = maxEntries ?? Infinity;
  const rows = new Map(), groups = new Map();
  const entries = () => [...rows.values()].filter(row => row.entry).length;
  const encodingWaiters = new Set();
  let bytes = 0, overflowBytes = 0, oversizedEncodingObserved = false;
  const changed = () => { for (const retry of encodingWaiters) queueMicrotask(retry); };
  function forget(token) {
    const row = rows.get(token);
    if (!row) return;
    rows.delete(token); bytes -= row.bytes;
    const left = groups.get(row.group) - row.bytes;
    if (left) groups.set(row.group, left); else groups.delete(row.group);
    changed(); return row;
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
  const budget = Object.freeze({
    enforced: maxBytes !== null || maxEntries !== null,
    forget,
    touch(token) { const row = rows.get(token); if (row) { rows.delete(token); rows.set(token, row); } },
    admit(token, { group, cost, pinned, evict, entry = true }) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      if (overflowBytes) return false;
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
      row.bytes = cost; bytes += delta; groups.set(row.group, groups.get(row.group) + delta); trim(); changed();
    },
    // Reserve before entering native compression, including for a cache miss
    // whose reusable admission was declined. Waiting callers do no native work.
    reserveEncoding({ cost, uncachedCost, detach, pin, unpin }) {
      if (!budget.enforced) return Promise.resolve(() => {});
      return new Promise(resolve => {
        const token = {}, group = Symbol('encoding');
        const retry = () => {
          if (!encodingWaiters.has(retry)) return;
          pin();
          const charge = cost();
          const releasePin = () => { unpin(); changed(); };
          if (charge > byteCeiling) {
            // An explicitly undersized/custom quota cannot retain this request.
            // Preserve its reply through one exclusive operation and report the
            // real excess, failing proof closed rather than hiding its bytes.
            unpin();
            if (overflowBytes || [...rows.values()].some(row => row.pinned())) return;
            for (const key of [...rows.keys()]) { const row = forget(key); row.evict(); }
            pin(); overflowBytes = cost(); oversizedEncodingObserved = true;
            encodingWaiters.delete(retry);
            resolve(() => { overflowBytes = 0; releasePin(); });
          } else if (budget.admit(token, { group, cost: charge, pinned: () => true, evict() {}, entry: false })) {
            encodingWaiters.delete(retry);
            resolve(() => { forget(token); releasePin(); });
          } else {
            unpin();
            // A row plus its output may be individually larger than a custom
            // quota even though the output alone fits. Waiting cannot fix that.
            if (uncachedCost() > byteCeiling) {
              detach?.();
              if (cost() !== charge) queueMicrotask(retry);
            }
          }
        };
        encodingWaiters.add(retry); retry();
      });
    },
    get bytes() { return bytes + overflowBytes; }, get size() { return entries(); },
    retentionLedger() {
      if (bytes > byteCeiling || entries() > entryCeiling) throw new Error('Service response cache cap exceeded.');
      return { owner: 'response-caches', complete: maxBytes !== null && maxEntries !== null && !oversizedEncodingObserved,
        blockers: oversizedEncodingObserved ? ['uncacheable-encoding-exceeds-response-quota'] : [], dimensions: [
        { unit: 'entries', used: budget.size, cap: maxEntries, enforced: maxEntries !== null },
        { unit: 'chargeBytes', used: bytes + overflowBytes, cap: maxBytes, enforced: maxBytes !== null },
        { unit: 'pendingEncodings', used: rows.size - entries() + (overflowBytes ? 1 : 0),
          cap: maxBytes === null ? null : Math.floor(maxBytes / 65536), enforced: maxBytes !== null }],
      accounting: 'One service-wide response charge, including cache backing, pinned saved-Why reservations and active encoding output reservations. Uncacheable inputs are charged with their encoding. Group ledgers are subsets; encoding reservations are shared transient work.' };
    },
  });
  return budget;
}

const serviceBudget = serviceMemoryBudget();
export const serviceResponseCacheBudget = createResponseCacheBudget({
  maxBytes: serviceBudget.responseBytes, maxEntries: serviceBudget.responseEntries,
});
