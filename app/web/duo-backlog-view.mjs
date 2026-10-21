import { backlogSearchText } from './screen-backlog.mjs';
import { matchesDuoOwner, scopeDuoRow } from './duo-task-lists.mjs';

export function selectDuoBacklogGroups(entries, state, selectedMemberId, ownerFilter = 'all', search = '', locationName, metadata = new Map()) {
  const query = search.toLowerCase().trim(), groups = new Map();
  for (const entry of entries) {
    if (!matchesDuoOwner(entry, ownerFilter)) continue;
    const byReason = new Map();
    for (const id of entry.memberIds) {
      if (!['all', 'both', id].includes(ownerFilter)) continue;
      const task = entry.tasksByMember[id];
      if (query && !`${backlogSearchText(task, locationName)} ${metadata.get(id)?.get(task.id) ?? ''}`.includes(query)) continue;
      const reason = (entry.statusByMember[id]?.backlogReason ?? '').trim();
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason).push(id);
    }
    for (const [reason, ids] of byReason) {
      if (!groups.has(reason)) groups.set(reason, { reason, label: reason || 'No reason given', tasks: [] });
      groups.get(reason).tasks.push(scopeDuoRow(entry, ids, state, selectedMemberId));
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Group search and folds are local display state. Each restore is one explicit
// player's revision-checked command, hence one ordinary Undo step.
export function createDuoBacklogView({ document, getState, getMemberId, getOwnerFilter, enabled, canEdit, command, showError, onChange, locationName, loadTasks, row, paint }) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
  const searchLabel = el('label', 'Search backlog', 'backlog-search'), search = el('input');
  search.type = 'search'; search.placeholder = 'Name, skill or chunk'; search.setAttribute('aria-label', 'Search backlog by name, skill or chunk'); searchLabel.append(search);
  const summary = el('span', undefined, 'task-meta'), actions = el('div', undefined, 'backlog-restore-actions'); summary.setAttribute('role', 'status');
  const folds = new Set(), metadata = new Map(), loads = new Map();
  let mounted, pending = false, metadataRevision;
  const scope = () => `${getState().revision}:${getMemberId()}:${getOwnerFilter()}:${enabled()}:${search.value}`;
  search.addEventListener('input', onChange);
  function restore(host, label, ids, memberId, capturedScope) {
    const submit = async () => {
      if (pending) return;
      if (!canEdit() || scope() !== capturedScope) { showError(new Error('The backlog changed. Review it and try again.')); return; }
      pending = true; onChange();
      try { await command({ type: 'clear-backlog', memberId, taskIds: ids }, getState().revision); }
      catch (error) { showError(error); }
      finally { pending = false; onChange(); }
    };
    const idle = () => {
      const control = button(label, () => {
        if (ids.length <= 10) return submit();
        host.replaceChildren(el('span', `Restore ${ids.length} tasks for ${getState().members.find(member => member.id === memberId)?.name ?? memberId}?`, 'task-meta'), button('Restore', submit), button('Cancel', idle));
      });
      control.disabled = pending; host.replaceChildren(control);
    };
    idle();
  }
  function restorePlayers(host, entries, all, capturedScope) {
    for (const member of getState().members) {
      const ids = [...new Set(entries.filter(entry => entry.memberIds.includes(member.id)).map(entry => entry.id))];
      if (!ids.length) continue;
      const container = el('span', undefined, 'backlog-restore-actions'); host.append(container);
      restore(container, all ? `Restore listed for ${member.name} (${ids.length})` : `Restore ${member.name}’s (${ids.length})`, ids, member.id, capturedScope);
    }
  }
  function requestLocations(entries) {
    if (!loadTasks || !search.value.trim()) return;
    const revision = getState().revision;
    for (const member of getState().members) {
      const tasks = entries.filter(entry => entry.memberIds.includes(member.id)).map(entry => entry.tasksByMember[member.id]);
      if (!tasks.length || metadata.has(member.id) || loads.has(member.id)) continue;
      const request = { failed: false }; loads.set(member.id, request);
      Promise.resolve().then(() => loadTasks(member.id)).then(value => {
        if (loads.get(member.id) !== request || getState().revision !== revision) return;
        if (value.memberId !== member.id || value.stateRevision !== revision) throw new Error('The backlog changed while loading chunk names.');
        metadata.set(member.id, new Map(value.tasks.map(task => [task.id, backlogSearchText(task, locationName)]))); loads.delete(member.id);
        if (enabled()) onChange();
      }).catch(() => { if (loads.get(member.id) === request) { request.failed = true; if (enabled()) onChange(); } });
    }
  }
  function render(host, target, entries, { open, generation, jobs = [] } = {}) {
    const state = getState(), memberId = getMemberId(), ownerFilter = getOwnerFilter(), capturedScope = scope();
    if (metadataRevision !== state.revision) { metadata.clear(); loads.clear(); metadataRevision = state.revision; }
    // The personal Backlog uses the same host when Group view is switched off.
    if (mounted !== host || searchLabel.parentElement !== host) { host.replaceChildren(searchLabel, summary, actions); mounted = host; }
    const all = selectDuoBacklogGroups(entries, state, memberId, ownerFilter), allRows = all.flatMap(group => group.tasks);
    if (open) requestLocations(allRows);
    const groups = selectDuoBacklogGroups(entries, state, memberId, ownerFilter, search.value, locationName, metadata), rows = groups.flatMap(group => group.tasks);
    const count = values => new Set(values.map(entry => entry.id)).size;
    summary.textContent = search.value.trim() ? `${count(rows)} of ${count(allRows)} tasks` : `${count(allRows)} tasks`;
    if (canEdit()) summary.textContent += ' · Undo brings restored tasks back.';
    if (canEdit() && search.value.trim()) summary.textContent += ' Restore listed ignores this search.';
    if (search.value.trim() && [...loads.values()].some(request => !request.failed)) summary.textContent += ' Loading chunk names…';
    actions.replaceChildren();
    if (search.value.trim() && [...loads.values()].some(request => request.failed)) {
      summary.textContent += ' Chunk search could not load.';
      actions.append(button('Retry chunk search', () => { for (const [id, request] of loads) if (request.failed) loads.delete(id); onChange(); }));
    }
    if (canEdit()) restorePlayers(actions, allRows, true, capturedScope);
    target.replaceChildren();
    if (!open) return { rows, total: count(allRows) };
    if (!groups.length) target.append(el('p', search.value.trim() ? 'No backlogged tasks match your search.' : 'No backlogged tasks.', 'empty-list'));
    for (const group of groups) {
      const section = el('section', undefined, 'backlog-group'), details = el('details'), heading = el('summary'), title = el('span', `${group.label} (${group.tasks.length})`, 'backlog-group-title'), body = el('div');
      heading.append(title); details.append(heading, body); section.append(details); target.append(section);
      let shown = 0;
      const more = button('Show more', () => { more.remove(); return paint(rowJobs(), generation); }); more.className = 'wide-button';
      const rowJobs = () => { const slice = group.tasks.slice(shown, shown + 70); shown += slice.length; return [...slice.map(entry => () => body.append(row(entry))), () => { if (shown < group.tasks.length) { more.textContent = `Show more (${group.tasks.length - shown})`; body.append(more); } }]; };
      details.open = folds.has(group.reason);
      if (details.open) jobs.push(...rowJobs());
      details.addEventListener('toggle', () => {
        if (scope() !== capturedScope) return;
        if (details.open) { folds.add(group.reason); if (!shown) void paint(rowJobs(), generation); } else folds.delete(group.reason);
      });
      if (canEdit()) {
        const controls = el('span', undefined, 'backlog-restore-actions'); controls.addEventListener('click', event => event.preventDefault?.());
        heading.replaceChildren(controls, title); restorePlayers(controls, group.tasks, false, capturedScope);
      }
    }
    return { rows, total: count(allRows) };
  }
  return { render };
}
