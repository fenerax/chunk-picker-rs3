const providerNames = { discord: 'Discord', google: 'Google' };
const providersFor = account => [...new Set([...(account?.providers ?? []), ...(account?.identities ?? []).map(identity => identity.provider), account?.provider].filter(provider => Object.hasOwn(providerNames, provider)))];

export function createAccountPanel({ el, openDialog, menuButton, topMenu, fetch = globalThis.fetch, location = globalThis.location, beforeSignOut = () => {}, beginAccountAction = async () => () => {}, dialogCurrent = () => true, ownerActions = {} }) {
  let session = {};
  const available = () => Boolean(session.account) || (session.signIn?.providers?.length ?? 0) > 0;
  const signedInName = () => Object.hasOwn(providerNames, session.account?.provider) ? providerNames[session.account.provider] : providersFor(session.account).map(provider => providerNames[provider]).join(' and ');
  function setSession(value) {
    session = value;
    if (menuButton) menuButton.hidden = !available();
    if (topMenu) {
      topMenu.hidden = !session.account;
      topMenu.open = false;
      const name = signedInName();
      topMenu.querySelector('.account-provider').textContent = name || 'Account';
      topMenu.querySelector('summary').setAttribute('aria-label', name ? `${name} account` : 'Account');
      topMenu.querySelector('.more-tools-menu').replaceChildren(...(session.account ? [rows({ compact: true })] : []));
    }
  }
  const link = (text, href) => { const node = el('a', text, 'secondary-button'); node.href = href; return node; };
  function rows({ compact = false } = {}) {
    const content = el('div', undefined, compact ? 'account-menu-details' : 'account-details');
    const actions = el('div', undefined, compact ? 'account-menu-actions' : 'account-actions');
    if (session.account) {
      const providers = providersFor(session.account);
      const signedIn = signedInName();
      content.append(el('p', signedIn ? `Signed in with ${signedIn}` : 'Signed in', compact ? 'account-menu-status' : undefined));
      if (session.multiPicker) {
        content.append(el('p', `Account: ${session.accountId ?? session.account.id}`, 'field-help'));
        content.append(el('p', `Picker: ${session.pickerId}`, 'field-help'));
        if (session.ownerControls?.role) content.append(el('p', `Role: ${session.ownerControls.role}`, 'field-help'));
        if (isOwner()) for (const [label, action] of Object.entries(ownerActions)) actions.append(actionButton(label, action));
        if (session.ownerControls) {
          if (isOwner()) actions.append(actionButton('Delete picker', () => deletionDialog('picker')));
          actions.append(actionButton('Delete account', () => deletionDialog('account')));
        }
      }
      if (!compact && providers.length > 1) content.append(el('p', `Linked sign-ins: ${providers.map(provider => providerNames[provider]).join(' and ')}.`, 'field-help'));
      for (const provider of session.signIn?.providers ?? []) {
        if (Object.hasOwn(providerNames, provider) && !providers.includes(provider)) actions.append(link(`Link ${providerNames[provider]} too`, `/auth/link/${provider}`));
      }
      const form = el('form'); form.method = 'post'; form.action = '/auth/signout';
      const signout = el('button', 'Sign out', 'secondary-button'); signout.type = 'submit'; form.append(signout); actions.append(form);
      const error = el('p', undefined, 'field-help'); error.setAttribute('role', 'alert'); error.hidden = true; form.append(error);
      form.addEventListener('submit', async event => {
        // A native form under no-referrer sends Origin: null. Fetch keeps the
        // same-origin POST check used by the rest of the picker intact.
        event.preventDefault();
        if (signout.disabled) return;
        signout.disabled = true; error.hidden = true;
        try {
          await beforeSignOut();
          const response = await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin' });
          if (!response.ok) throw new Error('Sign out failed. Try again.');
          location.assign('/auth/signin');
        } catch {
          error.textContent = 'Sign out failed. Try again.'; error.hidden = false; signout.disabled = false;
          if (compact && topMenu) { topMenu.open = true; signout.focus(); }
        }
      });
    } else {
      content.append(el('p', 'Using an invite link.', 'section-intro'));
      const unassigned = session.kind === 'invite' && !session.admin && !session.readOnly && !session.memberId;
      content.append(el('p', unassigned ? 'Ask the admin to choose a player for this invite before signing in' : 'Sign in to use this invitation with your account.', 'field-help'));
      if (!unassigned) for (const provider of session.signIn?.providers ?? []) if (Object.hasOwn(providerNames, provider)) actions.append(link(`Sign in with ${providerNames[provider]}`, `/auth/${provider}`));
    }
    content.append(actions);
    return content;
  }
  function actionButton(label, action) {
    const node = el('button', label, 'secondary-button'); node.type = 'button';
    node.addEventListener('click', action); return node;
  }
  function isOwner() { return session.multiPicker === true && session.ownerControls?.role === 'owner' && session.ownerControls.shared === false; }
  const binding = value => JSON.stringify([value.multiPicker, value.accountId ?? value.account?.id, value.pickerId,
    value.pickerRoute, value.kind, value.memberId, value.readOnly, value.capabilities, value.ownerControls]);
  function deletionDialog(target) {
    const selected = session, controls = selected.ownerControls;
    if (!selected.multiPicker || !selected.account || !controls || (target === 'picker' && !isOwner())) return;
    const title = target === 'picker' ? 'Delete picker' : 'Delete account';
    const content = el('div', undefined, 'form-stack');
    content.append(el('p', target === 'picker'
      ? `Permanently delete picker ${selected.pickerId} and its saved gameplay? This cannot be undone.`
      : `Permanently delete account ${selected.accountId ?? selected.account.id}? This cannot be undone.`));
    if (target === 'account') {
      if (controls.shared) content.append(el('p', "This removes this account's access and claimed invitations. The shared game and the other player are not changed."));
      if (controls.ownsDefaultPicker) content.append(el('p', 'Your owned picker and its saved gameplay will also be deleted.'));
    }
    content.append(el('p', controls.backups.message, 'field-help'));
    content.append(el('p', 'Your signed-in account will be checked again before deletion.', 'field-help'));
    const error = el('p', undefined, 'field-help'); error.setAttribute('role', 'alert'); error.hidden = true;
    const confirm = actionButton(title, submit), cancel = actionButton('Cancel', () => open());
    content.append(error, confirm, cancel);
    const generation = openDialog(title, content);
    const current = () => session === selected && dialogCurrent(generation);
    let busy = false, deleted = false, retryAt = 0, retryTimer;
    async function submit() {
      if (busy || deleted || !current() || Date.now() < retryAt) return;
      busy = true; confirm.disabled = true; error.hidden = true;
      let release;
      try {
        release = await beginAccountAction();
        const checked = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!checked.ok) throw new Error('Could not verify your signed-in account. Reload and sign in again.');
        const next = await checked.json();
        if (!current()) return;
        if (binding(next) !== binding(selected)) throw new Error('The account or picker changed. Reload before deleting.');
        const response = await fetch(`/api/${target}/delete`, { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Picker-Id': selected.pickerRoute ?? selected.pickerId }, body: '{}' });
        const value = await response.json();
        if (!response.ok) {
          if (response.status === 503) {
            const after = response.headers.get('Retry-After');
            const delay = after == null ? 0 : /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
            retryAt = Date.now() + Math.max(0, Number.isFinite(delay) ? delay : 0);
            confirm.textContent = 'Retry deletion';
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { if (current()) confirm.disabled = false; }, Math.min(2147483647, Math.max(0, retryAt - Date.now())));
            retryTimer?.unref?.();
          }
          throw new Error(value.message || 'Deletion was refused. Try again.');
        }
        deleted = true;
        // MP5 has revoked this session. Retire the old document before showing
        // the receipt; never feed this response through command recovery.
        let cleanupFailed = false;
        try { await beforeSignOut(); } catch { cleanupFailed = true; }
        const receipt = el('div', undefined, 'form-stack');
        receipt.append(el('p', `${title === 'Delete picker' ? 'Picker' : 'Account'} deleted.`), el('p', value.backups.message, 'field-help'));
        const cleanupError = el('p', 'Browser storage could not be cleared. Restore browser storage, then continue.', 'field-help');
        cleanupError.setAttribute('role', 'alert'); cleanupError.hidden = !cleanupFailed;
        const continueButton = actionButton('Continue to sign in', async () => {
          continueButton.disabled = true;
          try { await beforeSignOut(); location.assign('/auth/signin'); }
          catch { cleanupError.hidden = false; continueButton.disabled = false; }
        });
        receipt.append(cleanupError, continueButton); openDialog('Deletion complete', receipt);
      } catch (failure) {
        if (current()) { error.textContent = failure.message || 'Deletion failed. Try again.'; error.hidden = false; }
      } finally {
        release?.(); busy = false;
        if (!deleted && current()) confirm.disabled = Date.now() < retryAt;
      }
    }
  }
  const open = () => { if (available()) openDialog('Account', rows()); };
  return { setSession, available, rows, open, isOwner };
}
