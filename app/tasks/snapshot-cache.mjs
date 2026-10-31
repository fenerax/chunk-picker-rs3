import { serialize } from 'node:v8';
import { createEligibilityBudget } from './eligibility-cache.mjs';

// Calculation states are immutable trees; weak keys do not extend their lifetime.
const stateSizes = new WeakMap();
const stateBytes = (state, force = false) => {
  if (state === null || typeof state !== 'object') return serialize(state).byteLength;
  if (force || !stateSizes.has(state)) stateSizes.set(state, serialize(state).byteLength);
  return stateSizes.get(state);
};

export const DEFAULT_CACHE_BYTES = 384 * 1024 * 1024;
export function createWorkerCacheBudget(byteLimit = DEFAULT_CACHE_BYTES) {
  const eligibilityByteLimit = Math.floor(byteLimit / 3);
  return createEligibilityBudget({ byteLimit, ownerByteLimit: Math.floor(byteLimit / 2),
    eligibilityByteLimit, snapshotByteLimit: byteLimit - eligibilityByteLimit });
}

// Cache bulk graph sizes; small lazy fields are independent serialized payloads.
// Planning and sandbox graphs share one measurement with the baseline so their
// aliases stay deduplicated. Small cross-component aliases can be charged twice.
// This deliberately conservative
// measure is not a claim about V8 heap size; RSS is measured separately.
function baseBytes(snapshot, state, context) {
  const { currentBiS, activityInfo, ...baseline } = snapshot.baseline;
  return serialize([baseline, snapshot.baseline.processing, context?.state === state ? { ...context, state: undefined } : context,
    snapshot.planningIndex && [snapshot.planningIndex.byLocation, snapshot.planningIndex.clueLocations],
    snapshot.playResult, snapshot.sandboxDelta]).byteLength;
}
const componentData = {
  views: value => [value.baseline.currentBiS, value.baseline.activityInfo],
  estimates: value => value.estimates,
  locations: (_value, locations) => locations,
};
export function snapshotBytes(snapshot, state, context, locations, predictionBytes = 0) {
  return baseBytes(snapshot, state, context) + stateBytes(state) + predictionBytes
    + Object.values(componentData).reduce((sum, data) => sum + serialize(data(snapshot, locations)).byteLength, 0);
}

export function createSnapshotCache(entries, budget, { context = () => undefined, locations = () => undefined } = {}) {
  const metadata = new WeakMap(), results = new WeakMap(), slots = new Map();
  const version = value => ({
    base: [value.baseline, context(value.baseline), value.planningIndex,
      value.planningIndex?.byLocation, value.planningIndex?.clueLocations, value.playResult, value.sandboxDelta],
    views: [value.baseline.currentBiS, value.baseline.activityInfo],
    estimates: [value.estimates, value.estimates?.size],
    locations: [locations(value.baseline)],
    prediction: [metadata.get(value)?.predictionBytes],
  });
  const same = (a, b) => a?.length === b.length && a.every((part, i) => part === b[i]);
  const refresh = (value, force = false) => {
    const entry = metadata.get(value);
    if (!entry?.active) return;
    const next = version(value);
    if (!force && entry.version && Object.keys(next).every(name => same(entry.version[name], next[name])) && budget.touch(value)) return;
    budget.forget(value);
    let cost;
    const costs = { ...entry.costs };
    try {
      // Dropping a deferred context cannot grow the stable graph. Keep its old
      // charge without retaining the context itself. A new context or baseline
      // must be measured, as must an explicitly forced refresh.
      if (force || costs.base === undefined
        || entry.version.base.some((part, i) => i !== 1 && part !== next.base[i])
        || next.base[1] !== undefined && entry.version.base[1] !== next.base[1]) {
        costs.base = baseBytes(value, entry.state, next.base[1]);
      }
      for (const [name, data] of Object.entries(componentData)) {
        if (force || costs[name] === undefined || !same(entry.version[name], next[name])) {
          costs[name] = serialize(data(value, next.locations[0])).byteLength;
        }
      }
      if (force || costs.state === undefined) costs.state = stateBytes(entry.state, force);
      cost = Object.values(costs).reduce((sum, bytes) => sum + bytes, 0) + (entry.predictionBytes ?? 0)
        + Buffer.byteLength(entry.key) + Buffer.byteLength(entry.owner);
    } catch {
      // Unsupported executable/custom data must bypass reuse, never turn a
      // successful calculation into an admission error.
      entry.active = false; slots.delete(entry.key); entries.delete(entry.key);
      return;
    }
    entry.costs = costs;
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
      if (!entry.active) { entry.costs = undefined; entry.version = undefined; }
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
