import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { DATASET_CONTRACT, DATASET_OVERLAY_ORDER, datasetDigest } from '../../app/datasets.mjs';
import { datasetEvidencePath, datasetEvidenceRecord, readDatasetEvidence, provesEvidenceOnly } from '../../app/dataset-evidence.mjs';
import { atomic, encode, noLinks, sha, exists } from './files.mjs';
import { readStaticFieldBytes } from '../../app/storage/static-field.mjs';
import { bindingBytes } from '../private-companion/release-pack-check.mjs';

async function pinned(pin) {
  await noLinks(pin.path);
  const bytes = await readFile(pin.path);
  if (sha(bytes) !== pin.sha256) throw new Error('Dataset evidence release pin changed.');
  return JSON.parse(bytes);
}

// Read data, never executable code, from the immutable operator-selected release.
export async function releaseEvidenceDataset(release) {
  const config = release.config;
  if (!config.packs?.data || !config.packs?.rulesText || !config.profile) return undefined;
  const [data, text, profile] = await Promise.all([pinned(config.packs.data), pinned(config.packs.rulesText), pinned(config.profile)]);
  if (!isDeepStrictEqual(data.requires, DATASET_CONTRACT) || !isDeepStrictEqual(data.overlayOrder, DATASET_OVERLAY_ORDER)) throw new Error('Dataset evidence contract differs.');
  const files = [...data.files, ...text.files].filter(row => ['input', 'evidence'].includes(row.kind));
  const overlays = profile.catalogue.definitionOverlays ?? [];
  const dataset = { ...DATASET_CONTRACT, digest: data.datasetDigest, files,
    digestWithEvidence: evidence => datasetDigest([...files.filter(row => row.kind === 'input'), ...evidence], data.capabilities, overlays) };
  if (!datasetEvidenceRecord(dataset)) throw new Error('Dataset evidence manifest does not reproduce its digest.');
  return dataset;
}

export async function releaseEvidenceRecords(current, candidate) {
  const datasets = await Promise.all([releaseEvidenceDataset(current), releaseEvidenceDataset(candidate)]);
  return { current: datasets[0], candidate: datasets[1], records: datasets.map(dataset => dataset && datasetEvidenceRecord(dataset)).filter(Boolean) };
}

export async function serviceEvidenceBinding(current, candidate) {
  const [from, to] = [current.config, candidate.config];
  const changed = ['data', 'rulesText'].some(key => from.packs?.[key]?.sha256 !== to.packs?.[key]?.sha256)
    || ['profile', 'selection'].some(key => from[key]?.sha256 !== to[key]?.sha256);
  if (from.datasetId !== to.datasetId || from.packs?.art?.sha256 !== to.packs?.art?.sha256
    || from.addons?.sha256 !== to.addons?.sha256) throw new Error('Service pack changes require sequential recovery; in-place deploy refused.');
  if (!changed) return undefined;
  const transition = await releaseEvidenceRecords(current, candidate), old = transition.current && datasetEvidenceRecord(transition.current);
  if (!transition.candidate || !old || !provesEvidenceOnly(transition.candidate,
    { id: transition.candidate.datasetId, contractVersion: transition.candidate.datasetContractVersion, digest: old.digest }, [old]))
    throw new Error('Service pack changes require sequential recovery; transition is not proven evidence-only.');
  return bindingBytes(transition.candidate);
}

export async function retainReleaseDatasetEvidence(dataDir, current, candidate) {
  const { records } = await releaseEvidenceRecords(current, candidate);
  if (!records.length) return;
  const kept = new Map((await readDatasetEvidence(dataDir)).map(record => [record.digest, record]));
  for (const record of records) kept.set(record.digest, record);
  // Durable before selection changes; extra records after an interrupted deploy
  // grant nothing unless reconstruction matches an actual saved/bound digest.
  await atomic(datasetEvidencePath(dataDir), encode({ schemaVersion: 1, records: [...kept.values()] }), 0o644);
}

export async function checkSavedDatasetEvidence(dataDir, current, candidate) {
  const document = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  // Format 2 serves its immutable pinned base and has its own explicit rebase.
  if (document.storage?.schemaVersion === 2) return;
  const provenance = document.storage?.fields?.provenance
    ? JSON.parse(await readStaticFieldBytes(dataDir, 'provenance', document.storage.fields.provenance)) : document.state?.provenance;
  const identity = provenance?.dataset;
  if (!identity) return; // The unstamped duo path has no owned-picker gate.
  const transition = await releaseEvidenceRecords(current, candidate);
  if (!transition.candidate) return;
  const dataset = transition.candidate;
  if (identity.id === dataset.datasetId && identity.contractVersion === dataset.datasetContractVersion && identity.digest === dataset.digest) return;
  if (!await exists(path.join(candidate.config.coreRoot, 'app/dataset-evidence.mjs')))
    throw new Error('Receiving release cannot open a changed owned dataset stamp; keep the service stopped.');
  if (!provesEvidenceOnly(dataset, identity, [provenance.datasetEvidence,
    ...await readDatasetEvidence(dataDir), ...transition.records])) throw new Error('Saved dataset transition cannot be proven evidence-only; keep the service stopped.');
}
