export function equipmentChoices(definitions, query, recorded = []) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const saved = new Set(recorded);
  return Object.entries(definitions ?? {}).filter(([name]) => !saved.has(name) && terms.every(term => name.toLowerCase().includes(term)))
    .map(([name, data]) => ({ name, slot: data.slot ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
}

// Reuses the sticker picker's search-and-choice pattern: typed text only filters
// known choices. A choice button is the only way to record an equipment name.
export function createEquipmentRecorder(context, { memberId, revision, assertCurrent, onSaved }) {
  const { el, button, plain = value => value } = context;
  const root = el('div', undefined, 'bis-recorder'), search = el('input'), matches = el('div', undefined, 'bis-equipment-choices'), status = el('p', '', 'status-detail');
  search.type = 'search'; search.placeholder = 'Search equipment…'; search.setAttribute('aria-label', 'Search equipment to record as obtained');
  status.setAttribute('role', 'status');
  let busy = false;
  const render = () => {
    const member = context.state().members.find(row => row.id === memberId);
    const rows = equipmentChoices(context.definitions?.()?.equipment, search.value, member?.obtainedEquipment);
    const searching = search.value.trim().length > 0;
    matches.replaceChildren();
    status.textContent = busy ? 'Saving…' : !searching ? 'Search for an item, then choose it below.' : rows.length ? `${rows.length} matches${rows.length > 30 ? ' · showing the first 30; keep typing to narrow the list' : ''}` : 'No equipment matches. Try another search.';
    if (!searching) return;
    for (const row of rows.slice(0, 30)) {
      const choice = button(plain(row.name), async () => {
        if (busy) return;
        assertCurrent(); busy = true; search.disabled = true; render();
        try {
          await context.command({ type: 'set-obtained-equipment', memberId, equipmentName: row.name, obtained: true }, revision);
          await onSaved();
        } finally { busy = false; search.disabled = false; render(); }
      }, 'bis-equipment-choice');
      choice.setAttribute('aria-label', `Record ${plain(row.name)} as obtained`); choice.disabled = busy;
      matches.append(choice);
    }
  };
  search.addEventListener('input', render);
  root.append(el('h3', 'Record gear you got elsewhere'), el('p', 'Choose gear you got from a drop, a trade or before you used the picker. You can undo this in History.'), search, status, matches);
  render(); return root;
}

export function createHandRecordActions(context, { item, memberId, revision, canRemove, assertCurrent, onSaved }) {
  const { el, button, plain = value => value } = context, actions = el('div', undefined, 'bis-record-actions');
  actions.append(el('small', 'Added by hand', 'bis-manual-marker'));
  if (canRemove()) {
    const remove = button('Remove', async () => {
      assertCurrent(); remove.disabled = true;
      try {
        await context.command({ type: 'set-obtained-equipment', memberId, equipmentName: item.name, obtained: false }, revision);
        await onSaved();
      } finally { remove.disabled = false; }
    });
    remove.setAttribute('aria-label', `Remove hand record for ${plain(item.name)}`); actions.append(remove);
  }
  return actions;
}
