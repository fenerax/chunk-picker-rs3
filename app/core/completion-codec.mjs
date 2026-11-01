// Completion-array persistence codec. Gameplay and exposed History keep their
// existing full-array leaves; every encoded document owns all of its anchors.
export const COMPLETION_BACKUP_VERSION = 2;
const utf8 = new TextEncoder();
const utf8Bytes = text => utf8.encode(text).length;
// Synchronous SHA-256 for the existing synchronous browser import boundary.
// Storage injects the native implementation; both hash the exact UTF-8 JSON.
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const rotate = (word, count) => word >>> count | word << 32 - count;
function sha256(text) {
  const bytes = utf8.encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(size); padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer), bits = bytes.length * 8;
  view.setUint32(size - 8, Math.floor(bits / 2 ** 32)); view.setUint32(size - 4, bits >>> 0);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  for (let block = 0; block < size; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10);
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const first = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + K[i] + words[i];
      const second = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c);
      h = g; g = f; f = e; e = d + first | 0; d = c; c = b; b = a; a = first + second | 0;
    }
    for (const [i, word] of [a, b, c, d, e, f, g, h].entries()) hash[i] = hash[i] + word | 0;
  }
  return hash.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
}
const equal = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const ids = value => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0) && new Set(value).size === value.length;
const fail = () => { throw new TypeError('Invalid completion-array codec v1.'); };
// Match the portable import limit before a small splice graph can allocate an
// unbounded expanded history. Count UTF-8 JSON bytes, including repeated leaves.
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

function mapHistory(history, visit) {
  if (!Array.isArray(history)) return history;
  return history.map(event => {
    if (!Array.isArray(event?.undo?.memberChanges)) return event;
    return { ...event, undo: { ...event.undo, memberChanges: event.undo.memberChanges.map(member => ({ ...member,
      changes: member.changes.map(patch => {
        if (patch.kind !== 'value' || patch.path?.length !== 1 || patch.path[0] !== 'completedTasks') return patch;
        return { ...patch, before: visit(patch.before, member.id), after: visit(patch.after, member.id) };
      }) })) } };
  });
}

/** Store-local cache only holds immutable source arrays weakly. Entries in a
 * document are numbered afresh, so no file depends on a previous revision. */
