// Feedback lives outside the gameplay save. Seen IDs are acknowledged only after
// rows are displayed, so arrivals racing an open dialog keep their badge.
export function createFeedback({ api, el, button, input, field, openDialog, dialogCurrent, notice, context = () => ({}), isAdmin = () => false, isReadOnly = () => false, advanced = () => false,
  entryButton, streamSafe, document = globalThis.document, setInterval: poll = globalThis.setInterval, clearInterval: cancelPoll = globalThis.clearInterval }) {
  const kinds = [['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']];
  const safe = value => streamSafe?.safeText ? streamSafe.safeText(value) : String(value).replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]');
  let session, unread = 0, started = false, paused = false, timer, pending, epoch = 0, panel, unsubscribe, seenVersion = 0;
  let ackQueue = Promise.resolve();
  const acknowledged = new Set();
  const admin = () => session?.admin ?? isAdmin();
  const readOnly = () => session?.readOnly ?? isReadOnly();
  const badge = entryButton ? el('span', undefined, 'feedback-badge') : null;
  if (badge) { badge.setAttribute('aria-hidden', 'true'); entryButton.append(badge); }
  function renderBadge() {
    if (!badge) return;
    badge.hidden = readOnly() || !admin() || !unread;
    badge.textContent = String(unread);
    entryButton.setAttribute('aria-label', !badge.hidden ? `Feedback, ${unread} unread` : 'Feedback');
    entryButton.hidden = readOnly();
  }
  function acknowledge(ids, current, captured = epoch) {
    // Serialize acknowledgments so an older response cannot overwrite a newer
    // unread count; recalculate IDs when admitted to avoid duplicate writes.
    const operation = ackQueue.then(async () => {
      const fresh = [...new Set(ids)].filter(id => !acknowledged.has(id));
      // UUID batches stay below the feedback API's 16 KiB body limit, even for
      // the full retained inbox. Successful batches survive a later failure.
      for (let offset = 0; offset < fresh.length; offset += 256) {
        if (!current() || captured !== epoch || paused || document?.visibilityState === 'hidden') return;
        const batch = fresh.slice(offset, offset + 256);
        seenVersion++;
        const response = await api('/api/feedback/seen', { ids: batch });
        if (captured !== epoch) return;
        seenVersion++;
        for (const id of batch) acknowledged.add(id);
        unread = response.unread ?? unread; renderBadge();
      }
    });
    ackQueue = operation.catch(() => {});
    return operation;
  }
  async function refresh() {
    if (paused) return;
    if (readOnly()) { unread = 0; renderBadge(); return; }
    if (pending) return pending;
    const captured = epoch;
    pending = (async () => {
      try {
        if (admin()) {
          const version = seenVersion;
          const summary = await api('/api/feedback/summary');
          if (captured !== epoch) return;
          if (version === seenVersion) { unread = summary.unread ?? 0; renderBadge(); }
        }
        if (panel && !panel.current()) panel = undefined;
        if (captured === epoch && !paused && panel) await panel.load();
      } catch { /* The next visible refresh retries; keep the last known badge. */ }
    })().finally(() => { pending = undefined; });
    return pending;
  }
  const onVisible = () => { if (document?.visibilityState !== 'hidden') void refresh(); };
  function start() {
    renderBadge(); if (started) return;
    started = true; paused = false;
    void Promise.resolve(pending).then(() => { if (started) onVisible(); });
    timer = poll(onVisible, 60000);
    document?.addEventListener?.('visibilitychange', onVisible);
    unsubscribe = streamSafe?.subscribe?.(() => panel?.repaint());
    panel?.repaint();
  }
  // A page restored from BFCache keeps its dialog DOM and form closures. Suspend
  // listeners without invalidating them; start repaints with current privacy mode.
  function pause() {
    if (timer !== undefined) cancelPoll(timer);
    timer = undefined; started = false; paused = true;
    document?.removeEventListener?.('visibilitychange', onVisible);
    unsubscribe?.(); unsubscribe = undefined;
  }
  function stop() { pause(); epoch++; panel = undefined; }
  function setSession(value) {
    session = value; epoch++; acknowledged.clear(); unread = 0; panel = undefined; renderBadge();
    if (started) void Promise.resolve(pending).then(() => { if (started) onVisible(); });
  }
  renderBadge();

  function sendForm(current) {
    const captured = epoch;
    const form = el('form', undefined, 'form-stack feedback-form');
    const kindRow = el('div', undefined, 'feedback-kinds'); kindRow.setAttribute('role', 'radiogroup'); kindRow.setAttribute('aria-label', 'Kind of feedback');
    let kind = 'bug';
    const chips = kinds.map(([value, label]) => {
      const chip = button(label, () => { kind = value; for (const other of chips) other.setAttribute('aria-pressed', String(other === chip)); text.focus?.(); }, 'filter-chip');
      chip.type = 'button'; chip.setAttribute('aria-pressed', String(value === kind)); return chip;
    });
    kindRow.append(...chips);
    const text = el('textarea', undefined, 'feedback-text'); text.rows = 5; text.maxLength = 4000;
    text.placeholder = 'What happened, or what would you like? For a bug, say what you clicked and what you expected.';
    const include = input('checkbox'); include.checked = true;
    const includeLabel = el('label', undefined, 'checkbox-field'); includeLabel.append(include, el('span', 'Include what I’m looking at (open chunk, tab, player, screen size)'));
    const send = el('button', 'Send feedback', 'primary-action'); send.type = 'submit';
    const status = el('p', undefined, 'status-detail'); status.setAttribute('role', 'status');
    form.append(kindRow, field('Your feedback', text), includeLabel, send, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (send.disabled || readOnly() || captured !== epoch || !current()) return;
      if (!text.value.trim()) { status.textContent = 'Write something before sending.'; text.focus?.(); return; }
      send.disabled = true; status.textContent = 'Sending…';
      try {
        await api('/api/feedback', { kind, text: text.value.trim(), ...(include.checked ? { context: context() } : {}) });
        if (!current()) return;
        text.value = ''; status.textContent = 'Thanks, it’s been sent.';
        notice?.('Feedback sent. Thank you!');
        void refresh();
      } catch (error) { if (current()) status.textContent = safe(error.message || String(error)); }
      finally { if (current()) send.disabled = false; }
    });
    return form;
  }

  function receivedList(current) {
    const all = admin(), captured = epoch;
    const box = el('section', undefined, 'form-stack feedback-received');
    const heading = el('h3', all ? 'Received' : 'Your feedback'), list = el('div', undefined, 'feedback-list'), showDone = input('checkbox');
    const toggle = el('label', undefined, 'checkbox-field'); toggle.append(showDone, el('span', 'Show handled'));
    box.append(heading); if (all) box.append(toggle); box.append(list);
    let items = [];
    const render = (markSeen = true) => {
      if (!current() || captured !== epoch) return;
      const shown = items.filter(item => !all || showDone.checked || item.status !== 'done');
      heading.textContent = all ? `Received (${items.filter(item => item.status !== 'done').length} open)` : 'Your feedback';
      list.replaceChildren(...(shown.length ? shown.map(item => {
        const row = el('article', undefined, `feedback-item is-${item.kind}${item.status === 'done' ? ' is-done' : ''}`);
        const when = new Date(item.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const sender = streamSafe?.enabled?.() ? 'Sender' : safe(item.from?.label ?? 'Unknown');
        const meta = el('p', `${kinds.find(([value]) => value === item.kind)?.[1] ?? item.kind}${all ? ` · ${sender}` : ''} · ${when}`, 'feedback-meta');
        if (item.status === 'done') meta.append(el('span', 'Handled', 'feedback-handled'));
        row.append(meta, el('p', safe(item.text), 'feedback-body'));
        if (advanced() && item.context && !streamSafe?.enabled?.()) row.append(el('p', safe(Object.entries(item.context).map(([key, value]) => `${key}: ${value}`).join(' · ')), 'feedback-context'));
        const next = item.status === 'done' ? 'new' : 'done';
        if (all) row.append(button(item.status === 'done' ? 'Reopen' : 'Mark handled', async () => {
          if (!current() || captured !== epoch || readOnly() || !admin()) return;
          try {
            const response = await api(`/api/feedback/${encodeURIComponent(item.id)}/status`, { status: next });
            if (!current() || captured !== epoch) return;
            items = items.map(value => value.id === item.id ? response.item : value); render();
          } catch (error) { if (current()) notice?.(safe(error.message || String(error))); }
        }, 'feedback-done'));
        return row;
      }) : [el('p', !all || showDone.checked ? 'No feedback yet.' : 'Nothing open.', 'empty-list')]));
      if (markSeen) void acknowledge(shown.map(item => item.id), current, captured).catch(() => {});
    };
    showDone.addEventListener('change', () => render());
    list.append(el('p', 'Loading…', 'status-detail'));
    const load = async () => {
      try {
        const value = await api(all ? '/api/feedback' : '/api/feedback/own');
        if (!current() || captured !== epoch) return;
        items = value.items ?? []; render();
      } catch (error) { if (current() && captured === epoch) list.replaceChildren(el('p', safe(error.message || String(error)), 'error')); }
    };
    panel = { current, load, repaint: () => render(false) };
    void load();
    return box;
  }

  function open() {
    if (readOnly()) return;
    const content = el('div', undefined, 'form-stack');
    content.append(el('p', 'Found a bug or want something added? Send it here; the owner sees it in this same window.', 'section-intro'));
    let generation;
    const current = () => dialogCurrent(generation);
    content.append(sendForm(current));
    content.append(receivedList(current));
    generation = openDialog('Feedback', content);
    content.querySelector?.('textarea')?.focus?.();
  }
  return { open, refresh, start, pause, stop, setSession };
}
