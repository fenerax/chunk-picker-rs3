// A conservative fingerprint: collisions only decline a cache hit/publication.
// Every actual read/path intersection still intersects the corresponding bits.
export function createObligationCache({ enabled = true, maxEntries = 4096, hashBits = 256 } = {}) {
  if (![1, 2, 4, 8, 16, 32, 64, 128, 256].includes(hashBits)) throw new TypeError('Invalid footprint width.');
  const entries = new Map(), masks = new Map();
  let active;
  function mask(key) {
    let value = masks.get(key);
    if (value !== undefined) return value;
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    value = 1n << BigInt(hash & (hashBits - 1));
    if (masks.size >= 32768) masks.delete(masks.keys().next().value);
    masks.set(key, value); return value;
  }
  return {
    clear() { entries.clear(); },
    evaluate(task, visiting, compute) {
      if (!enabled) return compute();
      let path = 0n;
      for (const key of visiting) path |= mask(key);
      const cached = entries.get(task);
      if (cached && !(cached.reads & path)) {
        if (active) active.reads |= cached.reads;
        return cached.value;
      }
      const parent = active, frame = { reads: mask(task.key) };
      active = frame;
      try {
        const value = compute();
        if (!(frame.reads & path) && maxEntries > 0) {
          entries.set(task, { value, reads: frame.reads });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        }
        return value;
      } finally {
        active = parent;
        if (parent) parent.reads |= frame.reads;
      }
    },
  };
}
