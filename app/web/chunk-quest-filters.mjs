import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';

/** Local display choices for the quests named in a chunk's retained contents. */
export function createChunkQuestList(c, entries) {
  const memberId = c.memberId, revision = c.state.revision, chunkId = c.chunkId;
  const root = c.el('div', undefined, 'chunk-quest-list'), list = c.el('div', undefined, 'chunk-quest-rows');
  const current = () => memberId === c.memberId && revision === c.state.revision && chunkId === c.chunkId && root.isConnected !== false;
  const key = name => c.plain(String(name ?? '')).trim();
  const rows = entries.map(([name, count]) => ({ name, count, label: c.plain(name) }));
  let metadata = new Map(), pending, error, loaded = false;
  const needsFacts = () => controls.preferences().questStatuses.length || controls.preferences().sort === 'level';
  const change = () => { if (needsFacts() && !loaded && !pending && !error) void load(); else paint(); };
  const controls = createActivityFilterControls(c, { tab: 'Chunk quests', quests: true, activity: false, onChange: change });
  root.append(controls.element, list);

  function paint() {
    root.setAttribute('aria-busy', String(!!pending));
    const preferences = controls.preferences(), active = preferences.questStatuses.length > 0;
    const selected = selectActivityRows(rows.map(row => ({ ...row, ...metadata.get(key(row.name)) })), preferences);
    const count = c.el('p', `${selected.length} of ${rows.length} quests`, 'status-detail'); count.setAttribute('aria-live', 'polite');
    list.replaceChildren(count, ...selected.map(({ name, label, count }) => {
      const row = c.el('div', undefined, 'content-row');
      row.setAttribute('data-quest-name', key(name));
      row.append(c.el('span', `${label}${typeof count === 'number' ? ` × ${count}` : ''}`)); return row;
    }));
    if (active && pending) list.append(c.el('p', 'Loading quest progress…', 'status-detail'));
    else if (active && error) list.append(c.el('p', error, 'error'), c.button('Retry quest progress', load));
    else if (!selected.length) list.append(c.el('p', 'No quests match these filters.', 'status-detail'));
  }
  function accept(value) {
    if (value?.memberId !== memberId || value?.stateRevision !== revision) throw new Error('Quest progress changed. Refresh this chunk to review it.');
    const next = new Map(), facts = value.activityInfo?.questStates ?? {};
    const add = (name, fact) => {
      if (!name || !fact) return;
      const id = key(name), previous = next.get(id), level = Math.max(previous?.level ?? 0, Number.isFinite(fact.level) ? fact.level : 0);
      next.set(id, { questStatus: fact.questStatus ?? previous?.questStatus, canDoNow: fact.canDoNow ?? previous?.canDoNow, level });
    };
    for (const task of value.tasks ?? []) {
      if (task.category !== 'Quest') continue;
      const name = task.baseQuest ?? task.record?.BaseQuest ?? /~\|([^|]+)\|~/.exec(task.rawLabel ?? '')?.[1]?.split('#')[0] ?? task.label;
      add(name, facts[task.id] ?? (task.questStatus ? task : undefined));
    }
    for (const group of value.activityInfo?.quests ?? []) {
      const summaries = [...(group.tasks ?? []), ...(group.wholeCompletion ?? [])];
      if (group.questStatus) add(group.name, group);
      for (const task of summaries) add(group.name, facts[task.id] ?? (task.questStatus ? task : undefined));
    }
    metadata = next; loaded = true;
  }
  function load() {
    if (pending) return pending;
    error = undefined;
    pending = Promise.resolve().then(() => c.ensureFullResult()).then(value => {
      if (current()) accept(value);
    }).catch(reason => { if (current()) error = reason?.message ?? 'Unable to load quest progress.'; }).finally(() => {
      pending = undefined; if (current()) paint();
    });
    paint(); return pending;
  }
  const existing = [c.fullResult, c.result].find(value => value?.memberId === memberId && value?.stateRevision === revision && value.activityInfo);
  if (existing) accept(existing);
  paint();
  if (!existing && needsFacts()) void load();
  return root;
}
