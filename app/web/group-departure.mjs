export function departureControls({ el, fetch = globalThis.fetch, characterId, scopeHeaders, beforeSwitch = async () => {}, location = globalThis.location, randomId = () => crypto.randomUUID() }) {
  const root = el('div', undefined, 'form-stack'), rows = el('div'), error = el('p'); error.setAttribute('role', 'alert');
  root.append(el('p', 'Leaving creates a new empty solo for this character. Its current map and full history are frozen in Past maps, read-only and exportable. The group keeps its progress, but this character stops contributing access, supplies and task completion. Old slot keys are revoked. Rejoining needs a fresh owner invitation and starts from that group’s map.'), rows, error);
  const request = async body => {
    const r = await fetch('/api/group-departure', { credentials: 'same-origin', cache: 'no-store', headers: { ...scopeHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const value = await r.json(); if (!r.ok) throw new Error(value.message || 'Departure is unavailable.'); return value;
  };
  const button = (label, work) => { const b = el('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; error.textContent = ''; try { await work(); } catch (e) { error.textContent = e.message + ' Retry this same confirmation to recover its result. An interrupted group change stays pending until recovery.'; } finally { b.disabled = false; } }); return b; };
  async function load() {
    const value = await request(); rows.replaceChildren();
    if (value.solo) { rows.append(el('h3', 'Join another group'), el('p', 'Your solo stays available. Open a fresh player invitation from a group owner to join another group.')); return; }
    const owner = value.ownerCharacterId === characterId;
    if (owner) rows.append(el('p', 'Complete Group ownership handover first to leave your own character. You may remove a non-owner member below.'));
    const select = el('select'), label = el('label', owner ? 'Member to remove' : 'Character leaving');
    const choices = value.roster.filter(c => !c.owner && (owner || c.id === characterId));
    for (const c of choices) { const option = el('option', c.runescapeName || `Character ${c.id.slice(-6)}`); option.value = c.id; select.append(option); }
    label.append(select); rows.append(label);
    const acknowledge = el('input'); acknowledge.type = 'checkbox'; const confirmation = el('label'); confirmation.append(acknowledge, el('span', 'I reviewed the empty solo, preserved Past map, group contribution changes and key revocation.'));
    if (value.backups?.message) rows.append(el('p', value.backups.message));
    rows.append(confirmation);
    let attempt;
    rows.append(button(owner ? 'Confirm member removal' : 'Confirm leave', async () => {
      if (!acknowledge.checked) throw new Error('Confirm the reviewed consequences first.');
      if (!attempt || attempt.characterId !== select.value) attempt = { requestId: randomId(), characterId: select.value, revision: value.revision, confirmed: true };
      await beforeSwitch();
      const result = await request(attempt);
      if (result.character) location.assign(result.character.href); else { error.textContent = result.message; location.reload(); }
    }));
  }
  root.append(button('Refresh departure review', load)); void load().catch(e => { error.textContent = e.message; }); return root;
}
