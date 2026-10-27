const providerNames = { discord: 'Discord', google: 'Google' };
const providersFor = account => [...new Set([...(account?.providers ?? []), ...(account?.identities ?? []).map(identity => identity.provider), account?.provider].filter(provider => Object.hasOwn(providerNames, provider)))];

export function createAccountPanel({ el, openDialog, menuButton }) {
  let session = {};
  const available = () => Boolean(session.account) || (session.signIn?.providers?.length ?? 0) > 0;
  function setSession(value) {
    session = value;
    if (menuButton) menuButton.hidden = !available();
  }
  const link = (text, href) => { const node = el('a', text); node.href = href; return node; };
  function rows() {
    const content = el('div', undefined, 'account-details');
    const actions = el('div', undefined, 'account-actions');
    if (session.account) {
      const providers = providersFor(session.account);
      const signedIn = Object.hasOwn(providerNames, session.account.provider) ? providerNames[session.account.provider] : providers.map(provider => providerNames[provider]).join(' and ');
      content.append(el('p', signedIn ? `Signed in with ${signedIn}` : 'Signed in'));
      if (providers.length > 1) content.append(el('p', `Linked sign-ins: ${providers.map(provider => providerNames[provider]).join(' and ')}.`, 'field-help'));
      for (const provider of session.signIn?.providers ?? []) {
        if (Object.hasOwn(providerNames, provider) && !providers.includes(provider)) actions.append(link(`Link ${providerNames[provider]} too`, `/auth/link/${provider}`));
      }
      const form = el('form'); form.method = 'post'; form.action = '/auth/signout';
      const signout = el('button', 'Sign out'); signout.type = 'submit'; form.append(signout); actions.append(form);
    } else {
      content.append(el('p', 'Using an invite link.', 'section-intro'));
      content.append(el('p', 'Sign in to use this invitation with your account.', 'field-help'));
      for (const provider of session.signIn?.providers ?? []) if (Object.hasOwn(providerNames, provider)) actions.append(link(`Sign in with ${providerNames[provider]}`, `/auth/${provider}`));
    }
    content.append(actions);
    return content;
  }
  const open = () => { if (available()) openDialog('Account', rows()); };
  return { setSession, available, rows, open };
}
