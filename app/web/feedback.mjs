// Feedback lives outside the gameplay save. Seen IDs are acknowledged only after
// rows are displayed, so arrivals racing an open dialog keep their badge.
const issueRoot = 'https://github.com/fenerax/chunk-picker-rs3/issues/';
const publicContextKeys = ['dialog', 'tool', 'taskId', 'task', 'dataset', 'datasetVersion'];
export function publicIssueDraft(item) {
  // Never serialize the report: identities and arbitrary context stay private.
  const privateValues = [...Object.values(item.from ?? {}), ...Object.entries(item.context ?? {})
    .filter(([key]) => !publicContextKeys.includes(key)).map(([, value]) => value)]
    .filter(value => typeof value === 'string' && value.length).sort((a, b) => b.length - a.length);
  const clean = value => {
    let text = String(value ?? '');
    for (const value of privateValues) text = text.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]');
    return text.replace(/https?:\/\/[^\s<>]+|(?:\/|%2f)join(?:\/|%2f)[^\s<>]+/gi, '[link redacted]')
      .replace(/\b(map\s*(?:code|id))\s*[:=]?\s*[a-z0-9_-]+/gi, '$1 [redacted]');
  };
  const kind = ({ bug: 'Bug', idea: 'Idea', other: 'Other' })[item.kind] ?? 'Other';
  const text = clean(item.text);
  const context = publicContextKeys.filter(key => item.context?.[key] !== undefined)
    .map(key => `${key}: ${clean(item.context[key])}`).join('\n');
  return { title: `${kind}: ${text.split('\n')[0]}`.slice(0, 160), body: `Kind: ${kind}\n\n${text}${context ? `\n\nContext\n${context}` : ''}` };
}

export function githubIssueForm(title, body) {
  const publicTitle = String(title).slice(0, 160).toWellFormed(), points = Array.from(String(body).toWellFormed());
  const url = text => `${issueRoot}new?title=${encodeURIComponent(publicTitle)}&body=${encodeURIComponent(text)}`;
  let result = points.join('');
  if (url(result).length > 8000) {
    const note = '\n\n[Body truncated to fit the GitHub issue form URL. Review before submitting.]';
    let low = 0, high = points.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (url(points.slice(0, mid).join('') + note).length <= 8000) low = mid; else high = mid - 1;
    }
    result = points.slice(0, low).join('') + note;
  }
  return { title: publicTitle, body: result, url: url(result) };
}

