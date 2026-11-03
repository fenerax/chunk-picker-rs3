// Optional, disposable calculator artifacts. No state/store imports or codecs
// with native compression handles: a calculator may be terminated at any time.
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, lstatSync, openSync, closeSync, fstatSync, readSync, writeFileSync,
  renameSync, readdirSync, unlinkSync, rmdirSync, chownSync } from 'node:fs';
import path from 'node:path';

export const WARM_STORE_LIMITS = Object.freeze({ bytes: 512 * 1024 * 1024, entries: 256,
  entryBytes: 128 * 1024 * 1024, ageMs: 7 * 86400000 });
export const warmHash = bytes => createHash('sha256').update(bytes).digest('hex');
// Reserve independent budgets so per-player replies cannot evict both release
// collection graphs. Together: 512 MiB and 256 files, not per player.
export const WARM_COLLECTION_LIMITS = Object.freeze({ ...WARM_STORE_LIMITS, bytes: 256 * 1024 * 1024, entries: 2 });
export const WARM_RESULT_LIMITS = Object.freeze({ ...WARM_STORE_LIMITS, bytes: 256 * 1024 * 1024, entries: 254 });
const magic = Buffer.from('RS3WARM1'), headerBytes = 76, digest = /^[a-f0-9]{64}$/;
function header(file, key, limit, body = false) {
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
  const caps = { ...WARM_STORE_LIMITS, ...limits };
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || Object.values(caps).some(value => !Number.isSafeInteger(value) || value <= 0)
    || caps.entryBytes + headerBytes > caps.bytes || caps.entryBytes > 0xffffffff) return;
  const lock = path.join(directory, '.write-lock');
  let available = true;
  const fileFor = key => path.join(directory, `${key}.warm`);
  function prune(keep, reserveBytes = 0, reserveEntries = 0) {
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
  // queue unbounded buffers. A killed writer's lock is reclaimed after a minute.
  function writeLocked(operation) {
    if (!available) return false;
    let locked = false;
    try {
      const created = mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (created && process.getuid?.() === 0) {
        const owner = lstatSync(path.dirname(created));
        for (let current = directory; ; current = path.dirname(current)) {
          chownSync(current, owner.uid, owner.gid); if (current === created) break;
        }
      }
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return false;
      try { mkdirSync(lock, { mode: 0o700 }); locked = true; }
      catch {
        const info = lstatSync(lock);
        if (!info.isDirectory() || info.isSymbolicLink() || Date.now() - info.mtimeMs < 60000) return false;
        const ownerFile = path.join(lock, 'owner');
        try {
          const ownerFd = openSync(ownerFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          let owner;
          try { const bytes = Buffer.alloc(32); const count = readSync(ownerFd, bytes, 0, bytes.length, 0); owner = Number(bytes.subarray(0, count).toString()); } finally { closeSync(ownerFd); }
          if (Number.isSafeInteger(owner) && owner > 0) {
            try { process.kill(owner, 0); return false; } catch (error) { if (error.code !== 'ESRCH') return false; }
          }
          unlinkSync(ownerFile);
        } catch (error) { if (error.code !== 'ENOENT') return false; }
        rmdirSync(lock); mkdirSync(lock, { mode: 0o700 }); locked = true;
      }
      writeFileSync(path.join(lock, 'owner'), String(process.pid), { flag: 'wx', mode: 0o600 });
      operation(); return true;
    } catch { return false; }
    finally { if (locked) { try { unlinkSync(path.join(lock, 'owner')); rmdirSync(lock); } catch {} } }
  }
  writeLocked(() => prune());
  return {
    reference(key) {
      if (!available || !digest.test(key)) return;
      const file = fileFor(key);
      try { if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()
        || Date.now() - lstatSync(file).mtimeMs > caps.ageMs) return; } catch { return; }
      return header(file, key, caps.entryBytes);
    },
    get(key) { return this.reference(key) ? readWarmFile(fileFor(key), key, caps.entryBytes) : undefined; },
    put(key, bytes) {
      if (!available || !digest.test(key) || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > caps.entryBytes) return;
      const file = fileFor(key), temporary = path.join(directory, `${randomUUID()}.tmp`);
      const written = writeLocked(() => {
        // Prune before allocating disk space, leaving room for this publication.
        prune(undefined, bytes.length + headerBytes, 1);
        const prefix = Buffer.alloc(headerBytes); magic.copy(prefix);
        Buffer.from(key, 'hex').copy(prefix, 8); Buffer.from(warmHash(bytes), 'hex').copy(prefix, 40); prefix.writeUInt32BE(bytes.length, 72);
        writeFileSync(temporary, Buffer.concat([prefix, bytes]), { flag: 'wx', mode: 0o600 });
        if (process.getuid?.() === 0) { const owner = lstatSync(directory); chownSync(temporary, owner.uid, owner.gid); }
        renameSync(temporary, file); prune(file);
      });
      try { unlinkSync(temporary); } catch {}
      return written ? this.reference(key) : undefined;
    },
    close() { available = false; },
  };
}
