// Boolean path mode invokes a shared (task, path) evaluator on misses only.
// Omitting it, or passing a non-boolean, preserves the zero-argument thunk API.
function computeValue(task, visiting, compute, copyOnMiss) {
  return typeof copyOnMiss === 'boolean'
    ? compute(task, copyOnMiss ? new Set(visiting) : visiting ?? new Set())
    : compute();
}

// A conservative fingerprint: collisions only decline a cache hit/publication.
// Every actual read/path intersection still intersects the corresponding bits.
export function createObligationCache({ enabled = true, maxEntries = 4096, hashBits = 256 } = {}) {
  if (![1, 2, 4, 8, 16, 32, 64, 128, 256].includes(hashBits)) throw new TypeError('Invalid footprint width.');
  const entries = new Map(), masks = new Map();
  // FIFO rings avoid rescanning deleted Map slots on every eviction.
  const entryKeys = [], maskKeys = [], entryLimit = Math.max(0, Math.floor(maxEntries));
  let active, entryHead = 0, maskHead = 0;
  function retain(task, value) {
    if (entryLimit <= 0) return;
    if (!entries.has(task)) {
      if (entries.size >= entryLimit) {
        entries.delete(entryKeys[entryHead]); entryKeys[entryHead] = task;
        entryHead = (entryHead + 1) % entryLimit;
      } else entryKeys.push(task);
    }
    entries.set(task, value);
  }
  function mask(key) {
    let value = masks.get(key);
    if (value !== undefined) return value;
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    value = 1n << BigInt(hash & (hashBits - 1));
    if (masks.size >= 32768) {
      masks.delete(maskKeys[maskHead]); maskKeys[maskHead] = key;
      maskHead = (maskHead + 1) % 32768;
    } else maskKeys.push(key);
    masks.set(key, value); return value;
  }
  return {
    clear() { entries.clear(); entryKeys.length = 0; entryHead = 0; },
    release() { entries.clear(); masks.clear(); entryKeys.length = 0; maskKeys.length = 0; entryHead = maskHead = 0; },
    // Only for obligations whose sole path-dependent read is their own key.
    // Literal spatial/clue predicates have no recursive task dependencies.
    // Record that key in the enclosing proof even on a hit or cycle guard.
    evaluateLeaf(task, visiting, compute, copyOnMiss) {
      if (!enabled) return computeValue(task, visiting, compute, copyOnMiss);
      // A root hit needs no footprint merge. Recursive callers still record
      // the literal's exact cycle-guard read in their enclosing proof.
      if (active) active.reads |= mask(task.key);
      if (visiting?.has(task.key)) return computeValue(task, visiting, compute, copyOnMiss);
      const cached = entries.get(task);
      if (cached?.leaf) return cached.value;
      const value = computeValue(task, visiting, compute, copyOnMiss);
      if (entryLimit > 0) retain(task, { value, reads: mask(task.key), leaf: true });
      return value;
    },
    evaluate(task, visiting, compute, copyOnMiss) {
      if (!enabled) return computeValue(task, visiting, compute, copyOnMiss);
      let path = 0n;
      if (visiting) for (const key of visiting) path |= mask(key);
      const cached = entries.get(task);
      if (cached && !(cached.reads & path)) {
        if (active) active.reads |= cached.reads;
        return cached.value;
      }
      const parent = active, frame = { reads: mask(task.key) };
      active = frame;
      try {
        const value = computeValue(task, visiting, compute, copyOnMiss);
        if (!(frame.reads & path) && entryLimit > 0) retain(task, { value, reads: frame.reads });
        return value;
      } finally {
        active = parent;
        if (parent) parent.reads |= frame.reads;
      }
    },
  };
}