export function createCompletionEncoder({ hashJSON = sha256, byteLength = utf8Bytes } = {}) {
  const hashes = new WeakMap(), splices = new WeakMap();
  const describe = value => {
    if (!hashes.has(value)) {
      const json = JSON.stringify(value);
      hashes.set(value, { sha256: hashJSON(json), chars: json.length, bytes: byteLength(json) });
    }
    return hashes.get(value);
  };
  return document => {
    const entries = [], seen = new Map(), previous = new Map();
    let expandedBytes = 0;
    const history = mapHistory(document.state.history, (side, memberId) => {
      if (!side?.exists || !Array.isArray(side.value)) return side;
      const value = side.value, { sha256, chars, bytes } = describe(value);
      expandedBytes += bytes;
      let index = seen.get(sha256);
      if (index === undefined) {
        index = entries.length;
        const base = previous.get(memberId);
        let entry = { value, sha256 };
        if (base) {
          if (!splices.has(base.value)) splices.set(base.value, new WeakMap());
          const cache = splices.get(base.value);
          if (!cache.has(value)) {
            let at = 0, suffix = 0;
            while (at < base.value.length && at < value.length && base.value[at] === value[at]) at++;
            while (suffix < base.value.length - at && suffix < value.length - at
              && base.value[base.value.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
            const splice = { at, remove: base.value.slice(at, base.value.length - suffix),
              insert: value.slice(at, value.length - suffix), length: value.length, sha256 };
            const anchorChars = chars + JSON.stringify({ value: [], sha256 }).length - 2;
            cache.set(value, JSON.stringify({ base: base.index, ...splice }).length < anchorChars ? splice : null);
          }
          const splice = cache.get(value);
          if (splice) entry = { base: base.index, ...splice };
        }
        entries.push(entry);
        seen.set(sha256, index);
      }
      previous.set(memberId, { index, value });
      return { exists: true, value: { completionArray: index } };
    });
    // Never commit a compact document that our bounded decoder would refuse.
    // Very large existing stores retain their legacy format unchanged.
    if (!entries.length || expandedBytes > MAX_EXPANDED_BYTES) return document;
    return { ...document, schemaVersion: COMPLETION_BACKUP_VERSION, state: { ...document.state, history },
      completionArrays: { version: 1, entries } };
  };
}

/** Expand before normal state validation, migration, hooks or commands. Never
 * mutate an imported object, including its arrays or historical snapshots. */
export function decodeCompletionDocument(document, { hashJSON = sha256, byteLength = utf8Bytes } = {}) {
  if (document?.schemaVersion !== COMPLETION_BACKUP_VERSION) {
    if (document?.completionArrays !== undefined) fail();
    return document;
  }
  const codec = document.completionArrays;
  if (!keys(codec, ['version', 'entries']) || codec.version !== 1 || !Array.isArray(codec.entries) || !codec.entries.length) fail();
  if (!record(document.state) || !Array.isArray(document.state.history)) fail();
  const arrays = [], sizes = [];
  let allocated = 0;
  for (const entry of codec.entries) {
    let value, bytes;
    if (keys(entry, ['value', 'sha256'])) {
      if (!ids(entry.value)) fail();
      value = entry.value;
      bytes = byteLength(JSON.stringify(value));
    } else {
      if (!keys(entry, ['base', 'at', 'remove', 'insert', 'length', 'sha256'])
        || !Number.isSafeInteger(entry.base) || entry.base < 0 || entry.base >= arrays.length
        || !Number.isSafeInteger(entry.at) || entry.at < 0
        || !Number.isSafeInteger(entry.length) || entry.length < 0 || !ids(entry.remove) || !ids(entry.insert)) fail();
      const base = arrays[entry.base];
      if (entry.at + entry.remove.length > base.length || entry.length !== base.length - entry.remove.length + entry.insert.length
        || !equal(base.slice(entry.at, entry.at + entry.remove.length), entry.remove)) fail();
      // JSON array item bytes are additive after removing brackets/commas.
      const itemBytes = values => values.reduce((sum, id) => sum + byteLength(JSON.stringify(id)) + 1, 0);
      bytes = sizes[entry.base] - (base.length ? 1 : 2) - itemBytes(entry.remove) + itemBytes(entry.insert) + (entry.length ? 1 : 2);
      if (allocated + bytes > MAX_EXPANDED_BYTES) fail();
      value = [...base.slice(0, entry.at), ...entry.insert, ...base.slice(entry.at + entry.remove.length)];
      if (value.length !== entry.length || !ids(value)) fail();
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || hashJSON(JSON.stringify(value)) !== entry.sha256) fail();
    allocated += bytes;
    if (allocated > MAX_EXPANDED_BYTES) fail();
    arrays.push(value);
    sizes.push(bytes);
  }
  let references = 0, expanded = 0;
  const history = mapHistory(document.state.history, side => {
    // A v2 document may mix old full-array leaves and encoded leaves.
    if (!side?.exists || Array.isArray(side.value)) return side;
    if (!keys(side, ['exists', 'value']) || side.exists !== true || !keys(side.value, ['completionArray'])
      || !Number.isSafeInteger(side.value.completionArray) || side.value.completionArray < 0 || side.value.completionArray >= arrays.length) fail();
    references++;
    expanded += sizes[side.value.completionArray];
    if (expanded > MAX_EXPANDED_BYTES) fail();
    // Keep the public mutable-input boundary independent even when references
    // in the file share an array. The owned store can share decoded arrays.
    return { exists: true, value: arrays[side.value.completionArray] };
  });
  if (!references) fail();
  const { completionArrays, ...envelope } = document;
  return { ...envelope, schemaVersion: 1, state: { ...document.state, history } };
}
