// Acceptance-sized calculation inputs only: no stores, servers or workflow.
export async function snapshotThroughputFixture(groups, source = new URL('../../', import.meta.url)) {
  const [{ makeCatalogue, pickerId }, { selectedDataset }, { createGroupState, createResidentState }, { registerOwnedCalculatorBase }] =
    await Promise.all(['scripts/perf/owned-acceptance/fixture.mjs', 'app/dataset-runtime.mjs', 'app/core/state.mjs', 'app/tasks/owned-transport.mjs']
      .map(name => import(new URL(name, source))));
  const shape = { tasks: 24000, aliases: 100000, chunks: 256, members: 4 };
  const data = makeCatalogue(shape, { id: selectedDataset.datasetId,
    contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest });
  registerOwnedCalculatorBase(data.base, data.pin);
  const states = Array.from({ length: groups }, (_, index) => {
    const state = createGroupState(Array.from({ length: shape.members }, (_, i) =>
      ({ id: `member-${i}`, name: `Synthetic ${i}`, unlocked: [data.world.chunks.keys().next().value] })));
    state.tasks = [...data.base.tasks];
    state.tasks[index % shape.tasks] = { ...state.tasks[index % shape.tasks], memberIds: [`member-${index % 4}`] };
    const goal = `rs3:goal:acceptance-${index}`;
    state.tasks.push({ id: goal, label: `Synthetic goal ${index}`, category: 'Synthetic' },
      { id: `custom:acceptance-${index}`, label: `Synthetic custom ${index}`, category: 'Custom', memberIds: [`member-${(index + 1) % 4}`] });
    state.identityRegistry = { ...data.base.identityRegistry, entries: { ...data.base.identityRegistry.entries,
      [goal]: { label: `Synthetic goal ${index}`, kind: 'collection', category: 'Synthetic', aliases: [] } } };
    state.members.forEach((member, i) => { member.completedTasks = [data.base.tasks[(index * 4 + i + 1) % shape.tasks].id]; });
    return createResidentState(state, data.base);
  });
  return { shape, states, pickerId, subject: data.base.tasks[1].id, workerData: {
    definitions: data.definitions, world: { chunks: data.world.chunks, surface: data.world.surface, neighbors: data.world.neighbors },
    datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
    datasetOptions: { reviewedOverlays: false, cacheWalking: false }, skillGuideCatalogue: { skills: [], tasks: [] }, omitReadyCatalogue: true } };
}
