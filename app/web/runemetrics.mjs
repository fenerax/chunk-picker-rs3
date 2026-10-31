const number = value => Number(value).toLocaleString('en-CA', { maximumFractionDigits: 3 });
const time = value => value ? new Date(value).toLocaleString() : 'never';
const refreshRequired = 'Saved state changed. Fetch a new progress preview and review it before applying.';

function change(before, after) {
  if (before == null || before === after) return '';
  const difference = after - before;
  return ` (${difference < 0 ? '−' : '+'}${number(Math.abs(difference))})`;
}

export function skillChangeText(row) {
  const before = row.before;
  return `${row.skill}: level ${before == null ? 'unknown' : number(before.level)} → ${number(row.after.level)}${change(before?.level, row.after.level)} · XP ${before == null ? 'unknown' : number(before.xp)} → ${number(row.after.xp)}${change(before?.xp, row.after.xp)}`;
}

// All network work is on demand. A preview is tied to this member and dialog;
// applying it remains a separate, explicit action through the shared save queue.
export function createRuneMetricsControls(context, { memberId, isCurrent, onApplied, onNameSaved = onApplied }) {
  const { el, button, field, list } = context;
  const advanced = () => context.canWrite?.() !== false && context.preferences?.()?.advanced === true;
  const owner = context.state().members.find(member => member.id === memberId);
  const revision = context.state().revision;
  const root = el('section', undefined, 'dialog-section form-stack runemetrics-controls'), status = el('p', undefined, 'info-meta'), review = el('div', undefined, 'form-stack');
  root.setAttribute('aria-label', `progress for ${owner.name}`);
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const account = el('input'); account.type = 'text'; account.value = owner.runescapeName ?? ''; account.maxLength = 12; account.autocomplete = 'off';
  let serial = 0, busy = false, preview, controller;
  const current = () => isCurrent() && context.memberId() === memberId && context.state().members.some(member => member.id === memberId);
  const active = request => current() && request === serial;
  const setStatus = (message, failed = false) => { status.textContent = message; status.className = failed ? 'warning' : 'info-meta'; };
  const setBusy = value => { busy = value; saveName.disabled = fetchPreview.disabled = account.disabled = value; };
  const discard = () => { serial++; controller?.abort(); controller = undefined; preview = undefined; review.replaceChildren(); setBusy(false); setStatus('Preview cancelled.'); };
  const savedAccount = () => context.state().members.find(member => member.id === memberId)?.runescapeName ?? '';
  const saveName = button('Save RuneScape name', async () => {
    if (!current() || busy) return;
    const name = account.value.trim();
    if (!name) { setStatus('Enter this player’s RuneScape account name.', true); return; }
    const request = ++serial; preview = undefined; review.replaceChildren(); setBusy(true);
    try {
      await context.command({ type: 'set-runescape-name', memberId, name }, revision);
      if (!active(request)) return;
      setStatus('RuneScape account name saved.');
      await onNameSaved?.();
    } catch (error) { if (active(request)) setStatus(error.message || String(error), true); }
    finally { if (active(request)) setBusy(false); }
  });

  function renderPreview(value) {
    preview = value;
    const content = el('section', undefined, 'form-stack runemetrics-preview');
    content.append(el('h4', `Review ${value.sourceLabel ?? 'RuneMetrics'} for ${owner.name} · ${value.runescapeName}`),
      el('p', `Source: ${value.sourceLabel ?? 'RuneMetrics'}`, 'info-meta'),
      el('p', `Fetched ${time(value.fetchedAt)}${value.cached ? ' · recent saved result' : ''}${advanced() ? ` · Saved revision ${value.stateRevision}` : ''}`, 'info-meta'),
      el('p', `${value.counts.completedQuests} completed quests returned · ${value.counts.matchedQuests} matched · ${value.counts.unmatchedQuests} unmatched`, 'info-meta'),
      el('h5', `Observed skill changes (${value.skills.length})`));
    if (value.skills.length) {
      const rows = el('ul');
      for (const skill of value.skills) {
        const decrease = skill.before && (skill.after.level < skill.before.level || skill.after.xp < skill.before.xp);
        rows.append(el('li', skillChangeText(skill), decrease ? 'warning' : undefined));
      }
      content.append(rows);
    } else content.append(el('p', 'Saved levels and XP already match this snapshot.', 'info-meta'));
    content.append(el('h5', `New personal quest completions (${value.quests.length})`));
    content.append(value.quests.length ? list(value.quests.map(quest => quest.title === context.plain(quest.label) ? quest.title : `${quest.title} → ${context.plain(quest.label)}`)) : el('p', 'No new personal quest completions.', 'info-meta'));
    content.append(el('h5', `Unmatched skills (${value.unmatched.skills.length})`));
    content.append(value.unmatched.skills.length ? list(value.unmatched.skills.map(skill => `${skill.skill ?? skill.name ?? (advanced() ? `Skill ID ${skill.id}` : 'Unknown skill')}${skill.level == null ? '' : ` · reported level ${skill.level}`}${advanced() && skill.reason ? ` · ${skill.reason}` : ''}`)) : el('p', 'All returned skills matched.', 'info-meta'));
    content.append(el('h5', `Unmatched completed quests (${value.unmatched.quests.length})`));
    content.append(value.unmatched.quests.length ? list(value.unmatched.quests.map(quest => `${quest.title} · ${advanced() ? quest.reason : 'Could not match this to a quest completion in this app.'}`)) : el('p', 'All completed quests matched.', 'info-meta'));
    content.append(el('p', 'Apply saves your levels, XP, the listed completed quests and the sync date. Skills and quests that could not be matched are skipped.', 'info-meta'));
    const cancel = button('Cancel preview', () => { if (current() && !busy) discard(); });
    const apply = button('Apply progress snapshot', async () => {
      if (!current() || busy || preview !== value) return;
      if (context.state().revision !== value.stateRevision || savedAccount() !== value.runescapeName) { apply.disabled = true; setStatus(refreshRequired, true); return; }
      const request = serial; setBusy(true); apply.disabled = cancel.disabled = true; setStatus('Applying reviewed progress snapshot…');
      try {
        await context.applyRuneMetrics(value.previewId, value.stateRevision);
        if (!active(request)) return;
        preview = undefined; review.replaceChildren(); setStatus('Progress snapshot applied.');
        await onApplied?.();
      } catch (error) {
        if (!active(request)) return;
        setStatus(error.status === 409 ? refreshRequired : error.message || String(error), true);
        // Rejected or interrupted applies always need a freshly reviewed token.
        preview = undefined;
      } finally { if (active(request)) { setBusy(false); cancel.disabled = false; } }
    });
    if (context.state().revision !== value.stateRevision || savedAccount() !== value.runescapeName) { apply.disabled = true; setStatus(refreshRequired, true); }
    else setStatus(value.message ?? 'Review the proposed changes, then Apply or Cancel.');
    const actions = el('div', undefined, 'form-actions'); actions.append(apply, cancel);
    content.append(actions); review.replaceChildren(content);
  }

  const fetchPreview = button('Sync progress', async () => {
    if (!current() || busy) return;
    const name = savedAccount();
    if (account.value.trim() !== name) { setStatus('Save this player’s RuneScape account name before fetching a preview.', true); return; }
    const request = ++serial; controller?.abort(); controller = new AbortController(); preview = undefined; setBusy(true);
    setStatus(`Fetching a progress snapshot for ${name}…`);
    review.replaceChildren(button('Cancel preview', () => { if (current()) discard(); }));
    try {
      const value = await context.api('/api/runemetrics/preview', { memberId }, controller.signal);
      if (!active(request)) return;
      if (value.memberId !== memberId || value.runescapeName !== name) throw new Error('The account changed while fetching. Refresh Activity Info before reviewing progress.');
      if (value.available === false) { review.replaceChildren(); setStatus(value.message); return; }
      renderPreview(value);
    } catch (error) {
      if (active(request)) { review.replaceChildren(); setStatus(error.message || String(error), true); }
    } finally { if (active(request)) { controller = undefined; setBusy(false); } }
  });
  account.addEventListener('input', () => { serial++; preview = undefined; review.replaceChildren(); setStatus('Save the edited account name before fetching a preview.'); });
  const help = el('p', 'Sync your levels and completed quests from the game plugin or the web, review the changes, then apply them as personal progress.', 'field-help');
  help.id = `runemetrics-help-${memberId}`; account.setAttribute('aria-describedby', help.id);
  const accountField = field('RuneScape account name', account); accountField.className = 'form-field';
  const actions = el('div', undefined, 'form-actions'); actions.append(saveName, fetchPreview);
  root.setAttribute('aria-label', 'Progress sync');
  // The dialog title or the Activity Info section already names it.
  root.append(
    el('p', `${owner.name} · Last applied web snapshot: ${time(owner.runeMetricsSync?.fetchedAt)}${owner.runeMetricsSync?.runescapeName ? ` · ${owner.runeMetricsSync.runescapeName}` : ''}`, 'info-meta'),
    help, accountField, actions, status, review);
  return root;
}
