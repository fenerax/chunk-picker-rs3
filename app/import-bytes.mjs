import { serialize, deserialize } from 'node:v8';

// Only transferable bytes cross the worker boundary. Bounded token batches let
// the receiver build its owned object in short turns, including very wide trees
// and individual strings larger than a batch. No whole-state JSON or clone.
const TURN_MS = 4, BATCH_BYTES = 64 * 1024;
const pause = () => new Promise(resolve => setImmediate(resolve));
// The decoder already receives keys in bounded batches. Retain that index for
// mutable hook inputs: even starting a for-in loop on a wide V8 dictionary can
// block for hundreds of milliseconds before its first iteration.
const dictionaryKeys = new WeakMap();
function indexedDictionary() {
  const target = {}, index = { batches: [[]], additions: new Set(), loading: true };
  const value = new Proxy(target, {
    defineProperty(target, key, descriptor) {
      const previous = Object.getOwnPropertyDescriptor(target, key);
      const changed = Reflect.defineProperty(target, key, descriptor);
      if (changed && typeof key === 'string') {
        if (index.loading) {
          if (index.batches.at(-1).length === 256) index.batches.push([]);
          index.batches.at(-1).push(key);
        } else if (Object.getOwnPropertyDescriptor(target, key).enumerable) {
          if (!previous?.enumerable) index.additions.add(key);
        } else index.additions.delete(key);
      }
      return changed;
    },
    deleteProperty(target, key) {
      const changed = Reflect.deleteProperty(target, key);
      if (changed) index.additions.delete(key);
      return changed;
    },
  });
  dictionaryKeys.set(value, index);
  return value;
}
export async function encodeImportBytes(value) {
  const buffers = [], blocks = [], binary = new Map(), strings = new Map();
  let tokens = [], size = 0, turn = performance.now();
  function flush() {
    if (!tokens.length) return;
    const bytes = serialize(tokens);
    blocks.push(buffers.length);
    buffers.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    tokens = []; size = 0;
  }
  async function emit(type, value) {
    tokens.push([type, value]); size += typeof value === 'string' ? value.length * 2 + 16 : 32;
    if (size >= BATCH_BYTES) flush();
    if (performance.now() - turn >= TURN_MS) { await pause(); turn = performance.now(); }
  }
  async function visit(item) {
    // Strings are immutable. Reuse repeated large evidence leaves instead of
    // allocating and transporting a separate copy for each archive occurrence.
    const sharedString = typeof item === 'string' && item.length >= 256 && item.length <= 1024 * 1024;
    if (sharedString && strings.has(item)) {
      await emit(10, strings.get(item));
    } else if (typeof item === 'string' && item.length > 16_384) {
      const id = sharedString ? strings.size : undefined; if (sharedString) strings.set(item, id);
      await emit(4, id);
      for (let i = 0; i < item.length; i += 16_384) await emit(5, item.slice(i, i + 16_384));
      await emit(6);
    } else if (sharedString) {
      strings.set(item, strings.size); await emit(11, item);
    } else if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      // Parser buffers are exclusively owned; pooled small buffers need a copy.
      const bytes = item instanceof ArrayBuffer ? item : item.byteOffset === 0 && item.byteLength === item.buffer.byteLength
        ? item.buffer : item.buffer.slice(item.byteOffset, item.byteOffset + item.byteLength);
      if (!binary.has(bytes)) { binary.set(bytes, buffers.length); buffers.push(bytes); }
      await emit(7, { index: binary.get(bytes), type: item.constructor.name });
    } else if (item instanceof Map || item instanceof Set) {
      await emit(item instanceof Map ? 8 : 9);
      if (item instanceof Map) { for (const [key, value] of item) { await visit(key); await visit(value); } }
      else for (const value of item) await visit(value);
      await emit(3);
    } else if (Array.isArray(item) || item && [null, Object.prototype].includes(Object.getPrototypeOf(item))) {
      const array = Array.isArray(item);
      await emit(array ? 2 : 1);
      if (array) { for (const child of item) await visit(child); }
      else if (dictionaryKeys.has(item)) {
        const { batches, additions } = dictionaryKeys.get(item);
        for (const keys of batches) {
          for (const key of keys) if (!additions.has(key) && Object.getOwnPropertyDescriptor(item, key)?.enumerable) {
            await visit(key); await visit(item[key]);
          }
          // Deleted/hidden properties emit no tokens, but their index scan
          // still needs a turn boundary when a hook removes a wide dictionary.
          if (performance.now() - turn >= TURN_MS) { await pause(); turn = performance.now(); }
        }
        for (const key of additions) { await visit(key); await visit(item[key]); }
      } else for (const key in item) if (Object.hasOwn(item, key)) { await visit(key); await visit(item[key]); }
      await emit(3);
    } else await emit(0, item); // Small metadata leaves, such as Dates.
  }
  await visit(value); flush();
  return { buffers, blocks };
}

export async function decodeImportBytes({ buffers, blocks }, { freezeStates = false, indexDictionaries = false, signal } = {}) {
  let result, text, textId, turn = performance.now();
  const stack = [], binary = new Map(), strings = [];
  function put(value) {
    const frame = stack.at(-1);
    if (!frame) result = value;
    else if (Array.isArray(frame.value)) frame.value.push(value);
    else if (frame.value instanceof Set) frame.value.add(value);
    else if (!frame.hasKey) { frame.key = value; frame.hasKey = true; }
    else {
      if (frame.value instanceof Map) frame.value.set(frame.key, value);
      // Install final-state descriptors as we hydrate, rather than freezing an
      // entire wide dictionary in one main-thread walk at the closing token.
      else Object.defineProperty(frame.value, frame.key, { value, writable: !frame.freeze, enumerable: true, configurable: !frame.freeze });
      frame.key = undefined; frame.hasKey = false;
    }
  }
  for (const index of blocks) {
    signal?.throwIfAborted();
    const tokens = deserialize(Buffer.from(buffers[index]));
    buffers[index] = undefined;
    for (const [type, value] of tokens) {
      if (type === 0) put(value);
      else if (type === 1 || type === 2) {
        const value = type === 1 ? indexDictionaries ? indexedDictionary() : {} : [], parent = stack.at(-1);
        const freeze = parent?.freeze || freezeStates && parent?.key === 'state';
        put(value); stack.push({ value, freeze });
      }
      else if (type === 3) {
        const frame = stack.pop(), index = dictionaryKeys.get(frame.value);
        if (index) index.loading = false;
        if (frame.freeze) {
          if (Array.isArray(frame.value)) Object.freeze(frame.value);
          else Object.preventExtensions(frame.value);
        }
      }
      else if (type === 4) { text = ''; textId = value; }
      else if (type === 5) text += value;
      else if (type === 6) { if (textId !== undefined) strings[textId] = text; put(text); text = undefined; textId = undefined; }
      else if (type === 10) put(strings[value]);
      else if (type === 11) { strings.push(value); put(value); }
      else if (type === 7) {
        if (!binary.has(value.index)) { binary.set(value.index, buffers[value.index]); buffers[value.index] = undefined; }
        const bytes = binary.get(value.index);
        const types = { Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
        put(value.type === 'Buffer' ? Buffer.from(bytes) : value.type === 'ArrayBuffer' ? bytes : new types[value.type](bytes));
      }
      else if (type === 8 || type === 9) { const value = type === 8 ? new Map() : new Set(); put(value); stack.push({ value }); }
    }
    if (performance.now() - turn >= TURN_MS) { await pause(); turn = performance.now(); }
  }
  return result;
}
