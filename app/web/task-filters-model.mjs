import { resolvePersistedIdentity } from '../tasks/fact-projection.mjs';
import { customTaskDoable } from './custom-tasks-model.mjs';

export const TASK_FILTERS_STORAGE_KEY = 'rs3:active-task-filters:v1';
const strings = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))] : [];
const taskFor = row => row?.task ?? row;

/** Browser display preferences only; these never change saved tasks or rules. */
export function normalizeTaskFilters(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    skills: strings(source.skills), doable: source.doable === true, pinned: source.pinned === true,
    hidePartnerClaims: source.hidePartnerClaims === true, onlyMyClaims: source.onlyMyClaims === true,
    sort: ['default', 'level', 'skill', 'name'].includes(source.sort) ? source.sort : 'default',
    folded: strings(source.folded),
  };
}

export function readTaskFilters(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(TASK_FILTERS_STORAGE_KEY);
    return normalizeTaskFilters(saved ? JSON.parse(saved) : undefined);
  } catch { return normalizeTaskFilters(); }
}

export function writeTaskFilters(storage, filters) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.setItem(TASK_FILTERS_STORAGE_KEY, JSON.stringify(normalizeTaskFilters(filters)));
    return true;
  } catch { return false; }
}

function admittedOwners(row, memberId, ownerFilter) {
  const owners = (Array.isArray(row?.memberIds) ? [...new Set(row.memberIds)] : [memberId])
    .filter(id => !row?.filterMemberIds || row.filterMemberIds.includes(id));
  if (ownerFilter === 'both') return row?.memberIds?.length > 1 ? owners : [];
  return ownerFilter === 'all' ? owners : owners.filter(id => id === ownerFilter);
}

function pinContext(state) {
  const members = new Map((state?.members ?? []).map(member => [member.id, member]));
  const registry = state?.identityRegistry, savedAliases = new Map();
  // Only saved favorites can affect a pin. Avoid scanning the entire identity
  // catalogue whenever the browser asks whether an individual row has a star.
  for (const member of members.values()) {
    const byCanonical = new Map();
    for (const [id, status] of Object.entries(member.taskStatus ?? {})) {
      if (status?.favorite !== true) continue;
      const resolved = resolvePersistedIdentity(id, registry);
      if (resolved.status !== 'resolved') continue;
      if (!byCanonical.has(resolved.id)) byCanonical.set(resolved.id, []);
      byCanonical.get(resolved.id).push(id);
    }
    savedAliases.set(member.id, byCanonical);
  }
  return { members, registry, savedAliases };
}

function ownerPinned(row, task, ownerId, context) {
  const status = context.members.get(ownerId)?.taskStatus;
  if (!status) return false;
  const ids = new Set([row?.id, task?.id].filter(id => typeof id === 'string'));
  for (const id of [...ids]) {
    const resolved = resolvePersistedIdentity(id, context.registry, task?.category);
    if (resolved.status === 'resolved') ids.add(resolved.id);
  }
  for (const id of [...ids]) for (const alias of context.savedAliases.get(ownerId)?.get(id) ?? []) ids.add(alias);
  for (const alias of task?.aliases ?? []) {
    if (typeof alias !== 'string') continue;
    const resolved = resolvePersistedIdentity(alias, context.registry, task?.category);
    // An explicit task alias is useful when no registry evidence exists. Known
    // ambiguity or a registry mapping to another task must not transfer a pin.
    if (resolved.status === 'ambiguous') continue;
    if (resolved.status === 'resolved' && !ids.has(resolved.id)) continue;
    if (context.registry?.aliases?.[alias] && resolved.status !== 'resolved') continue;
    ids.add(alias);
  }
  return [...ids].some(id => status[id]?.favorite === true);
}

/** The star uses only owners admitted by the current owner chip. */
export function isTaskPinned(row, { state, memberId, ownerFilter = 'all' } = {}) {
  return createTaskPinChecker({ state, memberId, ownerFilter })(row);
}

/** Reuse one saved-pin context while rendering a complete task list. */
export function createTaskPinChecker({ state, memberId, ownerFilter = 'all' } = {}) {
  const context = pinContext(state);
  return row => admittedOwners(row, memberId, ownerFilter).some(id => ownerPinned(row, row?.tasksByMember?.[id] ?? taskFor(row), id, context));
}

const alphabetic = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
const level = task => typeof task?.level === 'number' && Number.isFinite(task.level) ? task.level : Infinity;

/** Select existing presentation rows without recomputing gameplay eligibility. */
export function selectTaskFilters(rows, { filters, state, memberId, selectedMemberId = memberId, claimMemberId = selectedMemberId, ownerFilter = 'all', search = '' } = {}) {
  const input = Array.isArray(rows) ? rows : [], active = normalizeTaskFilters(filters);
  const categories = [...new Set(input.map(row => taskFor(row)?.category).filter(category => typeof category === 'string' && category))].sort(alphabetic);
  const skills = new Set(active.skills), context = active.pinned ? pinContext(state) : undefined;
  const query = search.toLowerCase().trim(), matches = new Map();
  const selected = input.filter(row => {
    const task = taskFor(row);
    if (active.hidePartnerClaims || active.onlyMyClaims) {
      const identity = resolvePersistedIdentity(row?.id ?? task?.id, state?.identityRegistry, task?.category);
      const canonicalId = identity.status === 'resolved' ? identity.id : identity.status === 'ambiguous' ? undefined : row?.id ?? task?.id;
      const claim = state?.taskClaims?.[canonicalId];
      const claimant = state?.members?.some(member => member.id === claim?.memberId) ? claim.memberId : undefined;
      if (active.onlyMyClaims && (!claimMemberId || claimant !== claimMemberId)) return false;
      if (active.hidePartnerClaims && claimMemberId && claimant && claimant !== claimMemberId) return false;
    }
    const owners = admittedOwners(row, memberId, ownerFilter).filter(id => {
      const personal = row?.tasksByMember?.[id] ?? task;
      if (skills.size && !skills.has(personal?.category)) return false;
      if (query && !`${personal?.label ?? ''} ${personal?.category ?? ''}`.toLowerCase().includes(query)) return false;
      if (active.doable && (personal?.status !== 'available' || (personal.blockers?.length ?? 0) !== 0 || !customTaskDoable(personal, state?.members?.find(member => member.id === id)))) return false;
      return !active.pinned || ownerPinned(row, personal, id, context);
    });
    if (owners.length) matches.set(row, owners);
    return owners.length > 0;
  }).map(row => {
    if (!row?.tasksByMember) return row;
    const owners = matches.get(row), id = owners.includes(selectedMemberId) ? selectedMemberId : owners[0];
    const task = row.tasksByMember[id];
    return { ...row, memberId: id, task, facts: row.factsByMember?.[id] ?? row.facts, displayMemberIds: owners,
      inspectionOnly: row.presentedMemberIds ? !row.presentedMemberIds.includes(id) : row.inspectionOnly };
  });
  if (active.sort !== 'default') selected.sort((a, b) => {
    const left = taskFor(a), right = taskFor(b);
    if (active.sort === 'level') {
      const difference = level(left) - level(right);
      return Number.isNaN(difference) ? 0 : difference;
    }
    if (active.sort === 'skill') return alphabetic(left?.category, right?.category) || alphabetic(left?.label, right?.label);
    return alphabetic(left?.label, right?.label);
  });
  return { rows: selected, hidden: input.length - selected.length, categories };
}
