import { questMapLocations } from './quest-map-model.mjs';

// One temporary quest selection shares Search's canvas. No gameplay commands.
export function createQuestMap(c) {
  let active, pending, request = 0, panel, title, summary, notes;
  const scope = () => ({ world: c.world, memberId: c.memberId, revision: c.state.revision });
  const current = value => value && value.world === c.world && value.memberId === c.memberId && value.revision === c.state.revision;
  const countText = value => `${value.ids.length} ${value.ids.length === 1 ? 'chunk' : 'chunks'} · ${value.lockedIds.length} still locked`;
  const alternativesText = 'All recorded alternatives are shown; you may only need some of them.';
  // Big quest lines list dozens of interiors; keep the count short and the names one click away.
  const gaps = value => [
    [value.interiors, 'No map square for', count => `${count} places have no map square (caves, buildings and similar)`],
    [value.missing, 'No chunk recorded for', count => `${count} steps have no chunk recorded`],
  ].filter(([items]) => items.length);
  const noteText = value => [value.alternatives.length ? alternativesText : '',
    ...gaps(value).map(([items, label, many]) => items.length > 3 ? `${many(items.length)}.` : `${label}: ${items.join('; ')}.`)].filter(Boolean).join(' ');
  const noteNodes = value => [...(value.alternatives.length ? [c.el('p', alternativesText)] : []),
    ...gaps(value).map(([items, label, many]) => items.length > 3 ? c.details(many(items.length), c.el('p', `${items.join('; ')}.`)) : c.el('p', `${label}: ${items.join('; ')}.`))];

  function mount() {
    if (panel) return;
    const sheet = c.el('link'); sheet.rel = 'stylesheet'; sheet.href = '/quest-map.css';
    c.$('map-panel').ownerDocument.head.append(sheet);
    panel = c.el('section', undefined, 'quest-map-status'); panel.hidden = true;
    panel.setAttribute('aria-label', 'Quest on map');
    const header = c.el('div', undefined, 'quest-map-header');
    title = c.el('strong');
    const clearButton = c.button('Clear', () => { clear(); c.$('map-hover')?.focus(); });
    clearButton.setAttribute('aria-label', 'Clear quest highlights');
    header.append(title, clearButton);
    summary = c.el('p'); summary.setAttribute('role', 'status');
    const legend = c.el('p', undefined, 'quest-map-key');
    legend.append(c.el('span', 'Unlocked by either player', 'quest-map-unlocked'), c.el('span', 'Still locked', 'quest-map-locked'));
    notes = c.el('div', undefined, 'quest-map-notes');
    panel.append(header, summary, legend, notes);
    const dock = c.$('map-panel').querySelector('.map-dock');
    if (dock) dock.before(panel); else c.$('map-panel').append(panel);
  }

  function clear() {
    request++;
    if (active || pending) c.map?.setSearchMatches?.([]);
    active = pending = undefined;
    if (panel) panel.hidden = true;
  }

  function refresh() {
    if (active && !current(active) || pending && !current(pending)) clear();
  }

  function controls({ quest, task, guard = () => true }) {
    const host = c.el('div', undefined, 'quest-map-controls');
    const message = c.el('p', '', 'status-detail'); message.setAttribute('role', 'status');
    const captured = scope();
    const show = c.button('Show on map', async () => {
      if (!current(captured) || !guard()) return;
      clear();
      const attempt = ++request; pending = captured;
      show.disabled = true; message.textContent = 'Finding quest chunks…';
      try {
        await c.ensureFullDefinitions();
        if (attempt !== request || !current(captured) || !guard()) return;
        const unlocked = new Set(c.state.members.flatMap(owner => owner.unlocked));
        const value = questMapLocations({ quest, task, definitions: c.definitions, world: c.world, unlocked });
        if (!value.ids.length) {
          pending = undefined;
          message.textContent = `No map chunks recorded for this quest. ${noteText(value)}`.trim();
          return;
        }
        mount();
        // Closing Search may clear its canvas, so install quest geometry afterward.
        c.closeDialog();
        active = { ...captured, ...value }; pending = undefined;
        c.map.setSearchMatches(value.ids, { lockedIds: value.lockedIds });
        if (!c.map.centerOnChunks?.(value.ids)) c.map.centerOnChunk(value.ids[0]);
        title.textContent = c.plain(value.quest || 'Quest'); summary.textContent = countText(value);
        notes.replaceChildren(...noteNodes(value)); notes.hidden = !notes.childElementCount;
        panel.hidden = false;
        panel.querySelector('button')?.focus({ preventScroll: true });
      } catch {
        if (attempt === request && current(captured) && guard()) {
          pending = undefined;
          message.textContent = 'Quest map locations are unavailable. Try Show on map again.';
        }
      } finally {
        if (attempt === request && pending === captured) pending = undefined;
        show.disabled = false;
        if (message.textContent === 'Finding quest chunks…') message.textContent = '';
      }
    });
    host.append(show, message); return host;
  }

  return { controls, clear, refresh };
}
