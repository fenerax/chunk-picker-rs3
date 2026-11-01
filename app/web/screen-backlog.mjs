const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();
const list = value => Array.isArray(value) ? value : value == null ? [] : [value];

export function backlogSearchText(task, locationName = id => id) {
  const locations = [...list(task.locations), ...list(task.record?.Chunks)];
  for (const source of task.sources ?? []) locations.push(...list(source?.location), ...list(source?.locations));
  const places = locations.flatMap(location => {
    if (location == null) return [];
    const id = typeof location === 'object' ? location.id ?? location.location ?? location.name : location;
    if (id == null) return [];
    const reference = plain(id), base = /^\d+-\d+$/.test(reference) ? reference.split('-')[0] : undefined;
    return [id, locationName(reference), ...(base ? [locationName(base)] : []), typeof location === 'object' ? location.name : ''];
  });
  const skills = Object.keys(task.skillRequirements ?? {});
  for (const field of ['Skills', 'Requirements', 'SkillsNeeded', 'SkillReqs']) skills.push(...Object.keys(task.record?.[field] ?? {}));
  return plain([task.label, task.category, ...skills, ...places].join(' ')).toLowerCase();
}

export function selectBacklogGroups(tasks, status, search = '', locationName, searchIndex = new Map()) {
  const query = plain(search).toLowerCase(), groups = new Map(), seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id) || !status[task.id]?.backlogged || task.obligation === false || task.hidden) continue;
    seen.add(task.id);
    if (query && !`${backlogSearchText(task, locationName)} ${searchIndex.get(task.id) ?? ''}`.includes(query)) continue;
    const reason = (status[task.id].backlogReason ?? '').trim();
    if (!groups.has(reason)) groups.set(reason, { reason, label: reason || 'No reason given', tasks: [] });
    groups.get(reason).tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// The Backlog keeps its search and folds per selected player, outside the save.
