import { describeHistoryEvent, historyChangeTypes, historyChangeType } from './history-text.mjs';

const PAGE_SIZE = 150;

// History owns its request lifecycle; loading another page keeps the filters and focus.
export function createScreenHistory(c) {
  function historyDialog() {
    return openHistory();
  }

  function renderHistory(history) { return openHistory(history); }

  function openHistory(localHistory) {
    const revision = c.state.revision, requestedMember = c.memberId, lookups = c.historyLookups();
    const content = c.el('div', undefined, 'history-panel'), actions = c.el('div', undefined, 'history-actions');
    const filters = c.el('div', undefined, 'history-filters'), search = c.input('search');
    const player = c.select([{ value: '', label: 'All players' }, ...c.state.members.map(member => ({ value: member.id, label: member.name }))], '');
    const type = c.select([{ value: '', label: 'All changes' }, ...historyChangeTypes.map(item => ({ value: item.id, label: item.label }))], '');
    const rows = c.el('div', undefined, 'history-entries'), status = c.el('p', '', 'status-detail'), footer = c.el('div', undefined, 'history-actions');
    status.setAttribute('role', 'status'); search.placeholder = 'Search changes, names or notes…'; search.maxLength = 200;
    filters.append(c.field('Search History', search), c.field('Player', player), c.field('Type of change', type));
    content.append(actions, filters, status, rows, footer);
    const generation = c.openDialog('History', content);
    actions.append(c.button('Roll stats', () => c.rollStatsDialog()));
    let requestId = 0, nextBefore = null, shown = 0, timer, pending = false;
    const current = () => c.dialogCurrent(generation);
    const sameSave = () => revision === c.state.revision && requestedMember === c.memberId;
    const refresh = () => { if (current()) return c.historyDialog(); };
    if (c.canWrite()) {
      actions.append(c.duoCoordination ? c.duoCoordination.undoControl(refresh) : c.button('Undo most recent change', async () => {
        await c.command({ type: 'undo' }); return refresh();
      }));
      if (c.duoCoordination) actions.append(c.duoCoordination.ownControls(refresh));
    }

    function row(event) {
      const node = c.el('div', undefined, 'history-row'); node.classList?.toggle('is-undone', !!event.undoneRevision);
      const date = new Date(event.at), at = Number.isFinite(date.getTime())
        ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date not recorded';
      node.append(c.el('strong', describeHistoryEvent(event, lookups)), c.el('span', `${event.actor?.label ? `by ${event.actor.label} · ` : ''}${at}${c.advanced() ? ` · #${event.revision}` : ''}${event.undoneRevision ? ' · undone' : ''}`, 'history-meta'));
      if (c.advanced()) node.append(changeDetails(event));
      return node;
    }

    function changeDetails(event) {
      if (localHistory) return c.lazyJSON('Change details', event);
      const detail = c.details('Change details'), body = c.el('div'); detail.append(body);
      let loaded = false, loading = false;
      const loadDetails = async () => {
        if (!current() || loaded || loading) return;
        if (!sameSave()) { changedSave(); return; }
        loading = true; body.replaceChildren(c.el('p', 'Loading change details…', 'status-detail'));
        try {
          const value = await c.api(`/api/history/${event.revision}?stateRevision=${revision}`);
          if (!current()) return;
          if (!sameSave() || value.stateRevision !== revision) { changedSave(); return; }
          loaded = true; body.replaceChildren(c.jsonPreview(value.event));
        } catch (error) {
          if (!current()) return;
          if (!sameSave() || error.status === 409) { changedSave(); return; }
          body.replaceChildren(c.el('p', 'Change details could not be loaded.', 'status-detail'), c.button('Retry details', loadDetails));
        } finally { loading = false; }
      };
      detail.addEventListener('toggle', () => { if (detail.open) loadDetails(); });
      return detail;
    }

    function changedSave() {
      footer.replaceChildren(c.button('Refresh History', refresh));
      status.textContent = 'Your save or selected player changed. Refresh History to see the latest changes.';
    }

    function localPage(before, query) {
      const matches = [...(localHistory ?? [])].reverse().filter(event => {
        const command = event.command ?? {};
        return (!before || event.revision < before)
          && (!query.player || command.memberId === query.player || event.actor?.memberId === query.player || command.affectedMemberIds?.includes(query.player) || command.members?.some(member => member.memberId === query.player) || command.starts?.some(member => member.memberId === query.player))
          && (!query.type || historyChangeType(event) === query.type)
          && (!query.q || `${describeHistoryEvent(event, lookups)} ${event.actor?.label ?? ''} ${command.note ?? ''}`.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()));
      });
      const history = matches.slice(0, PAGE_SIZE);
      return { stateRevision: revision, history, hasMore: matches.length > PAGE_SIZE, nextBefore: history.at(-1)?.revision ?? null };
    }

    function finish(value, append, moveFocus) {
      const page = value.history.map(row);
      if (append) rows.append(...page); else rows.replaceChildren(...page);
      shown = (append ? shown : 0) + page.length; nextBefore = value.nextBefore;
      status.textContent = shown ? `${shown.toLocaleString()} ${shown === 1 ? 'change' : 'changes'} shown${value.hasMore ? ' · more available' : ''}`
        : search.value.trim() || player.value || type.value ? 'No changes match these filters.' : 'New actions will appear here. Imported original history stays in your full backup.';
      footer.replaceChildren(...(value.hasMore ? [c.button('Load older', () => load(true))] : []));
      if (moveFocus && page.length) { page[0].tabIndex = -1; page[0].focus(); }
    }

    async function load(append = false) {
      if (!current() || (append && pending)) return;
      if (!sameSave()) { changedSave(); return; }
      clearTimeout(timer);
      const request = ++requestId, before = append ? nextBefore : null;
      const moveFocus = append && footer.contains?.(globalThis.document?.activeElement);
      const query = { player: player.value, type: type.value, q: search.value.trim() };
      pending = true; rows.setAttribute('aria-busy', 'true');
      status.textContent = append ? 'Loading older changes…' : 'Searching saved history…';
      if (!append) { rows.replaceChildren(); shown = 0; }
      footer.replaceChildren();
      try {
        const value = localHistory ? localPage(before, query) : await c.api(`/api/history?limit=${PAGE_SIZE}&stateRevision=${revision}${before === null ? '' : `&before=${before}`}${query.player ? `&player=${encodeURIComponent(query.player)}` : ''}${query.type ? `&type=${encodeURIComponent(query.type)}` : ''}${query.q ? `&q=${encodeURIComponent(query.q)}` : ''}`);
        if (!current() || request !== requestId) return;
        if (!sameSave() || value.stateRevision !== revision) { changedSave(); return; }
        finish(value, append, moveFocus);
      } catch (error) {
        if (!current() || request !== requestId) return;
        if (!sameSave() || error.code === 'REVISION_CONFLICT' || error.status === 409) { changedSave(); return; }
        status.textContent = 'History could not be loaded. Try again.';
        const retry = c.button(append ? 'Retry older changes' : 'Retry History', () => load(append));
        footer.replaceChildren(retry); if (moveFocus) retry.focus();
      } finally {
        if (current() && request === requestId) { pending = false; rows.removeAttribute('aria-busy'); }
      }
    }

    search.addEventListener('input', () => {
      clearTimeout(timer); requestId++; pending = false;
      footer.replaceChildren(); rows.setAttribute('aria-busy', 'true');
      timer = setTimeout(() => load(), 180);
    });
    player.addEventListener('change', () => load()); type.addEventListener('change', () => load());
    return load();
  }

  Object.assign(c, { historyDialog, renderHistory });
}
