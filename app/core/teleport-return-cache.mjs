// Like the automatic baseline cache, worlds own a small content-keyed LRU.
// Store decisions only, never saves, task rows, geometry or request objects.
export function createTeleportReturnCache({ maxEntries = 16 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) throw new TypeError('Invalid return cache bound.');
  const worlds = new WeakMap();
  return {
    clear(world) { worlds.delete(world); },
    evaluate(world, key, compute) {
      let entries = worlds.get(world);
      if (!entries) { entries = new Map(); worlds.set(world, entries); }
      let value = entries.get(key);
      if (value === undefined) value = compute();
      entries.delete(key); entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    },
  };
}

export const teleportReturnCache = createTeleportReturnCache();
