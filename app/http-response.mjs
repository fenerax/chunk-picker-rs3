import { createHash } from 'node:crypto';
import { gzip, createGzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const gzipAsync = promisify(gzip), brotliAsync = promisify(brotliCompress);
const etag = bytes => `"${createHash('sha256').update(bytes).digest('hex')}"`;
export const PRIVATE_REVALIDATE = 'private, max-age=0, must-revalidate';
export const PRIVATE_NO_STORE = 'private, no-store';

export function negotiateEncoding(header = '', compress = true) {
  const qualities = new Map();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const param = params.map(value => value.trim()).find(value => value.startsWith('q='));
    const quality = param === undefined ? 1 : Number(param.slice(2));
    qualities.set(name, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
  }
  const quality = name => qualities.get(name) ?? (name === 'identity' ? (qualities.get('*') === 0 ? 0 : 1) : qualities.get('*') ?? 0);
  const choices = compress ? ['br', 'gzip', 'identity'] : ['identity'];
  const selected = choices.sort((a, b) => quality(b) - quality(a))[0];
  if (!quality(selected)) throw Object.assign(new Error('No acceptable response encoding.'), { status: 406 });
  return selected;
}

export function createRepresentation(bytes, { type = 'application/json; charset=utf-8', cacheControl = PRIVATE_REVALIDATE, compress = true } = {}) {
  const plain = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const encodings = new Map([['identity', Promise.resolve({ bytes: plain, etag: etag(plain) })]]);
  let retainedBytes = plain.byteLength;
  const representation = { bytes: plain, type, cacheControl, compress,
    get byteLength() { return plain.byteLength; },
    get retainedBytes() { return retainedBytes; },
    encoded(encoding) {
      if (!encodings.has(encoding)) encodings.set(encoding, (encoding === 'br'
        ? brotliAsync(plain, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
        : gzipAsync(plain, { level: 1 })).then(bytes => {
          retainedBytes += bytes.byteLength; representation.onSizeChange?.();
          return { bytes, etag: etag(bytes) };
        }).catch(error => { encodings.delete(encoding); throw error; }));
      return encodings.get(encoding);
    } };
  return representation;
}

// Full-state gzip is collected before sending, preserving encoded validators and
// Content-Length. Neither the raw envelope nor its plain validator is allocated.
export async function createGzipRepresentation(parts, { signal, maxBytes = 48 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  if (activeStateBuilds) throw stateBuildBusy();
  activeStateBuilds++;
  const chunks = [];
  let length = 0;
  async function* input() {
    let carry = '';
    for (let part of parts) {
      if (!part.length) continue;
      let start = 0;
      if (carry) {
        const low = part.charCodeAt(0) >= 0xdc00 && part.charCodeAt(0) <= 0xdfff;
        yield Buffer.from(carry + (low ? part[0] : ''));
        start = low ? 1 : 0; carry = '';
      }
      if (part.charCodeAt(part.length - 1) >= 0xd800 && part.charCodeAt(part.length - 1) <= 0xdbff) {
        carry = part.at(-1); part = part.slice(0, -1);
      }
      for (; start < part.length;) {
        signal?.throwIfAborted();
        let end = Math.min(start + 32 * 1024, part.length);
        // Do not replace a surrogate pair split by an encoding block boundary.
        if (end < part.length && part.charCodeAt(end - 1) >= 0xd800 && part.charCodeAt(end - 1) <= 0xdbff
          && part.charCodeAt(end) >= 0xdc00 && part.charCodeAt(end) <= 0xdfff) end--;
        yield Buffer.from(part.slice(start, end));
        start = end;
      }
    }
    if (carry) yield Buffer.from(carry);
  }
  try {
    await pipeline(Readable.from(input(), { objectMode: false, highWaterMark: 64 * 1024 }), createGzip({ level: 1 }),
      new Writable({ write(chunk, _encoding, done) {
        length += chunk.length;
        if (length > maxBytes) { done(Object.assign(new Error('Full-state gzip exceeds its response budget. Try another encoding.'), { status: 503, retryAfter: 1 })); return; }
        chunks.push(chunk); done();
      } }), { signal });
    signal?.throwIfAborted();
    const bytes = Buffer.concat(chunks, length), encoded = Promise.resolve({ bytes, etag: etag(bytes) });
    // The completed object captures only encoded bytes. It cannot retain source
    // strings, snapshot pools or a hidden plain representation through a closure.
    return gzipRepresentation(bytes, encoded);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally { parts = undefined; chunks.length = 0; activeStateBuilds--; }
}
function gzipRepresentation(bytes, encoded) {
  return { encoding: 'gzip', type: 'application/json; charset=utf-8', cacheControl: PRIVATE_REVALIDATE, compress: true,
    byteLength: bytes.length, retainedBytes: bytes.length,
    encoded(encoding) {
      if (encoding !== 'gzip') throw new TypeError('This representation contains gzip only.');
      return encoded;
    } };
}

// One active oversized compression across all pickers; no queued compressions.
// Each picker admits one capture with up to 32 same-revision waiters.
// Raw strings stay live until collection ends;
// the output cap allows at most twice maxBytes during concatenation, plus bounded
// stream/native buffers. Completed compressed-only rows use the ordinary cache.
let activeStateBuilds = 0;
const stateBuildBusy = () => Object.assign(new Error('A full-state response is being prepared. Retry shortly.'), { status: 503, retryAfter: 1 });
export function createStateResponseBuilds() {
  const pending = new Map();
  let closed = false;
  return {
    run(key, work, signal) {
      signal?.throwIfAborted();
      if (closed) return Promise.reject(stateBuildBusy());
      let row = pending.get(key);
      if (!row) {
        if (pending.size) return Promise.reject(stateBuildBusy());
        row = { controller: new AbortController(), waiters: 0, settled: false };
        pending.set(key, row);
        row.promise = Promise.resolve().then(() => { row.controller.signal.throwIfAborted(); return work(row.controller.signal); })
          .finally(() => { row.settled = true; if (pending.get(key) === row) pending.delete(key); });
      }
      if (row.controller.signal.aborted || row.waiters >= 32) return Promise.reject(stateBuildBusy());
      row.waiters++;
      let abort;
      return new Promise((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        row.promise.then(resolve, reject);
      }).finally(() => {
        signal?.removeEventListener('abort', abort);
        row.waiters--;
        if (!row.waiters && !row.settled) row.controller.abort();
      });
    },
    clear() { for (const row of pending.values()) row.controller.abort(stateBuildBusy()); },
    close() { closed = true; this.clear(); },
  };
}

// Cache eviction cannot release bytes still pinned by slow sockets. Count each
// shared compressed representation once until its final sender finishes/closes.
export function createResponseLeases({ maxBytes = 48 * 1024 * 1024 } = {}) {
  const rows = new Map();
  let bytes = 0;
  return {
    retain(representation) {
      let row = rows.get(representation);
      if (!row) {
        if (representation.retainedBytes > maxBytes - bytes) throw stateBuildBusy();
        row = { count: 0, bytes: representation.retainedBytes };
        rows.set(representation, row); bytes += row.bytes;
      }
      row.count++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (!--row.count) { rows.delete(representation); bytes -= row.bytes; }
      };
    },
  };
}

export async function sendRepresentation(request, response, representation, { status = 200, headers = {}, conditional = true } = {}) {
  const encoding = negotiateEncoding(request.headers['accept-encoding'], representation.compress);
  const encoded = await representation.encoded(encoding);
  if (response.destroyed) return;
  const fields = { 'Content-Type': representation.type, 'Cache-Control': representation.cacheControl,
    Vary: 'Accept-Encoding', ETag: encoded.etag, ...(encoding !== 'identity' ? { 'Content-Encoding': encoding } : {}), ...headers };
  const matches = (request.headers['if-none-match'] ?? '').split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === encoded.etag);
  if (conditional && status === 200 && ['GET', 'HEAD'].includes(request.method) && matches) {
    response.writeHead(304, fields); response.end(); return;
  }
  response.writeHead(status, { ...fields, 'Content-Length': encoded.bytes.length });
  response.end(request.method === 'HEAD' ? undefined : encoded.bytes);
}

/** Bound retained bytes, including completed encodings. Pending encodings
 * coalesce, and failures can be retried without poisoning the cache. */
export function createResponseCache({ maxEntries = 64, maxBytes = 32 * 1024 * 1024 } = {}) {
  const rows = new Map();
  const bytes = () => [...rows.values()].reduce((sum, row) => sum + row.retainedBytes, 0);
  const remove = key => { const row = rows.get(key); rows.delete(key); if (row) row.onSizeChange = undefined; };
  const trim = () => { while (rows.size && (rows.size > maxEntries || bytes() > maxBytes)) remove(rows.keys().next().value); };
  return {
    get(key) { const row = rows.get(key); if (row) { rows.delete(key); rows.set(key, row); } return row; },
    set(key, value) {
      if (rows.has(key)) remove(key);
      if (value.retainedBytes > maxBytes) return value;
      rows.set(key, value); value.onSizeChange = trim; trim();
      return value;
    },
    clear() { for (const key of rows.keys()) remove(key); },
    get size() { return rows.size; },
    get bytes() { return bytes(); },
  };
}
