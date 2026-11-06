import path from 'node:path';
import { noLinks, exists } from './files.mjs';
import { acquireStoreOwnership } from '../../app/storage/store-lock.mjs';

// Automatic operator starts can precede ExecStartPre with a stopped check.
// Recover only ownership the runtime itself can prove stale, under its guard.
export async function assertStartOwnershipReleased(dataDir) {
  await noLinks(await exists(dataDir) ? dataDir : path.dirname(dataDir));
  // Preserve the ordinary operator check's two cheap presence checks. Only an
  // existing marker needs runtime ownership/recovery before runtime startup.
  for (const name of ['store.lock', 'store.lock.recovery']) if (await exists(path.join(dataDir, name))) {
    const { release } = await acquireStoreOwnership(dataDir, { existingOnly: true });
    await release();
    return;
  }
}