export function createBacklogView({ document, getState, getMemberId, canEdit, command, showError, onChange, locationName, loadTasks, row, paint }) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const button = (text, action, cls) => { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', action); return node; };
  const searches = new Map(), folds = new Map();
  const searchLabel = el('label', 'Search backlog', 'backlog-search'), search = el('input');
  search.type = 'search'; search.placeholder = 'Name, skill or chunk'; search.setAttribute('aria-label', 'Search backlog by name, skill or chunk'); searchLabel.append(search);
  const summary = el('span', undefined, 'task-meta'), actions = el('div', undefined, 'backlog-restore-actions');
  summary.setAttribute('role', 'status');
  let owner, mounted, metadata, loading, pending = false;
  search.addEventListener('input', () => { searches.set(owner, search.value); onChange(); });

  function restoreControl(host, label, ids, revision, memberId, all = false, accessibleLabel = label) {
    const current = () => canEdit() && memberId === getMemberId() && revision === getState().revision;
    const submit = async () => {
      if (pending) return;
      if (!current()) { showError(new Error('The backlog changed. Review it and try again.')); return; }
      pending = true;
      for (const node of host.children) if (node.tagName === 'BUTTON') node.disabled = true;
      onChange();
      try { await command({ type: 'clear-backlog', memberId, ...(!all ? { taskIds: ids } : {}) }, revision); }
      catch (error) { showError(error); }
      finally { pending = false; onChange(); }
    };
    const idle = () => {
      const restore = button(label, () => {
        if (ids.length <= 10) return submit();
        host.replaceChildren(el('span', `Restore ${ids.length} tasks for ${getState().members.find(member => member.id === memberId)?.name ?? memberId}?`, 'task-meta'), button('Restore', submit, 'primary-action'), button('Cancel', idle));
      });
      restore.disabled = pending; restore.setAttribute('aria-label', accessibleLabel); host.replaceChildren(restore);
    };
    idle();
  }

  function requestLocations(tasks, revision, memberId) {
    if (!loadTasks || !search.value.trim() || metadata?.scope === `${memberId}:${revision}` || loading?.scope === `${memberId}:${revision}`) return;
    // Thin task rows omit locations. Fetch existing read-only details only when
    // searching, then retain a small text index rather than the full result.
    if (tasks.every(task => task.id.startsWith('custom:') || list(task.locations).some(Boolean) || list(task.record?.Chunks).some(Boolean)
      || task.sources?.some(source => list(source?.location).some(Boolean) || list(source?.locations).some(Boolean)))) return;
    const request = { scope: `${memberId}:${revision}`, failed: false }; loading = request;
    Promise.resolve().then(() => loadTasks(memberId)).then(value => {
      if (value.memberId !== memberId || value.stateRevision !== revision) throw new Error('The backlog changed while loading chunk names.');
      if (loading !== request) return;
      const savedIds = new Set(tasks.map(task => task.id));
      metadata = { scope: request.scope, index: new Map(value.tasks.filter(task => savedIds.has(task.id)).map(task => [task.id, backlogSearchText(task, locationName)])) };
      loading = undefined;
      if (getMemberId() === memberId && getState().revision === revision) onChange();
    }).catch(() => {
      if (loading !== request) return;
      request.failed = true;
      if (getMemberId() === memberId && getState().revision === revision) onChange();
    });
  }

  function render(host, target, tasks, { open, generation, jobs = [] } = {}) {
    const state = getState(), memberId = getMemberId(), revision = state.revision, scope = `${memberId}:${revision}`;
    if (owner !== memberId) { owner = memberId; search.value = searches.get(owner) ?? ''; }
    if (mounted !== host || searchLabel.parentElement !== undefined && searchLabel.parentElement !== host) { host.replaceChildren(searchLabel, summary, actions); mounted = host; }
    const status = state.members.find(member => member.id === memberId)?.taskStatus ?? {};
    const all = selectBacklogGroups(tasks, status), allRows = all.flatMap(group => group.tasks);
    if (open) requestLocations(allRows, revision, memberId);
    const groups = selectBacklogGroups(tasks, status, search.value, locationName, metadata?.scope === scope ? metadata.index : undefined), rows = groups.flatMap(group => group.tasks);
    summary.textContent = search.value.trim()
      ? `${rows.length} of ${allRows.length} unique task${allRows.length === 1 ? '' : 's'}${canEdit() ? ' · Restore these uses matching tasks.' : ''}`
      : `${allRows.length} unique task${allRows.length === 1 ? '' : 's'}${canEdit() ? ' · Undo brings restored tasks back.' : ''}`;
    if (loading?.scope === scope && search.value.trim()) summary.textContent += loading.failed ? ' Chunk search could not load.' : ' Loading chunk names…';
    actions.replaceChildren();
    if (loading?.scope === scope && loading.failed && search.value.trim()) actions.append(button('Retry chunk search', () => { loading = undefined; onChange(); }));
    const ids = Object.keys(status).filter(id => status[id].backlogged);
    if (canEdit() && ids.length) {
      const restore = el('div', undefined, 'backlog-restore-actions'); actions.append(restore);
      restoreControl(restore, `Restore all (${ids.length})`, ids, revision, memberId, true);
    }
    target.replaceChildren();
    if (!open) return { rows, total: allRows.length };
    if (!groups.length) target.append(el('p', search.value.trim() ? 'No backlogged tasks match your search.' : 'No backlogged tasks.', 'empty-list'));
    const expanded = folds.get(memberId) ?? new Set(); folds.set(memberId, expanded);
    for (const group of groups) {
      const section = el('section', undefined, 'backlog-group'), details = el('details'), heading = el('summary'), title = el('span', `${group.label} (${group.tasks.length} unique task${group.tasks.length === 1 ? '' : 's'})`, 'backlog-group-title'), body = el('div');
      heading.append(title); heading.setAttribute('aria-label', title.textContent);
      details.append(heading, body); section.append(details); target.append(section);
      let shown = 0;
      const more = button('Show more', () => { more.remove(); return paint(rowJobs(), generation); }, 'wide-button');
      const rowJobs = () => { const slice = group.tasks.slice(shown, shown + 70); shown += slice.length; return [...slice.map(task => () => body.append(row(task))), () => { if (shown < group.tasks.length) { more.textContent = `Show more (${group.tasks.length - shown})`; body.append(more); } }]; };
      details.open = expanded.has(group.reason);
      if (details.open) jobs.push(...rowJobs());
      details.addEventListener('toggle', () => {
        if (memberId !== getMemberId() || revision !== getState().revision) return;
        if (details.open) { expanded.add(group.reason); if (!shown) void paint(rowJobs(), generation); } else expanded.delete(group.reason);
      });
      if (canEdit()) {
        const restore = el('span', undefined, 'backlog-restore-actions');
        restore.addEventListener('click', event => event.preventDefault?.());
        heading.replaceChildren(restore, title);
        restoreControl(restore, 'Restore these', group.tasks.map(task => task.id), revision, memberId, false, `Restore these ${group.tasks.length} tasks: ${group.label}`);
      }
    }
    return { rows, total: allRows.length };
  }
  return { render };
}
