import { buildIdentityIndex, legacyTaskId } from '../tasks/identity.mjs';
import { projectMemberTaskFacts, stripTaskMarkup } from '../tasks/migration.mjs';
import { originalLocalChanges } from './original-local-changes.mjs';

const checkFields = ['checkedAllTasks', 'checkedChallenges', 'completedChallenges'];
const simple = task => ({ id: task.id, label: stripTaskMarkup(task.label), category: task.category });

/** Positive original checks are challenge evidence, never observed game progress.
 * Use the migration identity index, including category-filtered historical IDs.
 * This projection deliberately does not run whole-save gameplay migration. */
export function createOriginalTaskReview(state, sources, { taskMap = {}, taskMapHistory, catalogue = [], dynamicCatalogue = [] } = {}) {
  const mappingIds = new Set();
  for (const source of sources) for (const rows of [...Object.values(source.observations.taskChecks), source.observations.notes.backlog ?? {}]) {
    for (const tasks of Object.values(rows)) for (const id of Object.keys(tasks)) mappingIds.add(id);
  }
  const rows = [...state.tasks, ...catalogue, ...dynamicCatalogue];
  const availableIds = new Set(rows.map(task => task.id));
  const index = buildIdentityIndex(rows, { savedRegistry: state.identityRegistry, taskMap, history: taskMapHistory, mappingIds });
  const localRows = new Map(state.tasks.map(task => [task.id, task]));
  // Keep original labels for unresolved IDs, including historical collisions.
  const labels = new Map();
  const remember = (label, id) => {
    if (typeof id !== 'string' || !id.startsWith('t_')) return;
    const values = labels.get(id) ?? new Set(); values.add(stripTaskMarkup(label)); labels.set(id, values);
  };
  for (const mapping of [taskMap, taskMapHistory?.current, taskMapHistory?.historical, taskMapHistory?.mappings, taskMapHistory?.tombstones]) {
    for (const [label, id] of Object.entries(mapping ?? {})) remember(label, id);
  }
  for (const conflict of taskMapHistory?.conflicts ?? []) for (const id of conflict.ids ?? []) remember(conflict.label, id);
  const resolve = (originalId, category) => index.resolve(originalId.startsWith('t_') || originalId.startsWith('rs3:')
    ? originalId : legacyTaskId(category, originalId), { category });
  const localTask = id => localRows.get(id) ?? index.lookup(id) ?? { id, label: id, category: 'Unknown' };

  return (owner, source) => {
    const facts = projectMemberTaskFacts(state, owner, rows);
    const localChanges = originalLocalChanges(state, owner, id => {
      const resolution = index.resolve(id);
      return resolution.status === 'resolved' ? resolution.id : id;
    }, facts);
    const complete = new Map(), backlog = new Map(), unmapped = new Map();
    const read = (field, records) => {
      for (const [category, tasks] of Object.entries(records ?? {})) for (const [originalId, value] of Object.entries(tasks)) {
        if (field !== 'backlog' && value !== true) continue;
        const resolution = resolve(originalId, category);
        const unavailable = resolution.status === 'resolved' && !availableIds.has(resolution.id);
        if (resolution.status !== 'resolved' || unavailable) {
          const key = `${category}\u0000${originalId}`;
          const candidates = [...(labels.get(originalId) ?? [])];
          if (!candidates.length && unavailable) candidates.push(stripTaskMarkup(index.lookup(resolution.id).label));
          const entry = unmapped.get(key) ?? { category, originalId,
            ...(candidates.length === 1 ? { label: candidates[0] } : !originalId.startsWith('t_') ? { label: stripTaskMarkup(originalId) } : {}),
            candidates, reason: unavailable ? 'Task is absent from the current saved and generated catalogues'
              : resolution.status === 'ambiguous' ? 'Ambiguous task identity in this category' : 'No task identity in this category', sources: [] };
          entry.sources.push(field); unmapped.set(key, entry); continue;
        }
        const task = simple(index.lookup(resolution.id));
        if (field === 'backlog') {
          const existing = backlog.get(task.id);
          // Multiple source aliases must never silently choose different reasons.
          if (existing && existing.reason !== value) {
            const key = `${category}\u0000${originalId}`;
            unmapped.set(key, { category, originalId, label: task.label, candidates: [],
              reason: 'Multiple backlog aliases have different reasons; review manually', sources: [field] });
            existing.conflicted = true;
          } else if (!existing) backlog.set(task.id, { ...task, reason: value });
        } else {
          const entry = complete.get(task.id) ?? { ...task, sources: [] };
          if (!entry.sources.includes(field)) entry.sources.push(field);
          complete.set(task.id, entry);
        }
      }
    };
    for (const field of checkFields) read(field, source.observations.taskChecks[field]);
    read('backlog', source.observations.notes.backlog);
    const localCompleted = new Set(facts.completedTasks ?? []);
    for (const [id, status] of Object.entries(facts.taskStatus ?? {})) if (status.challengeCompleted === true) localCompleted.add(id);
    const localBacklog = new Map(Object.entries(facts.taskStatus ?? {}).filter(([, status]) => status.backlogged === true));
    const additions = [...backlog.values()].filter(task => !task.conflicted && !localBacklog.has(task.id));
    const backlogConflicts = [...backlog.values()].filter(task => facts.taskStatus?.[task.id]?.backlogReason && facts.taskStatus[task.id].backlogReason !== task.reason)
      .map(task => ({ ...simple(task), reason: task.reason, localReason: facts.taskStatus[task.id].backlogReason }));
    const preview = {
      complete: [...complete.values()].filter(task => !localCompleted.has(task.id) && !localChanges.tasks.has(task.id)),
      keepLocal: [...complete.values()].filter(task => !localCompleted.has(task.id) && localChanges.tasks.has(task.id))
        .map(task => ({ ...task, reason: [...localChanges.tasks.get(task.id)].join('; ') })),
      keepCompleted: [...localCompleted].filter(id => !complete.has(id)).map(id => simple(localTask(id))),
      backlogAdd: additions.map(({ conflicted, ...task }) => task),
      keepBacklog: [...localBacklog].filter(([id]) => !backlog.has(id)).map(([id, status]) => ({ ...simple(localTask(id)), reason: status.backlogReason ?? '' })),
      unmapped: [...unmapped.values()], backlogConflicts,
    };
    const target = { complete: preview.complete.map(task => task.id), backlog: preview.backlogAdd.map(task => ({ taskId: task.id, reason: task.reason })) };
    return { preview, target, localChanges };
  };
}
