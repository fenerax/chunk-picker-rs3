// Proof bytes never enter the ordinary eligibility/result caches.
export function createHowCache({ entries = 16, bytes = 1024 * 1024 } = {}) {
  const cache = new Map(); let size = 0;
  return {
    get(key) {
      const value = cache.get(key); if (!value) return undefined;
      cache.delete(key); cache.set(key, value); return JSON.parse(value);
    },
    set(key, proof) {
      const value = JSON.stringify(proof), length = Buffer.byteLength(value);
      if (length > 65536 || length > bytes) return;
      if (cache.has(key)) { size -= Buffer.byteLength(cache.get(key)); cache.delete(key); }
      cache.set(key, value); size += length;
      while (cache.size > entries || size > bytes) {
        const first = cache.keys().next().value; size -= Buffer.byteLength(cache.get(first)); cache.delete(first);
      }
    },
  };
}
