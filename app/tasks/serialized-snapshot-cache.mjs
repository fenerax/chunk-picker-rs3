import { serialize, DefaultDeserializer } from 'node:v8';
import { encodeSnapshotBytes, decodeSnapshotBytes, releaseSnapshotScratch } from './snapshot-wire.mjs';

// A snapshot owns bytes, never decoded task rows or a prediction closure. The
// fixed allowance covers the entry, ledger/maps and callback; keys
// are charged as UTF-16 and the complete dedicated backing store is charged.
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
function discardSnapshot(entries, key, record) {
  // This closure must not share an activation with a decoded snapshot.
  return () => { if (Map.prototype.get.call(entries, key) === record) entries.delete(key); };
}
const noCheckpoint = () => {};

export function createSerializedSnapshotCache(budget, { context = () => undefined, locations = () => undefined,
  restoreContext = () => {}, restoreLocations = () => {} } = {}) {
  const metadata = new WeakMap(), results = new WeakMap();
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
      return remember(value, { key, owner: record.owner, record, retainedRecord: record, version: version(value) });
    }
    clear() { for (const record of this.values()) budget.forget(record); super.clear(); }
  }();
  const stage = (key, value, _state, owner) => {
    let entry = metadata.get(value);
    if (entry && (entry.key !== key || entry.owner !== owner)) throw new TypeError('Snapshot cache identity changed.');
    if (!entry) remember(value, entry = { key, owner });
    return entry;
  };
  const measure = (value, force = false, checkpoint = noCheckpoint) => {
    checkpoint();
    const entry = metadata.get(value);
    if (!entry) return;
    const next = version(value);
    if (!force && entry.record && same(entry.version, next)) return entry.record.cost;
    try {
      const baseline = value.baseline;
      // Prediction validates/clones state and captures executable helpers. It
      // is cheap to recreate; never let that closure retain a full input graph.
      const raw = serialize({ snapshot: { ...value, predict: undefined,
        // The canonicalizer closes over immutable definition indexes. Worker
        // reads need only its already materialized location and clue maps.
        planningIndex: value.planningIndex && { byLocation: value.planningIndex.byLocation, clueLocations: value.planningIndex.clueLocations } }, deferred: context(baseline),
        mapLocations: locations(baseline), processing: baseline?.processing,
        primary: baseline?.tasks.map(row => row.processingPrimary),
        metrics: baseline && Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(baseline.metrics))
          .filter(([, descriptor]) => !descriptor.enumerable)) });
      checkpoint();
      const bytes = encodeSnapshotBytes(raw);
      checkpoint();
      entry.record = { bytes, owner: entry.owner,
        cost: serializedSnapshotBytes(entry.key, entry.owner, bytes) };
      entry.version = next;
      return entry.record.cost;
    } catch { checkpoint(); return; } // Unsupported data bypasses reuse.
  };
  const tokens = values => values.map(value => metadata.get(value)?.retainedRecord).filter(Boolean);
  const set = (key, value, state, owner, { preserve = [] } = {}) => {
    const entry = stage(key, value, state, owner), cost = measure(value);
    const previous = Map.prototype.get.call(entries, key), protectedEntries = tokens(preserve);
    if (cost === undefined || !budget.canAdmit({ cost, owner: 'picker:' + owner, preserve: protectedEntries, replace: entry.record })) {
      if (previous === entry.retainedRecord) { budget.forget(previous); entries.delete(key); }
      return false;
    }
    if (previous === entry.record && budget.touch(previous)) return true;
    if (previous) budget.forget(previous);
    const record = entry.record;
    if (!budget.admit(record, discardSnapshot(entries, key, record), { cost, owner: 'picker:' + owner, preserve: protectedEntries }))
      throw new Error('Snapshot admission preflight mismatch.');
    Map.prototype.set.call(entries, key, record);
    entry.retainedRecord = record;
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
    // No separately resident planning graph or captured prediction state.
    planningCharge: () => 0,
    capture() {},
    refreshResult(result) { const value = results.get(result); if (value) refresh(value); },
  });
}
