import { serialize } from 'node:v8';
import { chunkPlanningIndexBytes, planningStringBytes, planningMapBytes, planningArrayBytes } from './chunk-planning-index.mjs';
import { createEligibilityBudget, eligibilityResultBytes } from './eligibility-cache.mjs';

// Calculation states are immutable trees; weak keys do not extend their lifetime.
function releaseMeasurement(bytes) {
  if (bytes.byteLength < 65536 || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) return;
  try { bytes.buffer.transfer(0); } catch { /* Older/untransferable buffers remain ordinary GC-owned temporaries. */ }
}
function serializedBytes(value) {
  const bytes = serialize(value), size = bytes.byteLength;
  releaseMeasurement(bytes); return size;
}
const stateSizes = new WeakMap();
const referenceBytes = (bytes, padding = false) => {
  let cost = bytes.byteLength;
  for (let i = bytes.indexOf(0x5e); i !== -1; i = bytes.indexOf(0x5e, i + 1)) cost += 4;
  if (padding) for (let i = bytes.indexOf(0x63); i !== -1; i = bytes.indexOf(0x63, i + 1)) cost++;
  return cost;
};
const stateBytes = (state, force = false) => {
  if (state === null || typeof state !== 'object') return serializedBytes(state);
  if (force || !stateSizes.has(state)) {
    const bytes = serialize(state);
    const size = { bytes: bytes.byteLength, bound: referenceBytes(bytes) };
    releaseMeasurement(bytes); stateSizes.set(state, size);
  }
  return stateSizes.get(state).bytes;
};
// Hypothetical states share their large immutable task tree with the input.
// Charge a clone independently, using the original graph plus every changed
// top-level value; reference-ID widening is covered on both components.
function predictionStateBytes(state, source) {
  if (!referenceEncodingSupported) return stateBytes(state);
  if (state === source || stateSizes.has(state)) return stateBytes(state);
  if (!state || !source || typeof state !== 'object' || typeof source !== 'object' || !stateSizes.has(source)) return stateBytes(state);
  const changes = Object.fromEntries(Object.keys(state).filter(key => state[key] !== source[key]).map(key => [key, state[key]]));
  const bound = stateSizes.get(source).bound + referenceBound(changes);
  stateSizes.set(state, { bytes: bound, bound });
  return bound;
}

export const DEFAULT_CACHE_BYTES = 384 * 1024 * 1024;
export function createWorkerCacheBudget(byteLimit = DEFAULT_CACHE_BYTES) {
  const eligibilityByteLimit = Math.floor(byteLimit / 3);
  return createEligibilityBudget({ byteLimit, ownerByteLimit: Math.floor(byteLimit / 2),
    eligibilityByteLimit, snapshotByteLimit: byteLimit - eligibilityByteLimit });
}

const trustedPlans = new WeakMap();
// Only the worker calls this immediately after buildChunkPlanningIndex. Its
// fixed-shape rows are immutable after construction; no gameplay input can
// register an arbitrary graph. Weak references add no retaining graph roots.
export function trackPlanningIndex(index, baseline) {
  trustedPlans.set(index, { baseline: new WeakRef(baseline),
    rows: new WeakRef(index.byLocation), clues: new WeakRef(index.clueLocations) });
  return index;
}
const contextState = (value, context) => () => context(value.baseline)?.state;

// Literal property names are internalized by the producer. Native measurement
// includes its header plus extra alignment slack, independent of object IDs.
const [taskKey, evidenceKey, locationKey, reasonKey] = Object.keys({ task: 0, evidence: 0, location: 0, reason: 0 });
const rowKeyBytes = serialize(taskKey).byteLength + serialize(evidenceKey).byteLength + 2;
const evidenceKeyBytes = serialize(locationKey).byteLength + serialize(reasonKey).byteLength + 2;
const referenceProbe = {};
const referenceEncodingSupported = rowKeyBytes === 22 && evidenceKeyBytes === 24 && serialize([referenceProbe, referenceProbe])
  .equals(Buffer.from('ff0f41026f7b005e01240002', 'hex'))
  && serialize('\u00e9').equals(Buffer.from('ff0f2201e9', 'hex'))
  && serialize('\u6f22').equals(Buffer.from('ff0f6302226f', 'hex'));

// A component's object IDs can be larger when embedded after another graph.
// Every V8 object reference has tag 0x5e and a uint32 varint (2..6 bytes).
// Counting all matching bytes also counts some string/data bytes, conservatively.
function referenceBound(value, padding = false) {
  const bytes = serialize(value), cost = referenceBytes(bytes, padding);
  releaseMeasurement(bytes); return cost;
}

