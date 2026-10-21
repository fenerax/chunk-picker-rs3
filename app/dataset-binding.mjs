import path from 'node:path';
import { readFile, mkdir, writeFile, link, unlink, rename, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safeArtFile } from './packs.mjs';

export const bindingPath = dataDir => `${path.resolve(dataDir)}.dataset.json`;
function mismatch() { const error = new Error('This storage directory needs its bound data pack.'); error.code = 'DATASET_BINDING_MISMATCH'; return error; }
function expected(dataset) {
  const status = typeof dataset.status === 'function' ? dataset.status() : dataset;
  const receipt = { schemaVersion: 1, datasetId: dataset.datasetId ?? status.id, datasetContractVersion: dataset.datasetContractVersion ?? status.contractVersion, digest: dataset.digest ?? status.digest,
    ...(dataset.packed === true ? { requiresPack: true } : {}) };
  if (typeof receipt.datasetId !== 'string' || !Number.isSafeInteger(receipt.datasetContractVersion) || !/^[a-f0-9]{64}$/.test(receipt.digest ?? '')) throw mismatch();
  return receipt;
}
/** Pre-open check only; this never reads or prepares gameplay storage. */
export async function verifyDatasetBinding(dataDir, dataset) {
  const target = bindingPath(dataDir), receipt = expected(dataset);
  try {
    // A lexical sibling receipt must not be bypassed through a junction or
    // another realpath alias to an already bound physical storage directory.
    // Inspect directory metadata only; ordinary not-yet-created roots remain
    // valid, and gameplay files stay unopened.
    try { await safeArtFile(path.resolve(dataDir)); }
    catch (error) { if (error.code !== 'ENOENT') throw mismatch(); }
    await safeArtFile(path.dirname(target), path.basename(target));
    if ((await lstat(target)).size > 65536) throw mismatch();
    const existing = JSON.parse(await readFile(target, 'utf8'));
    const fields = ['schemaVersion', 'datasetId', 'datasetContractVersion', 'digest'];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing) || Object.keys(existing).some(key => ![...fields, 'requiresPack'].includes(key))
      || fields.some(key => existing[key] !== receipt[key])
      || (Object.hasOwn(existing, 'requiresPack') && existing.requiresPack !== true)
      || (existing.requiresPack === true && dataset.packed !== true)) throw mismatch();
    return { bound: true, ...existing };
  } catch (error) { if (error.code === 'ENOENT') return { bound: false, ...receipt }; throw mismatch(); }
}
async function safeParent(directory) {
  let ancestor = directory;
  while (true) { try { await safeArtFile(ancestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; } }
  await mkdir(directory, { recursive: true }); await safeArtFile(directory);
}
/** Explicit operator binding writes one sibling receipt, never a save field or event. */
export async function bindDatasetStorage(dataDir, dataset) {
  const checked = await verifyDatasetBinding(dataDir, dataset);
  const promote = checked.bound && dataset.packed === true && checked.requiresPack !== true;
  if (checked.bound && !promote) return checked;
  const target = bindingPath(dataDir), temporary = `${target}.${randomUUID()}.tmp`;
  await safeParent(path.dirname(target));
  try {
    await writeFile(temporary, `${JSON.stringify(expected(dataset), null, 2)}\n`, { flag: 'wx' });
    if (promote) {
      // Explicit binding may strengthen a matching tracked receipt. Verify
      // again before replacing the sibling; gameplay storage stays unopened.
      const latest = await verifyDatasetBinding(dataDir, dataset);
      if (latest.bound && latest.requiresPack !== true) await rename(temporary, target);
      else if (!latest.bound) { try { await link(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    } else { try { await link(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    return await verifyDatasetBinding(dataDir, dataset);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
