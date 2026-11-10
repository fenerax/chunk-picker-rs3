import path from 'node:path';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { catalogue, planFixture, digest, knownGaps, integer, syntheticWorld } from './model.mjs';
import { fixtureWorkers, buildGroups } from './fixture-pool.mjs';
import { fixtureConfigDigest, logicalFixtureDigest, sealFixture } from './fixture-cache.mjs';
import { fixtureMigration } from './fixture-migration.mjs';

// The parent alone owns registry/invites/keys. Workers exclusively own the
// disjoint picker stores between provisioning and ordered capability indexing.
export async function generate(profile, directory, { workers: requestedWorkers } = {}) {
  const started = performance.now(), plan = planFixture(profile), workers = fixtureWorkers(requestedWorkers, { groups: plan.length });
  const active = new Map();
  let groups = 0, characters = 0, builtGroups = 0, sequence = 0, writes = Promise.resolve();
  const progress = update => {
    const snapshot = { ...update, groups, characters, builtGroups, plannedGroups: plan.length, workers,
      active: [...active].sort(([a], [b]) => a - b).map(([worker, value]) => ({ worker, ...value })),
      sequence: ++sequence, updatedAt: new Date().toISOString(), elapsedMs: performance.now() - started };
    return writes = writes.then(async () => {
      const filename = path.join(directory, 'fixture-progress.json');
      await writeFile(filename + '.tmp', JSON.stringify(snapshot)); await rename(filename + '.tmp', filename);
    });
  };
  await progress({ phase: 'catalogue' });
  const [{ openRegistry }, { openStore }, { openInviteStore }, { openPluginKeys }, { createGroupState },
    { createRuleRegistry }, { buildWorld }, { selectedDataset }, { bindDatasetStorage }] = await Promise.all([
    import('../../../app/storage/registry.mjs'), import('../../../app/storage/store.mjs'), import('../../../app/storage/invites.mjs'),
    import('../../../app/plugin-keys.mjs'), import('../../../app/core/state.mjs'), import('../../../app/core/rules.mjs'),
    import('../../../app/data/world.mjs'), import('../../../app/dataset-runtime.mjs'), import('../../../app/dataset-binding.mjs')]);
  const data = catalogue(profile.catalogue), rules = createRuleRegistry();
  const { createTaskScheduler } = await import('../../../app/tasks/scheduler.mjs');
  const { prepareServerDefinitions, preparedDefinitionStages } = await import('../../../app/dataset-pipeline.mjs');
  const definitions = prepareServerDefinitions(structuredClone(data), selectedDataset, { reviewedOverlays: false });
  const calculator = await createTaskScheduler({ workerData: { definitions, datasetSelection: selectedDataset.workerSelection(),
    datasetDigest: selectedDataset.digest, datasetOptions: { reviewedOverlays: false, cacheWalking: false },
    preparedDatasetStages: preparedDefinitionStages(definitions), world: { ...syntheticWorld(data, buildWorld) } } });
  let migrationInputs;
  try {
    migrationInputs = { definitions, catalogue: calculator.catalogue, dynamicCatalogue: calculator.dynamicCatalogue,
      taskMap: {}, taskMapHistory: selectedDataset.capabilities.legacyHistory === false ? {} : await selectedDataset.json('app/data/legacy-task-history.json') };
  } finally { await calculator.close(); }
  const tasks = migrationInputs.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const { challenges, ...worldData } = data; // The world does not need task dependencies.
  const taskBytes = Buffer.from(JSON.stringify({ tasks, migrationInputs })), sharedTasks = new SharedArrayBuffer(taskBytes.length);
  Buffer.from(sharedTasks).set(taskBytes);
  const f = profile.fixture;
  integer(f.historyEvents, 0, 10000, 'historyEvents'); integer(f.snapshots, 0, 1000, 'snapshots'); integer(f.keysPerMember, 0, 3, 'keysPerMember');
  const paths = { registryDir: path.join(directory, 'registry'), pickerRoot: path.join(directory, 'pickers'), tombstoneDir: path.join(directory, 'tombstones') };
  const legacy = path.join(directory, 'legacy'); await mkdir(legacy, { recursive: true });
  const registry = await openRegistry({ ...paths, caps: profile.entityCaps });
  const manifest = { schemaVersion: 1, seed: profile.seed, planDigest: digest(plan), catalogueDigest: digest(data), datasetDigest: selectedDataset.digest,
    configDigest: fixtureConfigDigest(profile, selectedDataset.digest), catalogueBytes: Buffer.byteLength(JSON.stringify(data)), engineCatalogueTasks: tasks.length,
    shape: profile.catalogue, groups: [], characters: 0, logins: 0, keys: 0, gaps: knownGaps, workers,
    setupApi: 'serialized registry/session/key APIs; disjoint real picker stores in worker threads; no timed admission overrides',
    growthMode: 'one real replace-member batch unlock per member; no per-chunk growth History', initializationMs: performance.now() - started };
  let invites;
  try {
    await bindDatasetStorage(legacy, selectedDataset);
    const legacyStore = await openStore({ dataDir: legacy, world: syntheticWorld(worldData, buildWorld), registry: rules,
      initialState: createGroupState([{ id: 'legacy1', name: 'Synthetic legacy 1' }, { id: 'legacy2', name: 'Synthetic legacy 2' }], rules),
      ...fixtureMigration(migrationInputs, selectedDataset) });
    try {
      invites = await openInviteStore({ dataDir: legacy, masterToken: legacyStore.getAccessToken(), pickerRegistry: registry });
      const jobs = [];
      // Registry provisioning is strictly plan-ordered and finishes before any
      // worker can open a picker store. No worker opens the shared registry.
      for (const item of plan) {
        const at = performance.now();
        await progress({ phase: 'registry', groupIndex: item.index });
        const owner = await registry.firstLogin('discord', `capacity-${profile.seed}-${item.index}-0`);
        await registry.reserveTransferMembers(owner.picker.id, item.members.map(member => member.id));
        const accounts = [owner.account];
        for (let i = 1; i < item.size; i++) {
          const account = await registry.ensureIdentity('discord', `capacity-${profile.seed}-${item.index}-${i}`);
          await registry.attachMembership(account.id, { pickerId: owner.picker.id, role: 'player', memberId: item.members[i].id }); accounts.push(account);
        }
        jobs.push({ item, dataDir: registry.pickerDirectory(owner.picker.id), pickerId: owner.picker.id, accounts, registryMs: performance.now() - at });
      }
      const results = await buildGroups(jobs.map(({ item, dataDir }) => ({ item, dataDir })), {
        workers, workerData: { profile, worldData, tasks: sharedTasks },
        onProgress: async (value, worker) => { active.set(worker, value); await progress({ phase: 'building' }); },
        onComplete: async (result, worker) => { active.delete(worker); builtGroups++; await progress({ phase: 'building' }); }
      });
      // Workers are closed before ordered central session/capability writes.
      for (const [index, job] of jobs.entries()) {
        const at = performance.now(), group = { ...results[index], pickerId: job.pickerId, members: [], taskIds: tasks.slice(0, 100).map(task => task.id) };
        await progress({ phase: 'sessions-keys', groupIndex: job.item.index });
        const keys = await openPluginKeys({ dataDir: job.dataDir });
        try {
          for (const [i, member] of job.item.members.entries()) {
            const account = job.accounts[i], cookie = 'duo_access=' + await invites.issuePickerSession(account.id, job.pickerId, 'discord');
            const issued = [];
            for (let k = 0; k < f.keysPerMember; k++) {
              const { key } = await keys.create(member.id, `Synthetic key ${k + 1}`, account.id);
              await registry.setCapability({ kind: 'plugin-key', hash: digest(key), pickerId: job.pickerId, accountId: account.id, memberId: member.id }); issued.push(key); manifest.keys++;
            }
            group.members.push({ memberId: member.id, cookie, key: issued[0] ?? null });
          }
        } finally { await keys.close(); }
        group.registryMs = job.registryMs; group.capabilitiesMs = performance.now() - at;
        group.setupMs += group.registryMs + group.capabilitiesMs;
        manifest.groups.push(group); manifest.characters += job.item.size; manifest.logins += job.item.size;
        groups = manifest.groups.length; characters = manifest.characters;
        await progress({ phase: 'group-complete', groupIndex: job.item.index });
      }
    } finally { await invites?.close(); await legacyStore.close(); }
  } finally { await registry.close(); }
  manifest.fixtureDigest = logicalFixtureDigest(manifest);
  await progress({ phase: 'verifying' });
  await writeFile(path.join(directory, 'fixture.json'), JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
  await sealFixture(directory, manifest);
  await progress({ phase: 'complete', fixtureDigest: manifest.fixtureDigest });
  return manifest;
}
