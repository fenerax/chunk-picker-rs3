import { open, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { publishFile } from './publication.mjs';

// Dependencies (backups, sidecars, archives and lock records) must be durable
// before later writes can reference them or remove their previous source.
export async function atomicWrite(file, contents, { beforeRename, onPostPublishSyncError = 'throw' } = {}) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforeRename) await beforeRename();
    return await publishFile(temporary, file, { onPostPublishSyncError });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
