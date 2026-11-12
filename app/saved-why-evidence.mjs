import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createResponseCache } from './http-response.mjs';

const unzip = promisify(gunzip), owners = new WeakMap(), fallbackPools = new WeakMap();
export const SAVED_WHY_RAW_LIMIT = 1024 * 1024;
// Conservative graph/string/decoder reservation, not an RSS measurement. Reserve
// before native decoding or JSON allocation, within the existing response owner.
export const savedWhyCharge = (rawBytes, gzipBytes) => 1024 + rawBytes * 32 + gzipBytes;
export function forgetSavedWhyChain(entry) { for (const owner of [...(owners.get(entry) ?? [])]) owner.forget(entry); }
function remember(entry, owner) {
  if (!owners.has(entry)) owners.set(entry, new Set());
  owners.get(entry).add(owner);
}
function unregister(entry, owner) { const set = owners.get(entry); set?.delete(owner); if (!set?.size) owners.delete(entry); }

export function createSavedWhyEvidence({ cache = createResponseCache(), idleMs = 120_000,
  clock = { setTimeout, clearTimeout }, maxRawBytes = SAVED_WHY_RAW_LIMIT, decodeGzip = unzip } = {}) {
  if (cache.budget.enforced) return reservedEvidence({ cache, idleMs, clock, maxRawBytes, decodeGzip });
  const records = new Map(), reservations = new Set(), jobs = new Set();
  let closed = false, closing;
  function retire(record) {
    if (!record.retired) {
      record.retired = true;
      clock.clearTimeout(record.timer); record.timer = undefined;
      if (records.get(record.entry) === record) { records.delete(record.entry); unregister(record.entry, owner); }
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
      const bytes = await decodeGzip(gzip, { maxOutputLength: size });
      if (record.retired || closed) return undefined;
      if (bytes.length !== size) { retire(record); return undefined; }
      return JSON.parse(bytes.toString('utf8'));
    } catch { retire(record); return undefined; }
    finally {
      record.pending = false; record.reservation.pinned = false;
      record.reservation.onSizeChange?.();
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
      cache.set(record.key, record.reservation);
      record.reusable = cache.get(record.key) === record.reservation;
      if (!record.reusable) return undefined;
      records.set(entry, record); remember(entry, owner);
      if (record.reusable) reservations.add(record);
      record.promise = decode(record, gzip, size);
      const job = record.promise; jobs.add(job);
      void job.then(() => jobs.delete(job), () => jobs.delete(job));
    } else cache.get(record.key); // Shared LRU, including other response types.
    if (record.reusable) touch(record);
    return record.promise;
  }
  const owner = { read, forget,
    async acquire(entry, revision, options) { const value = await read(entry, revision, options); return value && { value, release() {} }; },
    async use(entry, revision, options, work) { return work(await read(entry, revision, options)); },
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

const capacityError = () => Object.assign(new Error('Saved explanation capacity is full. Retry shortly.'), {
  status: 503, code: 'SAVED_WHY_BUSY', retryAfter: 1,
});

// Enforced profiles expose explicit leases: a parsed graph stays charged until
// its final consumer releases it, including projection and response sending.
function reservedEvidence({ cache, idleMs, clock, maxRawBytes, decodeGzip }) {
  const budget = cache.budget, records = new Map(), consumers = new Set(), inFlight = new Set();
  if (!fallbackPools.has(budget)) fallbackPools.set(budget, new Map());
  const pool = fallbackPools.get(budget);
  let closed = false, closing;
  function attach(entry, job) {
    const binding = { job, gzip: entry.fullGzip, revision: entry.revision };
    records.set(entry, binding); remember(entry, owner);
    if (job.pending && !inFlight.has(job)) {
      inFlight.add(job);
      const settled = () => inFlight.delete(job);
      void job.promise.then(settled, settled);
    }
    const detach = () => {
      if (records.get(entry) === binding) { records.delete(entry); unregister(entry, owner); }
      job.detach.delete(detach);
    };
    binding.detach = detach; job.detach.add(detach); return binding;
  }
  function finish(job) {
    if (job.pending || job.users.size || job.cleaned) return;
    if (job.reusable && !job.retired) {
      job.reservation.onSizeChange?.();
      job.clock.clearTimeout(job.timer);
      job.timer = job.clock.setTimeout(() => retire(job), idleMs); job.timer?.unref?.();
      return;
    }
    job.cleaned = true; job.value = job.gzip = undefined;
    job.clock.clearTimeout(job.timer);
    job.release?.(); job.release = undefined;
    job.cache?.delete(job.key);
    if (pool.get(job.hash) === job) pool.delete(job.hash);
    for (const detach of [...job.detach]) detach();
  }
  function retire(job) {
    job.retired = true; job.clock.clearTimeout(job.timer); job.timer = undefined;
    for (const user of [...job.users]) if (!user.acquired) user.abort();
    for (const detach of [...job.detach]) detach();
    if (!job.users.size) job.controller.abort();
    finish(job);
  }
  function start(job, size) {
    job.promise = (async () => {
      try {
        job.controller.signal.throwIfAborted();
        const bytes = await decodeGzip(job.gzip, { maxOutputLength: size });
        job.controller.signal.throwIfAborted();
        if (bytes.length !== size) { job.retired = true; return; }
        job.value = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        job.retired = true;
        if (error.code === 'SAVED_WHY_BUSY' || job.controller.signal.aborted) throw error;
      } finally {
        job.pending = false;
        job.reservation.onSizeChange?.(); finish(job);
      }
    })();
    // Invalidation can precede a caller's await; all consumers observe settlement.
    void job.promise.catch(() => {});
  }
  function create(entry, size) {
    const gzip = entry.fullGzip, charge = savedWhyCharge(size, gzip.buffer.byteLength);
    const job = { gzip, revision: entry.revision, charge, key: Symbol('saved-why'), cache, clock,
      controller: new AbortController(), users: new Set(), detach: new Set(), pending: true };
    job.reservation = { retainedBytes: charge, get pinned() { return job.pending || job.users.size > 0; }, onEvict: () => retire(job) };
    cache.set(job.key, job.reservation);
    job.reusable = cache.get(job.key) === job.reservation;
    if (!job.reusable) {
      // Identical immutable saved bytes share only in-flight fallback work,
      // across owners. Default-profile cached graphs keep their old identities.
      const hash = `${entry.revision}:${createHash('sha256').update(gzip).digest('hex')}`;
      const existing = pool.get(hash);
      if (existing && !existing.retired && !existing.cleaned && !existing.controller.signal.aborted) return existing;
      job.release = budget.reserveDecode({ cost: charge });
      if (!job.release) throw capacityError();
      job.hash = hash; job.cache = undefined; pool.set(hash, job);
      start(job, size);
    } else start(job, size);
    return job;
  }
  async function acquire(entry, revision, { rawLimit = maxRawBytes, signal } = {}) {
    signal?.throwIfAborted();
    if (closed) throw capacityError();
    if (entry?.revision !== revision || !Buffer.isBuffer(entry.fullGzip)) { owner.forget(entry); return; }
    const gzip = entry.fullGzip;
    if (gzip.length < 18) return;
    const size = gzip.readUInt32LE(gzip.length - 4);
    if (!size || size > Math.min(rawLimit, maxRawBytes)) return;
    let binding = records.get(entry), job = binding?.job;
    if (job && (binding.revision !== revision || binding.gzip !== gzip || job.retired)) { owner.forget(entry); binding = job = undefined; }
    if (!job) job = create(entry, size); else cache.get(job.key);
    if (job.users.size >= 32) throw capacityError();
    binding ??= attach(entry, job);
    const user = { job, binding, acquired: false };
    job.clock.clearTimeout(job.timer); job.timer = undefined;
    const release = () => {
      if (!job.users.delete(user)) return;
      consumers.delete(user); signal?.removeEventListener('abort', user.abort);
      if (!job.users.size && job.pending) job.controller.abort();
      finish(job);
    };
    return new Promise((resolve, reject) => {
      user.abort = () => {
        if (user.acquired) return; // A consumer must release its live projection.
        release(); reject(signal?.reason ?? new DOMException('Saved evidence was invalidated.', 'AbortError'));
      };
      job.users.add(user); consumers.add(user);
      signal?.addEventListener('abort', user.abort, { once: true });
      job.promise.then(() => {
        if (!job.users.has(user)) return;
        if (!job.value || job.retired) { release(); resolve(undefined); return; }
        user.acquired = true; resolve({ value: job.value, release });
      }, error => { release(); reject(error); });
    });
  }
  const owner = {
    acquire, enforced: true,
    read() { throw new TypeError('Enforced saved evidence requires acquire()/release() or use().'); },
    async use(entry, revision, options, work) {
      const lease = await acquire(entry, revision, options);
      try { return await work(lease?.value); } finally { lease?.release(); }
    },
    forget(entry) {
      const binding = records.get(entry), job = binding?.job; if (!job) return;
      // A shared fallback may still serve another owner. Cancel only our users.
      for (const user of [...consumers]) if (user.binding === binding && !user.acquired) user.abort();
      if (job.reusable || !job.users.size) retire(job);
      binding.detach();
    },
    stats() {
      const jobs = [...new Set([...records.values()].map(binding => binding.job).concat([...consumers].map(user => user.job), [...inFlight]))];
      return { entries: records.size, pending: jobs.filter(job => job.pending).length,
        bytes: jobs.reduce((sum, job) => sum + job.charge, 0), maxRawBytes };
    },
    close() {
      if (!closing) {
        closed = true;
        const jobs = [...new Set([...records.values()].map(binding => binding.job).concat([...inFlight]))];
        for (const entry of [...records.keys()]) owner.forget(entry);
        closing = Promise.allSettled(jobs.filter(job => !job.users.size).map(job => job.promise)).then(() => {});
      }
      return closing;
    },
  };
  return owner;
}
