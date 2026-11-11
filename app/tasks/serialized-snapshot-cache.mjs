import { serialize, DefaultDeserializer } from 'node:v8';
import { encodeSnapshotBytes, decodeSnapshotBytes, releaseSnapshotScratch } from './snapshot-wire.mjs';
import { createSnapshotHeapMeter, createSnapshotHotSet } from './snapshot-hot-set.mjs';

// Cold snapshots own only wire bytes. A shared, heap-charged hot set can retain
// decoded graphs. The fixed cold allowance covers entries/maps/callbacks;
// keys are UTF-16 and the complete dedicated backing allocation is charged.
export const SNAPSHOT_ENTRY_BYTES = 2048;
export const serializedSnapshotBytes = (key, owner, bytes) =>
  bytes.buffer.byteLength + 2 * (key.length + owner.length) + SNAPSHOT_ENTRY_BYTES;

// Decoded typed arrays must not expose mutable views into retained wire bytes.
class SnapshotDeserializer extends DefaultDeserializer {
  _readHostObject() {
    const view = super._readHostObject();
    if (Buffer.isBuffer(view)) return Buffer.from(view);
    if (view instanceof DataView) return new DataView(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer);
    return view.slice();
  }
}
function decode(bytes) {
  const raw = decodeSnapshotBytes(bytes);
  try {
    const reader = new SnapshotDeserializer(raw);
    reader.readHeader(); return reader.readValue();
  } finally { if (raw.buffer !== bytes.buffer) releaseSnapshotScratch(raw); }
}
function discardSnapshot(entries, key, record, hotSet) {
  // This closure must not share an activation with a decoded snapshot.
  return () => { hotSet.forget(record); record.value = undefined; if (Map.prototype.get.call(entries, key) === record) entries.delete(key); };
}
function demoteSnapshot(demote, record) { return () => demote(record); }
const noCheckpoint = () => {};

