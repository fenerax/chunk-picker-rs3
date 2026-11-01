import { once } from 'node:events';
import { gunzipSync, crc32, constants as zlibConstants } from 'node:zlib';

export const stringify = value => JSON.stringify(value, (_, child) => child instanceof Map
  ? { $calcType: 'Map', entries: [...child] } : child instanceof Set ? { $calcType: 'Set', entries: [...child] } : child);
export const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export function parseBundle(bytes) {
  const bundle = parse(bytes);
  if (bundle?.world) {
    for (const key of ['chunks', 'areas']) if (bundle.world[key]?.$calcType === 'Map') bundle.world[key] = new Map(bundle.world[key].entries);
    if (bundle.world.surface?.$calcType === 'Set') bundle.world.surface = new Set(bundle.world.surface.entries);
  }
  return bundle;
}

// A chunk queue avoids repeatedly copying a large, fragmented state body.
export async function* frames(stream, { maxHeader = 1024 * 1024, maxBody = 512 * 1024 * 1024 } = {}) {
  const iterator = stream[Symbol.asyncIterator]();
  let chunks = [], offset = 0, available = 0, ended = false;
  async function take(size, optional = false) {
    while (available < size && !ended) {
      const next = await iterator.next();
      if (next.done) ended = true;
      else { chunks.push(Buffer.from(next.value)); available += next.value.length; }
    }
    if (optional && ended && available === 0) return null;
    if (available < size) throw new TypeError('invalid');
    const result = Buffer.allocUnsafe(size);
    let copied = 0;
    while (copied < size) {
      const n = Math.min(size - copied, chunks[0].length - offset);
      chunks[0].copy(result, copied, offset, offset + n);
      offset += n; copied += n; available -= n;
      if (offset === chunks[0].length) { chunks.shift(); offset = 0; }
    }
    return result;
  }
  while (true) {
    const first = await take(4, true);
    if (!first) return;
    const h = first.readUInt32LE();
    if (!h || h > maxHeader) throw new TypeError('invalid');
    const header = parse(await take(h));
    const b = (await take(4)).readUInt32LE();
    if (b > maxBody) throw new TypeError('invalid');
    yield { header, body: await take(b) };
  }
}
export function frame(header, body = Buffer.alloc(0)) {
  const json = Buffer.from(stringify(header));
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32LE(json.length); tail.writeUInt32LE(body.length);
  return Buffer.concat([head, json, tail, body]);
}
export function writer(stream) {
  let pending = Promise.resolve();
  return (header, body) => pending = pending.then(async () => {
    const chunks = Array.isArray(body) ? body : body ? [body] : [];
    const json = Buffer.from(stringify(header)), first = Buffer.alloc(4), last = Buffer.alloc(4);
    first.writeUInt32LE(json.length); last.writeUInt32LE(chunks.reduce((n,b) => n + b.length, 0));
    for (const chunk of [first, json, last, ...chunks]) if (!stream.write(chunk)) await once(stream, 'drain');
  });
}
export function packRawParts(raw) {
  const body = [], parts = [];
  for (const { name, chunks } of raw) {
    let bytes = 0;
    for (const chunk of chunks) {
      const value = ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : Buffer.from(chunk);
      body.push(value); bytes += value.length;
    }
    parts.push({ name, bytes });
  }
  return { parts, body };
}

export function packParts(parts) {
  const entries = Object.entries(parts).map(([name, value]) => [name, Buffer.from(JSON.stringify(value))]);
  return { parts: entries.map(([name, bytes]) => ({ name, bytes: bytes.length })), body: Buffer.concat(entries.map(([, bytes]) => bytes)) };
}
export function unpackParts(header, body) {
  let offset = 0;
  const parts = {};
  for (const part of header.parts ?? []) {
    if (typeof part.name !== 'string' || Object.hasOwn(parts, part.name) || !Number.isSafeInteger(part.bytes) || part.bytes < 0
      || offset + part.bytes > body.length || part.encoding && part.encoding !== 'gzip-sync-prefix') throw new TypeError('invalid');
    let bytes = body.subarray(offset, offset += part.bytes);
    if (part.encoding) {
      if (!Number.isSafeInteger(part.rawLength) || part.rawLength < 1 || part.rawLength > 512 * 1024 * 1024
        || !Number.isSafeInteger(part.crc32) || part.crc32 < 0 || part.crc32 > 0xffffffff) throw new TypeError('invalid');
      const raw = gunzipSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: part.rawLength });
      if (raw.length !== part.rawLength || crc32(raw) !== part.crc32) throw new TypeError('invalid');
      bytes = Buffer.concat([raw, Buffer.from('}')]);
    }
    Object.defineProperty(parts, part.name, { value: parse(bytes), enumerable: true });
  }
  if (offset !== body.length) throw new TypeError('invalid');
  return parts;
}
