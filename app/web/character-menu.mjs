import { deletionControls } from './character-deletion.mjs';

export const characterLabel = (character, index) => `${character.runescapeName ?? 'Unnamed character'} · Character ${index + 1}`;
export const characterDetails = character => `${character.groupLabel} · ${character.playerCount} ${character.playerCount === 1 ? 'player' : 'players'} · ${character.role ?? 'unavailable'}`;

export function createCharacterForm({ el, accountId, onCreated, fetch = globalThis.fetch, storage = globalThis.sessionStorage, randomId = () => globalThis.crypto.randomUUID() }) {
  const key = `picker.character-creation.${accountId}`;
  let draft;
  try { draft = JSON.parse(storage?.getItem(key) ?? 'null'); } catch {}
  draft ??= { requestId: randomId(), runescapeName: '', acknowledgeDuplicate: false };
  const form = el('form'), label = el('label', 'RuneScape name (optional)'), input = el('input');
  input.name = 'runescapeName'; input.maxLength = 12; input.value = draft.runescapeName; input.autocomplete = 'off'; label.append(input);
  input.disabled = draft.pending === true;
  const help = el('p', 'Start a new solo map. You can play without entering a RuneScape name.', 'field-help');
  const duplicate = el('label'), acknowledge = el('input'); acknowledge.type = 'checkbox'; acknowledge.checked = draft.acknowledgeDuplicate; duplicate.hidden = !draft.acknowledgeDuplicate;
  duplicate.append(acknowledge, el('span', 'Create a separate character with the same name.'));
  const error = el('p'); error.setAttribute('role', 'alert');
  const submit = el('button', 'Add character'); submit.type = 'submit';
  form.append(label, help, duplicate, error, submit);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled) return;
    submit.disabled = true; error.textContent = ''; input.disabled = true;
    draft = { requestId: draft.requestId, runescapeName: input.value.trim(), acknowledgeDuplicate: acknowledge.checked, pending: true };
    try {
      storage?.setItem(key, JSON.stringify(draft));
      const { pending, ...body } = draft;
      const response = await fetch('/api/characters', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) {
        if (value.code === 'DUPLICATE_CHARACTER_NAME') duplicate.hidden = false;
        if (response.status >= 400 && response.status < 500 || response.status === 507 && value.code === 'LOGIN_STORAGE_BUDGET_EXCEEDED') {
          draft.pending = false; storage?.setItem(key, JSON.stringify(draft)); input.disabled = false;
        }
        throw new Error(value.message || 'Character creation was refused.');
      }
      await onCreated(value.character); storage?.removeItem(key);
    } catch (failure) { error.textContent = failure.message || 'Could not confirm character creation. Retry to resume the same character.'; submit.disabled = false; }
  });
  return form;
}

if (globalThis.document?.getElementById('characters')) {
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const rows = document.getElementById('characters');
  void (async () => {
    try {
      const response = await fetch('/api/characters', { credentials: 'same-origin', cache: 'no-store' });
      const value = await response.json(); if (!response.ok) throw new Error(value.message || 'Sign in again to open your characters.');
      rows.replaceChildren();
      if (!value.characters.length) rows.append(el('p', 'No characters yet. Your login remains available. Add a character to start a solo map.'));
      value.characters.forEach((character, index) => {
        const link = el(character.available ? 'a' : 'p', `${characterLabel(character, index)} — ${characterDetails(character)}${character.available ? '' : ' · unavailable'}`, 'signin-provider');
        if (character.available) link.href = character.href; rows.append(link);
      });
      const viewerGroups = value.viewerMemberships ?? [];
      if (viewerGroups.length) {
        rows.append(el('h2', 'View-only groups'));
        viewerGroups.forEach((group, index) => {
          const link = el(group.available ? 'a' : 'p', `${group.groupLabel} ${index + 1} · ${group.playerCount} ${group.playerCount === 1 ? 'player' : 'players'} · View only${group.available ? '' : ' · unavailable'}`, 'signin-provider');
          if (group.available) link.href = group.href;
          rows.append(link);
        });
      }
      document.getElementById('add-character').append(createCharacterForm({ el, accountId: value.accountId, onCreated: character => location.assign(character.href) }));
      const deletion = el('details'), summary = el('summary', 'Delete login'); deletion.append(summary);
      deletion.addEventListener('toggle', () => { if (deletion.open && deletion.children.length === 1) deletion.append(deletionControls({ el, kind: 'account' })); });
      rows.append(deletion);
    } catch (failure) { rows.textContent = ''; document.getElementById('character-error').textContent = failure.message; }
  })();
}
