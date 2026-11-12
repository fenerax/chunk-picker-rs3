import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGroupState, applyCommand } from '../../../app/core/state.mjs';
import { createRuleRegistry } from '../../../app/core/rules.mjs';
import { buildWorld } from '../../../app/data/world.mjs';
import { openStore } from '../../../app/storage/store.mjs';
import { bindDatasetStorage } from '../../../app/dataset-binding.mjs';
import { selectedDataset } from '../../../app/dataset-runtime.mjs';
import { random, digest, syntheticWorld } from './model.mjs';
import { growthCommands, fixtureProgress } from './growth.mjs';
import { fixtureMigration, calibrateIdentities } from './fixture-migration.mjs';

export async function buildGroup({ item, dataDir, pickerId }, { profile, worldData, tasks, migrationInputs, progress, ownedServing }) {
  const started = performance.now(), rules = createRuleRegistry(), world = syntheticWorld(worldData, buildWorld);
  const step = fixtureProgress(progress);
  const update = value => step({ groupIndex: item.index, rosterSize: item.size, grown: item.grown, ...value });
  let state = createGroupState(item.members, rules), tick = 0, growthCount = 0;
  state.provenance = { dataset: { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest } };
  const f = profile.fixture, chunks = Object.keys(worldData.chunks), rng = random(`${profile.seed}-${item.index}`);
  const expectedTicks = item.size * (Math.max(1, Math.floor(chunks.length * f.unlockFraction)) + 6) + 1 + f.historyEvents + f.snapshots;
  const now = () => Date.UTC(2026, 9, 1) + (tick - expectedTicks) * 12 * 3600000;
  const growthStarted = performance.now();
  if (item.grown) for (const { command, ticks = 1 } of growthCommands(state, item, chunks, f, now, rules)) {
    await update({ phase: 'growth', completed: growthCount, total: item.size * 7 + 2, commandType: command.type });
    tick += ticks;
    state = applyCommand(state, command, { world, registry: rules, now: now(), random: rng });
    await update({ phase: 'growth', completed: ++growthCount, total: item.size * 7 + 2 });
  }
  const growthMs = performance.now() - growthStarted;
  state.tasks = state.tasks.concat(structuredClone(tasks));
  const hooks = fixtureMigration(migrationInputs, selectedDataset);
  state = calibrateIdentities(hooks.migrateState(state, { operation: 'initialize' }), profile.catalogue);
  await bindDatasetStorage(dataDir, selectedDataset);
  await update({ phase: 'open-store', completed: 0, total: 1 });
  const durableStarted = performance.now();
  let catalogueAdmitted = false;
  const store = await openStore({ dataDir, world, registry: rules, initialState: state, now, random: rng, ...hooks,
    ownedFormat2: ownedServing ? { ...ownedServing, pickerId, releaseBytes: Buffer.from(ownedServing.releaseBytes),
      // Acknowledged progress exposes the first real catalogue admission while
      // its lease is held, including a deterministic overlap seam for tests.
      crash: async phase => {
        if (phase === 'catalogue-exclusive-admitted' && !catalogueAdmitted) {
          catalogueAdmitted = true;
          await update({ phase: 'catalogue-admitted', completed: 0, total: 1 });
        }
      } } : false });
  const result = { index: item.index, grown: item.grown, variant: item.variant, growthMs, growthCommands: growthCount };
  try {
    if (item.grown) {
      await update({ phase: 'replacement', completed: 0, total: 1 });
      await store.replace({ format: 'rs3-chunk-picker', schemaVersion: 1, state: store.getState() }, store.getInfo().revision);
      for (const [phase, count] of [['history', f.historyEvents], ['snapshots', f.snapshots]]) for (let i = 0; i < count; i++) {
        await update({ phase, completed: i, total: count, commandType: 'set-note' });
        tick++;
        await store.command({ type: 'set-note', memberId: 'owner', chunkId: chunks[i % chunks.length],
          note: phase === 'history' ? `Synthetic history ${item.index}-${i}` : `Synthetic snapshot ${i}` }, store.getInfo().revision);
        await update({ phase, completed: i + 1, total: count });
      }
      await update({ phase: 'prepare-snapshot', completed: 0, total: 1 });
      await store.prepareSnapshot();
    }
    result.durableMs = performance.now() - durableStarted;
    result.retention = store.getInfo().retention; result.retainedSnapshots = (await store.listBackups()).length;
    result.revision = store.getInfo().revision;
    const saved = store.getState();
    result.stateDigest = digest(saved); result.stateBytes = Buffer.byteLength(JSON.stringify(saved));
    result.taskRows = saved.tasks.length; result.aliases = Object.keys(saved.identityRegistry?.aliases ?? {}).length;
    // Archive filenames are application entropy. Preserve archive CONTENT in
    // the logical digest while excluding those random names, like credentials.
    if (saved.provenance?.historyArchive) for (const reference of saved.provenance.historyArchive) {
      reference.id = digest(await readFile(path.join(dataDir, 'history', reference.id)));
    }
    result.logicalStateDigest = digest(saved);
  } finally { await store.close(); }
  result.setupMs = performance.now() - started;
  return result;
}
