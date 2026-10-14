const skillText = value => value ?? 'Not chosen yet';
const allocationText = allocation => Object.entries(allocation ?? {})
  .map(([skill, amount]) => `${Number(amount).toLocaleString()} ${skill} XP`).join(' · ');

/** Reward forms are detached from save state; only Save sends a command. */
export function renderXpChoiceSource(c, row, { canEdit = false, onSave } = {}) {
  const root = c.el('section', undefined, 'xp-choice-source');
  const heading = c.el('h3', (c.plain?.(row.label) ?? row.label).replace(/ Complete the (?:quest|miniquest|subquest)$/i, '').replace(/ Complete the (Beginner|Easy|Medium|Hard|Elite) Achievements$/, ' · $1'));
  root.append(heading);
  if (row.unknownSource) {
    root.append(c.el('p', `Imported choice: ${allocationText(row.importedAllocation)}. This reward source is unknown, so its choices cannot be changed yet.`, 'field-help'));
    return root;
  }
  if (row.ambiguous) root.append(c.el('p', `Imported choice: ${allocationText(row.importedAllocation)}. Choose each reward below to change it.`, 'field-help'));
  if (!row.availableInMode) root.append(c.el('p', 'Members reward. Your saved choice is kept.', 'field-help'));
  const fields = c.el('div', undefined, 'xp-choice-fields'), selects = [];
  for (const slot of row.slots) {
    const amount = `${Number(slot.amount).toLocaleString()} XP`;
    const label = row.slots.length > 1 ? `Reward ${slot.index + 1} · ${amount}` : amount;
    const field = c.el('label', undefined, 'xp-choice-field');
    field.append(c.el('span', label));
    if (canEdit && row.availableInMode) {
      const select = c.el('select'); select.setAttribute('aria-label', `${c.plain?.(row.label) ?? row.label} · ${label}`);
      for (const skill of [null, ...slot.skills]) { const option = c.el('option', skillText(skill)); option.value = skill ?? ''; select.append(option); }
      // An imported selection outside the current rules remains visible until changed.
      if (slot.selection && !slot.skills.includes(slot.selection)) {
        const option = c.el('option', `${slot.selection} (unavailable)`); option.value = slot.selection; option.disabled = true; select.append(option);
      }
      select.value = slot.selection ?? ''; selects.push(select); field.append(select);
    } else field.append(c.el('span', skillText(slot.selection), 'xp-choice-value'));
    fields.append(field);
  }
  root.append(fields);
  if (!selects.length) return root;
  const status = c.el('p', '', 'xp-choice-status'); status.setAttribute('role', 'status');
  const initial = row.slots.map(slot => slot.selection ?? null);
  const choices = () => selects.map(select => select.value || null);
  const save = c.button('Save choices', async () => {
    save.disabled = true; selects.forEach(select => { select.disabled = true; }); status.textContent = 'Saving…';
    try { await onSave(row.id, choices()); status.textContent = 'Saved'; }
    catch (error) { status.textContent = error.status === 409 ? 'Your save changed. Refresh choices and try again.' : `Choices were not saved. ${error.message}`; }
    finally { selects.forEach(select => { select.disabled = false; }); update(); }
  });
  const update = () => { save.disabled = !row.ambiguous && choices().every((skill, index) => skill === initial[index]); };
  selects.forEach(select => select.addEventListener('change', update)); update();
  const actions = c.el('div', undefined, 'xp-choice-actions'); actions.append(save, status); root.append(actions);
  return root;
}

export function createXpChoices(c) {
  async function open(initialMember = c.memberId) {
    c.closeTopMenus?.();
    if (c.sandbox?.active) { c.openDialog('XP choices', c.el('p', 'Exit Sandbox to view saved XP choices.', 'status-detail')); return; }
    const root = c.el('div', undefined, 'xp-choices'), toolbar = c.el('div', undefined, 'xp-choice-toolbar');
    const player = c.el('select'); player.setAttribute('aria-label', 'XP choices player');
    for (const member of c.state.members) { const option = c.el('option', member.name); option.value = member.id; player.append(option); }
    player.value = initialMember;
    const playerLabel = c.el('label'); playerLabel.append(c.el('span', 'Player'), player);
    const search = c.el('input'); search.type = 'search'; search.placeholder = 'Find a lamp or quest'; search.setAttribute('aria-label', 'Find a lamp or quest');
    const searchLabel = c.el('label'); searchLabel.append(c.el('span', 'Source'), search);
    toolbar.append(playerLabel, searchLabel, c.button('Refresh choices', () => load()));
    const intro = c.el('p', 'Choose where each lamp or quest reward goes. Choices update your possible tasks, not your recorded account XP.', 'section-intro');
    const mode = c.el('p', '', 'field-help'), count = c.el('p', '', 'xp-choice-count'), content = c.el('div', undefined, 'xp-choice-list');
    root.append(intro, toolbar, mode, count, content);
    const generation = c.openDialog('XP choices', root);
    let sequence = 0, view, shown = 30, revision;
    const current = request => request === sequence && c.dialogCurrent(generation);
    const editable = () => c.canWrite() && !c.sandbox?.active && (!c.sessionMember || c.sessionMember === player.value);
    function draw() {
      if (!view) return;
      const query = search.value.trim().toLocaleLowerCase();
      const rows = view.rows.filter(row => (!view.f2p || row.availableInMode || row.source !== 'unset')
        && (c.plain?.(row.label) ?? row.label).toLocaleLowerCase().includes(query));
      count.textContent = `${rows.length} ${rows.length === 1 ? 'source' : 'sources'}${query ? ' found' : ''}`;
      mode.textContent = editable() ? (view.f2p ? 'Free-to-play skill choices.' : 'Members skill choices.')
        : c.canWrite() ? 'You can view this player’s choices. Switch to your player to change them.' : 'View only';
      const renderedView = view, renderedRevision = revision, renderedRequest = sequence;
      content.replaceChildren(...rows.slice(0, shown).map(row => renderXpChoiceSource(c, row, {
        canEdit: editable(), onSave: async (taskId, choices) => {
          if (!current(renderedRequest) || !editable() || player.value !== renderedView.memberId) throw new Error('Reopen your player’s XP choices before saving.');
          await c.command({ type: 'set-xp-choices', memberId: renderedView.memberId, taskId, choices }, renderedRevision);
          if (c.dialogCurrent(generation)) await load(false);
        },
      })));
      if (!rows.length) content.append(c.el('p', 'No reward sources found.', 'status-detail'));
      if (rows.length > shown) content.append(c.button('Show more', () => { shown += 30; draw(); }));
    }
    async function load(reset = true) {
      const request = ++sequence, memberId = player.value;
      if (reset) shown = 30;
      view = undefined; content.replaceChildren(c.el('p', 'Loading choices…', 'status-detail')); content.setAttribute('aria-busy', 'true');
      try {
        const response = await c.api(`/api/xp-choices?memberId=${encodeURIComponent(memberId)}`);
        if (!current(request)) return;
        if (response.stateRevision !== c.state.revision) { content.replaceChildren(c.el('p', 'Your save changed. Refresh choices to see the latest choices.', 'status-detail')); return; }
        view = response; revision = response.stateRevision; draw();
      } catch (error) { if (current(request)) content.replaceChildren(c.el('p', `Choices could not be loaded. ${error.message}`, 'status-detail')); }
      finally { if (current(request)) content.setAttribute('aria-busy', 'false'); }
    }
    search.addEventListener('input', () => { shown = 30; draw(); }); player.addEventListener('change', load);
    await load();
    return root;
  }
  c.openXpChoices = open;
  return { open };
}
