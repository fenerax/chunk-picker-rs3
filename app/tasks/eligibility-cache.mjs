import { createHash } from 'node:crypto';
import { serialize, deserialize, DefaultDeserializer } from 'node:v8';
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib';
import { automaticTravelInputKey } from '../core/travel-inputs.mjs';

// Use the conservative travel proof boundary: every personal completion and
// explicit backlog value remains an input. Challenge satisfaction is overlaid
// afterwards. In particular we do not infer that a completed ordinary-looking
// row is harmless: it can seed training, processing, items or access elsewhere.
export function eligibilityInputKey(state, memberId, options) {
  // With sharing and typed travel disabled, another member cannot supply access,
  // training or items. Keep roster identity/order for explanations and overlays.
  const independent = state.rules?.['access.shared'] === false
    && state.rules?.['travel.automatic'] !== true && state.rules?.['access.transport'] !== true;
  const input = independent ? { ...state, members: state.members.map(member => member.id === memberId ? member
    : { id: member.id, name: member.name, sourceMapId: member.sourceMapId }) } : state;
  return createHash('sha256').update(automaticTravelInputKey(input)).update(JSON.stringify([memberId, options ?? null])).digest('hex');
}

// Cold replies retain their already serialized proof first. Idle compression
// replaces it only with a smaller backing store; the full original buffer stays
// charged until that replacement. No pending job owns evicted buffers.
const compressed = new WeakSet(), compacted = new WeakSet();
// Reuse the producer's wire measurement without retaining an extra buffer.
// Weak references keep evicted/decompressed wire storage outside this metadata.
const resultMeasurements = new WeakMap();
export function eligibilityResultBytes(result) {
  const measurement = resultMeasurements.get(result);
  if (!measurement) return;
  if (measurement.bytes !== undefined) return measurement.bytes + measurement.overlay;
  const wire = measurement.wire.deref();
  if (!wire || wire[0] !== 0xff || wire[1] !== 0x0f) return;
  let bytes = wire.byteLength;
  // Embedding can widen uint32 object references and change UTF-16 padding.
  // Counting matching payload bytes as tags deliberately overestimates.
  for (const [tag, extra] of [[0x5e, 4], [0x63, 1]])
    for (let i = wire.indexOf(tag); i !== -1; i = wire.indexOf(tag, i + 1)) bytes += extra;
  measurement.bytes = bytes; measurement.wire = undefined;
  return bytes + measurement.overlay;
}
function retainResult(result, measure = false) {
  const wire = serialize({ result, processing: result.processing,
    primary: result.tasks.map(row => row.processingPrimary),
    metrics: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(result.metrics))
      .filter(([, descriptor]) => !descriptor.enumerable)) });
  if (measure) resultMeasurements.set(result, { wire: new WeakRef(wire), overlay: 0 });
  return wire;
}
function compactResult(raw) {
  compacted.add(raw);
  try {
    const bytes = zstdCompressSync(raw, { params: { [constants.ZSTD_c_compressionLevel]: 1 } });
    if (bytes.byteLength >= raw.buffer.byteLength) return raw;
    const compact = Buffer.allocUnsafeSlow(bytes.byteLength);
    bytes.copy(compact); compressed.add(compact); compacted.add(compact);
    return compact;
  } catch {
    // Compression is optional. Keep the original backing store fully charged
    // on failure, including when this runs outside the request error handler.
    return raw;
  }
}

// Default decoding can expose typed-array views into the wire buffer. Copy
// those views, rather than copying a large immutable buffer of object/string
// data. V8 still owns object-reference tracking, including repeated views.
class PrivateProofDeserializer extends DefaultDeserializer {
  _readHostObject() {
    const view = super._readHostObject();
    if (Buffer.isBuffer(view)) return Buffer.from(view);
    if (view instanceof DataView) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
      return new DataView(bytes.buffer);
    }
    return view.slice();
  }
}
function deserializePrivate(bytes) {
  const reader = new PrivateProofDeserializer(bytes);
  reader.readHeader(); return reader.readValue();
}
function copyResult(bytes, measure = false) {
  const wire = compressed.has(bytes) ? zstdDecompressSync(bytes) : bytes;
  const copy = compressed.has(bytes) ? deserialize(wire) : deserializePrivate(wire);
  if (measure) resultMeasurements.set(copy.result, { wire: new WeakRef(wire), overlay: 0 });
  if (copy.processing !== undefined) Object.defineProperty(copy.result, 'processing', { value: copy.processing });
  copy.result.tasks.forEach((row, index) => {
    if (copy.primary[index] !== undefined) Object.defineProperty(row, 'processingPrimary', { value: copy.primary[index] });
  });
  Object.defineProperties(copy.result.metrics, copy.metrics);
  return copy.result;
}

