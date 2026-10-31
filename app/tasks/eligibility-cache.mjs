import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { gzipSync, gunzipSync } from 'node:zlib';
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

// Retain lossless compressed bytes so shared workers can keep many proofs.
// Copy out of zlib's output slab rather than retaining its unused capacity.
// Decoding on a hit still gives callers private, mutable rows. Keep engine facts
// explicitly: neither structured cloning nor V8 serialization keeps descriptors.
function retainResult(result) {
  const bytes = gzipSync(serialize({ result, processing: result.processing,
    primary: result.tasks.map(row => row.processingPrimary),
    metrics: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(result.metrics))
      .filter(([, descriptor]) => !descriptor.enumerable)) }), { level: 1 });
  if (bytes.buffer.byteLength === bytes.byteLength) return bytes;
  const compact = Buffer.allocUnsafeSlow(bytes.byteLength);
  bytes.copy(compact);
  return compact;
}

function copyResult(bytes) {
  const copy = deserialize(gunzipSync(bytes));
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
  let retainedBytes = 0, snapshotRetainedBytes = 0;
  const owners = new Map();
  const release = (token, entry) => {
    retained.delete(token); retainedBytes -= entry.cost;
    if (entry.owner !== 'eligibility') snapshotRetainedBytes -= entry.cost;
    const remaining = owners.get(entry.owner) - entry.cost;
    if (remaining) owners.set(entry.owner, remaining); else owners.delete(entry.owner);
  };
  return Object.freeze({
    get byteLimit() { return byteLimit; },
    get entryLimit() { return entryLimit; },
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
    admit(bytes, onEvict, { cost = backingBytes(bytes), owner = 'eligibility' } = {}) {
      const ownerLimit = owner === 'eligibility' ? eligibilityByteLimit : ownerByteLimit;
      if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Invalid cache byte cost.');
      if (cost > byteLimit || cost > ownerLimit || owner !== 'eligibility' && cost > snapshotByteLimit || entryLimit === 0) return false;
      if (retained.has(bytes)) throw new TypeError('Cache entry is already retained.');
      // A noisy picker evicts its own oldest entries before displacing peers.
      while ((owners.get(owner) ?? 0) + cost > ownerLimit) {
        const [oldest, entry] = [...retained].find(([, entry]) => entry.owner === owner);
        release(oldest, entry); entry.onEvict();
      }
      // Snapshot churn cannot consume the fixed space reserved for proofs.
      // Both snapshot kinds share this pool and its cross-picker LRU.
      while (owner !== 'eligibility' && snapshotRetainedBytes + cost > snapshotByteLimit) {
        const [oldest, entry] = [...retained].find(([, entry]) => entry.owner !== 'eligibility');
        release(oldest, entry); entry.onEvict();
      }
      while (retainedBytes + cost > byteLimit || retained.size >= entryLimit) {
        const [oldest, entry] = retained.entries().next().value;
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
        result = copyResult(cached);
      } else {
        // Release the oldest retained proof before computing its replacement.
        if (entries.size >= limit) evict();
        result = compute();
        const bytes = retainResult(result);
        // Oversized proofs are returned normally but never retained. Global
        // eviction removes the owning variant's reference as well as the ledger.
        if (budget.admit(bytes, () => discard(key, bytes))) {
          entries.set(key, bytes); retainedBytes += backingBytes(bytes);
        }
      }
      Object.defineProperty(result.metrics, 'eligibilityCacheHit', { value: !!cached });
      return applyCompletionOverlay(result, state, memberId);
    },
  };
}
