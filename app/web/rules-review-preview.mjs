/** A single cancellable Sandbox evaluation, with a bounded revision-scoped cache. */
export function createRuleReviewPreview(api) {
  const cache = new Map();
  let active, tail = Promise.resolve(), generation = 0, revision;
  const abortError = () => Object.assign(new Error('Preview cancelled.'), { name: 'AbortError' });
  function cancel() { generation++; active?.controller.abort(); active = undefined; }
  function check({ stateRevision, memberId, ruleId, value, taskRules = { [ruleId]: value } }) {
    if (revision !== stateRevision) { cancel(); cache.clear(); revision = stateRevision; }
    const key = JSON.stringify([stateRevision, memberId, ruleId, value, taskRules]);
    if (active?.key === key) return active.promise;
    cancel();
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const token = generation, controller = new AbortController();
    const promise = tail.catch(() => {}).then(async () => {
      if (token !== generation || controller.signal.aborted) throw abortError();
      const response = await api('/api/sandbox/evaluate', { memberId, baseRevision: stateRevision,
        changes: { unlockChunks: [], lockChunks: [], doneTasks: [], taskRules } }, controller.signal);
      if (token !== generation || controller.signal.aborted) throw abortError();
      if (response.format !== 'sandbox-v1' || response.memberId !== memberId || response.stateRevision !== stateRevision) throw new Error('The saved rules changed. Check the preview again.');
      const result = { added: response.delta.tasksAdded.length, removed: response.delta.tasksRemoved.length,
        addedCategories: categories(response.delta.tasksAdded), removedCategories: categories(response.delta.tasksRemoved),
        addedTasks: response.delta.tasksAdded, removedTasks: response.delta.tasksRemoved };
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(key, result); return result;
    }).finally(() => { if (active?.promise === promise) active = undefined; });
    active = { key, controller, promise }; tail = promise; return promise;
  }
  return { check, cancel };
}
function categories(tasks) {
  const counts = new Map();
  for (const task of tasks) { const name = task.skill ?? task.category ?? 'Other'; counts.set(name, (counts.get(name) ?? 0) + 1); }
  return [...counts].map(([name, count]) => `${name} ${count}`).join(', ');
}
export function rulePreviewText(result, action) {
  const added = result.addedTasks ?? [], removed = result.removedTasks ?? [];
  const category = task => task.skill ?? task.category ?? 'Other';
  const names = tasks => tasks.map(task => task.label).filter(Boolean).join('; ');
  if (result.added && result.added === result.removed && added.length === result.added && removed.length === result.removed
    && [...added, ...removed].every(task => category(task) === category(added[0]))) {
    return `${action} swaps ${result.added} ${category(added[0])} task${result.added === 1 ? '' : 's'}${result.added <= 5 && names(added) && names(removed) ? `: ${names(removed)} → ${names(added)}` : ''}.`;
  }
  const describe = (count, tasks, counts) => `${count} task${count === 1 ? '' : 's'}${count <= 5 && names(tasks) ? ` (${counts}): ${names(tasks)}` : ` (${counts})`}`;
  const parts = [];
  if (result.added) parts.push(`adds ${describe(result.added, added, result.addedCategories)}`);
  if (result.removed) parts.push(`removes ${describe(result.removed, removed, result.removedCategories)}`);
  return parts.length ? `${action} ${parts.join(' and ')}.` : `${action} adds or removes no current tasks.`;
}
