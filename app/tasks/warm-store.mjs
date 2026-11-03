// Optional, disposable calculator artifacts. No state/store imports or codecs
// with native compression handles: a calculator may be terminated at any time.
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, mkdtempSync, lstatSync, openSync, closeSync, fstatSync, readSync, writeFileSync,
  renameSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { threadId, workerData } from 'node:worker_threads';

export const WARM_STORE_LIMITS = Object.freeze({ bytes: 512 * 1024 * 1024, entries: 256,
  entryBytes: 128 * 1024 * 1024, ageMs: 7 * 86400000 });
// Cache paths are service-controlled. Root must not traverse them, including
// for reads, pruning or exited-worker cleanup. Recheck on existing handles too.
let warnedRoot = false;
export function warmStoreAllowed() {
  if (process.getuid?.() !== 0) return true;
  if (!warnedRoot) {
    warnedRoot = true;
    console.warn('[warm-store] Root access refused; optional cache reads and writes skipped.');
  }
  return false;
}
export const warmHash = bytes => createHash('sha256').update(bytes).digest('hex');
// Reserve independent budgets so per-player replies cannot evict both release
// collection graphs. Together: 512 MiB and 256 files, not per player.
export const WARM_COLLECTION_LIMITS = Object.freeze({ ...WARM_STORE_LIMITS, bytes: 256 * 1024 * 1024, entries: 2 });
export const WARM_RESULT_LIMITS = Object.freeze({ ...WARM_STORE_LIMITS, bytes: 256 * 1024 * 1024, entries: 254 });
const magic = Buffer.from('RS3WARM1'), headerBytes = 76, digest = /^[a-f0-9]{64}$/;
const ownerName = name => name === 'owner' || /^owner-[a-f0-9-]{36}$/.test(name);
const instanceId = workerData?.warmStoreOwnerId ?? randomUUID();
function lockOwner(file) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let value;
  try { const bytes = Buffer.alloc(256); const count = readSync(fd, bytes, 0, bytes.length, 0); value = bytes.subarray(0, count).toString(); }
  finally { closeSync(fd); }
  try { const owner = JSON.parse(value); return typeof owner === 'number' ? { pid: owner } : owner; } catch { return; }
}
function deadOwner(file) {
  const pid = lockOwner(file)?.pid;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return true;
}
// Called by the owning parent only AFTER its worker exits. Instance identity
// covers every store/lock that thread used, including unpublished stages. Each
// unlink still claims a unique lock token, so replacement writers stay safe.
export function releaseWarmStoreLocks(directory, ownerId, ownerThreadId) {
  if (!warmStoreAllowed()) return;
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return;
    for (const name of readdirSync(directory)) {
      if (name !== '.write-lock' && !/^\.write-lock-[a-zA-Z0-9]{6}$/.test(name)) continue;
      const lock = path.join(directory, name);
      try {
        const info = lstatSync(lock);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const names = readdirSync(lock);
        if (names.length !== 1 || !ownerName(names[0])) continue;
        const token = path.join(lock, names[0]), owner = lockOwner(token);
        if (owner?.pid !== process.pid || owner.threadId !== ownerThreadId || owner.instanceId !== ownerId) continue;
        unlinkSync(token); rmdirSync(lock);
      } catch { /* Optional cleanup; dead-process/aged-stage recovery remains. */ }
    }
  } catch { /* Missing or unavailable optional store. */ }
}
function header(file, key, limit, body = false) {
  if (!warmStoreAllowed()) return;
  let fd;
  try {
    if (!digest.test(key)) return;
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= headerBytes || info.size > limit + headerBytes) return;
    const prefix = Buffer.alloc(headerBytes);
    if (readSync(fd, prefix, 0, headerBytes, 0) !== headerBytes || !prefix.subarray(0, 8).equals(magic)
      || prefix.subarray(8, 40).toString('hex') !== key || prefix.readUInt32BE(72) !== info.size - headerBytes) return;
    const reference = { file, key, bytes: info.size - headerBytes, sha256: prefix.subarray(40, 72).toString('hex'), warm: true };
    if (!body) return reference;
    const bytes = Buffer.alloc(reference.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, headerBytes + offset);
      if (!count) return;
      offset += count;
    }
    if (warmHash(bytes) === reference.sha256) return bytes;
  } catch { /* A corrupt, partial or unavailable artifact is a cache miss. */ }
  finally { if (fd !== undefined) closeSync(fd); }
}
export const readWarmFile = (file, key, limit = WARM_STORE_LIMITS.entryBytes) => header(file, key, limit, true);

