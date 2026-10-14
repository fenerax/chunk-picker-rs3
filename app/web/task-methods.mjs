/** A compact choice list; metadata stays visible while each method uses one action. */
export function createTaskMethods({ document = globalThis.document, tasks, activeId, canChoose, choose, open, automatic = true }) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const root = el('div', undefined, 'task-methods');
  const controls = el('div', undefined, 'task-methods-controls');
  controls.append(el('span', automatic ? 'Automatic choice' : 'Saved choice', 'task-methods-hint'));
  if (canChoose) {
    const auto = el('button', 'Choose automatically', 'task-methods-auto'); auto.type = 'button'; auto.disabled = automatic;
    auto.addEventListener('click', () => act(auto, () => choose(null))); controls.append(auto);
  }
  root.append(controls);
  async function act(button, action) {
    button.disabled = true;
    try { await action(); }
    catch (error) { const message = el('p', error.message || String(error), 'task-methods-error'); message.setAttribute('role', 'alert'); root.append(message); }
    finally { button.disabled = false; }
  }
  const unique = [...new Map(tasks.map(task => [task.id, task])).values()].sort((left, right) => Number(right.id === activeId) - Number(left.id === activeId));
  for (const [ready, title] of [[true, 'Doable now'], [false, 'Needs progress']]) {
    const rows = unique.filter(task => (task.status === 'available') === ready); if (!rows.length) continue;
    const group = el('div', undefined, 'task-methods-group'); group.append(el('h4', `${title} (${rows.length})`));
    const addRow = task => {
      const row = el('div', undefined, 'task-method'); row.dataset.active = task.id === activeId;
      const action = el('button', undefined, 'task-method-choice'); action.type = 'button'; action.setAttribute('aria-pressed', String(task.id === activeId));
      action.append(el('span', task.label, 'task-method-name'), el('span', `${task.level && !(task.generated && task.category === 'BiS') ? `Level ${task.level} · ` : ''}${ready ? 'Doable now' : task.blockers?.[0]?.detail || 'Needs review'}`, 'task-method-meta'));
      if (task.id === activeId) action.append(el('span', 'Active choice', 'task-method-active'));
      action.addEventListener('click', () => act(action, () => canChoose ? choose(task.id) : open(task)));
      row.append(action);
      if (canChoose) { const detail = el('button', 'Details', 'task-method-details'); detail.type = 'button'; detail.setAttribute('aria-label', `Details for ${task.label}`); detail.addEventListener('click', () => act(detail, () => open(task))); row.append(detail); }
      group.append(row);
    };
    let shown = 0;
    const more = el('button', '', 'task-methods-more'); more.type = 'button';
    function addBatch(size) {
      more.remove?.(); rows.slice(shown, shown + size).forEach(addRow); shown = Math.min(rows.length, shown + size);
      if (shown < rows.length) { more.textContent = `Show more methods (${rows.length - shown})`; group.append(more); }
    }
    more.addEventListener('click', () => addBatch(12)); addBatch(6);
    root.append(group);
  }
  return root;
}
