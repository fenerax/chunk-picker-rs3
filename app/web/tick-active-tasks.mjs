import { tickActiveTaskPlan, tickActiveTaskQuestion } from './tick-active-tasks-model.mjs';

const conflictText = 'Another save arrived first. Nothing was ticked. Close this and try again.';

// Rarely needed and easy to regret, so it lives in the Active Tasks overflow
// menu and always asks first. Viewers never get the menu.
export function createTickActiveTasks(c) {
  let menu, item, note, snapshot = { rows: [], duo: false, ready: false, revision: undefined };
  const owner = () => c.sessionMember ?? c.memberId;
  const plan = () => tickActiveTaskPlan({ rows: snapshot.rows, ownerId: owner(), duo: snapshot.duo, personalFacts: task => c.taskFacts(task) });

  function unavailable() {
    if (c.sandbox?.active) return 'Exit Sandbox to tick tasks.';
    if (!snapshot.duo && owner() !== c.memberId) return 'Switch to your own map to tick your tasks.';
    if (!snapshot.ready || snapshot.revision !== c.state.revision) return 'Tasks are still updating.';
    if (!plan().taskIds.length) return 'Nothing here to tick.';
    return '';
  }
  function refresh() {
    const reason = unavailable();
    item.disabled = !!reason; note.textContent = reason; note.hidden = !reason;
  }
  function build() {
    const sheet = c.el('link'); sheet.rel = 'stylesheet'; sheet.href = '/tick-active-tasks.css'; document.head.append(sheet);
    menu = c.el('details', undefined, 'task-list-menu'); menu.id = 'active-task-menu';
    const summary = c.el('summary', '⋯', 'task-list-menu-toggle');
    summary.setAttribute('aria-label', 'More actions for active tasks'); summary.title = 'More actions';
    const items = c.el('div', undefined, 'task-list-menu-items');
    item = c.button('Tick all active tasks…', open, 'task-list-menu-item'); item.id = 'tick-active-tasks-open';
    note = c.el('p', '', 'task-list-menu-note'); note.hidden = true;
    items.append(item, note); menu.append(summary, items);
    menu.addEventListener('toggle', () => { if (menu.open) refresh(); });
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus?.();
    });
    document.addEventListener('click', event => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  }

  function open() {
    menu.open = false;
    if (!c.canWrite() || unavailable()) return;
    const chosen = plan(), revision = snapshot.revision, memberId = owner();
    const count = chosen.taskIds.length, label = `${count.toLocaleString()} ${count === 1 ? 'task' : 'tasks'}`;
    const name = c.state.members.find(member => member.id === memberId)?.name;
    const nodes = [c.el('p', tickActiveTaskQuestion(chosen, name), 'tick-active-question'),
      c.el('p', 'They count for your chunk challenge. Undo reverses this in one step.', 'field-help')];
    if (c.advanced?.()) nodes.push(c.el('p', `Saved as one tick-active-tasks change against revision ${revision}.`, 'field-help'));
    const status = c.el('p', '', 'tick-active-status'); status.setAttribute('role', 'status');
    const actions = c.el('div', undefined, 'tick-active-actions');
    let generation;
    const cancel = c.button('Cancel', () => c.closeDialog(generation), 'tick-active-cancel');
    const confirm = c.button(`Tick ${label}`, async () => {
      if (!c.dialogCurrent(generation)) return;
      confirm.disabled = cancel.disabled = true; status.textContent = 'Saving…';
      try {
        await c.command({ type: 'tick-active-tasks', memberId, taskIds: chosen.taskIds, ...(chosen.needChoice ? { skipped: chosen.needChoice } : {}) }, revision);
        c.closeDialog(generation);
        c.notice(`Ticked ${label}. Undo reverses this.`);
      } catch (error) {
        if (!c.dialogCurrent(generation)) { c.showError(error); return; }
        cancel.disabled = false;
        status.textContent = error.status === 409 ? conflictText : error.message;
      }
    }, 'tick-active-confirm');
    actions.append(cancel, confirm);
    generation = c.openDialog('Tick all active tasks', ...nodes, actions, status);
    cancel.focus?.();
  }

  /** Called on every task render with the exact rows Active Tasks shows. */
  function update(rows, { duo = false, ready = false, host } = {}) {
    snapshot = { rows, duo, ready, revision: c.state.revision };
    if (!c.canWrite()) { menu?.remove(); if (menu) menu.open = false; return; }
    if (!menu) build();
    if (menu.parentElement !== host) host.append(menu);
    if (menu.open) refresh();
  }
  return { update, open, element: () => menu };
}
