// Keeps keyboard focus on the same task control while the active list is rebuilt.
//
// Rows mark themselves with explicit metadata: `data-focus-task` on the row
// names the command identity (mode, owners, command task id, completion kind),
// and `data-task-control` on a control names its role. A redraw captures the
// focused control before the list is replaced, then focuses the fresh control
// with the same identity and role when its row is appended. Any user key,
// pointer or focus change, or a change of member, mode, filter or dialog,
// cancels the wait. Nothing is ever clicked or changed on the user's behalf.
export function createTaskFocus({ document, host, scope, onRestore = () => {}, view = globalThis }) {
  let lease, restoring = false;
  const cancel = () => { if (!restoring) lease = undefined; };
  for (const type of ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'focusin']) document.addEventListener?.(type, cancel, true);
  view?.addEventListener?.('blur', cancel);

  // Removing the focused node leaves the document, not a user choice, focused.
  const nowhere = node => !node || node === document.body || node === document.documentElement || node.isConnected === false;
  const semantic = node => {
    const role = node?.dataset?.taskControl;
    for (let row = node?.parentElement; role && row; row = row.parentElement) if (row.dataset?.focusTask) return { row: row.dataset.focusTask, role };
  };
  const find = (node, role) => {
    for (const child of node.children ?? []) {
      if (typeof child !== 'object') continue;
      if (child.dataset?.taskControl === role) return child;
      const found = find(child, role); if (found) return found;
    }
  };
  const visible = node => {
    for (let item = node; item; item = item.parentElement) if (item.hidden) return false;
    return node.checkVisibility?.() ?? true;
  };

  return {
    /** Call before the active list is replaced. */
    capture() {
      const active = document.activeElement, list = host(), control = list?.contains?.(active) ? semantic(active) : undefined;
      if (control) { lease = { ...control, scope: scope(), waiting: false }; return; }
      // An earlier redraw's lease survives only while nothing else took focus.
      if (lease && nowhere(active) && lease.scope === scope()) lease.waiting = false;
      else lease = undefined;
    },
    /** How many rows of a category the active list must paint to include the lease's row. */
    depth(target, rows, keyOf) {
      if (!lease || target !== host()) return 0;
      return rows.findIndex(row => keyOf(row) === lease.row) + 1;
    },
    /** Call with each row once it is in the document. */
    offer(row) {
      if (!lease || row?.dataset?.focusTask !== lease.row) return;
      const control = find(row, lease.role);
      // Completed and backlog lists reuse the row renderers; only the active list restores.
      if (!control || !host()?.contains?.(control)) return;
      if (lease.scope !== scope() || !visible(control)) { lease = undefined; return; }
      // A disabled control may be enabled by a later redraw; never enable it here.
      if (control.disabled) { lease.waiting = true; return; }
      lease = undefined; restoring = true;
      try { control.focus({ preventScroll: true }); } finally { restoring = false; }
      onRestore(control);
    },
    /** Call when the current redraw has painted every row; an absent target is not replaced. */
    finish() { if (lease && !lease.waiting) lease = undefined; },
    pending: () => !!lease,
  };
}
