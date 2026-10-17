const POLL_MS = 1000;
const HEARTBEAT_MS = 10000;
const number = value => Number.isFinite(value) ? value : null;

export function rankPoolRows(rows, skill = '') {
  const count = row => row.status === 'checked' ? number(skill ? row.bySkill?.[skill]?.count ?? 0 : row.count) : null;
  return [...rows].sort((a, b) => {
    const left = count(a), right = count(b);
    return (left === null) - (right === null) || (right ?? 0) - (left ?? 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
}

/** GET only reads saved summaries. A writable, settled view renews its own lease. */
export function createPoolRankingClient(ctx) {
  const schedule = ctx.setTimeout ?? globalThis.setTimeout, cancel = ctx.clearTimeout ?? globalThis.clearTimeout;
  const now = ctx.now ?? Date.now;
  const watchId = ctx.watchId ?? `pool_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')}`;
  let visible = false, key, timer, generation = 0, request, nextPollAt = 0, nextIntentAt = 0, registered;
  let writes = Promise.resolve();
  const scopeKey = scope => `${scope.memberId}:${scope.revision}`;
  const scope = () => ctx.scope();
  const readable = value => visible && !ctx.hidden() && !value.sandboxActive && !!value.memberId && Number.isSafeInteger(value.revision);
  const current = (value, token) => token === generation && readable(scope()) && scopeKey(scope()) === scopeKey(value);
  const writable = () => ctx.canWrite() && ctx.foregroundSettled();

  function write(value, on, token) {
    // Serializing leases also keeps a quick close/reopen from cancelling the new lease.
    writes = writes.catch(() => {}).then(async () => {
      if (!ctx.canWrite() || (on && (!current(value, token) || !writable()))) return;
      try { await ctx.api('/api/pool-ranking-intent', { memberId: value.memberId, revision: value.revision, watchId, visible: on }); }
      catch (error) { if (on && current(value, token)) ctx.onError?.(error); }
    });
  }

  function stop() {
    generation++; cancel(timer); timer = undefined; request?.controller.abort(); request = undefined;
    if (registered) { write(registered, false); registered = undefined; }
    nextPollAt = 0; nextIntentAt = 0;
  }

  async function poll(value, token) {
    const entry = { controller: new AbortController() }; request = entry;
    try {
      const response = await ctx.api(`/api/pool-ranking?memberId=${encodeURIComponent(value.memberId)}`, undefined, entry.controller.signal);
      if (!current(value, token) || response.memberId !== value.memberId || response.stateRevision !== value.revision) return;
      ctx.onUpdate(response);
    } catch (error) { if (current(value, token) && error.name !== 'AbortError') ctx.onError?.(error); }
    finally { if (request === entry) request = undefined; }
  }

  function refresh() {
    cancel(timer); timer = undefined;
    const value = scope(), nextKey = scopeKey(value);
    if (key !== nextKey || !readable(value)) { stop(); key = nextKey; }
    if (!readable(value)) return;
    const time = now(), token = generation;
    if (writable() && time >= nextIntentAt) {
      registered = value; nextIntentAt = time + HEARTBEAT_MS; write(value, true, token);
    } else if (!writable() && registered) {
      write(registered, false); registered = undefined; nextIntentAt = 0;
    }
    if (!request && time >= nextPollAt) { nextPollAt = time + POLL_MS; void poll(value, token); }
    timer = schedule(refresh, POLL_MS);
  }

  return {
    refresh,
    setVisible(on) { if (visible === on) return; visible = on; if (!on) stop(); else refresh(); },
    dispose() { visible = false; stop(); },
  };
}

export function createScreenPoolRanking(c) {
  let mounted = false, data, dataKey, sort = '', signature, skillOptionsSignature;
  const nodes = new Map();
  const document = globalThis.document;
  const panel = c.$('pool-ranking-panel'), toggle = c.$('pool-ranking-toggle');
  const client = createPoolRankingClient({
    api: (...args) => c.api(...args),
    scope: () => ({ memberId: c.memberId, revision: c.state?.revision, sandboxActive: !!c.sandbox?.active }),
    hidden: () => document.hidden,
    canWrite: c.canWrite,
    foregroundSettled: () => c.foregroundSettled(),
    onUpdate: value => { data = value; render(); },
    onError: () => { signature = undefined; c.$('pool-ranking-status').textContent = 'Could not update the comparison. Retrying…'; },
  });

  function name(id) { return c.plain(c.world?.chunks.get(String(id))?.name) || `Chunk ${id}`; }
  const label = value => c.plain(typeof value === 'string' ? value : value?.label ?? value?.name ?? '');
  const examples = values => (values ?? []).map(label).filter(Boolean).slice(0, 3).join(' · ');

  function rowNode(row) {
    const id = String(row.id);
    let entry = nodes.get(id);
    if (!entry) {
      const node = c.el('li', undefined, 'pool-ranking-row');
      node.dataset.chunkId = id;
      const view = c.button('', () => c.map.centerOnChunk(id), 'pool-ranking-view');
      const title = c.el('strong'), count = c.el('span', undefined, 'pool-ranking-count'), status = c.el('span', undefined, 'pool-ranking-row-status');
      const heading = c.el('span', undefined, 'pool-ranking-row-heading'), sample = c.el('span', undefined, 'pool-ranking-examples');
      heading.append(title, count); view.append(heading, status, sample);
      const details = c.details('Skills & notable unlocks'); details.className = 'pool-ranking-details';
      const content = c.el('div', undefined, 'pool-ranking-breakdown'); details.append(content); node.append(view, details);
      entry = { node, title, count, status, sample, view, details, content }; nodes.set(id, entry);
    }
    const checked = row.status === 'checked', value = checked ? number(sort ? row.bySkill?.[sort]?.count ?? 0 : row.count) : null;
    entry.title.textContent = `${name(id)}${c.advanced() && name(id) !== `Chunk ${id}` ? ` · Chunk ${id}` : ''}`;
    entry.count.textContent = value === null ? '—' : `+${value.toLocaleString()}`;
    entry.status.textContent = !checked ? 'Still checking' : value === 0 ? `No new ${sort ? `${sort} ` : ''}tasks` : 'Checked';
    if (c.member().selected?.includes(id)) entry.status.textContent = `Added to roll pool by hand · ${entry.status.textContent}`;
    entry.node.dataset.status = checked ? 'checked' : 'estimated';
    entry.view.setAttribute('aria-label', `Center map on ${name(id)}. ${checked && value !== null ? `${value} new ${sort ? `${sort} ` : ''}tasks. Checked.` : 'Still checking.'}`);
    entry.sample.textContent = examples(sort ? row.bySkill?.[sort]?.examples : row.examples);
    entry.sample.hidden = !entry.sample.textContent;
    const sections = [];
    const skills = Object.entries(row.bySkill ?? {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [skill, detail] of skills) {
      const line = c.el('p'); line.append(c.el('strong', `${skill} · ${detail.count.toLocaleString()}`));
      const sample = examples(detail.examples); if (sample) line.append(c.el('span', sample)); sections.push(line);
    }
    for (const [kind, title] of [['quests', 'Quests'], ['shops', 'Shops'], ['resources', 'Resources'], ['teleports', 'Teleports']]) {
      const sample = examples(row.notable?.[kind]); if (!sample) continue;
      const line = c.el('p'); line.append(c.el('strong', title), c.el('span', sample)); sections.push(line);
    }
    entry.details.hidden = !sections.length;
    entry.content.replaceChildren(...sections);
    return entry.node;
  }

  function render() {
    if (!mounted || panel.hidden) return;
    const nextKey = `${c.memberId}:${c.state?.revision}`;
    if (dataKey !== nextKey) { dataKey = nextKey; data = undefined; signature = undefined; nodes.clear(); c.$('pool-ranking-rows').replaceChildren(); }
    const owner = c.member()?.name ?? 'Player';
    c.$('pool-ranking-owner').textContent = `${owner}’s saved roll pool`;
    c.$('pool-ranking-advanced').hidden = !c.advanced();
    c.$('pool-ranking-advanced-content').textContent = `New tasks are counted for ${owner}. Partner chunks can supply access, but these totals belong to this player. Save revision ${c.state?.revision}.`;
    if (!data) { c.$('pool-ranking-status').textContent = 'Loading the roll pool…'; return; }
    const nextSignature = JSON.stringify([data, sort, c.advanced()]); if (nextSignature === signature) return; signature = nextSignature;
    const skills = [...new Set(data.rows.flatMap(row => Object.keys(row.bySkill ?? {})))].sort();
    const select = c.$('pool-ranking-sort');
    // Retain the chosen skill while partial summaries arrive or a new save is checked.
    if (sort && !skills.includes(sort)) skills.push(sort);
    const options = [{ value: '', label: 'Total new tasks' }, ...skills.sort().map(value => ({ value, label: value }))];
    const nextOptionsSignature = JSON.stringify(options);
    if (skillOptionsSignature !== nextOptionsSignature) {
      skillOptionsSignature = nextOptionsSignature;
      select.replaceChildren(...options.map(value => { const option = c.el('option', value.label); option.value = value.value; return option; })); select.value = sort;
    }
    const checked = data.checked, remaining = Math.max(0, data.total - checked);
    c.$('pool-ranking-status').textContent = data.total ? `${checked.toLocaleString()} of ${data.total.toLocaleString()} checked${remaining ? ` · ${remaining.toLocaleString()} still checking` : ''}` : 'No chunks in this roll pool.';
    const list = c.$('pool-ranking-rows'), active = document.activeElement, focusInside = list.contains(active), scroller = panel.parentElement, scrollTop = scroller.scrollTop, listScrollTop = list.scrollTop;
    const ids = new Set(data.rows.map(row => String(row.id)));
    for (const [id, entry] of nodes) if (!ids.has(id)) { entry.node.remove(); nodes.delete(id); }
    for (const row of rankPoolRows(data.rows, sort)) list.append(rowNode(row));
    if (focusInside && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    scroller.scrollTop = scrollTop; list.scrollTop = listScrollTop;
  }

  function close(focus = false) {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-pressed', 'false'); client.setVisible(false);
    if (focus) toggle.focus();
  }
  function refresh() {
    if (!mounted) return;
    toggle.disabled = !!c.sandbox?.active;
    if (c.sandbox?.active) close();
    render(); client.refresh();
  }
  function mount() {
    if (mounted) return; mounted = true;
    toggle.addEventListener('click', () => { if (!panel.hidden) { close(); return; } panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-pressed', 'true'); render(); client.setVisible(true); });
    c.$('pool-ranking-close').addEventListener('click', () => close(true));
    c.$('pool-ranking-sort').addEventListener('change', event => { sort = event.target.value; signature = undefined; render(); });
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) { close(true); event.preventDefault(); } });
    globalThis.addEventListener('pagehide', () => client.dispose());
    refresh();
  }
  c.poolRanking = { mount, refresh, close };
  return c.poolRanking;
}
