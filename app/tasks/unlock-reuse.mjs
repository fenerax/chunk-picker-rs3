import { createHash } from 'node:crypto';
import { constants as zlibConstants, crc32, gzipSync, gunzipSync } from 'node:zlib';

const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
const staticFields = new Set(['tasks', 'identityRegistry', 'legacy']);

/** Calculation snapshots own immutable trees. Cache their large catalogue and
 * registry digests without retaining those trees. Everything else is hashed on
 * each call. Roll bookkeeping is not consumed by task/access calculation;
 * actual unlocked chunks, personal progress, rules and overrides all remain.
 * Preferences follow storage's display-only gameplay-fingerprint boundary. */
export function createTaskReuseFingerprint() {
  const staticDigests = new WeakMap();
  return state => {
    const fields = [];
    for (const key of Object.keys(state).sort()) {
      if (['revision', 'history', 'provenance', 'taskClaims', 'progressSnapshots', 'finishLine'].includes(key)) continue;
      let value = state[key];
      if (key === 'members') value = value.map(({ selected, pendingRoll, blacklisted, preferences, chunkColours, chunkColourNames, ...member }) => member);
      const reusable = staticFields.has(key) && value && typeof value === 'object';
      let fingerprint = reusable ? staticDigests.get(value) : undefined;
      if (!fingerprint) {
        fingerprint = digest(value);
        if (reusable) staticDigests.set(value, fingerprint);
      }
      fields.push([key, fingerprint]);
    }
    return digest(fields);
  };
}

/** Mutable/direct callers receive a fresh calculation every time. */
export const taskReuseInputKey = state => createTaskReuseFingerprint()(state);

/** The prediction response cache and this cache divide one total byte budget.
 * Store worker gzip prefixes, releasing its large shared projections; direct
 * callers can use synchronous gzip fallback. Inflate projections lazily and
 * evict complete prediction origins together.
 * Priority: explicit Preview 3, pending roll 2, selected 1, bulk pool 0. */
