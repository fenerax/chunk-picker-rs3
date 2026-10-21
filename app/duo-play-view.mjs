import { createTaskFactsIndex } from './core/progress-index.mjs';

export const DUO_INSPECTION_VIEW = 'duo-inspection-v1';

/** Ordinary play bytes already contain the complete fact catalogue and display
 * fields for every nonhidden row. Inspection changes only which rows the Group
 * view may select; its presentation and all completion evidence stay intact. */
export function projectDuoInspectionJSON(bytes, { neverShowIds = [] } = {}) {
  const metadata = JSON.stringify({ projection: DUO_INSPECTION_VIEW, ...(neverShowIds.length ? { neverShowIds } : {}) });
  return Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(`,${metadata.slice(1)}`)]);
}

const custom = id => typeof id === 'string' && (id.startsWith('custom:') || id.startsWith('rs3:task:custom:'));
const targets = (registry, id) => {
  const candidates = registry?.aliases?.[id];
  return typeof candidates === 'string' ? [candidates] : Array.isArray(candidates) ? candidates : [];
};

/** A peer-only display projection. Saved references retain every competing alias
 * candidate, including undisplayed rows. A family member without saved evidence
 * cannot change completion, so a family named only by the foreground result is
 * still safe: its saved peer evidence is retained independently of presentation.
 * The worker's complete play projection remains the normal member/cache value. */
const presentedIds = result => new Set([...(result.presentation?.tasks ?? []), ...(result.presentation?.completedTasks ?? [])]
  .map(row => typeof row === 'string' ? row : row.id));

function projectRows(result, state, shown) {
  const saved = new Set(), historicalCategories = new Set();
  for (const member of state.members ?? []) {
    for (const id of member.completedTasks ?? []) saved.add(id);
    for (const id of Object.keys(member.taskStatus ?? {})) saved.add(id);
    for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const id of Object.values(groups)) {
      if (typeof id === 'string') saved.add(id);
      else if (id === null) historicalCategories.add(`rs3:${encodeURIComponent(category)}:`);
    }
  }
  const wanted = new Set(saved);
  for (const id of saved) for (const candidate of targets(state.identityRegistry, id)) wanted.add(candidate);
  const categoryPrefixes = [...historicalCategories], families = new Set();
  for (const row of result.tasks ?? []) if (shown.has(row.id) || custom(row.id)) {
    for (const id of row.completionIds ?? result.collectionPlanning?.completionGroups?.[row.completionGroup] ?? []) {
      families.add(id);
      for (const candidate of targets(state.identityRegistry, id)) families.add(candidate);
    }
  }
  const matches = id => wanted.has(id) || families.has(id)
    || targets(state.identityRegistry, id).some(candidate => wanted.has(candidate) || families.has(candidate));
  const tasks = (result.tasks ?? []).filter(row => shown.has(row.id) || custom(row.id) || matches(row.id)
    || row.aliases?.some(alias => matches(alias) || categoryPrefixes.some(prefix => typeof alias === 'string' && alias.startsWith(prefix))));
  return { ...result, tasks };
}

export function projectDuoPlayResult(result, state) {
  return projectRows(result, state, presentedIds(result));
}

/** Group view still displays the selected member's ordinary Completed and
 * Backlog disclosures. Decide those rows with the complete engine catalogue
 * before narrowing; saved aliases and unshown completion families retain the
 * same facts even when an active presentation suppressed the completed row. */
export function projectDuoSidebarResult(result, state, registry, memberId = result.memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}.`);
  const tasks = result.tasks ?? [], shown = presentedIds(result);
  const facts = createTaskFactsIndex(state, memberId, registry, {
    tasks, completionGroups: result.collectionPlanning?.completionGroups ?? {},
  });
  for (const task of tasks) {
    if (task.obligation === false || task.hidden) continue;
    if (member.taskStatus?.[task.id]?.backlogged || facts.get(task.id, task.completionIds).group) shown.add(task.id);
  }
  return { ...projectRows(result, state, shown), projection: 'duo-sidebar-v1' };
}