export function applyCompletionOverlay(result, state, memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  const scope = state.rules?.['tasks.completion'] ?? 'any';
  const owners = scope === 'personal' ? [member] : state.members;
  const completed = new Map(owners.map(owner => [owner, new Set(owner.completedTasks ?? [])]));
  const measurement = resultMeasurements.get(result);
  if (measurement) measurement.overlay = Math.max(measurement.overlay, result.tasks.reduce((bytes, row) => bytes + (Object.hasOwn(row, 'challengeSatisfied') ? 0 : 24), 0));
  for (const row of result.tasks) {
    const done = owner => completed.get(owner).has(row.id) || !!owner.taskStatus?.[row.id]?.challengeCompleted;
    row.challengeSatisfied = scope === 'all' ? owners.every(done) : owners.some(done);
  }
  return result;
}

const backingBytes = bytes => bytes.buffer.byteLength;

/** One byte ledger can span all compiled variants without sharing their values.
 * Charge complete backing stores (including allocator slack), not buffer slices.
 * The entry limits still bound keys, Buffer handles and eviction callbacks. */
export function createEligibilityBudget({ byteLimit = 384 * 1024 * 1024, entryLimit = 512, ownerByteLimit = byteLimit, eligibilityByteLimit = ownerByteLimit, snapshotByteLimit = byteLimit } = {}) {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 0 || !Number.isSafeInteger(entryLimit) || entryLimit < 0 || !Number.isSafeInteger(ownerByteLimit) || ownerByteLimit < 0 || !Number.isSafeInteger(eligibilityByteLimit) || eligibilityByteLimit < 0 || !Number.isSafeInteger(snapshotByteLimit) || snapshotByteLimit < 0) throw new TypeError('Invalid eligibility byte budget.');
  const retained = new Map();
  let measuringResult = false;
  let retainedBytes = 0, snapshotRetainedBytes = 0;
  const owners = new Map();
  const release = (token, entry) => {
    retained.delete(token); retainedBytes -= entry.cost;
    if (entry.owner !== 'eligibility') snapshotRetainedBytes -= entry.cost;
    const remaining = owners.get(entry.owner) - entry.cost;
    if (remaining) owners.set(entry.owner, remaining); else owners.delete(entry.owner);
  };
  const canAdmit = ({ cost, owner = 'eligibility', preserve = [], replace }) => {
    const ceiling = owner === 'eligibility' ? eligibilityByteLimit : ownerByteLimit;
    if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid cache byte cost.');
    if (cost > byteLimit || cost > ceiling || owner !== 'eligibility' && cost > snapshotByteLimit || entryLimit === 0) return false;
    let total = cost, own = cost, snapshots = owner === 'eligibility' ? 0 : cost, count = 1;
    for (const token of new Set(preserve)) {
      const entry = token === replace ? undefined : retained.get(token); if (!entry) continue;
      total += entry.cost; count++; if (entry.owner === owner) own += entry.cost;
      if (entry.owner !== 'eligibility') snapshots += entry.cost;
    }
    return total <= byteLimit && own <= ceiling && snapshots <= snapshotByteLimit && count <= entryLimit;
  };
  return Object.freeze({
    get byteLimit() { return byteLimit; },
    get measuringResult() { return measuringResult; },
    measureResult(operation) {
      const previous = measuringResult; measuringResult = true;
      try { return operation(); } finally { measuringResult = previous; }
    },
    get pickerOwners() { return [...owners.keys()].filter(owner => typeof owner === 'string' && owner.startsWith('picker:')).length; },
    get ownerByteLimit() { return ownerByteLimit; },
    canAdmit,
    get entryLimit() { return entryLimit; },
    get eligibilityByteLimit() { return eligibilityByteLimit; },
    get bytes() { return retainedBytes; },
    get size() { return retained.size; },
    forget(bytes) {
      const entry = retained.get(bytes);
      if (!entry) return false;
      release(bytes, entry);
      return true;
    },
    touch(bytes) {
      const entry = retained.get(bytes);
      if (!entry) return false;
      retained.delete(bytes); retained.set(bytes, entry);
      return true;
    },
    admit(bytes, onEvict, { cost = backingBytes(bytes), owner = 'eligibility', preserve = [] } = {}) {
      const ownerLimit = owner === 'eligibility' ? eligibilityByteLimit : ownerByteLimit;
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid cache byte cost.');
      if (!canAdmit({ cost, owner, preserve })) return false;
      const protectedEntries = new Set(preserve);
      if (retained.has(bytes)) throw new TypeError('Cache entry is already retained.');
      // A noisy picker evicts its own oldest entries before displacing peers.
      while ((owners.get(owner) ?? 0) + cost > ownerLimit) {
        const [oldest, entry] = [...retained].find(([token, entry]) => entry.owner === owner && !protectedEntries.has(token));
        release(oldest, entry); entry.onEvict();
      }
      // Snapshot churn cannot consume the fixed space reserved for proofs.
      // Both snapshot kinds share this pool and its cross-picker LRU.
      while (owner !== 'eligibility' && snapshotRetainedBytes + cost > snapshotByteLimit) {
        const [oldest, entry] = [...retained].find(([token, entry]) => entry.owner !== 'eligibility' && !protectedEntries.has(token));
        release(oldest, entry); entry.onEvict();
      }
      while (retainedBytes + cost > byteLimit || retained.size >= entryLimit) {
        const [oldest, entry] = [...retained].find(([token]) => !protectedEntries.has(token));
        release(oldest, entry); entry.onEvict();
      }
      retained.set(bytes, { cost, owner, onEvict }); retainedBytes += cost;
      if (owner !== 'eligibility') snapshotRetainedBytes += cost;
      owners.set(owner, (owners.get(owner) ?? 0) + cost);
      return true;
    },
  });
}