export function createWarmStore(directory, limits = {}) {
  if (!warmStoreAllowed()) return;
  const caps = { ...WARM_STORE_LIMITS, ...limits };
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || Object.values(caps).some(value => !Number.isSafeInteger(value) || value <= 0)
    || caps.entryBytes + headerBytes > caps.bytes || caps.entryBytes > 0xffffffff) return;
  const lock = path.join(directory, '.write-lock');
  let available = true, warnedLock = false;
  function lockFailure(reason) {
    if (!warnedLock) {
      warnedLock = true;
      console.warn(`[warm-store] Write lock unavailable (${reason}); optional publication/pruning skipped.`);
    }
    return false;
  }
  const fileFor = key => path.join(directory, `${key}.warm`);
  function prune(keep, reserveBytes = 0, reserveEntries = 0) {
    if (!warmStoreAllowed()) return;
    const rows = [];
    for (const name of readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.warm$/.test(name) && !/^[a-f0-9-]+\.tmp$/.test(name)) continue;
      const file = path.join(directory, name), info = lstatSync(file);
      if (!info.isFile()) continue;
      if (name.endsWith('.tmp') || Date.now() - info.mtimeMs > caps.ageMs || info.size > caps.entryBytes + headerBytes) {
        unlinkSync(file); continue;
      }
      rows.push({ file, bytes: info.size, time: info.mtimeMs });
    }
    rows.sort((a, b) => (a.file === keep) - (b.file === keep) || a.time - b.time || a.file.localeCompare(b.file));
    let bytes = rows.reduce((sum, row) => sum + row.bytes, 0), count = rows.length;
    for (const row of rows) {
      if (bytes <= caps.bytes - reserveBytes && count <= caps.entries - reserveEntries) break;
      unlinkSync(row.file); bytes -= row.bytes; count--;
    }
  }
  // Writers across lanes share one non-blocking lock. Busy means skip, never
  // queue unbounded buffers. Parents clean exited threads; dead-process locks
  // are reclaimed after a minute.
  function writeLocked(operation) {
    if (!warmStoreAllowed() || !available) return false;
    let locked = false, stagedLock;
    const token = `owner-${randomUUID()}`;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return lockFailure('unsafe directory');
      // Unpublished stages never protect a write; stale ones are disposable.
      for (const name of readdirSync(directory)) {
        if (!/^\.write-lock-[a-zA-Z0-9]{6}$/.test(name)) continue;
        const file = path.join(directory, name), info = lstatSync(file);
        if (!info.isDirectory() || info.isSymbolicLink() || Date.now() - info.mtimeMs < 60000) continue;
        // An interrupted writer can leave an empty unpublished stage.
        try { rmdirSync(file); continue; } catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
        const names = readdirSync(file);
        // A paused publisher can still expose its stage. Never empty a live
        // stage: every lock must remain nonempty when it is published.
        if (names.length !== 1 || !ownerName(names[0]) || !deadOwner(path.join(file, names[0]))) continue;
        unlinkSync(path.join(file, names[0]));
        rmdirSync(file);
      }
      stagedLock = mkdtempSync(path.join(directory, '.write-lock-'));
      const ownerFile = path.join(stagedLock, token);
      writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, threadId, instanceId }), { flag: 'wx', mode: 0o600 });
      // Every published lock is nonempty: rename cannot replace a live lock.
      try {
        if (lstatSync(lock, { throwIfNoEntry: false })) throw Object.assign(new Error('Lock exists.'), { code: 'EEXIST' });
        renameSync(stagedLock, lock); stagedLock = undefined; locked = true;
      }
      catch {
        const info = lstatSync(lock);
        if (!info.isDirectory() || info.isSymbolicLink() || Date.now() - info.mtimeMs < 60000) return lockFailure('busy or unsafe lock');
        const names = readdirSync(lock);
        if (names.length > 1 || names.length === 1 && !ownerName(names[0])) return lockFailure('unsafe owner');
        if (names.length) {
          const ownerFile = path.join(lock, names[0]);
          if (!deadOwner(ownerFile)) return lockFailure('live owner');
          // Unlink is the atomic claim on this stale instance. Only one
          // reclaimer can remove its unique token; losers must skip, including
          // ENOENT. A later writer has a different token and remains nonempty.
          // The fixed legacy name is safe too: new writers never reuse it.
          unlinkSync(ownerFile);
        }
        rmdirSync(lock); renameSync(stagedLock, lock); stagedLock = undefined; locked = true;
      }
      operation(); return true;
    } catch (error) { return locked ? false : lockFailure(error.code ?? 'error'); }
    finally {
      if (stagedLock) { try { unlinkSync(path.join(stagedLock, token)); } catch {} try { rmdirSync(stagedLock); } catch {} }
      if (locked) { try { unlinkSync(path.join(lock, token)); rmdirSync(lock); } catch {} }
    }
  }
  writeLocked(() => prune());
  return {
    reference(key) {
      if (!warmStoreAllowed() || !available || !digest.test(key)) return;
      const file = fileFor(key);
      try { if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()
        || Date.now() - lstatSync(file).mtimeMs > caps.ageMs) return; } catch { return; }
      return header(file, key, caps.entryBytes);
    },
    get(key) { return this.reference(key) ? readWarmFile(fileFor(key), key, caps.entryBytes) : undefined; },
    put(key, bytes) {
      if (!warmStoreAllowed() || !available || !digest.test(key) || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > caps.entryBytes) return;
      const file = fileFor(key), temporary = path.join(directory, `${randomUUID()}.tmp`);
      const written = writeLocked(() => {
        // Prune before allocating disk space, leaving room for this publication.
        prune(undefined, bytes.length + headerBytes, 1);
        const prefix = Buffer.alloc(headerBytes); magic.copy(prefix);
        Buffer.from(key, 'hex').copy(prefix, 8); Buffer.from(warmHash(bytes), 'hex').copy(prefix, 40); prefix.writeUInt32BE(bytes.length, 72);
        writeFileSync(temporary, Buffer.concat([prefix, bytes]), { flag: 'wx', mode: 0o600 });
        renameSync(temporary, file); prune(file);
      });
      try { unlinkSync(temporary); } catch {}
      return written ? this.reference(key) : undefined;
    },
    close() { available = false; },
  };
}
