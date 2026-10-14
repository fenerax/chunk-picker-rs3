import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { parseJSONStream } from './storage/json-stream.mjs';

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = MAX_BACKUP_BYTES + 1024 * 1024;
export const BACKUP_UPLOAD_TYPE = 'application/vnd.rs3-backup-upload+json';
export const isImportRoute = route => /^\/api\/(?:restore|import|member-restore)(?:\/preview)?$/.test(route);
const fail = (status, message) => Object.assign(new Error(message), { status });

// A replacement review needs owner counts, not another copy of imported evidence.
export function backupPreviewState(state) {
  return { schemaVersion: state.schemaVersion, revision: state.revision,
    members: state.members.map(({ id, name, unlocked, selected, taskStatus, completedTasks }) =>
      ({ id, name, unlocked, selected, taskStatus, completedTasks })) };
}

function limitBytes(maximum) {
  let bytes = 0;
  return new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maximum ? fail(413, 'This backup is too large. The limit is 256 MiB after decompression.') : null, chunk);
  } });
}

export async function readBackupRequest(request, { maxBackupBytes = MAX_BACKUP_BYTES, maxUploadBytes = MAX_UPLOAD_BYTES } = {}) {
  const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!['application/json', BACKUP_UPLOAD_TYPE].includes(type)) throw fail(415, 'Choose a .json or .json.gz backup.');
  const encoding = (request.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (!['identity', 'gzip'].includes(encoding)) throw fail(415, 'Use JSON or gzip for this backup.');
  if (Number(request.headers['content-length']) > maxUploadBytes) throw fail(413, 'This backup is too large. The limit is 256 MiB after decompression.');
  // Do not destroy the HTTP socket on parser/size errors: it must carry the error response.
  const input = new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } });
  const inputError = error => input.destroy(error);
  const aborted = () => input.destroy(fail(400, 'The backup upload was interrupted. Choose it again.'));
  request.on('error', inputError); request.on('aborted', aborted); request.pipe(input);
  const decoded = new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } });
  const transfer = pipeline(input, limitBytes(maxUploadBytes), ...(encoding === 'gzip' ? [createGunzip()] : []), decoded).catch(error => error);
  try {
    const value = await parseJSONStream(decoded, { maxBytes: maxBackupBytes + (type === BACKUP_UPLOAD_TYPE ? 9 : 0) });
    const error = await transfer;
    if (error) throw error;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'The backup must be a JSON object.');
    if (type !== BACKUP_UPLOAD_TYPE) return { body: value, uploaded: false };
    const rawMetadata = request.headers['x-rs3-import'] ?? '{}';
    if (rawMetadata.length > 8192) throw fail(400, 'Invalid backup import options.');
    let metadata;
    try { metadata = JSON.parse(rawMetadata); } catch { throw fail(400, 'Invalid backup import options.'); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || Object.keys(metadata).some(key => !['members', 'memberId', 'expectedRevision'].includes(key))) throw fail(400, 'Invalid backup import options.');
    const document = value.file;
    if (Object.keys(value).length !== 1 || !document || typeof document !== 'object' || Array.isArray(document)) throw fail(400, 'The backup must be a JSON object.');
    return { uploaded: true, body: { ...metadata, ...(document.format === 'rs3-chunk-picker'
      ? { backup: document } : { document, capturedAt: document.capturedAt }) } };
  } catch (error) {
    input.destroy(); decoded.destroy(); await transfer;
    if (error.status === 413) throw fail(413, 'This backup is too large. The limit is 256 MiB after decompression.');
    if (error.status) throw error;
    throw fail(400, encoding === 'gzip' && /^Z_/.test(error.code ?? '')
      ? 'This gzip backup is corrupt or incomplete. Choose another backup.' : 'The backup is not valid JSON. Choose another backup.');
  } finally {
    request.unpipe(input); request.off('error', inputError); request.off('aborted', aborted);
    input.destroy(); decoded.destroy();
    if (!request.complete) request.resume();
  }
}

// Yield each leaf separately instead of allocating one full JSON string and Buffer.
export function* backupJSONChunks(value) {
  if (value === null || typeof value !== 'object') { yield JSON.stringify(value); return; }
  const array = Array.isArray(value);
  yield array ? '[' : '{';
  let first = true;
  for (const [key, child] of array ? value.entries() : Object.entries(value)) {
    if (!array && child === undefined) continue;
    if (!first) yield ',';
    first = false;
    if (!array) yield `${JSON.stringify(key)}:`;
    yield* backupJSONChunks(child === undefined ? null : child);
  }
  yield array ? ']' : '}';
}

export async function sendGzipBackup(response, backup, { head = false } = {}) {
  // Refuse before starting a download that the importer could not accept.
  let total = 0;
  for (const leaf of backupJSONChunks(backup)) {
    total += Buffer.byteLength(leaf);
    if (total > MAX_BACKUP_BYTES) throw fail(413, 'This backup is too large. The limit is 256 MiB after decompression.');
  }
  // Coalesce small leaves for zlib without retaining a serialized copy of the save.
  async function* bytes() {
    let parts = [], length = 0;
    for (const leaf of backupJSONChunks(backup)) {
      parts.push(leaf); length += leaf.length;
      if (length >= 64 * 1024) { yield Buffer.from(parts.join('')); parts = []; length = 0; }
    }
    if (parts.length) yield Buffer.from(parts.join(''));
  }
  response.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'private, no-store',
    'Content-Disposition': 'attachment; filename="rs3-duo-backup.json.gz"' });
  if (head) { response.end(); return; }
  await pipeline(Readable.from(bytes()), limitBytes(MAX_BACKUP_BYTES), createGzip({ level: 1 }), response);
}