// Internal producer bridge: called immediately after engine.evaluate and before
// the worker appends collection/equipment rows. Engine rows and other roots are
// immutable from this point; only the task list, diagnostic tail and metrics grow.
const coreMeasurements = new WeakMap();
export function trackSnapshotCore(result) {
  if (!referenceEncodingSupported) return;
  const bytes = eligibilityResultBytes(result);
  if (bytes === undefined) return;
  const fields = new Map(Object.entries(result).filter(([key]) => !['tasks', 'diagnostics', 'metrics'].includes(key))
    .map(([key, value]) => [key, value && typeof value === 'object' ? new WeakRef(value) : value]));
  coreMeasurements.set(result, { bytes, fields, tasks: new WeakSet(result.tasks),
    diagnostics: new WeakRef(result.diagnostics), diagnosticCount: result.diagnostics.length });
}
function coreDelta(baseline, playResult) {
  const core = coreMeasurements.get(baseline);
  if (!core) return;
  const delta = { ...baseline }, play = playResult && { ...playResult };
  let references = 0;
  for (const [key, original] of core.fields) {
    const value = original instanceof WeakRef ? original.deref() : original;
    if (value !== undefined && value === delta[key]) delete delta[key];
    if (value && typeof value === 'object' && play && play[key] === value) {
      delete play[key]; references += planningStringBytes(key) + 6;
    }
  }
  delta.tasks = baseline.tasks.filter(row => !core.tasks.has(row));
  if (baseline.diagnostics === core.diagnostics.deref() && baseline.diagnostics.length >= core.diagnosticCount)
    delta.diagnostics = baseline.diagnostics.slice(core.diagnosticCount);
  if (Array.isArray(delta.presentation?.tasks)) {
    const rows = delta.presentation.tasks.filter(row => !core.tasks.has(row));
    references += 16 + 6 * (delta.presentation.tasks.length - rows.length);
    delta.presentation = { ...delta.presentation, tasks: rows };
  }
  return { bytes: core.bytes + references, delta, play };
}

