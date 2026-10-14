import { usageById } from './usage-catalogue.mjs';

export const USAGE_STORAGE_KEY = 'picker.usage-enabled';
export const usageDevice = width => width < 768 ? 'phone' : 'desktop';

// The buffer contains only daily totals. Neither DOM values nor event objects enter it.
export function createUsageCounter({ storage, actor, width, now = () => new Date(),
  fetch = globalThis.fetch, beacon, schedule = globalThis.setInterval, cancel = globalThis.clearInterval }) {
  let enabled = true, timer, sending = false, epoch = 0;
  const pending = new Map();
  try { enabled = storage?.getItem(USAGE_STORAGE_KEY) !== 'false'; } catch {}
  const add = row => {
    const key = JSON.stringify([row.id, row.actor, row.device, row.day]);
    if (!pending.has(key) && pending.size >= 200) return;
    const previous = pending.get(key)?.count ?? 0;
    pending.set(key, { ...row, count: Math.min(1000, previous + row.count) });
  };
  function count(id) {
    if (!enabled || !usageById.has(id)) return;
    const person = actor(); if (!person) return;
    add({ id, actor: person, device: usageDevice(width()), day: now().toISOString().slice(0, 10), count: 1 });
  }
  function setEnabled(value) {
    enabled = value === true; epoch++;
    if (!enabled) pending.clear();
    try { storage?.setItem(USAGE_STORAGE_KEY, String(enabled)); } catch {}
  }
  function refreshPreference() {
    try { const next = storage?.getItem(USAGE_STORAGE_KEY) !== 'false'; if (next !== enabled) { enabled = next; epoch++; if (!enabled) pending.clear(); } } catch {}
  }
  async function flush(onHide = false) {
    refreshPreference();
    if (!enabled || !pending.size || (!onHide && sending)) return;
    const rows = [...pending.values()], body = JSON.stringify({ counts: rows }), version = epoch;
    if (onHide && beacon) {
      try { if (beacon('/api/usage', new Blob([body], { type: 'application/json' }))) { pending.clear(); return; } } catch {}
    }
    pending.clear(); sending = true;
    try {
      const result = await fetch('/api/usage', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      if (!result.ok && enabled && epoch === version && (result.status >= 500 || result.status === 429)) rows.forEach(add);
    } catch { if (enabled && epoch === version) rows.forEach(add); }
    finally { sending = false; }
  }
  return { count, flush, setEnabled, refreshPreference, get enabled() { return enabled; },
    start() { if (!timer) timer = schedule(() => { void flush(); }, 60000); },
    stop() { if (timer) cancel(timer); timer = undefined; },
  };
}

const fixedDialogIds = new Map([
  ['Settings', 'settings'], ['Chunk Rules', 'rules'], ['History', 'history'], ['Backup & Import', 'backup'],
  ['Search', 'search'], ['OBS overlays', 'overlays'], ['Feedback', 'feedback'], ['About / Map sources', 'about'],
  ['What’s new', 'news'], ['Roadmap', 'roadmap'], ['Invite links', 'invites'], ['Sync from original picker', 'original-sync'],
  ['Apply rule profile', 'rules:profile-review'], ['Migration report', 'backup:migration-report'],
  ['Profile', 'profile'], ['Activity Info', 'activity'], ['Current BiS', 'bis'], ['Map journal', 'journal'],
  ['Ready for members', 'members'], ['Confirm members start', 'members:confirm'], ['Members starts', 'members:result'],
  ['Sandbox task rules', 'sandbox:rules'], ['Area check', 'area'], ['XP choices', 'xp'],
  ['Confirm chunk roll', 'roll:confirm'], ['New chunk tasks', 'roll:new-tasks'], ['Forfeit a chunk', 'roll:forfeit'],
  ['Roll stats', 'roll:stats'], ['F2P finish line', 'finish'], ['Ask your partner', 'partner'],
  ['Add custom task', 'tasks:custom'], ['Edit custom task', 'tasks:custom'], ['Delete custom task', 'tasks:custom-delete'],
  ['Completed Tasks', 'tasks:completed'], ['Download map image', 'dialog:download-map'],
  ['Task calculation', 'dialog:task-calculation'], ['Task unavailable', 'dialog:task-unavailable'], ['Usage', 'usage'],
]);
export function dialogUsageId(title, nodes = []) {
  const tagged = nodes.find(node => usageById.get(node?.dataset?.usage)?.kind === 'open');
  if (tagged) return tagged.dataset.usage;
  if (fixedDialogIds.has(title)) return fixedDialogIds.get(title);
  if (/’s Teleports$/.test(title)) return 'teleports';
  if (/^Sync .+ from RuneMetrics$/.test(title)) return 'runemetrics:standalone';
  if (/’s starting chunk$/.test(title)) return 'dialog:starting-marker';
  if (/’s stickers · /.test(title)) return 'stickers:full';
  if (/^Undo .+’s change\?$/.test(title)) return 'dialog:partner-undo';
  return 'dom:tool-dialog';
}

// Match static UI families. No values, hrefs, record ids or accessible names are read.
export function controlUsageId(control) {
  const tagged = control.dataset?.usage;
  if (usageById.has(tagged)) return tagged;
  const stable = `dom:${control.id}`;
  if (usageById.get(stable)?.kind === 'use') return stable;
  if (control.tagName === 'SUMMARY') {
    const id = control.parentElement?.id;
    if (['more-tools', 'info-tools', 'admin-tools', 'legend-details'].includes(id)) return `dom:${id}`;
    if (['backlog-details', 'completed-details'].includes(id)) return `dom:${id}:disclosure`;
  }
  if (control.closest?.('#member-switch')) return 'player:choice';
  if (control.closest?.('#undo-own')) return 'undo:own';
  if (control.closest?.('#chunk-info') && control.dataset?.tab) {
    const id = `chunk:tab-${control.dataset.tab}`; if (usageById.has(id)) return id;
  }
  if (!control.closest?.('.task-sidebar')) return;
  if (control.matches?.('.task-backlog') && control.querySelector?.('.icon-restore')) return 'tasks:row-restore';
  for (const [selector, id] of [
    ['.task-label-button', 'tasks:row-name'], ['.task-category-toggle', 'tasks:category-fold'],
    ['.task-skill-choices input', 'tasks:skill-choice'], ['.task-skill-picker summary', 'tasks:skill-fold:disclosure'],
    ['.duo-task-row > input', 'tasks:duo-row-check'], ['.task-row > input', 'tasks:row-check'],
    ['.task-row .icon-wiki', 'tasks:row-wiki'], ['.task-row a.icon-button', 'tasks:row-wiki'],
    ['.task-backlog .icon-restore', 'tasks:row-restore'], ['.task-backlog', 'tasks:row-backlog'],
    ['.group-goals-fold', 'goals:fold'], ['.group-goal-link', 'goals:link-task'],
    ['.backlog-form input', 'tasks:backlog-reason'], ['.backlog-form button[type="submit"]', 'tasks:backlog-save'],
    ['.backlog-form button', 'tasks:backlog-cancel'], ['.backlog-group .wide-button', 'tasks:backlog-more'], ['.task-list .wide-button', 'tasks:show-more'],
    ['#task-engine-status button', 'engine:details'],
    ['.duo-task-backlog', 'tasks:duo-row-backlog'], ['.duo-task-chooser select', 'tasks:owner-select'],
    ['.duo-task-chooser button[type="submit"]', 'tasks:owner-confirm'], ['.duo-task-chooser button', 'tasks:owner-cancel'],
    ['.task-claim-confirm button.primary-action', 'tasks:takeover-confirm'], ['.task-claim-confirm button', 'tasks:takeover-cancel'],
    ['.backlog-search input', 'tasks:backlog-search'], ['.backlog-group summary', 'tasks:backlog-group:disclosure'],
    ['.custom-task-edit', 'tasks:custom-edit'], ['.group-goal-matches button', 'goals:link-match'],
    ['.group-goal-save', 'goals:save'],
  ]) if (control.matches?.(selector) || control.closest?.(selector) === control) return id;
  if (control.closest?.('.backlog-restore-actions') && control.tagName === 'BUTTON') {
    if (control.textContent === 'Cancel') return 'tasks:backlog-confirm-cancel';
    if (control.textContent === 'Restore') return 'tasks:backlog-confirm';
    if (/^Restore all/.test(control.textContent)) return 'tasks:backlog-all';
    if (control.textContent === 'Restore these') return 'tasks:backlog-these';
    if (/^Restore listed for /.test(control.textContent)) return 'tasks:duo-backlog-all';
    return 'tasks:duo-backlog-these';
  }
  if (control.closest?.('#backlog-actions') && control.textContent === 'Retry chunk search') return 'tasks:backlog-retry';
  if (control.closest?.('.list-copy-fallback')) {
    const id = control.closest('.list-copy-fallback').querySelector('textarea')?.id;
    const prefix = id === 'copy-active-tasks-text' ? 'tasks:copy-active-tasks' : id === 'copy-completed-tasks-text' ? 'tasks:copy-completed-tasks' : undefined;
    if (prefix && control.tagName === 'BUTTON') return `${prefix}-${control.textContent === 'Select all' ? 'select' : 'close'}`;
  }
  if (control.closest?.('.group-goal-editor')) {
    if (control.type === 'text') return 'goals:text';
    if (control.type === 'search') return 'goals:link-search';
    if (control.tagName === 'SELECT') {
      const selects = [...control.closest('.group-goal-editor').querySelectorAll('select')];
      return selects.indexOf(control) === 0 ? 'goals:completion' : 'goals:link-kind';
    }
  }
  if (control.matches?.('.duo-task-chip')) {
    return control.textContent === 'All' ? 'tasks:owner-all' : control.textContent === 'Both' ? 'tasks:owner-both' : 'tasks:owner-player';
  }
  if (control.matches?.('.task-claim-action')) return control.dataset.owned === 'true' ? 'tasks:release' : control.dataset.claimed === 'true' ? 'tasks:takeover' : 'tasks:claim';
  if (control.closest?.('#group-goals')) {
    if (control.type === 'checkbox') return control.closest?.('label')?.textContent === 'Done' ? 'goals:done' : 'goals:player-done';
    // Only exact authored button captions are compared; never retain their text.
    const ids = { 'Add goal': 'goals:add', Edit: 'goals:edit', Up: 'goals:up', Down: 'goals:down', Remove: 'goals:remove', Cancel: 'goals:cancel', 'Save goal': 'goals:save', 'Keep draft': 'goals:keep-draft' };
    if (control.tagName === 'BUTTON' && ids[control.textContent]) return ids[control.textContent];
  }
  return 'tasks:other-control';
}

export function handleUsageControl(event, count) {
  if (!['click', 'change'].includes(event.type)) return;
  const control = event.target?.closest?.('button, summary, input, select, textarea, a');
  if (!control || control.disabled) return;
  const changes = control.tagName === 'SELECT' || control.tagName === 'TEXTAREA' && !control.readOnly
    || ['checkbox', 'radio', 'range', 'color', 'text', 'search', 'number'].includes(control.type);
  if ((event.type === 'change') !== changes) return;
  const id = controlUsageId(control);
  if (usageById.get(id)?.kind === 'use') count(id);
  if (id === 'dom:task-filters-toggle' && control.getAttribute?.('aria-expanded') !== 'true') count('dom:task-filters-panel');
}
