import { createPrivateLink } from './stream-safe.mjs';

// Invite secrets live only in the creation result, never in saved browser data.
export function createInvites({ api, el, button, input, field, openDialog, dialogCurrent, dialog, menuButton, clipboard = globalThis.navigator?.clipboard, members = () => [], streamSafe }) {
  let secret, disposeRows;
  const safe = value => streamSafe?.safeText(value) ?? String(value ?? '');
  const clearSecret = () => { if (secret) { secret.link.clear(); secret.section.remove(); secret = undefined; } };
  dialog.addEventListener('close', () => { if (!dialog.open) { clearSecret(); disposeRows?.(); disposeRows = undefined; } });
  dialog.addEventListener('cancel', clearSecret);

  async function loadSession() {
    menuButton.hidden = true;
    const session = await api('/api/session');
    menuButton.hidden = session.adminAvailable === false || session.admin !== true;
    return session;
  }

  async function open() {
    disposeRows?.(); disposeRows = undefined;
    clearSecret();
    const content = el('div', undefined, 'form-stack');
    const status = el('p', 'Loading invite links…', 'status-detail');
    status.setAttribute('role', 'status');
    content.append(status);
    const generation = openDialog('Invite links', content);
    const current = () => dialogCurrent(generation);
    let listing;
    try {
      const session = await loadSession();
      if (!current()) return;
      if (!session.admin) { status.textContent = 'Only admins can manage invite links.'; return; }
      listing = await api('/api/invites');
      if (!current()) return;
    } catch (error) {
      if (current()) { status.textContent = safe(error.message); status.className = 'error'; content.append(button('Retry', open)); }
      return;
    }

    const intro = el('p', 'Anyone possessing an invite link can use the picker. Share each link only with its intended person.', 'section-intro');
    const rows = el('div');
    const message = el('p', undefined, 'status-detail');
    message.setAttribute('role', 'status');
    message.hidden = true;
    content.replaceChildren(intro, rows, message);
    let invites = listing.invites;
    let reportText = '';
    const report = (text, error = false) => { reportText = text; message.textContent = safe(text); message.className = error ? 'error' : 'status-detail'; message.hidden = false; };
    const formatDate = (value, fallback) => value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : fallback;

    // The player an invite owns; that link may restore this player's map from a backup.
    const playerSelect = (value, cls) => {
      const node = el('select', undefined, cls);
      for (const [id, name] of [['', 'No player'], ...members().map(member => [member.id, member.name])]) {
        const option = el('option', safe(name)); option.value = id; option.selected = id === (value ?? ''); node.append(option);
      }
      node.value = value ?? '';
      return node;
    };
    function renderRows() {
      rows.replaceChildren();
      if (!invites.length) { rows.append(el('p', 'No invite links yet.', 'empty-list')); return; }
      for (const invite of invites) {
        const row = el('section', undefined, 'invite-row');
        const revoked = Boolean(invite.revoked);
        const head = el('div', undefined, 'invite-head');
        head.append(el('h3', safe(invite.label)), el('span', `${revoked ? 'Revoked' : 'Active'} · ${invite.viewer ? 'View only' : invite.admin ? 'Admin' : 'Player'}`, `invite-status ${revoked ? 'is-revoked' : invite.viewer ? 'is-viewer' : invite.admin ? 'is-admin' : 'is-active'}`));
        row.classList?.toggle('is-revoked', revoked);
        row.append(head, el('p', `Created: ${formatDate(invite.createdAt, 'Unknown')} · Last used: ${formatDate(invite.lastUsedAt, 'Never')}`, 'invite-meta'));
        if (members().length && !revoked && !invite.viewer) {
          const player = playerSelect(invite.memberId, 'invite-player-select');
          player.setAttribute('aria-label', safe(`Player for ${invite.label}’s link`));
          player.addEventListener('change', async () => {
            player.disabled = true;
            try {
              const response = await api(`/api/invites/${encodeURIComponent(invite.id)}/player`, { memberId: player.value || null });
              if (!current()) return;
              invites = invites.map(item => item.id === invite.id ? response.invite : item);
              report(player.value ? `${invite.label}’s link can now restore ${members().find(member => member.id === player.value)?.name ?? player.value}’s map.` : `${invite.label}’s link no longer owns a player’s map.`);
            } catch (failure) { if (current()) { report(failure.message, true); player.value = invite.memberId ?? ''; } }
            finally { if (current()) player.disabled = false; }
          });
          const owns = el('label', undefined, 'invite-player'); owns.append(el('span', 'Player'), player);
          row.append(owns);
        }
        if (revoked) { if (typeof invite.revoked === 'string') row.append(el('p', `Revoked: ${formatDate(invite.revoked, 'Yes')}`, 'invite-meta')); }
        else {
          const revoke = button('Revoke', () => {
            revoke.hidden = true;
            const confirmation = el('div', undefined, 'form-stack invite-confirmation');
            confirmation.append(el('p', safe(`Revoke ${invite.label}’s link? Anyone using it will lose access. This cannot be undone.`)));
            const error = el('p', undefined, 'error'); error.hidden = true; error.setAttribute('role', 'alert');
            const actions = el('div', undefined, 'form-actions');
            const cancel = button('Cancel', () => { confirmation.remove(); revoke.hidden = false; revoke.focus(); });
            const confirm = button('Revoke link', async () => {
              confirm.disabled = cancel.disabled = true;
              try {
                const response = await api(`/api/invites/${encodeURIComponent(invite.id)}/revoke`, {});
                if (!current()) return;
                invites = invites.map(item => item.id === invite.id ? response.invite : item);
                if (secret?.id === invite.id) clearSecret();
                renderRows(); report(`${invite.label}’s link was revoked.`);
              } catch (failure) { if (current()) { error.textContent = safe(failure.message); error.hidden = false; } }
              finally { if (current()) confirm.disabled = cancel.disabled = false; }
            });
            actions.append(cancel, confirm); confirmation.append(actions, error); row.append(confirmation); cancel.focus();
          });
          revoke.setAttribute('aria-label', safe(`Revoke ${invite.label}’s link`));
          revoke.className = 'invite-revoke';
          head.append(revoke);
        }
        rows.append(row);
      }
    }
    renderRows();
    disposeRows = streamSafe?.subscribe(() => {
      if (!current()) { disposeRows?.(); disposeRows = undefined; return; }
      renderRows(); message.textContent = safe(reportText);
      if (secret) secret.heading.textContent = safe(secret.title);
    });

    const form = el('form', undefined, 'form-stack dialog-section');
    const label = input('text'); label.required = true; label.maxLength = 80; label.placeholder = members()[1]?.name ?? 'Person'; label.autocomplete = 'off';
    const permission = el('select'); permission.setAttribute('aria-label', 'Invite permission');
    for (const [value, text] of [['player', 'Player'], ['admin', 'Admin'], ['viewer', 'View only']]) { const option = el('option', text); option.value = value; permission.append(option); }
    permission.value = 'player';
    const create = el('button', 'Create invite link', 'primary-action'); create.type = 'submit';
    const player = members().length ? playerSelect(null, 'invite-player-select') : null;
    // Typing a player's name picks their map; it can still be changed.
    if (player) label.addEventListener('input', () => { const match = members().find(member => member.name.toLowerCase() === label.value.trim().toLowerCase()); if (match) player.value = match.id; });
    const playerField = player ? field('Player (can restore this map from a backup)', player) : null;
    permission.addEventListener('change', () => { if (player) { player.disabled = permission.value === 'viewer'; playerField.hidden = player.disabled; } });
    form.append(el('h3', 'New invite link'), field('Person or label', label), field('Permission', permission), ...(playerField ? [playerField] : []),
      el('p', 'Player can edit both maps. Admin can also manage invite links and backups. View only can watch both maps, tasks, notes and History live, without changing anything.', 'field-help'), create);
    if (!listing.publicOrigin) form.append(el('p', 'New links use this server’s private address. Public sharing requires RS3_PUBLIC_ORIGIN to be configured on the server.', 'field-help'));
    content.append(form);
    let creating = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (creating || !current()) return;
      const name = label.value.trim();
      if (!name) { report('Enter a person or label for the invite link.', true); label.focus(); return; }
      creating = true; create.disabled = label.disabled = permission.disabled = true;
      try {
        const viewer = permission.value === 'viewer';
        const response = await api('/api/invites', { label: name, admin: permission.value === 'admin', ...(viewer ? { viewer: true } : {}), ...(!viewer && player?.value ? { memberId: player.value } : {}) });
        if (!current()) return;
        clearSecret();
        invites = [...invites, response.invite]; renderRows();
        const section = el('section', undefined, 'form-stack dialog-section');
        const privateLink = createPrivateLink({ value: response.link, el, button, input, field, streamSafe, viewer, current });
        const link = privateLink.input;
        const copyStatus = el('p', undefined, 'status-detail'); copyStatus.setAttribute('role', 'status');
        const copy = button('Copy link', async () => {
          try {
            if (!clipboard?.writeText) throw new Error('Clipboard unavailable.');
            await clipboard.writeText(privateLink.value());
            if (current()) copyStatus.textContent = 'Link copied.';
          } catch (error) { if (current()) { copyStatus.textContent = privateLink.masked() ? `${error.message} Use Show to reveal the link and copy it manually.` : `${error.message} You can select the link and copy it manually.`; if (!privateLink.masked()) { link.focus(); link.select(); } } }
        });
        section.classList?.add('invite-secret');
        const title = `${response.invite.label}’s new link`, heading = el('h3', safe(title));
        section.append(heading,
          el('p', 'This full link is shown only now. Copy it before closing this dialog or creating another link.', 'field-help'),
          privateLink.node, copy, copyStatus);
        secret = { link: privateLink, section, id: response.invite.id, title, heading }; content.append(section); if (!privateLink.masked()) { link.focus(); link.select(); } else copy.focus();
        label.value = ''; permission.value = 'player'; if (player) { player.value = ''; player.disabled = false; playerField.hidden = false; } report('Invite link created. Copy the new link below.');
      } catch (error) { if (current()) report(error.message, true); }
      finally { creating = false; if (current()) create.disabled = label.disabled = permission.disabled = false; }
    });
  }
  return { open, loadSession };
}