// Cache bulk graph sizes; small lazy fields are independent serialized payloads.
// Sandbox graphs share one measurement with the baseline so aliases remain
// deduplicated. Known planning shapes receive a separate conservative bound.
// Small cross-component aliases can be charged twice. This conservative measure is not a claim about V8 heap size; RSS is measured separately.
function baseBytes(snapshot, state, context, separatePlanning = false, allowTrusted = false) {
  const core = allowTrusted && separatePlanning && context === undefined && coreDelta(snapshot.baseline, snapshot.playResult);
  if (core) return core.bytes + 32 + referenceBound([
    core.delta, core.play, snapshot.sandboxDelta], true);
  const { currentBiS, activityInfo, ...baseline } = snapshot.baseline ?? {};
  const data = [baseline, snapshot.baseline?.processing, context?.state === state ? { ...context, state: undefined } : context,
    !separatePlanning && snapshot.planningIndex && [snapshot.planningIndex.byLocation, snapshot.planningIndex.clueLocations],
    snapshot.playResult, snapshot.sandboxDelta];
  return separatePlanning ? referenceBound(data) : serializedBytes(data);
}
const componentData = {
  views: value => [value.baseline?.currentBiS, value.baseline?.activityInfo],
  estimates: value => value.estimates,
  locations: (_value, locations) => locations,
};
// Planning rows refer to already charged baseline tasks. Bound their fixed data
// shape without serializing those tasks or the large evidence graph again.
// Unknown shapes retain the original joint native measurement and aliasing.
function planningBytes(snapshot, allowTrusted = false) {
  if (!referenceEncodingSupported) return null;
  const index = snapshot.planningIndex;
  if (!index) return 0;
  const maps = [index.byLocation, index.clueLocations];
  if (!maps.every(map => Object.getPrototypeOf(map) === Map.prototype)) return null;
  const trusted = trustedPlans.get(index);
  if (!trusted || trusted.baseline.deref() !== snapshot.baseline || trusted.rows.deref() !== index.byLocation
    || trusted.clues.deref() !== index.clueLocations) return null;
  if (allowTrusted) {
    const bytes = chunkPlanningIndexBytes(index, snapshot.baseline);
    if (bytes !== undefined) return 17 + bytes + referenceBound(index.clueLocations);
  }
  const tasks = new WeakSet();
  for (const task of snapshot.baseline?.tasks ?? []) if (task && typeof task === 'object') tasks.add(task);
  const string = planningStringBytes;
  const plain = (value, a, b) => {
    if (!value) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    let count = 0;
    for (const key in value) {
      if (key !== a && key !== b) return false;
      count++;
    }
    return count === 2;
  };
  // V8 object references use a tag and a uint32 varint: at most six bytes.
  // Known objects have two properties. Map counts allow five-byte varints;
  // the producer's dense arrays use their actual length-varint widths.
  const object = 3, array = 17, reference = 6;
  let cost = array + planningMapBytes(index.byLocation.size) + referenceBound(index.clueLocations);
  const rowKeys = 16, evidenceKeys = 18;
  try {
    Map.prototype.forEach.call(index.byLocation, (rows, location) => {
      if (Object.getPrototypeOf(rows) !== Map.prototype) throw new TypeError('Unsupported planning rows.');
      cost += string(location) + planningMapBytes(rows.size);
      Map.prototype.forEach.call(rows, (row, id) => {
        if (!plain(row, 'task', 'evidence') || !tasks.has(row.task)
          || !Array.isArray(row.evidence) || Object.getPrototypeOf(row.evidence) !== Array.prototype
          || row.evidence.length > 1000000 || Object.keys(row.evidence).length !== row.evidence.length) throw new TypeError('Unsupported planning row.');
        cost += string(id) + object + rowKeys + reference + planningArrayBytes(row.evidence.length);
        for (let i = 0; i < row.evidence.length; i++) {
          const evidence = row.evidence[i];
          if (!plain(evidence, 'location', 'reason')) throw new TypeError('Unsupported planning evidence.');
          cost += object + evidenceKeys + string(evidence.location) + string(evidence.reason);
        }
      });
    });
    return cost;
  } catch { return null; }
}
export function snapshotBytes(snapshot, state, context, locations, predictionBytes = 0) {
  const planning = planningBytes(snapshot);
  const native = baseBytes(snapshot, state, context, planning !== null);
  // Diagnostics independently verify the producer charge against the complete
  // native graph. Runtime admission uses the conservative producer bound alone.
  const base = coreMeasurements.has(snapshot.baseline) && planning !== null && context === undefined
    ? Math.max(native, baseBytes(snapshot, state, context, true, true)) : native;
  return base + (planning ?? 0) + stateBytes(state) + predictionBytes
    + Object.values(componentData).reduce((sum, data) => sum + serializedBytes(data(snapshot, locations)), 0);
}