export function createFeedback({ api, el, button, input, field, openDialog, dialogCurrent, notice, context = () => ({}), isAdmin = () => false, isReadOnly = () => false, advanced = () => false,
  entryButton, streamSafe, document = globalThis.document, setInterval: poll = globalThis.setInterval, clearInterval: cancelPoll = globalThis.clearInterval }) {
  const kinds = [['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']];
  const safe = value => streamSafe?.safeText ? streamSafe.safeText(value) : String(value).replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]');
  let session, unread = 0, started = false, paused = false, timer, pending, epoch = 0, panel, unsubscribe, seenVersion = 0;
  let ackQueue = Promise.resolve();
  let draft, resetForm, resetReview;
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
  function clearDraft() { draft = undefined; resetForm?.(); }
  function stop() { pause(); clearDraft(); resetReview?.(); resetForm = undefined; epoch++; panel = undefined; }
  function setSession(value) {
    clearDraft(); resetReview?.(); resetForm = undefined;
    session = value; epoch++; acknowledged.clear(); unread = 0; panel = undefined; renderBadge();
    if (started) void Promise.resolve(pending).then(() => { if (started) onVisible(); });
  }
  renderBadge();

  function sendForm(current, origin) {
    const captured = epoch;
    const form = el('form', undefined, 'form-stack feedback-form');
    const kindRow = el('div', undefined, 'feedback-kinds'); kindRow.setAttribute('role', 'radiogroup'); kindRow.setAttribute('aria-label', 'Kind of feedback');
    const choices = kinds.map(([value, label]) => {
      const choice = input('radio'); choice.name = 'feedback-kind'; choice.value = value; choice.checked = value === (draft?.kind ?? 'bug');
      const chip = el('label', undefined, 'feedback-kind');
      chip.append(choice, el('span', label, 'filter-chip')); kindRow.append(chip);
      return choice;
    });
    const text = el('textarea', undefined, 'feedback-text'); text.rows = 5; text.maxLength = 4000;
    text.value = draft?.text ?? '';
    text.placeholder = 'What happened, or what would you like? For a bug, say what you clicked and what you expected.';
    const include = input('checkbox'); include.checked = draft?.include ?? true;
    const includeLabel = el('label', undefined, 'checkbox-field'); includeLabel.append(include, el('span', 'Include what I’m looking at (open chunk, tab, player, screen size)'));
    const send = el('button', 'Send feedback', 'primary-action'); send.type = 'submit';
    const status = el('p', undefined, 'status-detail'); status.setAttribute('role', 'status');
    resetForm = () => {
      text.value = ''; choices.forEach(choice => { choice.checked = choice.value === 'bug'; });
      include.checked = true; status.textContent = '';
    };
    const remember = () => {
      if (captured !== epoch || !current()) return;
      draft = { text: text.value, kind: choices.find(choice => choice.checked).value, include: include.checked, context: origin, taskDraft: draft?.taskDraft };
    };
    text.addEventListener('input', remember);
    choices.forEach(choice => choice.addEventListener('change', remember));
    include.addEventListener('change', remember);
    const discard = button('Discard draft', () => {
      if (captured !== epoch || !current()) return;
      clearDraft(); status.textContent = 'Draft discarded.'; text.focus?.();
    });
    discard.type = 'button';
    form.append(kindRow, field('Your feedback', text), includeLabel, send, discard, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (send.disabled || readOnly() || captured !== epoch || !current()) return;
      if (!text.value.trim()) { status.textContent = 'Write something before sending.'; text.focus?.(); return; }
      remember(); const submitted = draft;
      send.disabled = true; status.textContent = 'Sending…';
      try {
        await api('/api/feedback', { kind: submitted.kind, text: submitted.text.trim(), ...(submitted.include ? { context: origin } : {}) });
        if (captured !== epoch) return;
        // Navigation keeps the draft identity; editing creates a newer draft.
        if (draft === submitted) clearDraft();
        if (!current()) return;
        status.textContent = 'Thanks, it’s been sent.';
        notice?.('Feedback sent. Thank you!');
        void refresh();
      } catch (error) { if (current() && captured === epoch) status.textContent = safe(error.message || String(error)); }
      finally { if (current() && captured === epoch) send.disabled = false; }
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
    const edits = new Map(), canReview = () => current() && captured === epoch && admin() && !readOnly();
    resetReview = () => { edits.clear(); list.replaceChildren(); };
    const externalLink = (label, href) => {
      const link = el('a', label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
    };
    const issueEditor = item => {
      const edit = edits.get(item.id), box = el('section', undefined, 'form-stack');
      box.append(el('p', 'Review every word for player names, identities, map codes and save details. Previewing sends nothing. GitHub opens a form; you decide whether to submit it.', 'field-help'));
      const title = input('text'); title.className = 'feedback-issue-title'; title.maxLength = 160; title.value = edit.title;
      const body = el('textarea', undefined, 'feedback-issue-body'); body.rows = 8; body.value = edit.body;
      const preview = el('div', undefined, 'form-stack');
      const paintPreview = () => {
        preview.replaceChildren(); if (!edit.preview) return;
        const link = externalLink('Open GitHub issue form', edit.preview.url);
        link.addEventListener('click', event => { if (!canReview()) event.preventDefault(); });
        preview.append(el('h4', edit.preview.title), el('p', edit.preview.body, 'feedback-body'), link);
      };
      for (const control of [title, body]) control.addEventListener('input', () => {
        if (!canReview()) return;
        edit.title = title.value; edit.body = body.value; delete edit.preview; paintPreview();
      });
      box.append(field('Public title', title), field('Public body', body), button('Preview public draft', () => {
        if (!canReview()) return;
        edit.preview = githubIssueForm(title.value, body.value); paintPreview();
      }), preview);
      paintPreview();
      const issue = input('url'); issue.className = 'feedback-issue-url'; issue.value = edit.issueUrl;
      issue.addEventListener('input', () => { if (canReview()) edit.issueUrl = issue.value; });
      const status = el('p', undefined, 'status-detail'); status.setAttribute('role', 'status');
      const record = button('Record issue link', async () => {
        if (!canReview() || record.disabled) return;
        record.disabled = true;
        try {
          const response = await api(`/api/feedback/${encodeURIComponent(item.id)}/issue`, { issueUrl: issue.value });
          if (!canReview()) return;
          edits.delete(item.id); items = items.map(value => value.id === item.id ? response.item : value); render(false);
        } catch (error) { if (canReview()) status.textContent = safe(error.message || String(error)); }
        finally { record.disabled = false; }
      });
      box.append(field('Existing GitHub issue URL', issue), el('p', 'Record a submitted or existing issue. This does not mark the report handled.', 'field-help'), record, status,
        button('Close issue draft', () => { if (canReview()) { edits.delete(item.id); render(false); } }));
      return box;
    };
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
        if (typeof item.issueUrl === 'string' && /^https:\/\/github\.com\/fenerax\/chunk-picker-rs3\/issues\/[1-9]\d*$/.test(item.issueUrl) && !/\s/.test(item.issueUrl)) row.append(externalLink('GitHub issue', item.issueUrl));
        if (advanced() && item.context && !streamSafe?.enabled?.()) row.append(el('p', safe(Object.entries(item.context).map(([key, value]) => `${key}: ${value}`).join(' · ')), 'feedback-context'));
        if (all) {
          row.append(button('Prepare GitHub issue', () => {
            if (!canReview()) return;
            if (!edits.has(item.id)) edits.set(item.id, { ...publicIssueDraft(item), issueUrl: item.issueUrl ?? '' });
            render(false);
          }));
          if (edits.has(item.id)) row.append(issueEditor(item));
        }
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

  function open(options = {}) {
    if (readOnly()) return;
    // Snapshot before Feedback replaces the tool, including task-supplied context.
    const requestedOrigin = structuredClone(options.context ?? context());
    const conflict = options.text && draft?.text.trim();
    if (options.text && !conflict) draft = { text: options.text, kind: 'bug', include: true, context: requestedOrigin, taskDraft: true };
    const origin = (conflict || draft?.taskDraft) ? draft.context : requestedOrigin;
    const content = el('div', undefined, 'form-stack');
    content.append(el('p', 'Found a bug or want something added? Send it here; the owner sees it in this same window.', 'section-intro'));
    let generation; const openedEpoch = epoch;
    const current = () => dialogCurrent(generation);
    if (conflict) {
      content.append(el('p', 'Your unsent feedback draft is still here. Replace it to start this task report, or keep working on it.', 'field-help'));
      const replace = button('Replace draft with task report', () => {
        if (!current() || openedEpoch !== epoch) return;
        clearDraft(); open({ ...options, context: requestedOrigin });
      });
      replace.type = 'button'; content.append(replace);
    }
    content.append(sendForm(current, origin));
    content.append(receivedList(current));
    generation = openDialog('Feedback', content);
    content.querySelector?.('textarea')?.focus?.();
  }
  return { open, refresh, start, pause, stop, setSession };
}
