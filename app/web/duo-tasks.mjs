import { createTaskFactsIndex } from '../core/progress-index.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
import { isCustomTask, customTaskForMember, customTaskDoable } from './custom-tasks-model.mjs';
import { normalizeDuoPersonalFilter } from './duo-task-preferences.mjs';

const completionReason = 'Challenge already satisfied.';
const custom = isCustomTask;
const resultFor = (results, id) => results instanceof Map ? results.get(id) : Array.isArray(results) ? results.find(value => value.memberId === id) : results?.[id];

/** Combine existing personal presentations; partner resources never create obligations.
 * Completion-only suppressed rows are recovered from the compact projection's
 * completedTasks references, or the full presentation's suppression reasons.
 * Counts describe the text/completion-filtered union before the owner filter.
 */
export function selectDuoTasks({ state, results, registry, selectedMemberId, filter = '', ownerFilter = 'all', showCompleted = false,
  showBlocked = false, showAll = false, searchAll = false, personalFilter = 'group' }) {
  if (!state.members.some(member => member.id === selectedMemberId)) throw new RangeError(`Unknown member: ${selectedMemberId}.`);
  const canonical = task => resolveSavedTaskId(state.identityRegistry, task.id, task.category);
  personalFilter = normalizeDuoPersonalFilter(personalFilter);
  const inspect = showAll || showBlocked || searchAll || !!filter.trim() || personalFilter !== 'group';
  const visible = task => task && task.obligation !== false && !task.hidden && !task.record?.NeverShow && !task.neverShow;
  const available = (task, member) => visible(task) && task.status === 'available' && !(task.blockers?.length) && customTaskDoable(task, member);
  const sources = state.members.flatMap(member => {
    const result = resultFor(results, member.id);
    return result && result.memberId === member.id && (result.stateRevision == null || result.stateRevision === state.revision) ? [{ member, result }] : [];
  });
  // Facts need displayed identities and saved/family evidence, not every unused
  // engine row. Retain all aliases matching saved references so narrowing the
  // catalogue cannot turn an ambiguous historical key into a definite match.
  const savedIds = new Set(state.members.flatMap(member => [
    ...(member.completedTasks ?? []), ...Object.keys(member.taskStatus ?? {}),
    ...Object.values(member.taskAlternatives ?? {}).flatMap(groups => Object.values(groups).filter(id => typeof id === 'string')),
  ]));
  for (const id of [...savedIds]) savedIds.add(resolveSavedTaskId(state.identityRegistry, id));
  const familyIds = new Set(), trustedRows = new Set(), customRows = (state.tasks ?? []).filter(custom);
  for (const source of sources) {
    const { result } = source, tasks = result.tasks ?? [], byId = new Map(tasks.map(task => [task.id, task]));
    source.neverShowIds = new Set(result.neverShowIds ?? []);
    source.presentedIds = new Set((result.presentation?.tasks ?? []).map(task => canonical(typeof task === 'string' ? { id: task } : task)));
    const references = inspect ? tasks.filter(task => !custom(task)) : [...(result.presentation?.tasks ?? []).filter(task => !custom(task))];
    if (showCompleted && !inspect) {
      references.push(...(result.presentation?.completedTasks ?? []).filter(task => !custom(task)));
      if (!result.presentation?.completedTasks) for (const task of tasks) {
        const reasons = result.presentation?.suppressed?.[task.id];
        if (!custom(task) && reasons?.length && reasons.every(reason => reason === completionReason)) references.push(task);
      }
    }
    const extras = customRows.map(task => customTaskForMember(task, source.member)).filter(Boolean);
    if (inspect) {
      const known = new Set(tasks.map(task => task.id)), savedMember = source.member;
      const completedIds = new Set(savedMember.completedTasks ?? []);
      extras.push(...(state.tasks ?? []).filter(task => !custom(task) && !known.has(task.id)
        && (Object.hasOwn(savedMember.taskStatus ?? {}, task.id) || completedIds.has(task.id)))
        .map(task => ({ ...task, status: 'unsupported', blockers: [{ detail: 'Preserved imported task; it has no current availability result.' }] })));
    }
    source.candidates = [...references.map(reference => byId.get(typeof reference === 'string' ? reference : reference.id)
      ?? (typeof reference === 'object' ? reference : undefined)).filter(task => task && !custom(task)), ...extras];
    for (const task of source.candidates) {
      trustedRows.add(task);
      const family = task.completionIds ?? result.collectionPlanning?.completionGroups?.[task.completionGroup] ?? [];
      for (const id of family) { familyIds.add(id); familyIds.add(resolveSavedTaskId(state.identityRegistry, id)); }
    }
  }
  for (const { result } of sources) for (const task of result.tasks ?? []) {
    const id = state.identityRegistry?.aliases?.[task.id] ? canonical(task) : task.id;
    if (savedIds.has(id) || familyIds.has(id) || task.aliases?.some(alias => savedIds.has(alias))) trustedRows.add(task);
  }
  const catalogue = [...trustedRows];
  const availability = new Map();
  if (personalFilter !== 'group') for (const { member, result } of sources) {
    const tasks = [...(result.tasks ?? []).filter(task => !custom(task)), ...customRows.map(task => customTaskForMember(task, member)).filter(Boolean)];
    for (const task of tasks) if (available(task, member) && !(result.neverShowIds ?? []).includes(task.id)) {
      const id = canonical(task);
      if (!availability.has(id)) availability.set(id, {});
      availability.get(id)[member.id] = true;
    }
  }
  // Personal filters inspect the full catalogue. Project each saved member
  // once for this selection; both facts indexes read the same catalogue and
  // saved snapshot. Nothing is retained across filters, members or revisions.
  const projectedMembers = personalFilter !== 'group' && sources.length
    ? new Map(state.members.map(member => [member.id, projectMemberTaskFacts(state, member, catalogue)])) : undefined;
  const projection = projectedMembers ? { projectMemberTaskFacts: (_state, member) => projectedMembers.get(member.id) } : undefined;
  const combined = new Map();
  for (const { member: savedMember, result, candidates, presentedIds, neverShowIds } of sources) {
    const member = projectedMembers?.get(savedMember.id) ?? projectMemberTaskFacts(state, savedMember, catalogue);
    const completionGroups = result.collectionPlanning?.completionGroups ?? {};
    const facts = createTaskFactsIndex(state, member.id, registry, { tasks: catalogue, completionGroups }, projection);
    for (const task of candidates) {
      if (!visible(task) || neverShowIds.has(task.id) || (!showBlocked && task.status !== 'available')) continue;
      const id = canonical(task);
      if (member.taskStatus?.[id]?.backlogged) continue;
      const personalFacts = facts.get(task.id, task.completionIds);
      // Personal completion rules can leave the partner's contribution open.
      // Filter each contribution before building the union, including extras.
      if (personalFilter === 'group' && !showCompleted && personalFacts.group) continue;
      let row = combined.get(id);
      if (!row) { row = { id, memberIds: [], tasksByMember: {}, factsByMember: {}, presentedMemberIds: [], availabilityByMember: availability.get(id) ?? {} }; combined.set(id, row); }
      if (row.memberIds.includes(member.id)) continue;
      row.memberIds.push(member.id); row.tasksByMember[member.id] = task;
      row.factsByMember[member.id] = personalFacts;
      if (custom(task) || presentedIds.has(id)) row.presentedMemberIds.push(member.id);
    }
  }
  const query = filter.toLowerCase().trim(), all = [];
  for (const row of combined.values()) {
    if (personalFilter !== 'group') {
      const facts = row.factsByMember[selectedMemberId];
      if (!facts || !row.memberIds.includes(selectedMemberId) || !row.availabilityByMember[selectedMemberId]
        || facts.personal || facts.actual || facts.completedBy.includes(selectedMemberId)) continue;
      if (personalFilter === 'only-player' && state.members.some(member => member.id !== selectedMemberId && row.availabilityByMember[member.id])) continue;
      row.filterMemberIds = [selectedMemberId]; row.personalCompletion = true;
    }
    const admitted = row.memberIds.filter(id => (!row.filterMemberIds || row.filterMemberIds.includes(id)) && (ownerFilter === 'all' || ownerFilter === 'both' || ownerFilter === id));
    row.displayMemberIds = admitted;
    row.memberId = admitted.includes(selectedMemberId) ? selectedMemberId : admitted[0] ?? row.memberIds[0];
    row.task = row.tasksByMember[row.memberId]; row.facts = row.factsByMember[row.memberId];
    row.inspectionOnly = !row.presentedMemberIds.includes(row.memberId);
    row.label = row.memberIds.length > 1 ? 'Both' : state.members.find(member => member.id === row.memberId).name;
    if (query && !admitted.some(id => { const task = row.tasksByMember[id]; return `${task.label} ${task.category}`.toLowerCase().includes(query); })) continue;
    all.push(row);
  }
  all.sort((a, b) => {
    const favorite = row => row.memberIds.some(id => state.members.find(member => member.id === id)?.taskStatus?.[row.id]?.favorite);
    return Number(favorite(b)) - Number(favorite(a)) || a.task.category.localeCompare(b.task.category)
      || (b.task.level ?? 0) - (a.task.level ?? 0) || a.task.label.localeCompare(b.task.label);
  });
  const byMember = Object.fromEntries(state.members.map(member => [member.id, all.filter(row => row.memberIds.includes(member.id)).length]));
  return {
    allRows: all,
    rows: all.filter(row => row.displayMemberIds.length && (ownerFilter !== 'both' || row.memberIds.length > 1)),
    counts: { union: all.length, byMember, shared: all.filter(row => row.memberIds.length > 1).length, completed: all.filter(row => row.facts.group).length },
    completedRows: all.filter(row => row.facts.group),
    completedRecoveryAvailable: sources.every(({ result }) => result.presentation?.completedTasks !== undefined || result.presentation?.suppressed !== undefined),
  };
}