export function createSerializedSnapshotCache(budget, { context = () => undefined, locations = () => undefined,
  restoreContext = () => {}, restoreLocations = () => {}, hotSet = createSnapshotHotSet({ entryLimit: 0 }) } = {}) {
  const metadata = new WeakMap(), results = new WeakMap();
  const transient = new Set();
  const version = value => [value.baseline, value.includeViews, value.revision, value.playResult, value.sandboxDelta,
    value.planningIndex, value.whyIndex, value.estimates, value.estimates?.size,
    value.baseline?.currentBiS, value.baseline?.activityInfo, context(value.baseline), locations(value.baseline)];
  const same = (a, b) => a?.length === b.length && a.every((part, i) => part === b[i]);
  const remember = (value, entry) => {
    metadata.set(value, entry);
    if (value.baseline) results.set(value.baseline, value);
    return value;
  };
  const entries = new class extends Map {
    get(key) {
      const record = super.get(key);
      if (!record) return;
      budget.touch(record);
      if (record.value) { hotSet.touch(record); return record.value; }
      const { snapshot, deferred, mapLocations, processing, primary, metrics } = decode(record.bytes);
      const value = snapshot;
      if (value.baseline) {
        if (processing !== undefined) Object.defineProperty(value.baseline, 'processing', { value: processing });
        value.baseline.tasks.forEach((row, index) => {
          if (primary[index] !== undefined) Object.defineProperty(row, 'processingPrimary', { value: primary[index] });
        });
        Object.defineProperties(value.baseline.metrics, metrics);
        if (deferred) restoreContext(value.baseline, deferred);
        if (mapLocations) restoreLocations(value.baseline, mapLocations);
      }
      remember(value, { key, owner: record.owner, record, retainedRecord: record, version: version(value) });
      if (hotSet.entryLimit) set(key, value, undefined, record.owner);
      return value;
    }
    clear() { for (const record of this.values()) { budget.forget(record); hotSet.forget(record); record.value = undefined; } super.clear(); }
  }();
  const stage = (key, value, _state, owner) => {
    let entry = metadata.get(value);
    if (entry && (entry.key !== key || entry.owner !== owner)) throw new TypeError('Snapshot cache identity changed.');
    if (!entry) remember(value, entry = { key, owner });
    return entry;
  };
  const wire = (value, checkpoint = noCheckpoint) => {
      const baseline = value.baseline;
      const raw = serialize({ snapshot: { ...value, predict: undefined,
        planningIndex: value.planningIndex && { byLocation: value.planningIndex.byLocation, clueLocations: value.planningIndex.clueLocations } }, deferred: context(baseline),
        mapLocations: locations(baseline), processing: baseline?.processing,
        primary: baseline?.tasks.map(row => row.processingPrimary),
        metrics: baseline && Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(baseline.metrics))
          .filter(([, descriptor]) => !descriptor.enumerable)) });
      checkpoint();
      const bytes = encodeSnapshotBytes(raw);
      checkpoint();
      return bytes;
  };
  const demote = record => {
    const value = record.value, entry = metadata.get(value);
    if (!value || !entry || Map.prototype.get.call(entries, entry.key) !== record) return;
    try {
      const bytes = wire(value);
      budget.forget(record);
      record.bytes = bytes; record.cost = serializedSnapshotBytes(entry.key, entry.owner, bytes);
      record.value = undefined; entry.meter = undefined;
      if (!budget.admit(record, discardSnapshot(entries, entry.key, record, hotSet), { cost: record.cost, owner: 'picker:' + entry.owner })) entries.delete(entry.key);
    } catch { budget.forget(record); discardSnapshot(entries, entry.key, record, hotSet)(); }
  };
  const measure = (value, force = false, checkpoint = noCheckpoint) => {
    checkpoint();
    const entry = metadata.get(value);
    if (!entry) return;
    const next = version(value);
    if (!force && entry.record && same(entry.version, next) && (entry.record.value || !hotSet.entryLimit)) return entry.record.cost;
    try {
      if (hotSet.entryLimit) {
        // Keep the producer's index identity: cancellation rolls an uncharged
        // index back by identity. Its canonicalizer is no longer needed here.
        if (value.planningIndex?.canonical) delete value.planningIndex.canonical;
        if (!entry.meter || force) { entry.meter = createSnapshotHeapMeter(); entry.heapVersion = undefined; }
        const meter = entry.meter, prior = entry.heapVersion;
        // Stable baseline objects are immutable; lazy roots are measured only
        // when their identity/size changes. The meter deduplicates their aliases.
        const roots = [value.baseline, context(value.baseline), locations(value.baseline), value.playResult,
          value.sandboxDelta, value.planningIndex, value.whyIndex, value.estimates, value.estimates?.size,
          value.baseline?.currentBiS, value.baseline?.activityInfo];
        roots.forEach((root, index) => {
          if (!prior || root !== prior[index] || index === 7 && roots[8] !== prior[8]) meter.visit(root, index === 7, checkpoint);
        });
        meter.visit({ ...value, predict: undefined }, false, checkpoint);
        meter.visit(entry.key); meter.visit(entry.owner);
        entry.heapVersion = roots;
        const cost = meter.bytes;
        if (hotSet.canHold(cost) && budget.canAdmit({ cost, owner: 'picker:' + entry.owner })) {
          entry.record ??= { owner: entry.owner };
          entry.record.value = value; entry.record.bytes = undefined; entry.record.cost = cost;
          entry.version = version(value);
          return cost;
        }
      }
      const bytes = wire(value, checkpoint);
      entry.record = { bytes, owner: entry.owner, cost: serializedSnapshotBytes(entry.key, entry.owner, bytes) };
      entry.meter = undefined; entry.heapVersion = undefined;
      entry.version = next;
      return entry.record.cost;
    } catch {
      // A cancelled walk may have visited only part of a root. Never reuse
      // its WeakSet on a later attempt and mistake that root for fully charged.
      entry.meter = undefined; entry.heapVersion = undefined;
      checkpoint(); return;
    } // Unsupported data bypasses reuse.
  };
  const tokens = values => values.map(value => metadata.get(value)?.retainedRecord).filter(Boolean);
  const set = (key, value, state, owner, { preserve = [] } = {}) => {
    const entry = stage(key, value, state, owner), cost = measure(value);
    const previous = Map.prototype.get.call(entries, key), protectedEntries = tokens(preserve);
    if (cost === undefined || !budget.canAdmit({ cost, owner: 'picker:' + owner, preserve: protectedEntries, replace: entry.record })) {
      if (previous && previous === entry.retainedRecord) { budget.forget(previous); discardSnapshot(entries, key, previous, hotSet)(); }
      return false;
    }
    if (previous === entry.record && previous.cost === entry.admittedCost && budget.touch(previous)) return true;
    if (previous) budget.forget(previous);
    const record = entry.record;
    hotSet.forget(previous);
    if (record.value) hotSet.retain(record, cost, demoteSnapshot(demote, record));
    if (!budget.admit(record, discardSnapshot(entries, key, record, hotSet), { cost, owner: 'picker:' + owner, preserve: protectedEntries }))
      throw new Error('Snapshot admission preflight mismatch.');
    Map.prototype.set.call(entries, key, record);
    entry.retainedRecord = record;
    entry.admittedCost = cost;
    return true;
  };
  const refresh = (value, force = false, measureOnly = false, checkpoint = noCheckpoint) => {
    const entry = metadata.get(value);
    if (!entry) return;
    const previous = Map.prototype.get.call(entries, entry.key);
    const cost = measure(value, force, checkpoint);
    if (!measureOnly && previous && previous === entry.retainedRecord) set(entry.key, value, undefined, entry.owner);
    return cost;
  };
  return Object.freeze({ entries, stage, set, refresh, measure,
    isCurrent(key, value) { const record = metadata.get(value)?.retainedRecord; return !!record && Map.prototype.get.call(entries, key) === record; },
    fits(value, preserve = []) {
      const entry = metadata.get(value), cost = measure(value);
      return cost !== undefined && budget.canAdmit({ cost, owner: 'picker:' + entry.owner, preserve: tokens(preserve), replace: entry.record });
    },
    // Planning belongs to the same charged graph; prediction closures last
    // only for the active request and are discarded in the worker's finally.
    planningCharge: () => 0,
    capture(value) { transient.add(value); },
    releaseTransient() { for (const value of transient) value.predict = undefined; transient.clear(); },
    refreshResult(result) { const value = results.get(result); if (value) refresh(value); },
  });
}
