import path from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { preparationSourceDigest } from '../preparation-key.mjs';
import { createWarmStore, warmStoreAllowed, warmHash, WARM_RESULT_LIMITS } from './warm-store.mjs';
import { createHash } from 'node:crypto';
import { hasResidentIdentities } from '../core/resident-copy.mjs';
import { identityJSONParts } from './identity-dictionary.mjs';

const buffers = ['resultJSON', 'playJSON', 'duoJSON', 'duoSidebarJSON'];
const reuseBuffers = ['playJSON', 'duoJSON', 'duoSidebarJSON'];
function convert(value, names, restore) {
  const output = { ...value };
  for (const name of names) if (output[name] !== undefined) {
    if (restore) {
      if (!(output[name] instanceof Uint8Array)) throw new TypeError('Invalid warm bytes.');
      const shared = new SharedArrayBuffer(output[name].byteLength);
      Buffer.from(shared).set(output[name]); output[name] = shared;
    } else output[name] = Buffer.from(output[name]);
  }
  return output;
}
function packet(value, restore) {
  const output = convert(value, buffers, restore);
  for (const name of ['unlockReuse', 'partnerUnlockReuse']) if (output[name]) output[name] = convert(output[name], reuseBuffers, restore);
  return output;
}
export function warmResultNamespace(data, environment) {
  try {
    // Include every semantic worker input, including custom world/extra rules.
    // Operational flags and directory locations do not affect calculator output.
    const { warmStoreDirectory, warmStoreOwnerId, omitReadyCatalogue, collectPreparedCollection, preparedCollection, preparedCollectionFile, ...semantic } = data;
    if (semantic.definitionBytes !== undefined) semantic.definitionBytes = Buffer.from(semantic.definitionBytes);
    return warmHash(serialize([1, environment ?? { source: preparationSourceDigest(), node: process.versions.node, v8: process.versions.v8 }, semantic]));
  } catch { /* Unserializable injected inputs disable optional persistence. */ }
}
export function warmResultKey(namespace, request) {
  try {
    if (!/^[a-f0-9]{64}$/.test(namespace) || !['evaluate', 'predict', 'roll-pool'].includes(request.type)
      || !Number.isSafeInteger(request.state?.revision) || request.state.revision < 0) return;
    // Full hydrated calculation bytes plus revision: inputKey alone is never
    // trusted as proof of save identity, even for direct calculator clients.
    if (!hasResidentIdentities(request.state)) return warmHash(JSON.stringify([1, namespace, request]));
    const hash = createHash('sha256');
    for (const part of identityJSONParts([1, namespace, request])) hash.update(part);
    return hash.digest('hex');
  } catch { /* Optional miss. */ }
}
export function createWarmResults(data, options = {}) {
  if (!warmStoreAllowed() || typeof data.warmStoreDirectory !== 'string') return;
  const namespace = Object.hasOwn(options, 'namespace') ? options.namespace : warmResultNamespace(data);
  const store = createWarmStore(path.join(data.warmStoreDirectory, 'results'), WARM_RESULT_LIMITS);
  if (!namespace || !store) return;
  return {
    key: request => warmResultKey(namespace, request),
    get(key) {
      if (!warmStoreAllowed() || !key) return;
      try {
        const bytes = store.get(key);
        if (!bytes) return;
        const value = deserialize(bytes);
        if (!value || typeof value !== 'object' || !value.result && !value.playJSON || value.error || value.cancelled || value.result?.cancelled) return;
        return packet(value, true);
      } catch { /* Invalid serialization is a miss. */ }
    },
    put(key, value) {
      if (!warmStoreAllowed() || !key || value.error || value.cancelled || value.result?.cancelled) return;
      try { store.put(key, serialize(packet(value, false))); } catch { /* Recompute after a write miss. */ }
    },
  };
}
