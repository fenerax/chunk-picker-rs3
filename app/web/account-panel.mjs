const providerNames = { discord: 'Discord', google: 'Google' };
const providersFor = account => [...new Set([...(account?.providers ?? []), ...(account?.identities ?? []).map(identity => identity.provider), account?.provider].filter(provider => Object.hasOwn(providerNames, provider)))];

export function createAccountPanel({ el, openDialog, menuButton, topMenu, fetch = globalThis.fetch, location = globalThis.location, beforeSignOut = () => {} }) {
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
  const open = () => { if (available()) openDialog('Account', rows()); };
  return { setSession, available, rows, open };
}
