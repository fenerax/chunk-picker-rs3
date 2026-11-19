import { characterLabel, characterDetails, createCharacterForm } from './character-menu.mjs';
import { ownerInviteControls } from './group-invites.mjs';
import { handoverControls } from './group-handover.mjs';
import { departureControls } from './group-departure.mjs';
import { deletionControls } from './character-deletion.mjs';
const providerNames = { discord: 'Discord', google: 'Google' };
const providersFor = account => [...new Set([...(account?.providers ?? []), ...(account?.identities ?? []).map(identity => identity.provider), account?.provider].filter(provider => Object.hasOwn(providerNames, provider)))];

export function createAccountPanel({ el, openDialog, menuButton, topMenu, fetch = globalThis.fetch, location = globalThis.location, beforeSignOut = () => {}, beforeSwitch = beforeSignOut, beforeDeparture = async () => () => {}, beginAccountAction = async () => () => {}, dialogCurrent = () => true, ownerActions = {} }) {
  let session = {}, departurePanel, deletionPanels = {}, deletionGenerations = {};
  const deletionBinding = value => JSON.stringify([value.accountId ?? value.account?.id, value.pickerId, value.characterId, value.memberId, value.ownerControls?.role, value.ownerControls?.shared]);
  const available = () => Boolean(session.account) || (session.signIn?.providers?.length ?? 0) > 0;
  const signedInName = () => Object.hasOwn(providerNames, session.account?.provider) ? providerNames[session.account.provider] : providersFor(session.account).map(provider => providerNames[provider]).join(' and ');
  function setSession(value) {
    if (deletionBinding(session) !== deletionBinding(value)) { departurePanel = undefined; deletionPanels = {}; deletionGenerations = {}; }
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
        if (session.characters) {
          content.append(el('h3', 'Characters'));
          const status = el('p', undefined, 'field-help'); status.setAttribute('role', 'alert');
          actions.append(actionButton('Characters and groups', async () => {
            try { await beforeSwitch(); location.assign('/characters'); }
            catch (failure) { status.textContent = failure.message; }
          }));
          for (const [index, character] of session.characters.entries()) {
            const current = character.id === session.characterId;
            const button = actionButton(`${characterLabel(character, index)}${current ? ' · Current' : ''}`, async () => {
              button.disabled = true;
              try { await beforeSwitch(); location.assign(character.href); }
              catch (failure) { status.textContent = failure.message; button.disabled = false; }
            });
            button.disabled = current || !character.available;
            button.setAttribute('aria-current', current ? 'true' : 'false');
            const row = el('div'); row.append(button, el('p', `${characterDetails(character)}${character.available ? '' : ' · unavailable'}`, 'field-help')); content.append(row);
          }
          content.append(status);
          actions.append(actionButton('Add character', () => {
            const form = createCharacterForm({ el, accountId: session.accountId ?? session.account.id, fetch,
              onCreated: async character => { await beforeSwitch(); location.assign(character.href); } });
            openDialog('Add character', form);
          }));
        }
        content.append(el('p', `Account: ${session.accountId ?? session.account.id}`, 'field-help'));
        actions.append(link('Past maps', '/past-maps'));
        content.append(el('p', `Picker: ${session.pickerId}`, 'field-help'));
        if (session.ownerControls?.role) content.append(el('p', `Role: ${session.ownerControls.role}`, 'field-help'));
        if (isOwner()) for (const [label, action] of Object.entries(ownerActions)) actions.append(actionButton(label, action));
        if (isOwner()) actions.append(actionButton('Invite players', () => openDialog('Player invitations', ownerInviteControls({ el, fetch,
          scopeHeaders: { 'X-Picker-Id': session.pickerId, 'X-Character-Id': session.characterId } }))));
        if (session.characterId && session.ownerControls?.shared === false) actions.append(actionButton('Group ownership', () => openDialog('Group ownership', handoverControls({ el, fetch, characterId: session.characterId,
          scopeHeaders: { 'X-Picker-Id': session.pickerId, 'X-Character-Id': session.characterId }, onChanged: async () => { await beforeSwitch(); location.reload(); } }))));
        if (session.characterId && session.ownerControls?.shared === false) actions.append(actionButton('Leave or remove member', () => {
          departurePanel ??= departureControls({ el, fetch, characterId: session.characterId, beforeDeparture, beforeSwitch, location,
            scopeHeaders: { 'X-Picker-Id': session.pickerId, 'X-Character-Id': session.characterId } });
          openDialog('Leave or remove member', departurePanel);
        }));
        if (session.ownerControls) {
          for (const target of [...(session.characterId ? ['character'] : []), ...(isOwner() ? ['picker'] : []), 'account']) {
            const control = actionButton(`Delete ${target}`, () => deletionDialog(target));
            control.disabled = session.ownerControls.deletionPaused === true;
            if (control.disabled) control.title = 'The legacy shared picker needs operator recovery before deletion.';
            actions.append(control);
          }
          if (session.ownerControls.deletionPaused) content.append(el('p', 'The legacy shared picker needs operator recovery before deletion. Your maps and access are unchanged.', 'field-help'));
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
  function deletionDialog(target) {
    if (!session.multiPicker || !session.account || !session.ownerControls || session.ownerControls.deletionPaused) return;
    deletionPanels[target] ??= deletionControls({ el, fetch, kind: target, characterId: session.characterId, pickerId: session.pickerId,
      beforeDeparture, beforeSignOut, location, isCurrent: () => dialogCurrent(deletionGenerations[target]), generation: () => deletionGenerations[target],
      showReceipt: content => openDialog('Deletion complete', content) });
    deletionGenerations[target] = openDialog('Delete character, group or login', deletionPanels[target]);
  }
  const open = () => { if (available()) openDialog('Account', rows()); };
  return { setSession, available, rows, open, isOwner };
}
