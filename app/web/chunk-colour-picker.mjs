import { CHUNK_COLOURS, LEGACY_CHUNK_COLOURS, MAX_CHUNK_COLOUR_NAME_LENGTH, resolveMemberChunkColours, resolveMemberChunkColourNames } from '../core/chunk-colours.mjs';

export function colourSwatch(el, id) {
  const swatch = el('i', undefined, `chunk-colour-swatch chunk-colour-${id}`);
  swatch.setAttribute('aria-hidden', 'true');
  return swatch;
}

// A quick annotation picker, using the same entry points as stickers.
export function createChunkColourPicker({ el, button, host, state, memberId, canWrite, command, chunkName, closeOthers }) {
  const panel = el('div', undefined, 'chunk-colour-picker');
  panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chunk colour');
  host.append(panel);
  let chunkId, ownerId, revision, generation = 0, busy = false, message = '', renameOpen = false, trigger;
  const owner = () => state().members.find(member => member.id === ownerId);
  const current = token => generation === token && memberId() === ownerId && canWrite();
  function close(restoreFocus = false) {
    generation++; panel.hidden = true; panel.replaceChildren(); chunkId = undefined; busy = false;
    if (restoreFocus) { if (trigger?.isConnected) trigger.focus(); else host.querySelector('#map-hover')?.focus(); }
  }
  async function save(payload) {
    if (busy || !chunkId || !current(generation)) return;
    const member = owner();
    if (payload.type === 'rename-chunk-colour' && resolveMemberChunkColourNames(state(), member)[payload.colour] === payload.name) return;
    const existing = resolveMemberChunkColours(state(), member)[chunkId] ?? [];
    if (payload.type === 'set-chunk-colour' && (payload.colour === null ? !existing.length : existing.length === 1 && existing[0] === payload.colour)) return;
    const token = generation;
    busy = true; message = 'Saving colour…'; render();
    try {
      const response = await command({ ...payload, memberId: ownerId }, revision, undefined, () => current(token));
      if (!current(token)) return;
      revision = response?.state?.revision ?? state().revision;
      message = payload.type === 'rename-chunk-colour' ? 'Colour name saved.' : payload.colour === null ? 'Colour cleared.' : 'Colour saved.';
    } catch (error) {
      if (current(token)) message = error.status === 409 ? 'Another save arrived. Reload colours, then try again.' : error.message;
    } finally { if (current(token)) { busy = false; render(); } }
  }
  function render() {
    const member = owner(); if (!member) { close(); return; }
    const names = resolveMemberChunkColourNames(state(), member), colours = resolveMemberChunkColours(state(), member)[chunkId] ?? [];
    const heading = el('div', undefined, 'chunk-colour-heading');
    const dismiss = button('×', () => close(true), 'close-button'); dismiss.setAttribute('aria-label', 'Close chunk colours');
    heading.append(el('strong', `Colour · ${chunkName(chunkId)}`), dismiss);
    const choices = el('div', undefined, 'chunk-colour-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', `${member.name}’s chunk colour`);
    for (const colour of CHUNK_COLOURS) {
      const choice = button('', () => save({ type: 'set-chunk-colour', chunkId, colour: colour.id }), 'chunk-colour-choice');
      choice.append(colourSwatch(el, colour.id), el('span', names[colour.id]));
      choice.setAttribute('aria-label', `Tint ${names[colour.id]}`); choice.setAttribute('aria-pressed', String(colours.length === 1 && colours[0] === colour.id));
      choice.disabled = busy; choices.append(choice);
    }
    const clear = button('Clear colour', () => save({ type: 'set-chunk-colour', chunkId, colour: null })); clear.disabled = busy || !colours.length;
    const status = el('p', message || `${member.name}’s map`, 'status-detail'); status.setAttribute('role', 'status');
    const rename = el('details', undefined, 'chunk-colour-names'); rename.open = renameOpen;
    rename.append(el('summary', 'Name colours')); rename.addEventListener('toggle', () => { renameOpen = rename.open; });
    for (const colour of CHUNK_COLOURS) {
      const row = el('form', undefined, 'chunk-colour-name-row'), input = el('input');
      input.type = 'text'; input.value = names[colour.id]; input.maxLength = MAX_CHUNK_COLOUR_NAME_LENGTH; input.required = true;
      input.setAttribute('aria-label', `${colour.label} colour name`); input.disabled = busy;
      const submit = el('button', 'Save'); submit.type = 'submit'; submit.disabled = busy;
      submit.setAttribute('aria-label', `Save ${colour.label.toLowerCase()} colour name`);
      row.addEventListener('submit', event => { event.preventDefault(); if (input.value.trim()) save({ type: 'rename-chunk-colour', colour: colour.id, name: input.value.trim() }); });
      row.append(colourSwatch(el, colour.id), input, submit); rename.append(row);
    }
    const reload = button('Reload colours', () => { if (busy) return; revision = state().revision; message = 'Latest colours loaded.'; render(); }, 'chunk-colour-reload'); reload.disabled = busy; reload.hidden = revision === state().revision;
    panel.replaceChildren(heading, choices, clear, status, rename, reload);
  }
  function open(id, source) {
    if (!canWrite()) return;
    closeOthers?.(); close(); trigger = source; chunkId = String(id); ownerId = memberId(); revision = state().revision;
    renameOpen = false; message = ''; panel.hidden = false; render(); panel.querySelector('button[aria-pressed=true]')?.focus();
    if (!panel.contains(host.ownerDocument?.activeElement)) panel.querySelector('button.chunk-colour-choice')?.focus();
  }
  return { open, close, element: panel, isOpen: () => !panel.hidden };
}

