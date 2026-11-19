export function handoverControls({ el, fetch = globalThis.fetch, characterId, scopeHeaders, randomId = () => crypto.randomUUID(), onChanged = () => globalThis.location.reload() }) {
  const root = el('div', undefined, 'form-stack'), rows = el('div'), error = el('p'); error.setAttribute('role', 'alert');
  root.append(el('p', 'Choose an existing group character. Another login must accept before ownership changes. Your maps and player access stay in this group. Pending player invitations are revoked when handover completes.'), rows, error);
  async function request(body) {
    const r = await fetch('/api/group-handover', { credentials: 'same-origin', cache: 'no-store', headers: { ...scopeHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const value = await r.json(); if (!r.ok) throw new Error(value.message || 'The handover request was refused.'); return value;
  }
  const button = (label, work) => {
    const b = el('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', async () => {
      b.disabled = true; error.textContent = '';
      try { await work(); } catch (e) { error.textContent = e.message + ' Retry the same action to recover its result.'; } finally { b.disabled = false; }
    }); return b;
  };
  async function resolved(body) {
    const result = await request({ ...body, confirmed: true });
    if (result.status === 'accepted') await onChanged(); else await refresh();
  }
  async function refresh() {
    const value = await request(); rows.replaceChildren();
    const pending = value.handovers.find(h => h.status === 'pending');
    const label = id => value.candidates.find(c => c.id === id)?.runescapeName || `Character ${id.slice(-6)}`;
    if (pending) {
      rows.append(el('p', `Ownership offer to ${label(pending.toCharacterId)}. The current owner stays responsible until acceptance.`));
      if (pending.toCharacterId === characterId) rows.append(button('Accept ownership', () => resolved({ action: 'accept', id: pending.id })), button('Decline ownership', () => resolved({ action: 'decline', id: pending.id })));
      if (pending.fromCharacterId === characterId) rows.append(button('Cancel handover', () => resolved({ action: 'cancel', id: pending.id })));
    } else if (value.ownerCharacterId === characterId) {
      if (!value.candidates.length) { rows.append(el('p', 'Invite another character before handing over this solo group.')); return; }
      const select = el('select'), field = el('label', 'Successor character');
      for (const c of value.candidates) { const option = el('option', `${label(c.id)}${c.sameLogin ? ' · Your login' : ''}`); option.value = c.id; select.append(option); }
      field.append(select);
      const consequences = el('p'), update = () => { consequences.textContent = value.candidates.find(c => c.id === select.value)?.sameLogin
        ? 'This designates your other character immediately. Your selected character becomes a player.' : 'Send an ownership offer. You stay owner until this character’s login accepts.'; };
      select.addEventListener('change', update); update();
      // Preserve request/target through uncertain responses. Reopening reads the
      // durable pending proposal instead of making a second one.
      let attempt;
      rows.append(field, consequences, button('Confirm successor', async () => {
        if (!attempt || attempt.targetCharacterId !== select.value) attempt = { action: 'propose', requestId: randomId(), targetCharacterId: select.value };
        await resolved(attempt);
      }));
    } else rows.append(el('p', 'No ownership offer for this character.'));
  }
  root.append(button('Refresh ownership', refresh)); void refresh().catch(e => { error.textContent = e.message; }); return root;
}
