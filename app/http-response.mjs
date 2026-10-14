import { createHash } from 'node:crypto';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';

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

export async function sendRepresentation(request, response, representation, { status = 200, headers = {}, conditional = true } = {}) {
  const encoding = negotiateEncoding(request.headers['accept-encoding'], representation.compress);
  const encoded = await representation.encoded(encoding);
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
