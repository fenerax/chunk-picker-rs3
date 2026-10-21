import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';

/** Index explicit challenge checks and actual personal completion separately.
 * Actual completion can satisfy an obligation without creating a checkmark or
 * copying personal quest/reward progress to another member. */
export function createTaskFactsIndex(snapshot, activeMemberId, registry, { tasks = [], completionGroups = {} } = {}, { projectMemberTaskFacts: projectFacts = projectMemberTaskFacts, resolveSavedTaskId: resolveId = resolveSavedTaskId } = {}) {
  const sourceSnapshot = snapshot;
  snapshot = { ...snapshot, members: snapshot.members.map(owner => projectFacts(snapshot, owner, tasks)) };
  if (!snapshot.members.some(owner => owner.id === activeMemberId)) throw new RangeError(`Unknown member: ${activeMemberId}.`);
  // Derived presentation rows are trusted read-only identities. They need not
  // be persisted before their first check; unrelated queries still fail closed.
  const taskIds = new Set([...snapshot.tasks, ...tasks].map(task => resolveId(snapshot.identityRegistry, task.id)));
  const derivedGroups = new Map(tasks.filter(task => typeof task.completionGroup === 'string').map(task => [resolveId(snapshot.identityRegistry, task.id), task.completionGroup]));
  const mode = registry.resolve(snapshot.rules)['tasks.completion'];
  const roster = snapshot.members.map(owner => owner.id).sort();
  const assignments = new Map([...tasks, ...snapshot.tasks].filter(task =>
    task.id.startsWith('custom:') || task.id.startsWith('rs3:task:custom:'))
    .map(task => [resolveId(snapshot.identityRegistry, task.id), (task.memberIds ?? roster).filter(id => roster.includes(id)).slice().sort()]));
  const completedByTask = new Map(), familyFacts = new Map(), normalizedFamilies = new WeakMap();
  for (const owner of snapshot.members) {
    const satisfied = new Set([...(owner.completedTasks ?? []), ...Object.entries(owner.taskStatus ?? {}).filter(([, status]) => status.challengeCompleted === true).map(([id]) => id)]);
    for (const id of satisfied) {
      if (!taskIds.has(id)) continue;
      if (!completedByTask.has(id)) completedByTask.set(id, []);
      completedByTask.get(id).push(owner.id);
    }
  }
  for (const owners of completedByTask.values()) owners.sort();
  const member = snapshot.members.find(owner => owner.id === activeMemberId);
  const actualCompletions = new Set(member.completedTasks ?? []);
  return {
    state: sourceSnapshot, memberId: activeMemberId, registry,
    get(id, completionIds) {
      id = resolveId(snapshot.identityRegistry, id);
      if (!taskIds.has(id)) throw new RangeError(`Unknown task: ${id}.`);
      if (completionIds === undefined && derivedGroups.has(id)) {
        const group = derivedGroups.get(id);
        if (!Object.hasOwn(completionGroups, group)) throw new RangeError(`Unknown completion group: ${group}.`);
        completionIds = completionGroups[group];
      }
      let family, key;
      if (completionIds !== undefined) {
        if (!Array.isArray(completionIds)) throw new TypeError('Completion family must contain task IDs.');
        let normalized = normalizedFamilies.get(completionIds);
        if (!normalized) {
          if (completionIds.some(value => typeof value !== 'string' || !value)) throw new TypeError('Completion family must contain task IDs.');
          const ids = [...new Set(completionIds.map(value => resolveId(snapshot.identityRegistry, value)))].sort();
          normalized = { ids, members: new Set(ids), key: JSON.stringify(ids) }; normalizedFamilies.set(completionIds, normalized);
        }
        if (normalized.members.has(id)) { family = normalized.ids; key = normalized.key; }
        else { family = [...normalized.ids, id].sort(); key = JSON.stringify(family); }
      } else { family = [id]; key = JSON.stringify(family); }
      const assigned = assignments.get(id) ?? roster;
      const requiredBy = mode === 'personal' ? assigned.includes(activeMemberId) ? [activeMemberId] : [] : assigned;
      if (assignments.has(id)) key += JSON.stringify(assigned);
      let indexed = familyFacts.get(key);
      if (!indexed) {
        const completedBy = [...new Set(family.flatMap(alias => completedByTask.get(alias) ?? []))].filter(owner => assigned.includes(owner)).sort();
        const group = mode === 'personal' ? completedBy.includes(activeMemberId) : mode === 'all' ? requiredBy.length > 0 && requiredBy.every(owner => completedBy.includes(owner)) : completedBy.length > 0;
        indexed = { completedBy, group, tasks: new Map() }; familyFacts.set(key, indexed);
      }
      if (indexed.tasks.has(id)) return indexed.tasks.get(id);
      const { completedBy, group } = indexed;
      const personal = assigned.includes(activeMemberId) && member.taskStatus?.[id]?.challengeCompleted === true;
      const actual = assigned.includes(activeMemberId) && actualCompletions.has(id);
      const facts = { personal, actual, group, completedBy, requiredBy };
      indexed.tasks.set(id, facts); return facts;
    },
  };
}

export function goalProgress(goals, facts) {
  const rows = new Map(goals.map(task => [task.id, task]));
  const completed = [...rows.values()].filter(task => facts.get(task.id, task.completionIds).group).length;
  return { completed, total: rows.size, percent: rows.size ? Math.round(completed / rows.size * 100) : 0 };
}