export function createUnlockResultCache({ limit, byteLimit }) {
  const entries = new Map();
  const projectionKeys = ['playJSON', 'duoJSON', 'duoSidebarJSON'];
  let bytes = 0, rawBytes = 0, hits = 0, admitted = 0, skipped = 0;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; rawBytes -= entry.rawBytes; entries.delete(key); }
  };
  const origin = (key, entry) => entry.predictionKey === undefined ? `entry:${key}` : `prediction:${entry.predictionKey}`;
  const valid = message => message && typeof message.taskInputKey === 'string' && /^[a-f0-9]{64}$/.test(message.taskInputKey)
    && typeof message.memberId === 'string' && Number.isSafeInteger(message.sourceRevision) && message.sourceRevision >= 0
    && projectionKeys.every(key => message[key] instanceof SharedArrayBuffer)
    && (message.gzipJSONPrefixes === undefined || message.gzipJSONPrefixes !== null && typeof message.gzipJSONPrefixes === 'object'
      && !Array.isArray(message.gzipJSONPrefixes) && Object.entries(message.gzipJSONPrefixes).every(([key, prefix]) =>
        projectionKeys.includes(key) && prefix instanceof SharedArrayBuffer && prefix.byteLength > 0 && Buffer.from(message[key]).at(-1) === 125))
    && (message.gzipJSONPrefixMetadata === undefined || message.gzipJSONPrefixMetadata !== null && typeof message.gzipJSONPrefixMetadata === 'object'
      && !Array.isArray(message.gzipJSONPrefixMetadata) && Object.entries(message.gzipJSONPrefixMetadata).every(([key, value]) =>
        projectionKeys.includes(key) && message.gzipJSONPrefixes?.[key] instanceof SharedArrayBuffer
        && value && Object.keys(value).length === 2 && Object.hasOwn(value, 'crc32') && Object.hasOwn(value, 'rawLength')
        && Number.isInteger(value.crc32) && value.crc32 >= 0 && value.crc32 <= 0xffffffff
        && Number.isSafeInteger(value.rawLength) && value.rawLength === message[key].byteLength - 1));
  const cache = {
    admit(message, priority = 0, predictionKey) { return cache.admitMany([message], priority, predictionKey); },
    admitMany(messages, priority = 0, predictionKey) {
      if (!Array.isArray(messages) || !messages.length || !messages.every(valid)
        || !Number.isInteger(priority) || priority < 0 || priority > 3
        || predictionKey !== undefined && typeof predictionKey !== 'string') return false;
      const staged = new Map();
      for (const message of messages) {
        const key = JSON.stringify([message.taskInputKey, message.memberId]), previous = entries.get(key);
        if (staged.has(key)) return false;
        const retainedOrigin = predictionKey ?? previous?.predictionKey;
        const metadata = { taskInputKey: message.taskInputKey, memberId: message.memberId, sourceRevision: message.sourceRevision };
        const metadataBytes = Buffer.byteLength(JSON.stringify([message.taskInputKey, message.memberId, message.sourceRevision,
          ...(retainedOrigin === undefined ? [] : [retainedOrigin])]));
        const finalBytes = {}, prefixMetadata = {}, projections = Object.fromEntries(projectionKeys.map(key => {
          const raw = Buffer.from(message[key]);
          // A final object brace can be supplied by a tiny response suffix.
          // Store only one compressed representation; get restores exact bytes.
          if (raw.at(-1) === 125) finalBytes[key] = 125;
          const prepared = message.gzipJSONPrefixes?.[key];
          if (prepared) {
            if (message.gzipJSONPrefixMetadata?.[key]) prefixMetadata[key] = { ...message.gzipJSONPrefixMetadata[key] };
            return [key, Buffer.from(new Uint8Array(prepared))];
          }
          if (finalBytes[key] === undefined) return [key, gzipSync(raw, { level: 1 })];
          const prefix = raw.subarray(0, -1);
          prefixMetadata[key] = { crc32: crc32(prefix), rawLength: prefix.length };
          return [key, gzipSync(prefix, { level: 1, finishFlush: zlibConstants.Z_SYNC_FLUSH })];
        }));
        const prefixMetadataBytes = Object.keys(prefixMetadata).length ? Buffer.byteLength(JSON.stringify(prefixMetadata)) : 0;
        staged.set(key, { metadata, projections, finalBytes, prefixMetadata, predictionKey: retainedOrigin, priority: Math.max(priority, previous?.priority ?? 0),
          bytes: metadataBytes + prefixMetadataBytes + Object.keys(finalBytes).length + projectionKeys.reduce((sum, key) => sum + projections[key].length, 0),
          rawBytes: metadataBytes + projectionKeys.reduce((sum, key) => sum + message[key].byteLength, 0) });
      }
      const incomingOrigins = new Set([...staged].map(([key, entry]) => origin(key, entry)));
      const groups = new Map();
      let nextBytes = 0, nextCount = staged.size;
      for (const [key, entry] of entries) {
        if (staged.has(key)) continue;
        nextBytes += entry.bytes; nextCount++;
        const id = origin(key, entry), group = groups.get(id) ?? { keys: [], bytes: 0, priority: 0 };
        group.keys.push(key); group.bytes += entry.bytes; group.priority = Math.max(group.priority, entry.priority);
        groups.set(id, group);
      }
      // An intermediate own-member result may already be retained. Completing
      // its pair inherits interest expressed since that intermediate arrived.
      const originPriorities = new Map();
      for (const [key, entry] of staged) {
        const id = origin(key, entry);
        originPriorities.set(id, Math.max(originPriorities.get(id) ?? 0, entry.priority, groups.get(id)?.priority ?? 0));
      }
      for (const [key, entry] of staged) entry.priority = originPriorities.get(origin(key, entry));
      nextBytes += [...staged.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      const effectivePriority = Math.min(...[...staged.values()].map(entry => entry.priority));
      const prepared = [...incomingOrigins].some(id => (groups.get(id)?.keys.length ?? 0)
        + [...staged].filter(([key, entry]) => origin(key, entry) === id).length >= 2);
      const victims = [...groups].filter(([id, group]) => !incomingOrigins.has(id)
        && (group.priority < effectivePriority || effectivePriority === 3 && group.priority === 3
          || prepared && group.priority === effectivePriority && group.keys.length === 1))
        .sort(([, a], [, b]) => a.priority - b.priority || a.keys.length - b.keys.length);
      const evicted = [];
      while (nextCount > limit || nextBytes > byteLimit) {
        const victim = victims.shift();
        if (!victim) { skipped++; return false; }
        evicted.push(...victim[1].keys); nextCount -= victim[1].keys.length; nextBytes -= victim[1].bytes;
      }
      for (const key of evicted) remove(key);
      for (const [key, entry] of staged) {
        remove(key); entries.set(key, entry); bytes += entry.bytes; rawBytes += entry.rawBytes; admitted++;
      }
      return true;
    },
    touchPrediction(predictionKey) {
      // A cached Preview refreshes every member of its existing origin.
      if (typeof predictionKey !== 'string') return false;
      let touched = false;
      for (const [key, entry] of [...entries]) if (entry.predictionKey === predictionKey) {
        entry.priority = 3; entries.delete(key); entries.set(key, entry); touched = true;
      }
      return touched;
    },
    hasCompletePrediction(predictionKey, memberIds, sourceRevision) {
      if (typeof predictionKey !== 'string' || !Array.isArray(memberIds) || !memberIds.length
        || memberIds.some(id => typeof id !== 'string') || new Set(memberIds).size !== memberIds.length) return false;
      const signatures = new Map();
      for (const entry of entries.values()) {
        if (entry.predictionKey !== predictionKey || sourceRevision !== undefined && entry.metadata.sourceRevision !== sourceRevision) continue;
        const signature = JSON.stringify([entry.metadata.taskInputKey, entry.metadata.sourceRevision]);
        const members = signatures.get(signature) ?? new Set(); members.add(entry.metadata.memberId); signatures.set(signature, members);
      }
      return [...signatures.values()].some(members => memberIds.every(id => members.has(id)));
    },
    get(taskInputKey, memberId, revision) {
      const entry = entries.get(JSON.stringify([taskInputKey, memberId]));
      if (!entry || !Number.isSafeInteger(revision) || revision <= entry.metadata.sourceRevision) return undefined;
      const gzipJSONPrefixes = {}, value = { ...entry.metadata };
      for (const key of projectionKeys) {
        const finalByte = entry.finalBytes[key];
        if (finalByte !== undefined) gzipJSONPrefixes[key] = Buffer.from(entry.projections[key]);
        let inflated;
        Object.defineProperty(value, key, { enumerable: true, get() {
          if (inflated === undefined) {
            const prefix = gunzipSync(entry.projections[key], entry.prefixMetadata[key] ? { finishFlush: zlibConstants.Z_SYNC_FLUSH } : {});
            inflated = finalByte === undefined ? prefix : Buffer.concat([prefix, Buffer.from([finalByte])]);
          }
          return inflated;
        } });
      }
      if (Object.keys(gzipJSONPrefixes).length) value.gzipJSONPrefixes = gzipJSONPrefixes;
      if (Object.keys(entry.prefixMetadata).length) value.gzipJSONPrefixMetadata = Object.fromEntries(
        Object.entries(entry.prefixMetadata).map(([key, metadata]) => [key, { ...metadata }]));
      hits++;
      return value;
    },
    supersede(revision) {
      for (const [key, entry] of entries) if (entry.metadata.sourceRevision < revision - 1) remove(key);
    },
    clear() { entries.clear(); bytes = 0; rawBytes = 0; },
    getDiagnostics: () => ({ entries: entries.size, bytes, compressedBytes: bytes, rawBytes, encoding: 'gzip',
      limit, byteLimit, hits, admitted, skipped }),
  };
  return cache;
}
