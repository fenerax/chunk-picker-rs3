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

/** Publish an already synchronized temporary file, then persist its directory entry. */
export async function publishFile(temporary, file, { filesystem = fs, platform = process.platform, wait = delay } = {}) {
  // Windows scanners can briefly hold the destination without delete-sharing.
  // Retry the same synchronized replacement; never remove the old file.
  for (let attempt = 0; ; attempt++) {
    try { await filesystem.rename(temporary, file); break; }
    catch (failure) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code) || attempt >= 6) throw failure;
      await wait(20 * 2 ** attempt);
    }
  }
  await syncDirectory(path.dirname(file), { filesystem, platform });
}