export function createEligibilityCache({ limit = 2, byteLimit = 128 * 1024 * 1024, budget } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(byteLimit) || byteLimit < 0) throw new TypeError('Invalid eligibility cache bound.');
  budget ??= createEligibilityBudget({ byteLimit });
  const entries = new Map();
  let retainedBytes = 0;
  const discard = (key, bytes) => {
    if (!entries.delete(key)) return;
    retainedBytes -= backingBytes(bytes); budget.forget(bytes);
  };
  let compactionPending = false;
  const compactWhenIdle = () => {
    if (compactionPending) return;
    compactionPending = true;
    setImmediate(() => {
      compactionPending = false;
      const newest = [...entries.values()].at(-1);
      for (const [key, raw] of entries) {
        if (compacted.has(raw)) continue;
        // One interactive picker benefits from raw decoding of its newest proof.
        // Every backing byte stays charged; other proofs and shared pickers
        // retain the existing compression policy.
        if (budget.pickerOwners === 1 && raw === newest && backingBytes(raw) <= budget.eligibilityByteLimit / 2) continue;
        const bytes = compactResult(raw);
        if (bytes === raw) continue;
        discard(key, raw);
        if (!budget.admit(bytes, () => discard(key, bytes))) throw new Error('Eligibility compaction accounting mismatch.');
        entries.set(key, bytes); retainedBytes += backingBytes(bytes);
      }
    }).unref();
  };
  const evict = () => {
    const [key, bytes] = entries.entries().next().value;
    discard(key, bytes);
  };
  return {
    get size() { return entries.size; },
    get bytes() { return retainedBytes; },
    evaluate(state, memberId, options, compute) {
      // Automatic travel owns its separate baseline. Do not retain the same
      // large capability proof twice. Zero bounds also explicitly disable reuse.
      if (options?.reuseEligibility === false || limit === 0 || budget.byteLimit === 0 || budget.entryLimit === 0) {
        const result = compute();
        Object.defineProperty(result.metrics, 'eligibilityCacheHit', { value: false });
        return applyCompletionOverlay(result, state, memberId);
      }
      const key = eligibilityInputKey(state, memberId, options);
      const cached = entries.get(key);
      let result;
      if (cached) {
        entries.delete(key); entries.set(key, cached);
        if (!budget.touch(cached)) throw new Error('Eligibility cache accounting mismatch.');
        result = copyResult(cached, budget.measuringResult);
      } else {
        // Release the oldest retained proof before computing its replacement.
        if (entries.size >= limit) evict();
        result = compute();
        let bytes = retainResult(result, budget.measuringResult);
        // An oversized raw proof is compacted before it can displace peers.
        // A single picker reserves half its proof quota for the hot raw proof.
        if (backingBytes(bytes) < 65536 || backingBytes(bytes) > budget.eligibilityByteLimit / (budget.pickerOwners === 1 ? 2 : 1)) bytes = compactResult(bytes);
        // Oversized proofs are returned normally but never retained. Global
        // eviction removes the owning variant's reference as well as the ledger.
        if (budget.admit(bytes, () => discard(key, bytes))) {
          entries.set(key, bytes); retainedBytes += backingBytes(bytes); compactWhenIdle();
        }
      }
      Object.defineProperty(result.metrics, 'eligibilityCacheHit', { value: !!cached });
      return applyCompletionOverlay(result, state, memberId);
    },
  };
}
