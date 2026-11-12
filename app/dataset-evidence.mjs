import path from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { safeArtFile } from './packs.mjs';

export const datasetEvidencePath = directory => path.join(directory, 'dataset-evidence.json');
const hash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const valid = proof => proof && hash(proof.digest) && Array.isArray(proof.files) && proof.files.length <= 10000
  && proof.files.every(row => row && Object.keys(row).sort().join() === 'bytes,kind,path,sha256'
    && row.kind === 'evidence' && typeof row.path === 'string' && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && hash(row.sha256))
  && new Set(proof.files.map(row => row.path)).size === proof.files.length;

// A provider must implement its ORIGINAL digest algorithm with only evidence
// substituted. In particular, a pinned format-2 base cannot borrow the running
// provider's inputs to certify a different base digest.
export function datasetEvidenceRecord(dataset) {
  if (typeof dataset.digestWithEvidence !== 'function' || !Array.isArray(dataset.files)) return undefined;
  const proof = { digest: dataset.digest, files: dataset.files.filter(row => row.kind === 'evidence')
    .map(({ path, bytes, sha256, kind }) => ({ path, bytes, sha256, kind })) };
  return valid(proof) && dataset.digestWithEvidence(proof.files) === dataset.digest ? proof : undefined;
}

export function provesEvidenceOnly(dataset, identity, proofs = []) {
  if (!identity || identity.id !== dataset.datasetId || identity.contractVersion !== dataset.datasetContractVersion
    || !hash(identity.digest) || !datasetEvidenceRecord(dataset)) return false;
  return proofs.some(proof => valid(proof) && proof.digest === identity.digest
    && dataset.digestWithEvidence(proof.files) === identity.digest);
}

export async function readDatasetEvidence(directory) {
  const file = datasetEvidencePath(directory);
  try {
    await safeArtFile(directory, path.basename(file));
    if ((await lstat(file)).size > 8 * 1024 ** 2) throw new Error('Dataset evidence history is too large.');
    const history = JSON.parse(await readFile(file, 'utf8'));
    if (history.schemaVersion !== 1 || !Array.isArray(history.records) || !history.records.every(valid)) throw new Error('Invalid dataset evidence history.');
    return history.records;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function datasetWithEvidenceHistory(directory, dataset) {
  const records = await readDatasetEvidence(directory);
  return records.length ? { ...dataset, evidenceHistory: [...(dataset.evidenceHistory ?? []), ...records] } : dataset;
}
