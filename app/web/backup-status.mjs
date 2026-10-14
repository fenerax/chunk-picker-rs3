import { describeHistoryEvent } from './history-text.mjs';

// Restore choices explain the snapshot; revision and size belong in Advanced.
export function backupSaveLabel(backup, lookups) {
  if (!backup) return 'Saved changes';
  const change = backup.label || (backup.event ? describeHistoryEvent(backup.event, lookups) : backup.revision === 0 ? 'Initial save' : 'Saved changes');
  const date = new Date(backup.at), at = backup.at && Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date not recorded';
  return `${change}${!backup.label && backup.event?.actor?.label ? ` · by ${backup.event.actor.label}` : ''} · ${at}`;
}

const warnings = {
  failed: 'The latest backup failed. Review Backup & Import and check the backup destination.',
  stale: 'No successful backup in the last two days. Check that the desktop and backup destination are available.',
  'not-configured': 'Automatic backups are not configured. Download a full backup from Backup & Import.',
  'not-run': 'Automatic backups have not run yet. Download a full backup while waiting for the first run.',
  unavailable: 'Backup status is unavailable. Open Backup & Import to check again or download a full backup.',
};

function when(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
}

export function backupStatusText(status) {
  if (!status) return 'Last backup: checking…';
  const at = when(status.lastSuccessAt ?? (status.result === 'success' ? status.lastRunAt : null));
  if (!at) return status.result === 'never' ? 'Last backup: none yet' : 'Last backup: unknown';
  const size = status.result === 'success' && Number.isFinite(status.byteSize) && status.byteSize >= 0
    ? ` · ${Math.max(1, Math.round(status.byteSize / 1024)).toLocaleString()} KB` : '';
  return `Last backup: ${at}${size}`;
}

// Automatic backup health has its own persistent region so ordinary notices
// and their dismissal timers cannot hide it. Nothing is fetched for invite links.
export function createBackupStatus({ api, el, button, document, isAdmin, menuLine, banner, openBackup,
  setInterval: poll = globalThis.setInterval, clearInterval: stop = globalThis.clearInterval }) {
  let status, pending, timer, dialogLine, started = false;
  function render() {
    for (const line of [menuLine, dialogLine?.deref()]) {
      if (!line) continue;
      line.hidden = !isAdmin();
      line.textContent = backupStatusText(status);
    }
    const warning = status?.warning ?? (status?.result === 'failed' ? 'failed' : null);
    const text = warnings[warning];
    banner.hidden = !isAdmin() || !text;
    if (!banner.hidden) banner.replaceChildren(el('span', text), button('Review backups', openBackup));
  }
  async function refresh() {
    if (!isAdmin()) { render(); return; }
    if (pending) return pending;
    pending = (async () => {
      try { status = await api('/api/backup-status'); }
      catch { status = { ...status, warning: 'unavailable' }; }
      finally { pending = null; render(); }
    })();
    return pending;
  }
  function line() {
    if (!isAdmin()) return null;
    // A detached status node can retain its whole dialog through its parent.
    // Keep the current dialog weakly; the visible DOM owns its lifetime.
    const node = el('p', backupStatusText(status), 'backup-status-line');
    dialogLine = new WeakRef(node);
    return node;
  }
  function start() {
    render();
    if (started || !isAdmin()) return;
    started = true;
    void refresh();
    timer = poll(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 15 * 60 * 1000);
  }
  function dispose() { if (timer !== undefined) stop(timer); timer = undefined; started = false; }
  return { start, refresh, line, dispose };
}
