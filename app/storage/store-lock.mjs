import { link, lstat, readFile, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { atomicWrite } from './atomic-write.mjs';
import { acquireProcessGuard } from './process-guard.mjs';

let host;
const execFileAsync = promisify(execFile);
let ownStart;
let ownStartVerified;
let ownIdentityPending;

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

async function processStartedAt(pid) {
  if (pid === process.pid && ownStart) return ownStartVerified ? ownStart : undefined;
  try {
    const result = process.platform === 'win32'
      ? await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { timeout: 3000, windowsHide: true })
      : await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 3000 });
    const time = Date.parse(result.stdout.trim());
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
  } catch { return undefined; }
}

/** Resolve this process's lock identity while other startup work is pending. */
export function prepareStoreProcessIdentity() {
  return ownIdentityPending ??= (async () => {
    ownStart = await processStartedAt(process.pid);
    ownStartVerified = ownStart !== undefined;
    ownStart ??= new Date(Date.now() - process.uptime() * 1000).toISOString();
  })();
}

async function ownerIsStale(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return false;
  // A copied directory from another host is not evidence that its owner died.
  if (owner.host !== undefined && owner.host !== host) return false;
  if (!isAlive(owner.pid)) return true;
  if (owner.startVerified === false || typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt))) return false;
  const actual = await processStartedAt(owner.pid);
  return actual !== undefined && Date.parse(actual) !== Date.parse(owner.startedAt);
}

async function removeUnchanged(file, contents) {
  try {
    if (await readFile(file, 'utf8') !== contents) return false;
    await unlink(file);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Publish the complete synchronized owner record in one exclusive operation;
// interruption cannot leave an empty newly created lock/recovery marker.
async function createOwnerFile(file, contents) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await atomicWrite(temporary, contents);
    await link(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function acquireStoreFileLock(directory, beforeLockRecovery) {
  host ??= hostname();
  const file = path.join(directory, 'store.lock');
  await prepareStoreProcessIdentity();
  const contents = JSON.stringify({ pid: process.pid, startedAt: ownStart, startVerified: ownStartVerified, host, nonce: randomBytes(16).toString('hex'), createdAt: new Date().toISOString() });
  const recoveryFile = `${file}.recovery`;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      // Recovery ownership also matters when a crash already removed store.lock.
      const marker = await readFile(recoveryFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (marker !== undefined) {
        let owner;
        try { owner = JSON.parse(marker); } catch { /* Legacy empty marker: require a dead lock owner and an age grace period. */ }
        let stale = owner && await ownerIsStale(owner);
        if (!owner) {
          let locked;
          try { locked = JSON.parse(await readFile(file, 'utf8')); } catch { /* Uncertain ownership requires manual recovery. */ }
          stale = locked && await ownerIsStale(locked) && Date.now() - (await stat(recoveryFile)).mtimeMs > 30_000;
        }
        if (!stale) throw new Error('Another server is recovering the data-directory lock, or its recovery owner cannot be verified. Inspect store.lock.recovery.');
        await removeUnchanged(recoveryFile, marker);
        continue;
      }
      await createOwnerFile(file, contents);
      return () => removeUnchanged(file, contents);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery too: a second process must not unlink the
      // fresh lock obtained by the first recovery contender.
      try { await createOwnerFile(recoveryFile, contents); } catch (recoveryError) {
        if (recoveryError.code === 'EEXIST') continue;
        throw recoveryError;
      }
      try {
        let previous;
        try { previous = await readFile(file, 'utf8'); } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
        let parsed;
        try { parsed = JSON.parse(previous); } catch { throw new Error('The store has an unreadable lock; inspect store.lock before restarting.'); }
        if (!await ownerIsStale(parsed)) throw new Error('Another server already holds this data-directory lock, or its owner cannot be verified.');
        if (beforeLockRecovery) await beforeLockRecovery({ lockFile: file, recoveryFile });
        await removeUnchanged(file, previous);
      } finally { await removeUnchanged(recoveryFile, contents); }
    }
  }
  throw new Error('Could not acquire the data-directory lock.');
}


// Presence checks replace the start gate's old assertReleased checks. A clean
// checkpoint needs only kernel ownership: no owner lookup or lock-file writes.
export async function acquireStoreOwnership(directory, { existingOnly = false } = {}) {
  const releaseGuard = await acquireProcessGuard(directory);
  let releaseFile;
  const ensureFileLock = async () => { releaseFile ??= await acquireStoreFileLock(directory); };
  const release = async () => { try { await releaseFile?.(); } finally { await releaseGuard(); } };
  try {
    if (!existingOnly) await ensureFileLock();
    else for (const name of ['store.lock', 'store.lock.recovery']) {
      try { await lstat(path.join(directory, name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await ensureFileLock(); break;
    }
    return { ensureFileLock, release };
  } catch (error) { await release(); throw error; }
}
