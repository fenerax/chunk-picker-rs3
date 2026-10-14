import { createUsageCounter, dialogUsageId, handleUsageControl } from './usage-client.mjs';
import { usageSummary } from './usage-model.mjs';

const observedPanels = ['chunk-info', 'map-display-panel', 'map-pins-panel', 'pending-panel', 'pool-ranking-panel', 'phone-task-panel', 'phone-more'];

export function createScreenUsage(c, { storage: providedStorage, now = () => new Date() } = {}) {
  const storage = providedStorage ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } })();
  const counter = createUsageCounter({ storage, now,
    actor: () => c.state ? c.sessionReadOnly ? 'viewer' : c.sessionMember ?? c.state.members[0]?.id : undefined,
    width: () => globalThis.innerWidth ?? 1024,
    beacon: (url, body) => globalThis.navigator?.sendBeacon?.(url, body),
  });
  let started = false, currentDialog;
  const visibility = new Map();
  function panelOpened(id) {
    const panel = c.$(id); if (!panel || panel.hidden) { visibility.set(id, false); return; }
    if (!visibility.get(id)) counter.count(`dom:${id}`);
    visibility.set(id, true);
  }
  function settingsRow() {
    const row = c.el('div', undefined, 'rule-row settings-option'), text = c.el('div', undefined, 'field-copy');
    text.append(c.el('strong', 'Count which windows I use'), c.el('p', 'Counts stay on this picker and are only seen by the administrator.', 'field-help'));
    const input = c.input('checkbox'); input.id = 'usage-enabled'; input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', 'Count which windows I use'); input.checked = counter.enabled;
    input.addEventListener('change', () => counter.setEnabled(input.checked)); row.append(text, input);
    return row;
  }
  const openSettings = () => c.openDialog('Settings', settingsRow());
  async function openView() {
    if (!c.sessionAdmin) return;
    await counter.flush();
    const root = c.el('div', undefined, 'usage-view'), status = c.el('p', 'Loading counts…', 'status-detail');
    root.append(status); const generation = c.openDialog('Usage', root);
    const payload = await c.api('/api/usage'); if (!c.dialogCurrent(generation)) return;
    const controls = c.el('div', undefined, 'usage-controls');
    const person = c.select([...c.state.members.map(member => ({ value: member.id, label: member.name })), { value: 'viewer', label: 'Viewers' }, ...(payload.counts.some(row => row.actor === 'unlinked') ? [{ value: 'unlinked', label: 'Unlinked invites' }] : [])], c.sessionMember ?? c.state.members[0]?.id);
    const period = c.select([{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }], '7');
    const device = c.select([{ value: 'all', label: 'Phone and desktop' }, { value: 'phone', label: 'Phone' }, { value: 'desktop', label: 'Desktop' }], 'all');
    controls.append(c.field('Person', person), c.field('Period', period), c.field('Device', device));
    const output = c.el('div'), note = c.el('p', 'Counts start when this feature is enabled; devices with counting off leave no counts.', 'field-help');
    const exportButton = c.button('Export JSON', () => c.download(payload, 'picker-usage.json'));
    root.replaceChildren(note, controls, status, output, exportButton);
    function render() {
      const summary = usageSummary(payload.counts, { actor: person.value, days: Number(period.value), device: device.value, now: now() });
      status.textContent = `${summary.total.toLocaleString()} opens and uses · ${summary.start} to ${summary.end} UTC`;
      const heading = c.el('h3', 'Most used'), scroll = c.el('div', undefined, 'usage-table-scroll');
      const table = c.el('table', undefined, 'usage-table'), caption = c.el('caption', 'The 30 most-used windows and controls');
      const head = c.el('thead'), headings = c.el('tr');
      for (const label of ['Window or control', 'Count', 'Phone', 'Desktop']) { const cell = c.el('th', label); cell.scope = 'col'; headings.append(cell); }
      head.append(headings); const body = c.el('tbody');
      for (const event of summary.top) {
        const row = c.el('tr'), label = c.el('th'); label.scope = 'row';
        label.append(c.el('span', event.label), c.el('small', event.kind === 'open' ? 'Opened' : 'Used', 'usage-kind'));
        row.append(label, ...[event.total, event.phone, event.desktop].map(value => c.el('td', value.toLocaleString()))); body.append(row);
      }
      table.append(caption, head, body); scroll.append(table);
      const unused = c.details(`No counts in this period (${summary.unused.length})`), list = c.el('ul', undefined, 'usage-unused');
      for (const event of summary.unused) list.append(c.el('li', `${event.label} (${event.kind === 'open' ? 'opened' : 'used'})`));
      unused.append(c.el('p', 'These registered windows and controls have no recorded counts for this person and device selection.', 'field-help'), list);
      output.replaceChildren(heading, summary.top.length ? scroll : c.el('p', 'No counts yet.', 'empty-list'), unused);
    }
    for (const control of [person, period, device]) control.addEventListener('change', render);
    render();
  }
  c.usage = { ...counter, settingsRow, panelOpened, openSettings, openView,
    dialogOpened(title, nodes, wasOpen) {
      const id = dialogUsageId(title, nodes);
      if (!wasOpen || currentDialog !== id) counter.count(id);
      currentDialog = id;
    },
    pageOpened(id) { counter.count(id); },
    get enabled() { return counter.enabled; },
    start() {
      if (started || !c.state) return; started = true;
      const button = c.$('usage-open'); if (button) { button.hidden = !c.sessionAdmin; button.addEventListener('click', () => { void openView().catch(c.showError); }); }
      if (c.sessionReadOnly) {
        const privacy = c.button('Usage settings', openSettings);
        privacy.id = 'usage-settings-open'; c.$('more-tools')?.querySelector('.more-tools-menu')?.prepend(privacy);
      }
      const listener = event => handleUsageControl(event, counter.count);
      for (const name of ['click', 'change']) document.addEventListener(name, listener, true);
      document.addEventListener('toggle', event => {
        if (event.target?.open && ['recent-panel', 'backlog-details', 'completed-details'].includes(event.target.id)) counter.count(`dom:${event.target.id}`);
        if (event.target?.open && event.target.dataset?.usage === 'tasks:accessible-areas') counter.count('tasks:accessible-areas');
      }, true);
      c.$('tool-dialog')?.addEventListener('close', () => { if (!c.$('tool-dialog').open) currentDialog = undefined; });
      if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(records => { for (const { target } of records) panelOpened(target.id); });
        for (const id of observedPanels) { const node = c.$(id); if (node) { panelOpened(id); observer.observe(node, { attributes: true, attributeFilter: ['hidden'] }); } }
      }
      globalThis.addEventListener?.('pagehide', () => { counter.stop(); void counter.flush(true); });
      globalThis.addEventListener?.('pageshow', () => { counter.refreshPreference(); counter.start(); });
      globalThis.addEventListener?.('storage', event => { if (event.key === 'picker.usage-enabled') counter.refreshPreference(); });
      counter.count('region:application'); counter.start();
    },
  };
}
