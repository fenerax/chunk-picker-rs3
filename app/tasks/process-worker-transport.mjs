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

export function encodeProcessMessage(value) {
  const shared = [], views = [], buffers = new WeakMap();
  function sharedPlaceholder(buffer) {
    if (buffers.has(buffer)) return buffers.get(buffer);
    const placeholder = {};
    buffers.set(buffer, placeholder);
    shared.push({ placeholder, bytes: Buffer.from(new Uint8Array(buffer)) });
    return placeholder;
  }
  const data = transform(value, entry => {
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

const viewTypes = new Map([
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
  Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
].map(type => [type.name, type]));

export function decodeProcessMessage({ data, shared, views }) {
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
  return transform(data, entry => replacements.get(entry));
}
