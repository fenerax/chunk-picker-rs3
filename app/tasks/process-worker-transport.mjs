// Advanced child-process serialization preserves Maps, Sets and Buffer, but
// cannot carry SharedArrayBuffer. Placeholders are referenced from a separate
// envelope, so arbitrary user properties can never be mistaken for a tag.
function transform(value, replace, seen = new WeakMap()) {
  if (typeof value === 'function' || typeof value === 'symbol') throw new DOMException('Value cannot be cloned by a process worker.', 'DataCloneError');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const replacement = replace(value);
  if (replacement !== undefined) { seen.set(value, replacement); return replacement; }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer
    || value instanceof Date || value instanceof RegExp || value instanceof Error) return value;
  const copy = value instanceof Map ? new Map() : value instanceof Set ? new Set()
    : Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  if (value instanceof Map) for (const [key, entry] of value) copy.set(transform(key, replace, seen), transform(entry, replace, seen));
  else if (value instanceof Set) for (const entry of value) copy.add(transform(entry, replace, seen));
  else for (const key of Object.keys(value)) Object.defineProperty(copy, key, {
    value: transform(value[key], replace, seen), writable: true, enumerable: true, configurable: true,
  });
  return copy;
}

// Consume a graph freshly cloned by a native message boundary. Unchanged
// children need no property write; only shared placeholders change identity.
function transformOwned(value, replace, seen = new WeakMap()) {
  if (typeof value === 'function' || typeof value === 'symbol') throw new DOMException('Value cannot be cloned by a process worker.', 'DataCloneError');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const replacement = replace(value);
  if (replacement !== undefined) { seen.set(value, replacement); return replacement; }
  seen.set(value, value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer
    || value instanceof Date || value instanceof RegExp || value instanceof Error) return value;
  if (value instanceof Map) {
    const entries = [...value], restored = entries.map(([key, entry]) => [transformOwned(key, replace, seen), transformOwned(entry, replace, seen)]);
    if (restored.some(([key, entry], index) => key !== entries[index][0] || entry !== entries[index][1])) {
      value.clear(); for (const [key, entry] of restored) value.set(key, entry);
    }
  } else if (value instanceof Set) {
    const entries = [...value], restored = entries.map(entry => transformOwned(entry, replace, seen));
    if (restored.some((entry, index) => entry !== entries[index])) {
      value.clear(); for (const entry of restored) value.add(entry);
    }
  } else for (const key of Object.keys(value)) {
    const child = value[key], restored = transformOwned(child, replace, seen);
    if (restored !== child) Object.defineProperty(value, key, {
      value: restored, writable: true, enumerable: true, configurable: true,
    });
  }
  return value;
}

function encode(value, walk) {
  const shared = [], views = [], buffers = new WeakMap();
  function sharedPlaceholder(buffer) {
    if (buffers.has(buffer)) return buffers.get(buffer);
    const placeholder = {};
    buffers.set(buffer, placeholder);
    // IPC serializes the view's bytes synchronously; no intermediate copy.
    shared.push({ placeholder, bytes: Buffer.from(buffer) });
    return placeholder;
  }
  const data = walk(value, entry => {
    if (entry instanceof SharedArrayBuffer) return sharedPlaceholder(entry);
    if (ArrayBuffer.isView(entry) && entry.buffer instanceof SharedArrayBuffer) {
      const placeholder = {};
      views.push({ placeholder, buffer: sharedPlaceholder(entry.buffer),
        type: Buffer.isBuffer(entry) ? 'Buffer' : entry.constructor.name,
        byteOffset: entry.byteOffset, byteLength: entry.byteLength });
      return placeholder;
    }
  });
  return { data, shared, views };
}

export function encodeProcessMessage(value) { return encode(value, transform); }

// Native Worker message events own a fresh cloned result. Its source in the
// worker isolate stays untouched while the host prepares the IPC envelope.
export function encodeReceivedWorkerMessage(value) { return encode(value, transformOwned); }

const viewTypes = new Map([
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
  Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
].map(type => [type.name, type]));

function sharedReplacements(shared, views) {
  const replacements = new WeakMap();
  for (const { placeholder, bytes } of shared) {
    const buffer = new SharedArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    replacements.set(placeholder, buffer);
  }
  for (const { placeholder, buffer: reference, type, byteOffset, byteLength } of views) {
    const buffer = replacements.get(reference);
    if (type === 'Buffer') replacements.set(placeholder, Buffer.from(buffer, byteOffset, byteLength));
    else {
      const Type = viewTypes.get(type);
      if (!Type) throw new TypeError('Unknown process worker shared view type.');
      replacements.set(placeholder, new Type(buffer, byteOffset, type === 'DataView' ? byteLength : byteLength / Type.BYTES_PER_ELEMENT));
    }
  }
  return replacements;
}

export function decodeProcessMessage({ data, shared, views }) {
  const replacements = sharedReplacements(shared, views);
  return transform(data, entry => replacements.get(entry));
}

// Only consume freshly deserialized IPC envelopes here: IPC has already cloned
// their graph. Preserve that owned graph while restoring shared placeholders.
export function decodeReceivedProcessMessage({ data, shared, views }) {
  if (!shared.length && !views.length) return data;
  const replacements = sharedReplacements(shared, views);
  return transformOwned(data, entry => replacements.get(entry));
}
