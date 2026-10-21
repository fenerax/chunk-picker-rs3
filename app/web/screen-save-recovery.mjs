// Both surfaces call the same command client's Retry/Discard actions. The
// modal copy stays in its focus scope, beside the control that failed.
export function createSaveRecovery(c, { retry, discard }) {
  let shown = false, header, inline;
  function controls(prefix) {
    const host = c.el(prefix ? 'div' : 'span', undefined, prefix ? 'form-stack status-detail' : 'status-detail');
    const message = c.el('span', 'Save not confirmed. '); message.setAttribute('role', 'status');
    const retryButton = c.button('Retry save', retry), discardButton = c.button('Discard pending save', discard);
    retryButton.id = `${prefix}pending-save-retry`; discardButton.id = `${prefix}pending-save-discard`;
    host.append(message, retryButton, discardButton); return host;
  }
  function remove(host) {
    const focused = host?.contains(document.activeElement);
    host?.remove();
    if (focused) {
      const dialog = c.$('tool-dialog');
      const target = c.lastSaveControl?.isConnected ? c.lastSaveControl
        : dialog?.open ? dialog.querySelector('button') : c.$('history-open');
      target?.focus();
    }
  }
  function refresh() {
    if (!shown || !c.canWrite()) { remove(header); remove(inline); header = inline = undefined; return; }
    if (!c.$('save-status')?.after || !c.el || !c.button) return;
    if (!header?.isConnected) { header = controls(''); c.$('save-status')?.after(header); }
    if (!c.$('tool-dialog')?.open) { remove(inline); inline = undefined; return; }
    if (inline?.isConnected) return;
    inline = controls('dialog-');
    let anchor = c.lastSaveControl;
    if (anchor?.tagName === 'INPUT') anchor = anchor.closest?.('label') ?? anchor;
    if (anchor?.isConnected && c.$('dialog-content').contains(anchor)) anchor.after(inline);
    else c.$('dialog-content').prepend(inline);
  }
  c.refreshSaveRecovery = refresh;
  return show => { shown = show; refresh(); };
}