export function createScreenChunkColours(c) {
  const picker = createChunkColourPicker({ el: c.el, button: c.button, host: c.$('map-panel'), state: () => c.state, memberId: () => c.memberId,
    canWrite: () => c.canWrite() && !c.sandbox.active, command: c.command, chunkName: id => c.plain(c.world.chunks.get(id)?.name ?? id),
    closeOthers: () => { c.closeChunkMenu(); c.stickerPicker?.close(); } });
  function action(id) {
    if (!c.canWrite() || c.sandbox.active || !c.world.surface.has(id)) return null;
    const control = c.button('Colour', () => picker.open(id, control), 'chunk-colour-action'); return control;
  }
  function summary(id) {
    const row = c.el('div', undefined, 'chunk-colour-summary');
    const members = c.$('group-view').checked ? c.state.members : [c.member()];
    for (const member of members) {
      const colours = resolveMemberChunkColours(c.state, member)[id] ?? [], names = resolveMemberChunkColourNames(c.state, member);
      for (const colour of colours) { const chip = c.el('span', undefined, 'chunk-colour-label'); chip.append(colourSwatch(c.el, colour), `${member.name}: ${names[colour]}`); row.append(chip); }
    }
    return row;
  }
  document.addEventListener('pointerdown', event => { if (picker.isOpen() && !picker.element.contains(event.target) && !event.target.closest?.('.chunk-colour-action')) picker.close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && picker.isOpen()) { event.preventDefault(); event.stopImmediatePropagation(); picker.close(true); } }, true);
  c.$('member').addEventListener('change', () => picker.close());
  c.$('map-stage').addEventListener('wheel', () => picker.close(), { passive: true });
  c.chunkColours = { picker, action, summary };
}

export function chunkColourLegend(c, members) {
  const group = c.el('div', undefined, 'legend-chunk-colours');
  for (const member of members) {
    const names = resolveMemberChunkColourNames(c.state, member), row = c.el('div', undefined, 'legend-colour-row');
    row.append(c.el('span', `${member.name}’s colours`, 'legend-colour-title'));
    const used = new Set(Object.values(resolveMemberChunkColours(c.state, member)).flat());
    const colours = [...CHUNK_COLOURS, ...LEGACY_CHUNK_COLOURS.filter(colour => !CHUNK_COLOURS.some(slot => slot.id === colour.id) && used.has(colour.id))];
    for (const colour of colours) { const key = c.el('span', undefined, 'legend-item'); key.append(colourSwatch(c.el, colour.id), names[colour.id]); row.append(key); }
    group.append(row);
  }
  return group;
}
