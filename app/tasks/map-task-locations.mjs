import { buildChunkPlanningIndex, baseLocationId } from './chunk-planning-index.mjs';

const isCustom = task => task?.id?.startsWith('custom:') || task?.id?.startsWith('rs3:task:custom:');

/** Project default active tasks onto surface chunk IDs for map badges.
 * Planning indexes only the already-presented rows and available custom tasks,
 * so non-visible catalogue rows do not add indexing work or badge counts.
 */
export function projectMapTaskLocations(definitions, result, world) {
  const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
  const byId = new Map(tasks.map(task => [task.id, task]));
  const candidates = new Map();
  for (const reference of result?.presentation?.tasks ?? []) {
    const task = byId.get(typeof reference === 'string' ? reference : reference?.id);
    if (task) candidates.set(task.id, task);
  }
  for (const task of tasks) if (isCustom(task)) candidates.set(task.id, task);

  const eligible = [...candidates.values()].filter(task => task.status === 'available'
    && task.obligation !== false && !task.hidden && !task.record?.NeverShow && !task.neverShow);
  if (!eligible.length) return {};

  const index = buildChunkPlanningIndex(definitions, { ...result, tasks: eligible }, world);
  const surfaceIds = world?.chunks instanceof Map ? new Set([...world.chunks.keys()].map(String))
    : new Set(Object.keys(world?.chunks ?? {}));
  const projected = new Map(eligible.map(task => [task.id, new Set()]));
  for (const [location, rows] of index.byLocation) {
    const surfaceId = baseLocationId(location);
    if (!surfaceIds.has(surfaceId)) continue;
    for (const taskId of rows.keys()) projected.get(taskId)?.add(surfaceId);
  }
  return Object.fromEntries([...projected].map(([taskId, locations]) => [taskId, [...locations].sort()]));
}
