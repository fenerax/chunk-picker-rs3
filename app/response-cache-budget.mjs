// owner decision, 2026-11-11: 100 active groups, 750 MiB hard total.
// Reserve 256 MiB for worker caches, 128 MiB for engines, 32 MiB for parsed
// inputs and 128 MiB for scheduler results. Responses take the last 128 MiB
// of the opt-in 672 MiB managed budget, leaving 78 MiB below the hard reject line.
// This bounds cache residency, not the service's measured heap or RSS.
import { BUDGET_RESPONSE_CACHE_BYTES, serviceMemoryBudget } from './service-memory-budget.mjs';

export function createResponseCacheBudget({ maxBytes = BUDGET_RESPONSE_CACHE_BYTES, maxEntries = 4096,
  groupFloorBytes = 64 * 1024, maxQueuedEncodings = 32,
  maxPendingDecodes = 4, maxDecodeBytes = Math.min(64 * 1024 ** 2, maxBytes ?? 128 * 1024 ** 2),
  maxQueuedBytes = Math.min(32 * 1024 ** 2, Math.floor((maxBytes ?? 128 * 1024 ** 2) / 4)) } = {}) {
  if (![maxBytes, maxEntries].every(n => n === null || Number.isSafeInteger(n) && n >= 0)
    || ![groupFloorBytes, maxQueuedEncodings, maxQueuedBytes, maxPendingDecodes, maxDecodeBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError('Invalid service response cache budget.');
  const byteCeiling = maxBytes ?? Infinity, entryCeiling = maxEntries ?? Infinity;
  const rows = new Map(), groups = new Map();
  const entries = () => [...rows.values()].filter(row => row.entry).length;
  const encodingWaiters = new Map();
  let bytes = 0, queuedBytes = 0, overflowBytes = 0, oversizedEncodingObserved = false, scheduled = false, closed = false, encodingStarts = 0;
  let activeEncodings = 0, activeDecodes = 0, decodeBytes = 0, decodeStarts = 0;
  const changed = () => {
    if (!encodingWaiters.size || scheduled) return;
    scheduled = true; queueMicrotask(pump);
  };
  function forget(token, notify = true) {
    const row = rows.get(token);
    if (!row) return;
    rows.delete(token); bytes -= row.bytes;
    const left = groups.get(row.group) - row.bytes;
    if (left) groups.set(row.group, left); else groups.delete(row.group);
    if (notify) changed(); return row;
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
  const busy = () => Object.assign(new Error('Response encoding admission is full. Retry shortly.'), { status: 503, code: 'RESPONSE_ENCODING_BUSY', retryAfter: 1 });
  const decodeBusy = () => Object.assign(new Error('Saved explanation capacity is full. Retry shortly.'), { status: 503, code: 'SAVED_WHY_BUSY', retryAfter: 1 });
  function dequeue(waiter) {
    if (!encodingWaiters.delete(waiter.token)) return;
    queuedBytes -= waiter.inputBytes;
    waiter.signal?.removeEventListener('abort', waiter.abort);
  }
  function cancel(waiter, reason) {
    dequeue(waiter); forget(waiter.token); waiter.reject(reason); changed();
  }
  function start(waiter) {
    if (waiter.signal?.aborted) { cancel(waiter, waiter.signal.reason); return true; }
    waiter.pin();
    let charge = waiter.cost();
    if (waiter.kind === 'decode' && (activeDecodes >= maxPendingDecodes || decodeBytes + charge > maxDecodeBytes)) {
      waiter.unpin(); return false;
    }
    if (charge > byteCeiling || waiter.uncachedCost() > byteCeiling) {
      if (encodingWaiters.has(waiter.token)) { waiter.unpin(); cancel(waiter, busy()); return true; }
      waiter.unpin(); waiter.detach?.();
      // Oversized custom quotas preserve the existing exclusive transient path.
      // Queued roots and active work still own their bytes and cannot be hidden.
      if (overflowBytes || [...rows].some(([token, row]) => token !== waiter.token && row.pinned())) return false;
      for (const key of [...rows.keys()]) if (key !== waiter.token) { const row = forget(key); row.evict(); }
      dequeue(waiter); forget(waiter.token, false);
      if (waiter.signal?.aborted) { waiter.reject(waiter.signal.reason); return true; }
      waiter.pin(); overflowBytes = waiter.cost(); oversizedEncodingObserved = true; encodingStarts++;
      waiter.resolve(() => { overflowBytes = 0; waiter.unpin(); changed(); });
      return true;
    }
    if (!budget.admit(waiter.activeToken, { group: waiter.group, cost: charge, pinned: () => true, evict() {}, entry: false }, waiter.token)) {
      waiter.unpin(); return false;
    }
    dequeue(waiter);
    if (waiter.kind === 'decode') { activeDecodes++; decodeBytes += charge; decodeStarts++; }
    else { activeEncodings++; encodingStarts++; }
    let released = false;
    waiter.resolve(() => {
      if (released) return; released = true;
      if (waiter.kind === 'decode') { activeDecodes--; decodeBytes -= charge; } else activeEncodings--;
      forget(waiter.activeToken); waiter.unpin(); changed();
    });
    return true;
  }
  function pump() {
    scheduled = false;
    // Strict FIFO: never wake the tail when the live head cannot enter.
    while (encodingWaiters.size) {
      const waiter = encodingWaiters.values().next().value;
      if (!start(waiter)) break;
    }
  }
  function reserve({ kind = 'encoding', cost, uncachedCost, inputBytes, inputCost, detach, pin = () => {}, unpin = () => {}, signal }) {
    if (!budget.enforced) return Promise.resolve(() => {});
    return new Promise((resolve, reject) => {
      const refusal = kind === 'decode' ? decodeBusy : busy;
      const waiter = { token: {}, activeToken: {}, group: Symbol(kind), kind, cost, uncachedCost, detach, pin, unpin, signal, resolve, reject };
      if (closed || signal?.aborted) { reject(signal?.reason ?? refusal()); return; }
      if (kind === 'decode' && (!maxPendingDecodes || cost() > maxDecodeBytes || cost() > byteCeiling)) { reject(refusal()); return; }
      if (!encodingWaiters.size && start(waiter)) return;
      if (uncachedCost() > byteCeiling) { reject(refusal()); return; }
      waiter.inputBytes = inputBytes() + 16 * 1024;
      if (encodingWaiters.size >= maxQueuedEncodings || queuedBytes + waiter.inputBytes > maxQueuedBytes) { reject(refusal()); return; }
      waiter.abort = () => cancel(waiter, signal.reason);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      pin();
      const admitted = budget.admit(waiter.token, { group: waiter.group, cost: inputCost() + 16 * 1024,
        pinned: () => true, evict() {}, entry: false });
      unpin();
      if (!admitted) { signal?.removeEventListener('abort', waiter.abort); reject(refusal()); return; }
      encodingWaiters.set(waiter.token, waiter); queuedBytes += waiter.inputBytes;
      changed();
    });
  }
  const budget = Object.freeze({
    enforced: maxBytes !== null || maxEntries !== null,
    forget,
    notifyUnpinned: changed,
    touch(token) { const row = rows.get(token); if (row) { rows.delete(token); rows.set(token, row); } },
    admit(token, { group, cost, pinned, evict, entry = true }, replacing) {
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid response charge.');
      if (closed || overflowBytes) return false;
      if (maxBytes !== null || maxEntries !== null) {
        const pinnedRows = [...rows].filter(([key, row]) => key !== replacing && row.pinned()).map(([, row]) => row);
        if (cost > byteCeiling || entry && pinnedRows.filter(row => row.entry).length >= entryCeiling
          || cost + pinnedRows.reduce((sum, row) => sum + row.bytes, 0) > byteCeiling) return false;
      }
      forget(replacing, false);
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
    reserveEncoding: reserve,
    reserveDecode({ cost, inputBytes, signal }) {
      return reserve({ kind: 'decode', cost: () => cost, uncachedCost: () => cost,
        inputBytes: () => inputBytes, inputCost: () => inputBytes, signal });
    },
    close() {
      closed = true;
      for (const waiter of [...encodingWaiters.values()]) cancel(waiter, waiter.kind === 'decode' ? decodeBusy() : busy());
    },
    get bytes() { return bytes + overflowBytes; }, get size() { return entries(); },
    retentionLedger() {
      if (bytes > byteCeiling || entries() > entryCeiling) throw new Error('Service response cache cap exceeded.');
      return { owner: 'response-caches', complete: maxBytes !== null && maxEntries !== null && !oversizedEncodingObserved,
        blockers: oversizedEncodingObserved ? ['uncacheable-encoding-exceeds-response-quota'] : [], dimensions: [
        { unit: 'entries', used: budget.size, cap: maxEntries, enforced: maxEntries !== null },
        { unit: 'chargeBytes', used: bytes + overflowBytes, cap: maxBytes, enforced: maxBytes !== null },
        { unit: 'pendingEncodings', used: activeEncodings + (overflowBytes ? 1 : 0),
          cap: maxBytes === null ? null : Math.floor(maxBytes / 65536), enforced: maxBytes !== null },
        { unit: 'queuedEncodings', used: encodingWaiters.size, cap: maxQueuedEncodings, enforced: true },
        { unit: 'queuedInputBytes', used: queuedBytes, cap: maxQueuedBytes, enforced: true },
        { unit: 'queuedDecodes', used: [...encodingWaiters.values()].filter(row => row.kind === 'decode').length, cap: maxQueuedEncodings, enforced: true },
        { unit: 'pendingDecodes', used: activeDecodes, cap: maxPendingDecodes, enforced: true },
        { unit: 'decodeBytes', used: decodeBytes, cap: maxDecodeBytes, enforced: true }], encodingStarts, decodeStarts,
      accounting: 'Service response charge includes backing, saved-Why pins, active encoding reservations, and queued input/metadata. Cached queued inputs alias their existing charge and are cancelled on eviction. Queue dimensions are subsets of chargeBytes.' };
    },
  });
  return budget;
}

const serviceBudget = serviceMemoryBudget();
export const serviceResponseCacheBudget = createResponseCacheBudget({
  maxBytes: serviceBudget.responseBytes, maxEntries: serviceBudget.responseEntries,
});
