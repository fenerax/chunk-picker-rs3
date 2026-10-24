export function planningResult(snapshot, chunkId, projectTask) {
  const index = snapshot.planningIndex;
  return { format: 'chunk-planning-v1', chunkId, rows: [...(index.byLocation.get(String(chunkId))?.values() ?? [])].map(({ task, evidence }) => ({
    task: { ...projectTask(task, { retainHiddenDisplay: true }), ...(task.record?.ClueTier !== undefined ? { record: { ClueTier: task.record.ClueTier } } : {}) }, evidence,
  })), clueLocations: index.clueLocations.get(String(chunkId)) ?? [], access: snapshot.baseline.access };
}