export function createSnapshotCache(entries, budget, { context = () => undefined, locations = () => undefined, contextOwnsState = false } = {}) {
  const metadata = new WeakMap(), results = new WeakMap(), slots = new Map();
  const version = value => ({
    base: [value.baseline, context(value.baseline), value.playResult, value.sandboxDelta],
    planning: [value.planningIndex, value.planningIndex?.byLocation, value.planningIndex?.clueLocations],
    views: [value.baseline?.currentBiS, value.baseline?.activityInfo],
    estimates: [value.estimates, value.estimates?.size],
    locations: [locations(value.baseline)],
    prediction: [metadata.get(value)?.predictionBytes],
    state: [metadata.get(value)?.state],
  });
  const same = (a, b) => a?.length === b.length && a.every((part, i) => part === b[i]);
  const refresh = (value, force = false, measureOnly = false) => {
    const entry = metadata.get(value);
    if (!entry?.active && !(measureOnly && entry?.pending)) return;
    if (force && value.baseline) coreMeasurements.delete(value.baseline);
    const next = version(value);
    if (!force && entry.version && Object.keys(next).every(name => same(entry.version[name], next[name])) && (measureOnly || budget.touch(value))) return entry.measuredCost;
    let cost;
    const costs = { ...entry.costs };
    try {
      // Dropping a deferred context cannot grow the stable graph. Keep its old
      // charge without retaining the context itself. A new context or baseline
      // must be measured, as must an explicitly forced refresh.
      const planned = force || costs.planning === undefined || !same(entry.version.planning, next.planning)
        || entry.version.base[0] !== next.base[0];
      const wasSeparate = entry.separatePlanning;
      if (planned) {
        if (force && value.planningIndex) trustedPlans.delete(value.planningIndex);
        const bytes = planningBytes(value, !force);
        entry.separatePlanning = bytes !== null; costs.planning = bytes ?? 0;
      }
      if (force || costs.base === undefined || wasSeparate !== entry.separatePlanning
        || !entry.separatePlanning && planned
        || entry.version.base.some((part, i) => i !== 1 && part !== next.base[i])
        || next.base[1] !== undefined && entry.version.base[1] !== next.base[1]) {
        costs.base = baseBytes(value, entry.state, next.base[1], entry.separatePlanning, !force);
      }
      for (const [name, data] of Object.entries(componentData)) {
        if (force || costs[name] === undefined || !same(entry.version[name], next[name])) {
          costs[name] = serializedBytes(data(value, next.locations[0]));
        }
      }
      if (force || costs.state === undefined || !same(entry.version.state, next.state)) costs.state = stateBytes(entry.state, force);
      cost = Object.values(costs).reduce((sum, bytes) => sum + bytes, 0) + (entry.predictionBytes ?? 0)
        + Buffer.byteLength(entry.key) + Buffer.byteLength(entry.owner);
    } catch {
      // Unsupported executable/custom data must bypass reuse, never turn a
      // successful calculation into an admission error.
      if (entry.active) { budget.forget(value); entry.active = false; if (slots.get(entry.key) === value) { slots.delete(entry.key); entries.delete(entry.key); } }
      return;
    }
    entry.costs = costs;
    entry.version = next; entry.measuredCost = cost;
    if (measureOnly || !entry.active) return cost;
    budget.forget(value);
    const discard = () => { if (entry.active) { entry.active = false; slots.delete(entry.key); entries.delete(entry.key); } };
    if (!budget.admit(value, discard, { cost, owner: 'picker:' + entry.owner })) discard();
  };
  return Object.freeze({
    stage(key, value, state, owner) {
      let entry = metadata.get(value);
      if (entry && (entry.key !== key || entry.owner !== owner)) throw new TypeError('Snapshot cache identity changed.');
      if (!entry) {
        entry = { key, owner, pending: true };
        if (contextOwnsState) Object.defineProperty(entry, 'state', { get: contextState(value, context) });
        else entry.state = state;
        const previous = slots.get(key), prior = metadata.get(previous);
        if (prior?.active) {
          entry.costs = { ...prior.costs }; entry.version = prior.version;
          entry.separatePlanning = prior.separatePlanning; entry.measuredCost = prior.measuredCost;
        }
        if (value.predict && value.predict === previous?.predict) entry.predictionBytes = metadata.get(previous)?.predictionBytes;
        metadata.set(value, entry);
      }
      if (!entry.active && !entry.pending) { entry.pending = true; entry.costs = undefined; entry.version = undefined; }
      return entry;
    },
    measure(value) { return refresh(value, false, true); },
    planningCharge(value) { const entry = metadata.get(value); return entry?.separatePlanning ? entry.costs?.planning ?? 0 : 0; },
    fits(value, preserve = []) {
      const entry = metadata.get(value), cost = refresh(value, false, true);
      return cost !== undefined && budget.canAdmit({ cost, owner: 'picker:' + entry.owner, preserve, replace: value });
    },
    set(key, value, state, owner, { preserve = [] } = {}) {
      const previous = slots.get(key), entry = this.stage(key, value, state, owner);
      const cost = refresh(value, false, true);
      if (cost === undefined || !budget.canAdmit({ cost, owner: 'picker:' + owner, preserve, replace: value })) {
        if (previous === value) { budget.forget(value); entry.active = false; slots.delete(key); entries.delete(key); }
        entry.pending = false; return false;
      }
      if (previous && previous !== value) { budget.forget(previous); metadata.get(previous).active = false; }
      budget.forget(value);
      const discard = () => { entry.active = false; if (slots.get(key) === value) { slots.delete(key); entries.delete(key); } };
      if (!budget.admit(value, discard, { cost, owner: 'picker:' + owner, preserve })) throw new Error('Snapshot admission preflight mismatch.');
      entry.active = true; entry.pending = false;
      slots.set(key, value); if (value.baseline) results.set(value.baseline, value);
      entries.delete(key); entries.set(key, value);
      return true;
    },
    refresh,
    capture(value, state, source = state) {
      const entry = metadata.get(value);
      if (entry?.active || entry?.pending) {
        // prepareChunkPrediction validates into an independent frozen clone.
        // Charge it separately even when the caller passes the baseline state.
        entry.predictionBytes = predictionStateBytes(state, source);
        refresh(value);
      }
    },
    refreshResult(result) { const value = results.get(result); if (value) refresh(value); },
  });
}
