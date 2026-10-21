// "A new version is ready" banner and the What's new list.
// The server sends its version on every live connection; a different one after a reconnect means the picker was updated.
export function createUpdates({ el, button, openDialog, api, banner, storage = (() => { try { return globalThis.localStorage; } catch { return null; } })() }) {
  let loadedVersion, changelog;
  const seenKey = 'picker.changelogSeen';

  async function loadChangelog() {
    changelog ??= api('/api/changelog').catch(error => { changelog = undefined; throw error; });
    return changelog;
  }

  function showBanner(latest) {
    if (!banner) return;
    const text = el('span', latest ? `The picker has been updated: ${latest.title}.` : 'The picker has been updated.', 'update-text');
    banner.replaceChildren(text, button('Refresh', () => globalThis.location?.reload()), button('What’s new', () => openList()), button('Later', () => { banner.hidden = true; }, 'update-later'));
    banner.hidden = false;
  }

  /** Called with each version the server reports. */
  function seen(version) {
    if (!version) return;
    if (loadedVersion === undefined) { loadedVersion = version; return; }
    if (version !== loadedVersion) loadChangelog().then(value => showBanner(value.entries?.[0])).catch(() => showBanner());
  }

  async function openList() {
    const content = el('div', undefined, 'form-stack changelog');
    content.append(el('p', 'Loading…', 'status-detail'));
    openDialog('What’s new', content);
    try {
      const value = await loadChangelog();
      content.replaceChildren(...(value.entries ?? []).map(entry => {
        const section = el('section', undefined, 'changelog-entry');
        const items = el('ul');
        for (const item of entry.items ?? []) items.append(el('li', item));
        section.append(el('h3', entry.title), el('p', new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), 'changelog-date'), items);
        return section;
      }));
      try { storage?.setItem(seenKey, value.entries?.[0]?.date + '|' + value.entries?.[0]?.title); } catch {}
      refreshDot(value);
    } catch (error) { content.replaceChildren(el('p', error.message || String(error), 'error')); }
  }

  // A small dot on the What's new menu item until the newest entry has been opened.
  function refreshDot(value, menuItem = globalThis.document?.getElementById('whats-new-open')) {
    if (!menuItem) return;
    const latest = value?.entries?.[0];
    let lastSeen = null; try { lastSeen = storage?.getItem(seenKey); } catch {}
    menuItem.classList?.toggle('has-news', !!latest && lastSeen !== `${latest.date}|${latest.title}`);
  }
  loadChangelog().then(value => refreshDot(value)).catch(() => {});

  // The roadmap is fetched on every open: statuses change while the picker keeps running.
  const statusOrder = ['working', 'next', 'soon', 'later', 'maybe', 'done'];
  const longDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  async function openRoadmap() {
    const content = el('div', undefined, 'roadmap');
    content.append(el('p', 'Loading…', 'status-detail'));
    openDialog('Roadmap', content);
    try {
      const value = await api('/api/roadmap');
      const labels = value.statuses ?? {}, themes = value.themes ?? [];
      const all = themes.flatMap(theme => theme.items);
      const count = status => all.filter(item => item.status === status).length;
      const pill = status => { const node = el('span', labels[status] ?? status, 'roadmap-pill'); node.dataset.status = status; return node; };
      const intro = el('p', `What we plan to build, and what is being worked on right now. Updated as work happens; last updated ${longDate(value.updated)}.`, 'roadmap-intro');
      const now = el('section', undefined, 'roadmap-now');
      for (const status of ['working', 'next']) {
        const items = all.filter(item => item.status === status);
        if (!items.length) continue;
        const list = el('ul');
        for (const item of items) { const row = el('li'); row.append(el('strong', item.title), ...(item.note ? [el('span', ` · ${item.note}`)] : [])); list.append(row); }
        now.append(el('h3', labels[status] ?? status), list);
      }
      const filters = el('div', undefined, 'roadmap-filters');
      filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Show');
      const body = el('div', undefined, 'roadmap-themes');
      let shown = 'all';
      const card = item => {
        const node = el('article', undefined, 'roadmap-item'); node.dataset.status = item.status;
        const head = el('div', undefined, 'roadmap-item-head'); head.append(el('h4', item.title), pill(item.status));
        const meta = [value.sizes?.[item.size] && `Size: ${value.sizes[item.size].toLowerCase()}`, item.done && `Done ${shortDate(item.done)}`, item.note].filter(Boolean).join(' · ');
        node.append(head, el('p', item.what), el('p', `Why: ${item.why}`, 'roadmap-why'), ...(meta ? [el('p', meta, 'roadmap-meta')] : []));
        return node;
      };
      const render = () => {
        for (const chip of filters.children) chip.setAttribute('aria-pressed', String(chip.dataset.filter === shown));
        body.replaceChildren(...themes.map(theme => {
          const items = theme.items.filter(item => shown === 'all' || item.status === shown)
            .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
          if (!items.length) return null;
          const section = el('section', undefined, 'roadmap-theme');
          section.append(el('h3', theme.title), el('p', theme.blurb, 'roadmap-blurb'), ...items.map(card));
          return section;
        }).filter(Boolean));
      };
      for (const [key, label] of [['all', 'Everything'], ...statusOrder.filter(count).map(status => [status, `${labels[status] ?? status} ${count(status)}`])]) {
        const chip = button(label, () => { shown = key; render(); }); chip.type = 'button'; chip.dataset.filter = key; filters.append(chip);
      }
      render();
      content.replaceChildren(intro, ...(now.children.length ? [now] : []), filters, body);
    } catch (error) { content.replaceChildren(el('p', error.message || String(error), 'error')); }
  }

  return { seen, openList, openRoadmap };
}
