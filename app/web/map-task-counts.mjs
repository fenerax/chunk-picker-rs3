import { selectDuoTasks } from './duo-tasks.mjs';
/** Default Active Tasks, irrespective of the sidebar's temporary display filters.
 * Each union task counts once at a location, using only its attributed owners. */
export function countMapTasks(options) { return mapTaskEntries(options).counts; }
/** The counts plus, per location, which task each owner holds for every counted row,
 * so Chunk Info can list exactly what the badge counts. */
export function mapTaskEntries({ state, results, registry, memberId, groupView = false }) {
  const counts = new Map(), entries = new Map();
  const current = results.filter(value => value?.stateRevision === state.revision
    && state.members.some(owner => owner.id === value.memberId)
    && (groupView || value.memberId === memberId));
  const byMember = new Map(current.map(value => [value.memberId, value]));
  if (!byMember.has(memberId) || groupView && byMember.size !== state.members.length) return { counts, entries };
  const unlocked = new Set(state.members.filter(owner => groupView || owner.id === memberId).flatMap(owner => owner.unlocked));
  const rows = selectDuoTasks({ state, results: byMember, registry, selectedMemberId: memberId }).rows;
  for (const row of rows) {
    const taskIdByMember = Object.fromEntries(row.memberIds.map(owner => [owner, row.tasksByMember[owner].id]));
    const locations = new Set(row.memberIds.flatMap(owner => byMember.get(owner)?.taskLocations?.[taskIdByMember[owner]] ?? []));
    for (const id of locations) if (unlocked.has(id)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      entries.set(id, [...(entries.get(id) ?? []), { memberIds: row.memberIds, taskIdByMember }]);
    }
  }
  return { counts, entries };
}
/** One count pass per coherent state/result update; never called by canvas paint. */
export function createMapTaskCounts(c) {
  let key, counts = new Map(), entries = new Map();
  const refresh = () => {
    const groupView = c.duoEnabled(), results = groupView ? [...c.duoResults().results().values()] : [c.result].filter(Boolean);
    const next = [c.state, c.registry, c.memberId, groupView, !!c.sandbox.active, ...results];
    if (key && next.length === key.length && next.every((value, index) => value === key[index])) return counts;
    key = next;
    ({ counts, entries } = c.sandbox.active ? { counts: new Map(), entries: new Map() }
      : mapTaskEntries({ state: c.state, results, registry: c.registry, memberId: c.memberId, groupView }));
    c.map.setTaskCounts?.(counts);
    return counts;
  };
  return {
    refresh,
    /** What the map badge counts on one chunk, from the same pass as the badge. */
    at(chunkId) { refresh(); return entries.get(String(chunkId)) ?? []; },
  };
}
