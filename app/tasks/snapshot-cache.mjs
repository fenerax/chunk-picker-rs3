import { serialize } from 'node:v8';
import { createEligibilityBudget } from './eligibility-cache.mjs';

export const DEFAULT_CACHE_BYTES = 384 * 1024 * 1024;
export function createWorkerCacheBudget(byteLimit = DEFAULT_CACHE_BYTES) {
  const eligibilityByteLimit = Math.floor(byteLimit / 3);
  return createEligibilityBudget({ byteLimit, ownerByteLimit: Math.floor(byteLimit / 2),
    eligibilityByteLimit, snapshotByteLimit: byteLimit - eligibilityByteLimit });
}

// Measure the retained data graph, including the state captured by prediction
// closures and deferred equipment views. Executable code and immutable module
// bindings are shared. These serialized bytes are an admission measure, not a
// claim about V8 heap size; RSS is measured separately under interleaving.
export function snapshotBytes(snapshot, state, context, locations, predictionBytes = 0) {
  const data = [snapshot.baseline, snapshot.baseline.processing, state, context,
    snapshot.estimates, snapshot.planningIndex && [snapshot.planningIndex.byLocation, snapshot.planningIndex.clueLocations],
    snapshot.playResult, snapshot.sandboxDelta, locations];
  return serialize(data).byteLength + predictionBytes;
}

export function createSnapshotCache(entries, budget, { context = () => undefined, locations = () => undefined } = {}) {
  const metadata = new WeakMap(), results = new WeakMap(), slots = new Map();
  const version = value => [value.includeViews, value.planningIndex, value.estimates?.size,
    value.playResult, value.sandboxDelta, context(value.baseline), locations(value.baseline), metadata.get(value)?.predictionBytes];
  const refresh = (value, force = false) => {
    const entry = metadata.get(value);
    if (!entry?.active) return;
    const next = version(value);
    if (!force && entry.version?.every((part, i) => part === next[i]) && budget.touch(value)) return;
    budget.forget(value);
    let cost;
    try {
      cost = snapshotBytes(value, entry.state, context(value.baseline), locations(value.baseline), entry.predictionBytes)
        + Buffer.byteLength(entry.key) + Buffer.byteLength(entry.owner);
    } catch {
      // Unsupported executable/custom data must bypass reuse, never turn a
      // successful calculation into an admission error.
      entry.active = false; slots.delete(entry.key); entries.delete(entry.key);
      return;
    }
    entry.version = next;
    const discard = () => { if (entry.active) { entry.active = false; slots.delete(entry.key); entries.delete(entry.key); } };
    if (!budget.admit(value, discard, { cost, owner: 'picker:' + entry.owner })) discard();
  };
  return Object.freeze({
    set(key, value, state, owner) {
      const previous = slots.get(key);
      if (previous && previous !== value) {
        budget.forget(previous); metadata.get(previous).active = false;
      }
      let entry = metadata.get(value);
      if (entry && (entry.key !== key || entry.owner !== owner)) throw new TypeError('Snapshot cache identity changed.');
      if (!entry) { entry = { key, state, owner }; metadata.set(value, entry); }
      entry.active = true;
      slots.set(key, value); results.set(value.baseline, value);
      entries.delete(key); entries.set(key, value);
      refresh(value);
    },
    refresh,
    capture(value, state) {
      const entry = metadata.get(value);
      if (entry?.active) {
        // prepareChunkPrediction validates into an independent frozen clone.
        // Charge it separately even when the caller passes the baseline state.
        entry.predictionBytes = serialize(state).byteLength;
        refresh(value);
      }
    },
    refreshResult(result) { const value = results.get(result); if (value) refresh(value); },
  });
}
