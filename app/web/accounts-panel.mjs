const providerNames = { discord: 'Discord', google: 'Google' };
const providerIds = account => [...new Set([...(account.providers ?? []), ...(account.identities ?? []).map(identity => identity.provider)].filter(provider => Object.hasOwn(providerNames, provider)))];

export function createAccountsPanel({ api, el, button, openDialog, dialogCurrent, menuButton, members = () => [], streamSafe }) {
  const safe = value => streamSafe?.safeText(value) ?? String(value ?? '');
  const allowed = session => session.admin === true && session.adminAvailable !== false;
  function setSession(session) { if (menuButton) menuButton.hidden = !allowed(session); }
  const formatDate = value => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';
  };
  async function open() {
    const content = el('div', undefined, 'form-stack');
    const status = el('p', 'Loading accounts…', 'status-detail'); status.setAttribute('role', 'status'); content.append(status);
    const generation = openDialog('Accounts', content), current = () => dialogCurrent(generation);
    let accounts;
    try {
      const session = await api('/api/session');
      if (!current()) return;
      setSession(session);
      if (!allowed(session)) { status.textContent = 'Only admins on the private address can manage accounts.'; return; }
      const listing = await api('/api/accounts');
      if (!current()) return;
      accounts = listing.accounts ?? [];
    } catch (error) {
      if (current()) { status.className = 'error'; status.textContent = safe(error.message); content.append(button('Retry', open)); }
      return;
    }
    const rows = el('div');
    content.replaceChildren(el('p', 'Manage linked sign-ins and access to this picker.', 'section-intro'), rows, status);
    status.hidden = true;
    const report = (message, error = false) => { status.textContent = safe(message); status.className = error ? 'error' : 'status-detail'; status.hidden = false; };
    async function perform(account, action, body, success) {
      const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/${action}`, body);
      if (!current()) return;
      if (action === 'delete') accounts = accounts.filter(item => item.id !== account.id);
      else if (result.account) accounts = accounts.map(item => item.id === account.id ? result.account : item);
      else if (action === 'unlink') accounts = accounts.map(item => item.id === account.id ? { ...item, providers: providerIds(item).filter(provider => provider !== body.provider), identities: (item.identities ?? []).filter(identity => identity.provider !== body.provider) } : item);
      render(); report(success);
    }
    function render() {
      rows.replaceChildren();
      if (!accounts.length) { rows.append(el('p', 'No accounts yet.', 'empty-list')); return; }
      for (const account of accounts) {
        const row = el('section', undefined, 'account-row'), providers = providerIds(account), shortId = String(account.id).slice(0, 8);
        row.append(el('h3', `${providers.map(provider => providerNames[provider]).join(' + ') || 'Account'} · ${shortId}`));
        for (const membership of account.memberships ?? []) {
          const member = members().find(item => item.id === membership.memberId);
          row.append(el('p', safe(`${member?.name ?? membership.memberId ?? 'No linked player'} · ${membership.role ?? 'player'}`), 'account-meta'));
        }
        if (!account.memberships?.length) row.append(el('p', 'No linked player or invitation.', 'account-meta'));
        row.append(el('p', `Last used: ${formatDate(account.lastUsedAt)}`, 'account-meta'));
        const actions = el('div', undefined, 'form-actions');
        const run = async (control, action, body, success) => {
          control.disabled = true;
          try { await perform(account, action, body, success); }
          catch (error) { if (current()) report(error.message, true); }
          finally { if (current()) control.disabled = false; }
        };
        for (const provider of providers) {
          const unlink = button(`Unlink ${providerNames[provider]}`, () => run(unlink, 'unlink', { provider }, `${providerNames[provider]} was unlinked from account ${shortId}.`));
          unlink.title = providers.length < 2 ? 'Removing the last sign-in requires a new invite to recover access.' : `Remove ${providerNames[provider]} sign-in from this account`;
          actions.append(unlink);
        }
        const revoke = button('Revoke sessions', () => run(revoke, 'revoke-sessions', {}, `Sessions revoked for account ${shortId}.`)); actions.append(revoke);
        const remove = button('Delete account', () => {
          actions.hidden = true;
          const confirmation = el('div', undefined, 'form-stack account-confirmation');
          confirmation.append(el('p', `Delete account ${shortId}? Its linked sign-ins and sessions will be removed. This cannot be undone.`));
          const error = el('p', undefined, 'error'); error.hidden = true; error.setAttribute('role', 'alert');
          const controls = el('div', undefined, 'form-actions');
          const cancel = button('Cancel', () => { confirmation.remove(); actions.hidden = false; remove.focus(); });
          const confirm = button('Delete account', async () => {
            confirm.disabled = cancel.disabled = true;
            try { await perform(account, 'delete', {}, `Account ${shortId} was deleted.`); }
            catch (failure) { if (current()) { error.textContent = safe(failure.message); error.hidden = false; } }
            finally { if (current()) confirm.disabled = cancel.disabled = false; }
          });
          confirm.classList?.add('account-danger'); controls.append(cancel, confirm); confirmation.append(controls, error); row.append(confirmation); cancel.focus();
        });
        remove.classList?.add('account-danger'); actions.append(remove); row.append(actions); rows.append(row);
      }
    }
    render();
  }
  return { open, setSession };
}
