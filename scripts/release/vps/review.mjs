// Run on the VPS with the installed operator tools, never against the live store.
import path from 'node:path';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertReleased, atomic, copyTree, directory, encode, exclusive, exists, headroom, json, noLinks, outside, sha } from '../../linux/files.mjs';
import { readRelease } from '../../linux/runtime.mjs';
import { checkStoppedCompatibility, verifyBackup } from '../../linux/recovery.mjs';
import { bindingBytes, configDescriptor } from '../../private-companion/release-pack-check.mjs';
import { digestValue } from '../../private-companion/release-identity.mjs';

export async function newestVerifiedBackup(backupDir) {
  await noLinks(backupDir);
  // Match the publisher's names and ordering, ignoring pending/unrelated files.
  const names = (await readdir(backupDir)).filter(name => /^recovery-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name)).sort().reverse();
  for (const name of names) {
    const backup = path.join(backupDir, name);
    try { return { backup, manifest: await verifyBackup(backup) }; } catch {}
  }
  throw new Error('No verified recovery backup is available.');
}
export async function deriveVpsAdditions({ settings, pointer, receiptFile, acceptDigest, check = checkStoppedCompatibility }) {
  await directory(settings.controlDir);
  return exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
    if (await exists(path.join(settings.controlDir, 'maintenance.json'))) throw new Error('Maintenance evidence remains.');
    const current = await readRelease(settings.current, settings.dataDir);
    const candidate = await readRelease(pointer, settings.dataDir);
    await noLinks(receiptFile);
    const receiptBytes = await readFile(receiptFile), receipt = JSON.parse(receiptBytes);
    if (receipt.additionsReviewRequired !== true || receipt.previousPointerSha256 !== sha(current.pointerBytes)
      || receipt.candidateIdentity !== candidate.identity || path.resolve(receipt.pointer) !== path.resolve(pointer)) throw new Error('Staged deployment receipt changed.');
    const { backup, manifest } = await newestVerifiedBackup(settings.backupDir);
    outside(backup, settings.scratchRoot); outside(settings.dataDir, settings.scratchRoot);
    await directory(settings.scratchRoot);
    await headroom(settings.scratchRoot, manifest.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0) * 8, settings.minFreeBytes);
    const scratch = await mkdtemp(path.join(settings.scratchRoot, 'vps-additions-'));
    try {
      const dataDir = path.join(scratch, 'store');
      await copyTree(path.join(backup, 'store'), dataDir);
      await copyFile(path.join(backup, 'store.dataset.json'), dataDir + '.dataset.json', 1);
      let candidateBinding;
      if (candidate.config.packs?.data) {
        const old = await configDescriptor(current.pointer.config.path), next = await configDescriptor(candidate.pointer.config.path);
        const binding = await json(dataDir + '.dataset.json');
        if (['datasetId', 'datasetContractVersion', 'digest'].some(key => binding[key] !== old.descriptor[key])) throw new Error('Backup binding differs from selected release.');
        if (encode(old.descriptor) !== encode(next.descriptor)) candidateBinding = bindingBytes(next.descriptor);
      }
      const proof = await check({ dataDir, scratchRoot: path.join(scratch, 'probes'), current, candidate, candidateBinding,
        minFreeBytes: settings.minFreeBytes, assertStopped: () => assertReleased(dataDir) });
      const savedIdentityAdditions = proof.savedIdentityAdditions, digest = digestValue(savedIdentityAdditions);
      // Probes only open scratch; neither the backup nor its manifest may change.
      if (encode(manifest) !== encode(await verifyBackup(backup))) throw new Error('Recovery backup changed.');
      if (sha(await readFile(settings.current)) !== receipt.previousPointerSha256
        || sha(await readFile(receiptFile)) !== sha(receiptBytes)) throw new Error('Review inputs changed.');
      if (acceptDigest !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(acceptDigest) || acceptDigest !== digest) throw new Error('Reviewed additions digest differs.');
        await atomic(receiptFile, encode({ ...receipt, savedIdentityAdditions, savedIdentityAdditionsDigest: digest,
          savedIdentityAdditionsReviewed: true, additionsBackupManifestSha256: sha(encode(manifest)) }));
      }
      return { savedIdentityAdditions, digest, accepted: acceptDigest !== undefined };
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [pointer, receiptFile, operatorFile, acceptDigest, ...extra] = process.argv.slice(2);
    if (!pointer || !receiptFile || !operatorFile || extra.length) throw new Error();
    // Reuse the operator's validated settings reader without opening the store.
    process.env.RS3_OPERATOR_CONFIG = operatorFile;
    const { operatorSettings } = await import('../../linux/runtime.mjs');
    const result = await deriveVpsAdditions({ settings: await operatorSettings(), pointer, receiptFile, acceptDigest });
    process.stdout.write(encode(result));
  } catch { process.stderr.write('VPS additions review refused; inspect privately.\n'); process.exitCode = 1; }
}
