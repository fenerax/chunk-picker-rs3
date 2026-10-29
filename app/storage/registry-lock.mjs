import { link, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

export async function syncDirectory(directory) {
  let handle;
  try { handle = await open(directory, 'r'); await handle.sync(); }
  catch (failure) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(failure.code)) throw failure;
  } finally { await handle?.close(); }
}

export async function durableDirectory(directory) {
  directory = path.resolve(directory);
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
  // Windows returns the created path with a \\?\ prefix; without stripping it the walk never meets the boundary.
  const boundary = path.dirname(path.resolve((firstCreated ?? directory).replace(/^\\\\\?\\/, '')));
  for (let current = directory; ; current = path.dirname(current)) {
    await syncDirectory(current);
    if (current === boundary || path.dirname(current) === current) break;
  }
}

/** Exclusive temporary file, file fsync, atomic replacement, then parent fsync. */
export async function writeRegistryJson(file, document) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (failure) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code) || attempt >= 6) throw failure;
        await delay(20 * 2 ** attempt);
      }
    }
    await syncDirectory(path.dirname(file));
  } finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

const locked = () => Object.assign(new Error('Registry writer lock is held or its owner cannot be verified.'), { code: 'REGISTRY_LOCKED', status: 409 });

/** A kernel mutex serializes both normal ownership and stale owner-file recovery. */
export async function lockRegistry(directory) {
  const canonical = await realpath(directory);
  const digest = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const guard = createServer(socket => socket.destroy());
  const address = process.platform === 'win32' ? { path: `\\\\.\\pipe\\rs3-registry-${digest}`, exclusive: true }
    : process.platform === 'linux' ? { path: `\0rs3-registry-${digest}`, exclusive: true }
      : { host: '127.0.0.1', port: 30000 + parseInt(digest.slice(0, 8), 16) % 20000, exclusive: true };
  try {
    await new Promise((resolve, reject) => { guard.once('error', reject); guard.listen(address, resolve); });
  } catch (failure) { if (['EADDRINUSE', 'EACCES'].includes(failure.code)) throw locked(); throw failure; }
  guard.on('error', () => {});
  const releaseGuard = () => new Promise((resolve, reject) => guard.close(failure => failure ? reject(failure) : resolve()));
  const file = path.join(canonical, 'registry.lock');
  const contents = JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomBytes(16).toString('hex') });
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    let previous;
    try { previous = await readFile(file, 'utf8'); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    if (previous !== undefined) {
      let owner;
      try { owner = JSON.parse(previous); } catch { throw locked(); }
      if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || owner.host !== hostname()) throw locked();
      try { process.kill(owner.pid, 0); throw locked(); }
      catch (failure) { if (failure.code !== 'ESRCH') throw locked(); }
      await unlink(file);
    }
    // Publish a complete record without a crash window containing an empty lock.
    await writeRegistryJson(temporary, JSON.parse(contents));
    await link(temporary, file);
    await syncDirectory(canonical);
  } catch (failure) { await releaseGuard(); throw failure; }
  finally { await unlink(temporary).catch(() => {}); }
  let released;
  return () => released ??= (async () => {
    try {
      if ((await readFile(file, 'utf8')).trim() !== contents) throw locked();
      await unlink(file); await syncDirectory(canonical);
    } finally { await releaseGuard(); }
  })();
}
