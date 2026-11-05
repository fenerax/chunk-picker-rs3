import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function syncDirectory(directory, { filesystem = fs, platform = process.platform } = {}) {
  let handle;
  try { handle = await filesystem.open(directory, 'r'); await handle.sync(); }
  catch (failure) {
    if (platform !== 'win32' || !['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(failure.code)) throw failure;
  } finally { await handle?.close(); }
}

/** Warn only when the caller can adopt a self-consistent published file. Ordered
 * publications must stop on sync failure even though rename cannot be undone. */
export async function publishFile(temporary, file, { filesystem = fs, platform = process.platform, wait = delay,
  onPostPublishSyncError = 'throw' } = {}) {
  if (!['warn', 'throw'].includes(onPostPublishSyncError)) throw new TypeError('Invalid post-publication sync error policy.');
  // Windows scanners can briefly hold the destination without delete-sharing.
  // Retry the same synchronized replacement; never remove the old file.
  for (let attempt = 0; ; attempt++) {
    try { await filesystem.rename(temporary, file); break; }
    catch (failure) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code) || attempt >= 6) throw failure;
      await wait(20 * 2 ** attempt);
    }
  }
  try {
    await syncDirectory(path.dirname(file), { filesystem, platform });
    return { durable: true };
  } catch (error) {
    if (onPostPublishSyncError === 'throw') throw error;
    return { durable: false, error };
  }
}

/** Never include file contents, credentials, paths or arbitrary error messages. */
export function warnDurability(publication, store) {
  if (publication?.durable !== false) return;
  const code = /^[A-Z0-9_]{1,32}$/.test(publication.error?.code ?? '') ? publication.error.code : 'UNKNOWN';
  console.warn(`[storage] ${store}: write published, but parent directory sync failed (${code}); crash durability is uncertain.`);
}