/** Ambiguous row commands must ask for an owner even when her map is selected. */
export function duoCommandTarget(row, selectedMemberId, explicitMemberId) {
  const memberIds = [...new Set(row.memberIds ?? [])];
  if (!memberIds.length) throw new RangeError('This task has no owning member.');
  if (explicitMemberId !== undefined && !memberIds.includes(explicitMemberId)) throw new RangeError('The chosen member does not own this task.');
  const preferredMemberId = memberIds.includes(selectedMemberId) ? selectedMemberId : memberIds[0];
  return { memberId: explicitMemberId ?? (memberIds.length === 1 ? memberIds[0] : undefined), requiresChoice: explicitMemberId === undefined && memberIds.length > 1, memberIds, preferredMemberId };
}

/** Revision-scoped display cache. Foreground loading supplies the selected result;
 * this controller normally waits until that result is remembered. Foreground
 * callers may admit missing partners just after starting their selected request.
 * A sandbox transition clears saved results, including in-flight requests.
 */
export function createDuoResultCache({ getScope, fetchResult, onChange = () => {} }) {
  const values = new Map(), pending = new Map();
  let revision, sandbox, cacheKey, generation = 0;
  const clear = () => { generation++; values.clear(); pending.clear(); };
  const scope = () => {
    const next = getScope();
    if (revision !== next.revision || sandbox !== !!next.sandbox || cacheKey !== next.cacheKey) {
      clear(); revision = next.revision; sandbox = !!next.sandbox; cacheKey = next.cacheKey;
    }
    return next;
  };
  const matches = (value, requested) => value?.memberId === requested.memberId && value.stateRevision === requested.revision;
  const remember = value => {
    const current = scope();
    if (current.sandbox || !current.memberIds.includes(value?.memberId) || !matches(value, { memberId: value.memberId, revision: current.revision })) return false;
    values.set(value.memberId, value); return true;
  };
  const results = () => { const current = scope(); return current.sandbox ? new Map() : new Map(values); };
  const ensure = async ({ allowBeforeSelected = false } = {}) => {
    const current = scope();
    if (current.sandbox || !current.groupOn || (!allowBeforeSelected && !values.has(current.selectedMemberId))) return results();
    const requests = current.memberIds.filter(id => id !== current.selectedMemberId && !values.has(id)).map(memberId => {
      if (pending.has(memberId)) return pending.get(memberId);
      const requested = { memberId, revision: current.revision, selectedMemberId: current.selectedMemberId }, epoch = generation;
      const currentRequest = () => {
        const latest = scope();
        return epoch === generation && !latest.sandbox && latest.groupOn && latest.memberIds.includes(memberId);
      };
      const promise = Promise.resolve().then(() => fetchResult(memberId, requested.revision, requested.selectedMemberId)).then(value => {
        if (!currentRequest()) return;
        if (!matches(value, requested)) throw new Error('The partner task calculation does not match the requested member and saved revision.');
        values.set(memberId, value); onChange(value);
      }).catch(error => {
        if (currentRequest()) throw error;
      }).finally(() => { if (pending.get(memberId) === promise) pending.delete(memberId); });
      pending.set(memberId, promise); return promise;
    });
    await Promise.all(requests); return results();
  };
  return { remember, ensure, results, clear };
}
