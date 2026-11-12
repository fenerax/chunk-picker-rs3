import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createResponseCache } from './http-response.mjs';

const unzip = promisify(gunzip), owners = new WeakMap();
export const SAVED_WHY_RAW_LIMIT = 1024 * 1024;
// Conservative graph/string/decoder reservation, not an RSS measurement. Reserve
// before native decoding or JSON allocation, within the existing response owner.
export const savedWhyCharge = (rawBytes, gzipBytes) => 1024 + rawBytes * 32 + gzipBytes;
export function forgetSavedWhyChain(entry) { owners.get(entry)?.forget(entry); }

export function createSavedWhyEvidence({ cache = createResponseCache(), idleMs = 120_000,
  clock = { setTimeout, clearTimeout }, maxRawBytes = SAVED_WHY_RAW_LIMIT } = {}) {
  const records = new Map(), reservations = new Set(), jobs = new Set();
  let closed = false, closing;
  function retire(record) {
    if (!record.retired) {
      record.retired = true;
      clock.clearTimeout(record.timer); record.timer = undefined;
      if (records.get(record.entry) === record) { records.delete(record.entry); owners.delete(record.entry); }
      record.entry = record.gzip = undefined;
    }
    if (!record.pending) {
      record.promise = undefined;
      reservations.delete(record);
      cache.delete(record.key);
    }
  }
  function forget(entry) { const record = records.get(entry); if (record) retire(record); }
  function touch(record) {
    clock.clearTimeout(record.timer);
    record.timer = clock.setTimeout(() => retire(record), idleMs);
    record.timer?.unref?.();
  }
  async function decode(record, gzip, size) {
    try {
      const bytes = await unzip(gzip, { maxOutputLength: size });
      if (record.retired || closed) return undefined;
      if (bytes.length !== size) { retire(record); return undefined; }
      return JSON.parse(bytes.toString('utf8'));
    } catch { retire(record); return undefined; }
    finally {
      record.pending = false; record.reservation.pinned = false;
      record.reservation.onSizeChange?.();
      cache.notifyUnpinned();
      if (record.retired || !record.reusable) retire(record);
    }
  }
  async function read(entry, revision, { rawLimit = maxRawBytes } = {}) {
    if (closed || entry?.revision !== revision || !Buffer.isBuffer(entry.fullGzip)) { forget(entry); return undefined; }
    const gzip = entry.fullGzip;
    let record = records.get(entry);
    if (record && (record.revision !== revision || record.gzip !== gzip)) { retire(record); record = undefined; }
    // Gzip ISIZE is only an admission hint; maxOutputLength and the exact decoded
    // length check also reject forged trailers and concatenated/oversized data.
    if (gzip.length < 18) return undefined;
    const size = gzip.readUInt32LE(gzip.length - 4);
    if (!size || size > Math.min(rawLimit, maxRawBytes)) return undefined;
    if (!record) {
      record = { entry, revision, gzip, key: Symbol('saved-why'), pending: true };
      record.reservation = { retainedBytes: savedWhyCharge(size, gzip.buffer.byteLength), pinned: true, onEvict: () => retire(record) };
      let refused;
      cache.set(record.key, record.reservation, { onRefused: reason => { refused = reason; } });
      record.reusable = cache.get(record.key) === record.reservation;
      if (!record.reusable && refused !== 'service') return undefined;
      // Admission controls retention, not availability. A refused reservation
      // from service pressure still decodes within the same raw/output bounds
      // for this request only. Existing local-owner refusal policy is unchanged.
      records.set(entry, record); owners.set(entry, owner);
      if (record.reusable) reservations.add(record);
      record.promise = decode(record, gzip, size);
      const job = record.promise; jobs.add(job);
      void job.then(() => jobs.delete(job), () => jobs.delete(job));
    } else cache.get(record.key); // Shared LRU, including other response types.
    if (record.reusable) touch(record);
    return record.promise;
  }
  const owner = { read, forget,
    stats: () => ({ entries: records.size, pending: jobs.size,
      bytes: [...reservations].reduce((sum, row) => sum + row.reservation.retainedBytes, 0), maxRawBytes }),
    close() {
      if (!closing) {
        closed = true;
        for (const record of [...records.values()]) retire(record);
        closing = Promise.allSettled([...jobs]).then(() => {});
      }
      return closing;
    },
  };
  return owner;
}
