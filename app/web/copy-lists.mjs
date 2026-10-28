import { createCopyListControl } from './copy-list-control.mjs';

// Review copy uses the complete filtered ledger, including folded categories
// and later pages. Recent view retains its flat order.
export function completedReviewList({ rows, players, range, layout = 'category', plain = String, date = at => at ? new Date(at).toLocaleString() : 'Date unknown' }) {
  const groups = new Map();
  for (const row of rows) {
    const label = layout === 'category' ? row.category : '';
    if (!groups.has(label)) groups.set(label, []);
    const evidence = row.completions.map(completion => {
      const kind = completion.kind === 'ticked' ? 'ticked' : completion.source === 'runemetrics' ? 'in-game, RuneMetrics' : completion.source === 'official-api' ? 'in-game, RuneScape API' : 'in-game';
      return `Done by ${completion.name ?? completion.memberName} (${kind}) · ${date(completion.at)}${completion.imported ? ' · Imported from original picker' : ''}`;
    }).join('; ');
    groups.get(label).push(`${plain(row.task.label)}${layout === 'category' ? '' : ` · ${row.category}`} · ${evidence}`);
  }
  return { player: players.join(' & '), title: 'Completed', range, groups: [...groups].map(([label, items]) => ({ label, items })) };
}

export function createCompletedReviewCopy({ document, getClipboard }) {
  let snapshot;
  const control = createCopyListControl({ document, id: 'copy-completed-review', label: 'Copy filtered completed tasks', complete: true, getClipboard, readList: () => snapshot });
  return { ...control, update(list) { snapshot = list; control.refresh(); } };
}

// Read-only exports of the same ordered rows used to paint the screen.
export function createCopyLists(c) {
  const controls = new Map(), snapshots = new Map();
  const sheet = c.el('link'); sheet.rel = 'stylesheet'; sheet.href = '/copy-lists.css'; document.head.append(sheet);
  const date = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  function update(id, label, host, fallbackHost, list) {
    snapshots.set(id, list);
    if (!controls.has(id)) {
      const control = createCopyListControl({ document, id, label, readList: () => ({ ...snapshots.get(id), date: date() }) });
      controls.set(id, control); fallbackHost.append(control.fallback);
    }
    const control = controls.get(id); control.refresh(); host.append(control.element);
  }
  function taskGroups(rows, duo = false) {
    const groups = new Map();
    for (const value of rows) {
      const task = duo ? value.task : value;
      if (!groups.has(task.category)) groups.set(task.category, []);
      const doneBy = duo ? (value.facts.completedBy ?? []).map(id => c.state.members.find(member => member.id === id)?.name ?? id).join(' and ') : '';
      groups.get(task.category).push(`${c.plain(task.label)}${duo ? ` · ${value.label}${doneBy ? ` · Done by ${doneBy}` : ''}` : ''}`);
    }
    return [...groups].map(([label, items]) => ({ label, items }));
  }
  function tasks(active, completed, group = false, ownerFilter = 'all') {
    const heading = c.$('task-count').parentElement, sidebar = heading.parentElement;
    update('copy-active-tasks', 'Copy active tasks', heading, sidebar, {
      player: group ? c.state.members.map(owner => owner.name).join(' & ') : c.member().name,
      title: c.sandbox.active ? 'Sandbox active tasks' : 'Active tasks', groups: taskGroups(active),
    });
    // Keep recovery beside its list, ahead of the search field.
    heading.after(controls.get('copy-active-tasks').fallback);
    const details = c.$('completed-details');
    update('copy-completed-tasks', 'Copy completed tasks', details.querySelector('summary'), details.parentElement, {
      player: group ? (c.state.members.find(member => member.id === ownerFilter)?.name ?? c.state.members.map(owner => owner.name).join(' & ')) : c.member().name,
      title: group && ownerFilter === 'both' ? 'Shared completed tasks' : 'Completed tasks', groups: taskGroups(completed, group),
    });
    details.after(controls.get('copy-completed-tasks').fallback);
  }
  function map(owner, pool) {
    const counts = c.$('map-counts'), name = id => {
      const name = c.plain(c.world.chunks.get(String(id))?.name);
      return name && name !== String(id) ? `${name} (${id})` : String(id);
    }, names = ids => ids.map(name);
    const title = value => c.sandbox.active ? `Sandbox ${value.toLowerCase()}` : value;
    update('copy-unlocked-chunks', 'Copy unlocked chunks', counts.children[0], counts.parentElement, {
      player: owner.name, title: title('Unlocked chunks'), groups: [{ items: names(owner.unlocked) }],
    });
    update('copy-pool-chunks', 'Copy roll pool chunks', counts.children[2], counts.parentElement, {
      player: owner.name, title: title('Roll pool chunks'), groups: [{ items: pool.eligible.map(({ id }) => `${name(id)}${owner.selected?.includes(id) ? ' (added by hand)' : ''}`) }],
    });
    counts.after(controls.get('copy-unlocked-chunks').fallback, controls.get('copy-pool-chunks').fallback);
  }
  return { tasks, map };
}
