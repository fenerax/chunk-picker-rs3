import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chown, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { snapshotPath } from '../../app/storage/snapshot.mjs';
import { copyTree, directory, headroom, inventory, json, noLinks } from './files.mjs';

// Root takes ownership of the service-created snapshot, then works only on a
// private copy. A failed request never falls back to stopping the writer.
export async function captureOnline({ settings, release, request }) {
  const id = randomUUID(), source = snapshotPath(settings.dataDir, id);
  let scratch;
  try {
    const result = await request(release, settings.multiPicker ? '/api/operator/service-snapshot' : '/api/operator/snapshot', 'POST', { id });
    if (result.id !== id || !Number.isFinite(result.heldMs)) throw new Error('Invalid online snapshot response.');
    await noLinks(source);
    if ((await json(path.join(source, 'complete.json'))).id !== id) throw new Error('Incomplete online snapshot.');
    const files = await inventory(source);
    if (process.platform === 'linux' && process.getuid() === 0) {
      await chown(source, 0, 0);
      for (const row of files) await chown(path.join(source, row.path), 0, 0);
    }
    await directory(settings.scratchRoot);
    await headroom(settings.scratchRoot, files.reduce((n, row) => n + (row.bytes ?? 0), 0) * 7, settings.minFreeBytes);
    scratch = await mkdtemp(path.join(settings.scratchRoot, 'online-'));
    if (settings.multiPicker) {
      const serviceDir = path.join(scratch, 'service');
      await copyTree(source, serviceDir);
      return { serviceDir, heldMs: result.heldMs, cleanup: () => rm(scratch, { recursive: true, force: true }) };
    }
    const dataDir = path.join(scratch, 'store');
    await copyTree(path.join(source, 'store'), dataDir);
    await copyFile(path.join(source, 'store.dataset.json'), dataDir + '.dataset.json', 1);
    return { dataDir, heldMs: result.heldMs, cleanup: () => rm(scratch, { recursive: true, force: true }) };
  } catch (error) {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    throw error;
  } finally {
    // Random operation-owned path only. A timed-out writer may finish later;
    // leave such evidence for explicit reconciliation rather than racing it.
    try { if ((await json(path.join(source, 'complete.json'))).id === id) await rm(source, { recursive: true }); } catch {}
  }
}
