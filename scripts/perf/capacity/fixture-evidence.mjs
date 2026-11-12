import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { datasetEvidencePath, datasetEvidenceRecord, provesEvidenceOnly } from '../../../app/dataset-evidence.mjs';
import { atomicWrite } from '../../../app/storage/atomic-write.mjs';
import { openRegistry } from '../../../app/storage/registry.mjs';
import { openStore } from '../../../app/storage/store.mjs';
import { verifyDatasetBinding } from '../../../app/dataset-binding.mjs';
import { prepareOwnedPickerState } from '../../../app/game-profile.mjs';
import { buildWorld } from '../../../app/data/world.mjs';
import { prepareFixtureInputs } from './fixture-inputs.mjs';
import { fixtureMigration } from './fixture-migration.mjs';
import { digest, syntheticWorld } from './model.mjs';

// Only called after all streams have been copied and hash-verified. The source
// is never passed to an API that opens storage for writing.
export async function refreshFixtureEvidence(directory, profile, manifest, dataset, records) {
  if (manifest.storageFormat !== 'format1') throw new Error('Evidence-only fixture refresh requires format 1; format 2 needs an explicit pinned-base rebase.');
  const { data, rules, migrationInputs } = await prepareFixtureInputs(profile);
  const world = syntheticWorld(data, buildWorld), { migrateState } = fixtureMigration(migrationInputs, dataset);
  const retained = [...new Map([...records, datasetEvidenceRecord(dataset)].filter(record => provesEvidenceOnly(dataset,
    { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: record?.digest }, [record]))
    .map(record => [record.digest, record])).values()];
  const serving = { ...dataset, evidenceHistory: retained };
  const paths = { registryDir: path.join(directory, 'registry'), pickerRoot: path.join(directory, 'pickers'), tombstoneDir: path.join(directory, 'tombstones') };
  const registry = await openRegistry({ ...paths, caps: profile.entityCaps });
  let refreshed = 0;
  const retain = async dataDir => {
    await atomicWrite(datasetEvidencePath(dataDir), JSON.stringify({ schemaVersion: 1, records: retained }));
    const binding = await verifyDatasetBinding(dataDir, serving, { evidenceOnly: true });
    if (!binding.bound) throw new Error('Fixture dataset binding is missing.');
  };
  try {
    await retain(path.join(directory, 'legacy'));
    for (const group of manifest.groups) {
      const dataDir = registry.pickerDirectory(group.pickerId);
      await retain(dataDir);
      const store = await openStore({ dataDir, world, registry: rules, migrateState,
        prepareState: prepareOwnedPickerState(serving, registry, group.pickerId), retention: false,
        // The builder's synthetic epoch keeps upgraded fixtures reproducible.
        now: '2026-10-01T00:00:00.000Z' });
      try {
        const state = store.getState();
        if (state.provenance?.dataset?.digest !== dataset.digest || state.revision !== group.revision + 1
          || state.history.at(-1)?.type !== 'catalogue-refresh') throw new Error('Fixture evidence refresh did not commit exactly one catalogue migration.');
        group.revision = state.revision; group.stateDigest = digest(state);
        group.stateBytes = Buffer.byteLength(JSON.stringify(state));
        group.retainedSnapshots = (await store.listBackups()).length;
        if (state.provenance?.historyArchive) for (const reference of state.provenance.historyArchive)
          reference.id = digest(await readFile(path.join(dataDir, 'history', reference.id)));
        group.logicalStateDigest = digest(state);
        refreshed++;
      } finally { await store.close(); }
    }
  } finally { await registry.close(); }
  return { oldDigest: manifest.datasetDigest, newDigest: dataset.digest,
    applied: 'evidence-only catalogue-refresh', refreshedPickers: refreshed,
    backupsAdded: refreshed, revisionIncrements: refreshed, eventsAdded: refreshed,
    bindingReceipts: 'retained; proven evidence-only on read', sourceFixtureDigest: manifest.fixtureDigest };
}
