import { createTaskFactsIndex } from '../core/progress-index.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
import { personalCustomTaskRows, isCustomTask } from './custom-tasks-model.mjs';

export const matchesDuoOwner = (row, filter = 'all') => filter === 'all'
  || (filter === 'both' ? row.memberIds.length > 1 : row.memberIds.includes(filter));

export function scopeDuoRow(row, memberIds, state, selectedMemberId) {
  const memberId = memberIds.includes(selectedMemberId) ? selectedMemberId : memberIds[0];
  return { ...row, memberIds, memberId, task: row.tasksByMember[memberId], facts: row.factsByMember[memberId],
    label: memberIds.length > 1 ? 'Both' : state.members.find(member => member.id === memberId)?.name ?? memberId };
}

// These disclosures use each personal catalogue, including blocked and preserved
// saved tasks. Active presentation and Hide completed do not narrow them.
export function selectDuoTaskLists({ state, results, registry, selectedMemberId, ownerFilter = 'all', filter = '' }) {
  const sources = state.members.flatMap(member => {
    const result = results instanceof Map ? results.get(member.id) : results?.find(value => value.memberId === member.id);
    if (!result || result.memberId !== member.id || result.stateRevision !== state.revision) return [];
    const known = new Set((result.tasks ?? []).map(task => task.id));
    const saved = new Set([...(member.completedTasks ?? []), ...Object.keys(member.taskStatus ?? {})]);
    const extras = (state.tasks ?? []).filter(task => !known.has(task.id) && !isCustomTask(task) && saved.has(task.id));
    return [{ member, result, tasks: personalCustomTaskRows([...(result.tasks ?? []), ...extras], state, member)
      .filter(task => task.obligation !== false && !task.hidden) }];
  });
  const catalogue = sources.flatMap(source => [...(source.result.tasks ?? []), ...source.tasks]), completed = new Map(), backlog = new Map();
  const add = (list, task, member, facts) => {
    const id = resolveSavedTaskId(state.identityRegistry, task.id, task.category);
    let row = list.get(id);
    if (!row) { row = { id, stateRevision: state.revision, memberIds: [], tasksByMember: {}, factsByMember: {}, statusByMember: {} }; list.set(id, row); }
    if (row.memberIds.includes(member.id)) return;
    row.memberIds.push(member.id); row.tasksByMember[member.id] = task; row.factsByMember[member.id] = facts;
    row.statusByMember[member.id] = member.taskStatus?.[id] ?? {};
  };
  for (const source of sources) {
    const member = projectMemberTaskFacts(state, source.member, catalogue);
    const index = createTaskFactsIndex(state, member.id, registry, { tasks: catalogue, completionGroups: source.result.collectionPlanning?.completionGroups ?? {} });
    for (const task of source.tasks) {
      const facts = index.get(task.id, task.completionIds);
      if (facts.group) add(completed, task, member, facts);
      const id = resolveSavedTaskId(state.identityRegistry, task.id, task.category);
      if (member.taskStatus?.[id]?.backlogged) add(backlog, task, member, facts);
    }
  }
  const select = (list, search = '') => {
    const allRows = [...list.values()].map(row => scopeDuoRow(row, row.memberIds, state, selectedMemberId))
      .filter(row => !search || Object.values(row.tasksByMember).some(task => `${task.label} ${task.category}`.toLowerCase().includes(search)))
      .sort((a, b) => a.task.category.localeCompare(b.task.category) || a.task.label.localeCompare(b.task.label));
    return { allRows, rows: allRows.filter(row => matchesDuoOwner(row, ownerFilter)), total: allRows.length };
  };
  return { completed: select(completed, filter.toLowerCase().trim()), backlog: select(backlog) };
}
