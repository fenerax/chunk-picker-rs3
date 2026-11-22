async function request(url, body, fetcher = globalThis.fetch) {
  const response = await fetcher(url, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'The invitation request was refused.');
  return value;
}

export function ownerInviteControls({ el, fetch = globalThis.fetch, scopeHeaders = {}, clipboard = globalThis.navigator?.clipboard }) {
  const root = el('div', undefined, 'form-stack'), error = el('p'), rows = el('div'), output = el('input'), copy = el('button', 'Copy invitation link', 'secondary-button');
  error.setAttribute('role', 'alert'); output.readOnly = true; output.setAttribute('aria-label', 'Invitation link shown once'); output.hidden = true; copy.hidden = true; copy.type = 'button';
  const scoped = (url, options) => fetch(url, { ...options, headers: { ...options.headers, ...scopeHeaders } });
  root.append(el('p', 'Reserve a vacant player seat for seven days. Copy and share the link yourself. Links are shown once; replacing a lost link revokes it.'), rows, output, copy, error);
  copy.addEventListener('click', async () => { try { await clipboard.writeText(output.value); copy.textContent = 'Copied'; } catch { error.textContent = 'Copy the selected link manually.'; output.select(); } });
  const button = (label, work) => { const b = el('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; error.textContent = ''; try { await work(); } catch (e) { error.textContent = e.message; } finally { b.disabled = false; } }); return b; };
  async function create(replaceId) {
    output.value = ''; output.hidden = copy.hidden = true;
    const value = await request('/api/group-invites', replaceId ? { replaceId } : {}, scoped);
    output.value = value.link; output.hidden = copy.hidden = false; copy.textContent = 'Copy invitation link'; await refresh();
  }
  async function refresh() {
    const value = await request('/api/group-invites', undefined, scoped); rows.replaceChildren();
    if (!value.invites.length) rows.append(el('p', 'No invitations yet.'));
    for (const [n, i] of value.invites.entries()) {
      const row = el('div'); row.append(el('p', `Invitation ${n + 1} · ${i.status}${i.joining ? ' · completing admission' : ''} · expires ${new Date(i.expiresAt).toLocaleDateString()}`));
      if (i.status === 'pending') row.append(button('Replace link', () => create(i.id)), button('Revoke', async () => { await request('/api/group-invites', { revokeId: i.id }, scoped); await refresh(); }));
      rows.append(row);
    }
  }
  root.append(button('Create player invitation', () => create())); void refresh().catch(e => { error.textContent = e.message; }); return root;
}

export async function renderAcceptance({ root, error, el, fetch = globalThis.fetch, location = globalThis.location }) {
  const value = await request('/auth/group-invite/review', undefined, fetch);
  root.replaceChildren();
  if (value.invite.status !== 'pending') {
    root.append(el('p', `This invitation is ${value.invite.status}.`));
    if (value.invite.status === 'accepted') {
      root.append(el('p', 'If you already joined, choose the same character to recover your result.'));
      const retry = el('button', 'Already joined · open character', 'signin-provider');
      retry.type = 'button'; retry.addEventListener('click', async () => { try { const joined = await request('/auth/group-invite/accept', { reviewToken: value.reviewToken, confirmed: true, characterId: value.invite.acceptingCharacterId }, fetch); location.assign(joined.character.href); } catch (e) { error.textContent = e.message; } }); root.append(retry);
    }
    return;
  }
  root.append(el('p', 'Choose a character. Joining uses this group’s map and shared rules; personal progress, notes and checks are not copied.'));
  const form = el('form', undefined, 'invite-form'), select = el('select'), label = el('label', 'Character'), nameLabel = el('label', 'New character name (optional)'), name = el('input'); name.maxLength = 12; name.autocomplete = 'off';
  const option = (text, id) => { const n = el('option', text); n.value = id; return n; };
  select.append(option('New character', ''));
  for (const c of value.characters) {
    const n = option(`${c.runescapeName ?? 'Unnamed character'}${c.eligible ? '' : ' · unavailable'}`, c.id); n.disabled = !c.eligible; select.append(n);
    if (!c.eligible) root.append(el('p', `${c.runescapeName ?? 'Unnamed character'}: ${c.reason}`, 'signin-help'));
  }
  label.append(select); nameLabel.append(name);
  const consequence = el('p', '', 'signin-help');
  const duplicate = el('label', undefined, 'invite-check'), acknowledge = el('input'); acknowledge.type = 'checkbox'; duplicate.append(acknowledge, el('span', 'If this name is already used in my login, create a separate character.'));
  const update = () => {
    const selected = select.value ? value.characters.find(c => c.id === select.value) : null;
    nameLabel.hidden = Boolean(selected);
    duplicate.hidden = Boolean(selected);
    consequence.textContent = selected
      ? selected.sourceMode === 'group'
        ? 'A read-only copy of your current group map will be saved in Past maps. You will leave your current group (remaining members keep their map and history) and join this group’s map and rules with a fresh slot; your previous progress is not copied. Old group keys will be revoked.'
        : selected.rejoining || selected.sourceMode === 'solo'
          ? 'Your solo map will be frozen in Past maps, read-only and exportable. Moving uses the destination map and rules with a fresh slot; your solo progress is not copied. Old solo keys and pending invitations will be revoked.'
          : 'Your untouched onboarding solo will be retired and its pending invitations revoked. No gameplay progress is discarded.'
      : 'A new character joins directly. Your existing characters and maps stay available.';
  };
  select.addEventListener('change', update); update();
  const review = el('section'), heading = el('h2', 'Destination map and rules');
  review.append(heading, el('p', `${value.review.unlocked.length} unlocked chunks: ${value.review.unlocked.join(', ') || 'None'}. Starting chunk: ${value.review.startingChunk ?? 'Not selected'}.`), el('p', `Blacklisted chunks: ${value.review.blacklisted.join(', ') || 'None'}.`));
  const display = value => typeof value === 'boolean' ? value ? 'On' : 'Off' : String(value);
  const listRules = (title, rows) => {
    const details = el('details'), list = el('dl', undefined, 'invite-rule-list'); details.append(el('summary', title));
    for (const row of rows) list.append(el('dt', row.label), el('dd', display(row.value)));
    details.append(list); review.append(details);
  };
  listRules('Shared rules', value.review.ruleRows ?? Object.entries(value.review.rules).map(([label, value]) => ({ label, value })));
  const taskRows = value.review.taskRuleRows ?? Object.entries(value.review.taskRules).map(([label, value]) => ({ label, value }));
  if (taskRows.length) listRules('Map task rules', taskRows);
  else review.append(el('p', 'Default task rules apply.'));
  for (const [key, title] of [['sectionOverrides', 'Section access overrides'], ['areaOverrides', 'Area access overrides']]) {
    const rows = Object.entries(value.review[key] ?? {}).map(([label, value]) => ({ label, value }));
    if (rows.length) listRules(title, rows);
  }
  const confirmLabel = el('label', undefined, 'invite-check'), confirm = el('input'); confirm.type = 'checkbox'; confirm.required = true; confirmLabel.append(confirm, el('span', 'I reviewed the destination map, rules and source-map consequences.'));
  const submit = el('button', 'Join group', 'signin-provider'); submit.type = 'submit';
  form.append(label, nameLabel, consequence, review, duplicate, confirmLabel, submit); root.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!confirm.checked) return; submit.disabled = true; error.textContent = '';
    try {
      const joined = await request('/auth/group-invite/accept', { reviewToken: value.reviewToken, confirmed: true, ...(select.value ? { characterId: select.value } : { runescapeName: name.value, acknowledgeDuplicate: acknowledge.checked }) }, fetch);
      location.assign(joined.character.href);
    } catch (e) { error.textContent = e.message + ' Reopen this page to review changes; retrying a completed join returns Already joined.'; submit.disabled = false; }
  });
}
if (globalThis.document?.getElementById('group-invite')) {
  const el = (tag, text, css) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (css) node.className = css; return node; };
  const error = document.getElementById('invite-error');
  void renderAcceptance({ root: document.getElementById('group-invite'), error, el }).catch(e => { document.getElementById('group-invite').textContent = ''; error.textContent = e.message; });
}
