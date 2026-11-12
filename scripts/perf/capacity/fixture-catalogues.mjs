import path from 'node:path';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';

// Catalogue admission is local to a JS isolate, but its kernel guard excludes
// every other isolate/process. Give parallel fixture writers independent roots
// instead of sharing or bypassing that guard. Saved references contain only the
// base pin, so the completed fixture still needs exactly one canonical catalogue.
export async function fixtureCatalogues(ownedServing, jobs, workers) {
  if (!ownedServing || workers <= 1) return { releases: Array(workers).fill(ownedServing), close: async () => {} };
  const { createPinnedStorage } = await import('../../../app/storage/owned-storage.mjs');
  await mkdir(jobs[0].dataDir, { recursive: true });
  await createPinnedStorage({ ...ownedServing, pickerId: jobs[0].pickerId }, jobs[0].dataDir).ensurePublished();
  const scratch = await mkdtemp(path.join(path.dirname(ownedServing.catalogueRoot), '.fixture-catalogues-'));
  const close = () => rm(scratch, { recursive: true, force: true });
  try {
    const releases = [];
    for (let slot = 0; slot < workers; slot++) {
      const catalogueRoot = path.join(scratch, String(slot));
      // Copy once per worker, never per group. Retain the real writer, release
      // validation and process guard on each copy; never hard-link mutable files.
      await cp(ownedServing.catalogueRoot, catalogueRoot, { recursive: true });
      const local = filename => path.join(catalogueRoot, path.basename(filename));
      releases.push({ ...ownedServing, catalogueRoot, manifestPath: local(ownedServing.manifestPath),
        releasePath: local(ownedServing.releasePath), retainedManifestPaths: (ownedServing.retainedManifestPaths ?? []).map(local) });
    }
    return { releases, close };
  } catch (error) { await close(); throw error; }
}
