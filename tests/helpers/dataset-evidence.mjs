import { createHash } from 'node:crypto';
import { createGroupState } from '../../app/core/state.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { datasetDigest, DATASET_CONTRACT, DATASET_OVERLAY_ORDER } from '../../app/datasets.mjs';
import { prepareOwnedPickerState } from '../../app/game-profile.mjs';
import { catalogue, syntheticWorld } from '../../scripts/perf/capacity/model.mjs';

export const memberId = 'synthetic-member', pickerId = 'synthetic-picker';
export const pickerRegistry = { getPicker: () => ({ memberIds: [memberId] }),
  listAccounts: () => [{ memberships: [{ pickerId, role: 'owner', memberId }] }] };
export function syntheticDataset({ input = 'synthetic game data', evidence = 'old source', capabilities = {}, overlays = [] } = {}) {
  const record = (path, value, kind) => ({ path, kind, bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') });
  const files = [record('synthetic/input.json', input, 'input'), record('app/tasks/engine.mjs', evidence, 'evidence')];
  return { ...DATASET_CONTRACT, files, capabilities, overlayOrder: DATASET_OVERLAY_ORDER, definitionOverlays: overlays,
    digest: datasetDigest(files, capabilities, overlays),
    digestWithEvidence: rows => datasetDigest([...files.filter(row => row.kind === 'input'), ...rows], capabilities, overlays) };
}
export function storageOptions(dataDir, dataset) {
  const registry = createRuleRegistry(), world = syntheticWorld(catalogue({ chunks: 4, tasks: 4, dependencyDepth: 1, crossLinks: 1 }), buildWorld);
  const initialState = createGroupState([{ id: memberId, name: 'Synthetic member' }], registry);
  initialState.provenance = { dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
  return { dataDir, registry, world, initialState, retention: false, now: '2026-01-01T00:00:00.000Z',
    prepareState: prepareOwnedPickerState(dataset, pickerRegistry, pickerId) };
}
