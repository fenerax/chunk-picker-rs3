// Generated overlay URLs stay in this closure; the DOM only receives metadata.
export function createOverlayPanel({ api, el, button, openDialog, dialogCurrent, dialog, members = () => [], clipboard = globalThis.navigator?.clipboard }) {
  let secret, secretSection, lifetime = 0, panelEpoch = 0;
  const clearSecret = () => { secret = undefined; secretSection?.remove(); secretSection = undefined; lifetime++; };
  const dismiss = () => { panelEpoch++; clearSecret(); };
  dialog.addEventListener('close', dismiss);
  dialog.addEventListener('cancel', dismiss);
  const widgetNames = { goals: 'Active goals', roll: 'Last roll', count: 'Chunk count' };
  const sourceSizes = { goals: '600 × 360', roll: '600 × 180', count: '460 × 120' };
  const goalNames = { personal: 'Personal pins', group: 'Group goals', both: 'Both' };
  const playerName = id => id === 'duo' ? 'Both players' : members().find(member => member.id === id)?.name ?? 'Player';
  const title = link => `${widgetNames[link.widget] ?? 'Overlay'} · ${playerName(link.player)}${link.widget === 'goals' && link.goals && link.goals !== 'personal' ? ` · ${goalNames[link.goals]}` : ''}`;
  const date = value => {
    const parsed = new Date(value);
    return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
  };

  async function open() {
    clearSecret();
    const openedEpoch = ++panelEpoch;
    const content = el('div', undefined, 'overlay-panel form-stack');
    const message = el('p', 'Loading overlay links…', 'status-detail');
    message.setAttribute('role', 'status'); content.append(message);
    const generation = openDialog('OBS overlays', content);
    const current = () => openedEpoch === panelEpoch && dialogCurrent(generation);
    const report = (text, error = false) => { message.textContent = text; message.className = error ? 'error' : 'status-detail'; message.hidden = false; };
    let links;
    try {
      const listing = await api('/api/overlays');
      if (!current()) return;
      links = listing.links;
    } catch {
      if (current()) { report('Overlay links could not be loaded. Try again.', true); content.append(button('Retry', open)); }
      return;
    }
    const intro = el('p', 'Add a browser source in OBS, then paste a copied overlay link into its URL field. The background is transparent and updates appear automatically.', 'section-intro');
    const privacy = el('p', 'Each link shows only the overlay and players you choose. Keep it private. Copy a new link before closing this dialog; saved links cannot be copied again.', 'field-help');
    const rows = el('div', undefined, 'overlay-links');
    content.replaceChildren(intro, privacy, message);
    message.hidden = true;

    function renderRows() {
      rows.replaceChildren(el('h3', 'Saved links'));
      if (!links.length) { rows.append(el('p', 'No overlay links yet.', 'empty-list')); return; }
      for (const link of links) {
        const row = el('section', undefined, 'overlay-link-row');
        const head = el('div', undefined, 'overlay-link-head');
        const details = el('div', undefined, 'overlay-link-details');
        details.append(el('h4', title(link)), el('p', `${link.revoked ? 'Revoked' : 'Active'} · Created ${date(link.createdAt)}`, 'overlay-link-meta'));
        head.append(details); row.append(head);
        if (!link.revoked) {
          const revoke = button('Revoke', () => {
            if (!current()) return;
            revoke.hidden = true;
            const confirmation = el('div', undefined, 'overlay-confirmation form-stack');
            confirmation.append(el('p', 'Revoke this link? OBS sources using it will stop updating. This cannot be undone.'));
            const actions = el('div', undefined, 'overlay-actions');
            const cancel = button('Cancel', () => { confirmation.remove(); revoke.hidden = false; revoke.focus(); });
            const confirm = button('Revoke link', async () => {
              if (!current() || confirm.disabled) return;
              confirm.disabled = cancel.disabled = true;
              try {
                const response = await api(`/api/overlays/${encodeURIComponent(link.id)}/revoke`, {});
                if (!current()) return;
                links = links.map(item => item.id === link.id ? response.overlay ?? { ...item, revoked: true } : item);
                if (secret?.id === link.id) clearSecret();
                renderRows(); report('Overlay link revoked.');
              } catch { if (current()) report('The link could not be revoked. Try again.', true); }
              finally { if (current()) confirm.disabled = cancel.disabled = false; }
            });
            actions.append(cancel, confirm); confirmation.append(actions); row.append(confirmation); cancel.focus();
          });
          revoke.setAttribute('aria-label', `Revoke ${title(link)} link`); head.append(revoke);
        }
        rows.append(row);
      }
    }

    const form = el('form', undefined, 'overlay-create form-stack');
    const choices = el('div', undefined, 'overlay-choices');
    const fields = new Map();
    function select(label, options, initial) {
      const control = el('select'); control.setAttribute('aria-label', label);
      for (const [value, text] of options) { const option = el('option', text); option.value = value; control.append(option); }
      control.value = initial;
      const field = el('label'); field.append(el('span', label), control); choices.append(field);
      fields.set(label, field);
      return control;
    }
    const widget = select('Overlay', Object.entries(widgetNames), 'goals');
    const goals = select('Show goals', Object.entries(goalNames), 'personal');
    const player = select('Players', [['duo', 'Both players'], ...members().map(member => [member.id, member.name])], 'duo');
    const variant = select('Layout', [['full', 'Full'], ['compact', 'Compact']], 'full');
    const size = select('Text size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'medium');
    const sizing = el('p', undefined, 'field-help');
    const goalHelp = el('p', 'Group goals include both players. The Players choice applies to personal pins.', 'field-help');
    let groupOnly = false, personalPlayer = player.value;
    const updateGoals = () => {
      fields.get('Show goals').hidden = widget.value !== 'goals';
      goalHelp.hidden = widget.value !== 'goals' || goals.value === 'personal';
      const nextGroupOnly = widget.value === 'goals' && goals.value === 'group';
      if (nextGroupOnly && !groupOnly) personalPlayer = player.value;
      if (nextGroupOnly) player.value = 'duo';
      else if (groupOnly) player.value = personalPlayer;
      player.disabled = groupOnly = nextGroupOnly;
    };
    widget.addEventListener('change', updateGoals); goals.addEventListener('change', updateGoals); updateGoals();
    const updateSizing = () => { sizing.textContent = `Recommended OBS source size: ${sourceSizes[widget.value]} pixels. Adjust the source size to fit your scene.`; };
    widget.addEventListener('change', updateSizing); updateSizing();
    const create = el('button', 'Create overlay link', 'primary-action'); create.type = 'submit';
    form.append(el('h3', 'New overlay link'), choices, goalHelp, sizing, create);
    let creating = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (creating || !current()) return;
      clearSecret(); creating = true;
      const controls = [create, widget, goals, player, variant, size]; controls.forEach(control => { control.disabled = true; });
      try {
        const response = await api('/api/overlays', { widget: widget.value,
          player: widget.value === 'goals' && goals.value === 'group' ? 'duo' : player.value,
          variant: variant.value, size: size.value, ...(widget.value === 'goals' ? { goals: goals.value } : {}),
        });
        if (!current()) return;
        links = [...links.filter(link => link.id !== response.overlay.id), response.overlay]; renderRows();
        secret = { id: response.overlay.id, value: response.link };
        const capturedLifetime = lifetime;
        const section = el('section', undefined, 'overlay-new-link form-stack');
        const copyStatus = el('p', undefined, 'status-detail'); copyStatus.setAttribute('role', 'status');
        const copy = button('Copy link', async () => {
          if (!current() || lifetime !== capturedLifetime || !secret || copy.disabled) return;
          copy.disabled = true;
          try {
            if (!clipboard?.writeText) throw new Error();
            await clipboard.writeText(secret.value);
            if (current() && lifetime === capturedLifetime) copyStatus.textContent = 'Link copied. Paste it into your OBS browser source.';
          } catch {
            if (current() && lifetime === capturedLifetime) copyStatus.textContent = 'The link could not be copied. Allow clipboard access in your browser and try again.';
          } finally { if (current() && lifetime === capturedLifetime) copy.disabled = false; }
        });
        section.append(el('h3', 'New link ready'), el('p', 'Link hidden', 'overlay-link-mask'),
          el('p', 'Copy this link now. Closing this dialog or creating another link clears it.', 'field-help'), copy, copyStatus);
        secretSection = section; form.after ? form.after(section) : content.append(section);
        copy.focus(); report('Overlay link created.');
      } catch { if (current()) report('The overlay link could not be created. Try again.', true); }
      finally { creating = false; if (current()) { controls.forEach(control => { control.disabled = false; }); updateGoals(); } }
    });
    content.append(form, rows); renderRows();
  }
  return { open };
}
