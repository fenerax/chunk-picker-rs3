// Both previews count tasks individually while grouping related clue locations.
export function appendPreviewTasks(c, outcome, added, { expandable = false } = {}) {
  const groups = new Map();
  for (const task of added) {
    if (!groups.has(task.category)) groups.set(task.category, []);
    groups.get(task.category).push(task);
  }
  outcome.replaceChildren(c.el('p', added.length ? `${added.length} new possible task${added.length === 1 ? '' : 's'}` : 'No new possible tasks', 'unlock-count'));
  for (const [category, tasks] of groups) {
    const rows = [], clues = new Map(), list = c.el('ul');
    for (const task of tasks) {
      const tier = String(task.record?.ClueTier ?? '').trim().toLowerCase(), type = String(task.record?.ClueType ?? '').trim().toLowerCase();
      if (!tier || !type) { rows.push(task); continue; }
      const key = JSON.stringify([tier, type]);
      if (!clues.has(key)) { const group = { tier, type, tasks: [] }; clues.set(key, group); rows.push(group); }
      clues.get(key).tasks.push(task);
    }
    for (const row of rows) {
      if (!row.tasks) { list.append(c.el('li', c.plain(row.label))); continue; }
      const entry = c.el('li'), tier = row.tier.charAt(0).toUpperCase() + row.tier.slice(1);
      const kind = row.type === 'scan' || row.type === 'compass' ? 'spots' : 'steps';
      entry.append(c.details(`${tier} ${row.type} clue ${kind} (${row.tasks.length})`, c.list(row.tasks.map(task => c.plain(task.label)))));
      list.append(entry);
    }
    const label = `${category} (${tasks.length})`;
    if (expandable) outcome.append(c.details(label, list));
    else outcome.append(c.el('h4', label, 'content-heading'), list);
  }
}
