import { open } from 'node:fs/promises';
import path from 'node:path';

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

// Read only small local metadata. In particular, never open the gameplay backup.
async function boundedRead(file, limit, tail = false) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size } = await handle.stat();
    if (!tail && size > limit) return { invalid: true };
    const bytes = Buffer.alloc(Math.min(size, limit));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, tail ? Math.max(0, size - limit) : 0);
    return { text: bytes.subarray(0, bytesRead).toString('utf8'), truncated: size > limit };
  } catch (error) {
    return error.code === 'ENOENT' ? { missing: true } : { invalid: true };
  } finally { await handle?.close(); }
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function sanitized(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const lastRunAt = timestamp(record.lastRunAt);
  const lastSuccessAt = timestamp(record.lastSuccessAt);
  if (!lastRunAt || !['success', 'failed'].includes(record.result)) return null;
  if (record.result === 'success' && (!lastSuccessAt || lastSuccessAt !== lastRunAt)) return null;
  if (lastSuccessAt && Date.parse(lastSuccessAt) > Date.parse(lastRunAt)) return null;
  return { lastRunAt, result: record.result,
    byteSize: Number.isSafeInteger(record.byteSize) && record.byteSize >= 0 ? record.byteSize : null,
    lastSuccessAt };
}

function legacyRecord(text, truncated, before = Infinity) {
  let current = null;
  const lines = text.split(/\r?\n/);
  if (truncated) lines.shift();
  for (const line of lines) {
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d) (?:Saved rs3-chunk-picker-\d{4}-\d\d-\d\d\.zip \((\d+) KB, revision [^)]+\)\.|Backup failed:.*)$/.exec(line);
    if (!match) continue;
    const lastRunAt = timestamp(match[1]);
    if (!lastRunAt || Date.parse(lastRunAt) >= before) continue;
    const success = match[2] !== undefined;
    const size = success ? Number(match[2]) * 1024 : null;
    current = { lastRunAt, result: success ? 'success' : 'failed', byteSize: Number.isSafeInteger(size) ? size : null,
      lastSuccessAt: success ? lastRunAt : current?.lastSuccessAt ?? null };
  }
  return current;
}

// The public allowlist contains only timestamps, outcome, size and a warning code.
// dataDir is the server's .local/duo directory, not the backup destination.
export async function readBackupStatus(dataDir, { now = Date.now(), legacyLog = true } = {}) {
  const localDir = path.dirname(path.resolve(dataDir));
  const destination = await boundedRead(path.join(localDir, 'backup-destination'), 4096);
  const configured = typeof destination.text === 'string' && Boolean(destination.text.split(/\r?\n/, 1)[0].trim());
  const raw = await boundedRead(path.join(localDir, 'backup-status.json'), 16384);
  let record = null;
  if (raw.text !== undefined) {
    try { record = sanitized(JSON.parse(raw.text)); } catch {}
  } else if (raw.missing && legacyLog) {
    const log = await boundedRead(path.join(localDir, 'backup.log'), 65536, true);
    if (log.text !== undefined) record = legacyRecord(log.text, log.truncated);
  }
  // The first status-writing script run can fail after older log-only successes.
  // Keep the status outcome authoritative, enriching only its missing success time.
  if (record?.result === 'failed' && !record.lastSuccessAt && legacyLog) {
    const log = await boundedRead(path.join(localDir, 'backup.log'), 65536, true);
    if (log.text !== undefined) {
      record.lastSuccessAt = legacyRecord(log.text, log.truncated, Date.parse(record.lastRunAt))?.lastSuccessAt ?? null;
    }
  }
  const result = record?.result ?? (raw.missing ? 'never' : 'unknown');
  const lastSuccessAt = record?.lastSuccessAt ?? null;
  const clock = now instanceof Date ? now.getTime() : Number(now);
  const warning = result === 'failed' ? 'failed' : !configured ? 'not-configured'
    : lastSuccessAt && clock - Date.parse(lastSuccessAt) > TWO_DAYS ? 'stale'
      : result === 'never' ? 'not-run' : result === 'unknown' ? 'unavailable' : null;
  return { lastRunAt: record?.lastRunAt ?? null, result, byteSize: record?.byteSize ?? null, lastSuccessAt, warning };
}
