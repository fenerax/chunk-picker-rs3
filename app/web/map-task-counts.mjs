import { selectDuoTasks } from './duo-tasks.mjs';

/** Default Active Tasks, irrespective of the sidebar's temporary display filters.
 * Each union task counts once at a location, using only its attributed owners.
 */
export function countMapTasks({ state, results, registry, memberId, groupView = false }) {
  const current = results.filter(value => value?.stateRevision === state.revision
    && state.members.some(owner => owner.id === value.memberId)
    && (groupView || value.memberId === memberId));
  const byMember = new Map(current.map(value => [value.memberId, value]));
  if (!byMember.has(memberId) || groupView && byMember.size !== state.members.length) return new Map();
  const unlocked = new Set(state.members.filter(owner => groupView || owner.id === memberId).flatMap(owner => owner.unlocked));
  const rows = selectDuoTasks({ state, results: byMember, registry, selectedMemberId: memberId }).rows;
  const counts = new Map();
  for (const row of rows) {
    const locations = new Set(row.memberIds.flatMap(owner => byMember.get(owner)?.taskLocations?.[row.tasksByMember[owner].id] ?? []));
    for (const id of locations) if (unlocked.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** One count pass per coherent state/result update; never called by canvas paint. */
export function createMapTaskCounts(c) {
  let key, counts = new Map();
  return {
    refresh() {
      const groupView = c.duoEnabled(), results = groupView ? [...c.duoResults().results().values()] : [c.result].filter(Boolean);
      const next = [c.state, c.registry, c.memberId, groupView, !!c.sandbox.active, ...results];
      if (key && next.length === key.length && next.every((value, index) => value === key[index])) return counts;
      key = next;
      counts = c.sandbox.active ? new Map() : countMapTasks({ state: c.state, results, registry: c.registry, memberId: c.memberId, groupView });
      c.map.setTaskCounts?.(counts);
      return counts;
    },
  };
}
