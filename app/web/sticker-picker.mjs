// One quick picker serves the map menu and chunk panel; labels use the full editor.
import { stickerDefinitions, resolveMemberStickers, MAX_STICKERS_PER_CHUNK } from '../core/map-markers.mjs';
import { stickerAsset, stickerGlyph, stickerFont, stickerLabel, loadStickerFont } from './map-tools.mjs';
const FAVOURITES = ['star', 'heart', 'skull', 'skull-crossbones', 'exclamation-circle', 'flag', 'crown', 'gem', 'lock', 'unlock-alt', 'clock', 'hourglass', 'map-marker-alt', 'circle-question', 'thumbs-up', 'thumbs-down', 'mining', 'smithing', 'woodcutting', 'fishing', 'cooking', 'quest', 'clue', 'achievements'];
const COLOURS = ['#ffffff', '#f5c451', '#e5484d', '#e69a4c', '#7fc98f', '#6fa8ff', '#b48cff', '#141414'];
const NUMBERS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
const GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'F']);
const groupOf = id => stickerAsset(id) ? 'Skills & activities' : NUMBERS.has(id) ? 'Numbers' : GRADES.has(id) ? 'Grades' : 'Symbols';
const RECENT_KEY = 'picker.recentStickers';
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').filter(id => stickerDefinitions.some(item => item.id === id)); } catch { return []; } }
function remember(id) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter(item => item !== id)].slice(0, 8))); } catch { /* per-browser convenience only */ } }
export function createStickerPicker({ el, button, command, host, state, memberId, member, world, openFullDialog, showError }) {
  const popover = el('div', undefined, 'sticker-popover'), toast = el('div', undefined, 'map-toast');
  popover.hidden = true; toast.hidden = true; popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Choose stickers');
  host.append(popover, toast);
  let chunkId = null, ownerId, revision, generation = 0, selectedId = null, busy = false, colour = COLOURS[1], showAll = false, toastTimer;
  let placement, onClose, returnFocus;
  const current = () => {
    const owner = state().members.find(value => value.id === ownerId);
    return chunkId && owner ? resolveMemberStickers(state(), owner)[chunkId] ?? [] : [];
  };
  const face = (id, size, tint = colour) => {
    const asset = stickerAsset(id);
    if (asset) { const img = el('img'); img.src = asset; img.alt = ''; img.width = img.height = size; return img; }
    const glyph = el('span', stickerGlyph(id), 'sticker-glyph');
    glyph.style.color = tint; glyph.style.fontFamily = stickerFont(id); glyph.style.fontSize = `${Math.round(size * .8)}px`;
    return glyph;
  };
  function close(options = {}) {
    const target = returnFocus; returnFocus = undefined;
    const notify = onClose; onClose = null; placement = null;
    generation++; popover.hidden = true; popover.replaceChildren(); chunkId = null; busy = false;
    notify?.(options);
    if (options.restoreFocus && !notify) {
      (target?.isConnected && !target.closest?.('[hidden]') ? target : host.querySelector?.('#map-hover'))?.focus();
    }
  }
  function position() {
    if (!placement || popover.hidden) return;
    const box = host.getBoundingClientRect();
    const viewport = host.ownerDocument?.defaultView;
    const left = Math.max(box.left, 0) + 8, top = Math.max(box.top, 0) + 8;
    const right = Math.min(box.left + box.width, viewport?.innerWidth ?? Infinity) - 8;
    const bottom = Math.min(box.top + box.height, viewport?.innerHeight ?? Infinity) - 8;
    popover.style.maxWidth = `${Math.max(0, right - left)}px`;
    popover.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const width = popover.offsetWidth || 284, height = popover.offsetHeight || 420;
    let x = placement.x, y = placement.y;
    if (placement.beside) {
      const menu = placement.beside.getBoundingClientRect(), anchor = placement.anchor.getBoundingClientRect();
      x = menu.right + 4;
      if (x + width > right) x = menu.left - width - 4;
      // On narrow screens overlap the menu instead of clipping the catalogue.
      if (x < left) x = right - width;
      y = anchor.top;
    }
    popover.style.left = `${Math.max(left, Math.min(x, right - width)) - box.left}px`;
    popover.style.top = `${Math.max(top, Math.min(y, bottom - height)) - box.top}px`;
  }
  function focus() { popover.querySelector?.('input[type=search]')?.focus(); }
  function flash(text) {
    clearTimeout(toastTimer);
    const toastRevision = revision;
    const undo = button('Undo', async () => {
      if (busy || undo.disabled) return;
      const token = generation; undo.disabled = true; busy = true;
      if (chunkId) render();
      try {
        const response = await command({ type: 'undo' }, toastRevision);
        if (token !== generation) return;
        toast.hidden = true; revision = response?.state?.revision ?? state().revision;
      } catch (error) { if (token === generation) { showError(error); undo.disabled = false; } }
      finally { if (token === generation) { busy = false; if (chunkId) render(); } }
    }, 'toast-undo');
    toast.replaceChildren(el('span', text), undo); toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
  }
  async function mutate(payload, message, after) {
    if (busy || !chunkId) return;
    const token = generation, target = chunkId, owner = ownerId;
    busy = true; render(true);
    try {
      const response = await command({ ...payload, memberId: owner, chunkId: target }, revision);
      if (generation !== token) return;
      revision = response?.state?.revision ?? state().revision;
      after?.(); flash(`${message} ${world().chunks.get(target)?.name ?? target}`);
    } catch (error) { if (generation === token) showError(error); }
    finally { if (generation === token) { busy = false; render(true); } }
  }
  function place(id) {
    if (current().length >= MAX_STICKERS_PER_CHUNK) return;
    return mutate({ type: 'add-sticker', sticker: { type: id, color: colour, text: '' } }, `${capital(stickerLabel(id))} added to`, () => { remember(id); selectedId = null; });
  }
  function render(focusSearch = false, focusLabel) {
    const existing = current(), selected = existing.find(sticker => sticker.id === selectedId);
    if (!selected) selectedId = null;
    const query = popover.querySelector?.('input[type=search]')?.value?.trim().toLowerCase() ?? '';
    const head = el('div', undefined, 'sticker-popover-head');
    head.append(el('strong', `Stickers · ${world().chunks.get(chunkId)?.name ?? chunkId}`), button('×', () => close({ restoreFocus: true }), 'close-button'));
    head.lastChild.setAttribute('aria-label', 'Close sticker picker');
    const list = el('div', undefined, 'sticker-current-list'); list.setAttribute('aria-label', 'Current stickers');
    for (const sticker of existing) {
      const row = el('div', undefined, 'sticker-current-item');
      const selectLabel = `Select ${stickerLabel(sticker.type)}${sticker.text ? `: ${sticker.text}` : ''}`;
      const choose = button('', () => { if (busy) return; selectedId = sticker.id; colour = sticker.color; render(false, selectLabel); }, 'sticker-current-select');
      choose.append(face(sticker.type, 20, sticker.color)); choose.title = sticker.text || stickerLabel(sticker.type);
      choose.setAttribute('aria-label', selectLabel);
      choose.setAttribute('aria-pressed', String(selectedId === sticker.id)); choose.disabled = busy;
      const remove = button('×', () => mutate({ type: 'remove-sticker', stickerId: sticker.id }, 'Sticker removed from', () => { if (selectedId === sticker.id) selectedId = null; }), 'sticker-current-remove');
      remove.setAttribute('aria-label', `Remove ${stickerLabel(sticker.type)}`); remove.disabled = busy;
      row.append(choose, remove); list.append(row);
    }
    const status = el('p', busy ? 'Saving stickers…' : existing.length >= MAX_STICKERS_PER_CHUNK ? `${MAX_STICKERS_PER_CHUNK} stickers · remove one to add another.` : `${existing.length}/${MAX_STICKERS_PER_CHUNK} stickers · choose below to add.`, 'status-detail sticker-picker-status');
    status.setAttribute('role', 'status');
    const search = el('input'); search.type = 'search'; search.value = query; search.placeholder = 'Search: skull, mining, 3…'; search.setAttribute('aria-label', 'Search stickers');
    const grid = el('div', undefined, 'sticker-quick-grid');
    const matches = def => !query || def.id.toLowerCase().includes(query) || stickerLabel(def.id).toLowerCase().includes(query);
    const ordered = [...new Set([...recent(), ...FAVOURITES])].map(id => stickerDefinitions.find(def => def.id === id)).filter(Boolean);
    const cell = def => {
      const option = button('', () => place(def.id), 'sticker-quick-option');
      option.title = stickerLabel(def.id); option.setAttribute('aria-label', `Add ${stickerLabel(def.id)}`);
      option.disabled = busy || existing.length >= MAX_STICKERS_PER_CHUNK;
      option.append(face(def.id, 22)); return option;
    };
    let first = null;
    if (query || showAll) {
      for (const group of ['Symbols', 'Skills & activities', 'Numbers', 'Grades']) {
        const defs = stickerDefinitions.filter(def => groupOf(def.id) === group && matches(def));
        if (!defs.length) continue;
        grid.append(el('p', group, 'sticker-quick-group'));
        for (const def of defs) { grid.append(cell(def)); first ??= def.id; }
      }
      if (!first) grid.append(el('p', 'No sticker matches that.', 'status-detail'));
    } else { for (const def of ordered.slice(0, 24)) { grid.append(cell(def)); first ??= def.id; } }
    search.addEventListener('input', () => render(true));
    search.style.fontSize = 'var(--type-input-mobile)';
    search.addEventListener('keydown', event => { if (event.key === 'Enter' && first) { event.preventDefault(); place(first); } else if (event.key === 'Escape') { event.stopPropagation?.(); close({ restoreFocus: true }); } });
    const more = query ? null : button(showAll ? 'Show favourites' : `Show all ${stickerDefinitions.length}`, () => { showAll = !showAll; render(); }, 'sticker-quick-link');
    const colours = el('div', undefined, 'sticker-quick-colours');
    colours.setAttribute('role', 'group'); colours.setAttribute('aria-label', selected ? 'Selected sticker colour' : 'New sticker colour');
    for (const value of COLOURS) {
      const dot = button('', () => {
        if (busy) return;
        if (selected) return mutate({ type: 'update-sticker', stickerId: selected.id, sticker: { type: selected.type, color: value, text: selected.text } }, 'Sticker recoloured on', () => { colour = value; });
        colour = value; render();
      }, 'colour-dot');
      dot.style.background = value; dot.disabled = busy;
      dot.setAttribute('aria-label', `Colour ${value}`); dot.setAttribute('aria-pressed', String(colour.toLowerCase() === value)); colours.append(dot);
    }
    const colourHint = el('div', undefined, 'sticker-colour-hint');
    colourHint.append(el('span', selected ? `Colour for ${stickerLabel(selected.type)}` : 'Colour for new stickers'));
    if (selected) { const reset = button('New stickers', () => { if (!busy) { selectedId = null; render(true); } }, 'sticker-quick-link'); reset.disabled = busy; colourHint.append(reset); }
    const foot = el('div', undefined, 'sticker-popover-foot');
    const full = button('Label & more…', () => { if (busy) return; const target = chunkId; close({ fullDialog: true }); openFullDialog(target); }, 'sticker-quick-link'); full.disabled = busy; foot.append(full);
    const reload = button('Reload stickers', () => {
      if (busy || !chunkId) return;
      revision = state().revision;
      const refreshed = current().find(sticker => sticker.id === selectedId);
      if (refreshed) colour = refreshed.color;
      else selectedId = null;
      render(true);
    }, 'sticker-quick-link'); reload.disabled = busy; foot.append(reload);
    popover.replaceChildren(head, list, status, search, grid, ...(more ? [more] : []), colourHint, colours, foot);
    position();
    if (focusSearch) { search.focus(); const end = search.value.length; search.setSelectionRange?.(end, end); }
    else if (focusLabel) [...(popover.querySelectorAll?.('button[aria-label]') ?? [])].find(control => control.getAttribute('aria-label') === focusLabel)?.focus();
  }
  function open(id, options) {
    close(); placement = options; onClose = options.onClose;
    returnFocus = options.anchor ?? host.ownerDocument?.activeElement;
    generation++; chunkId = id; ownerId = memberId(); revision = state().revision; selectedId = null; busy = false; showAll = false;
    colour = member().preferences?.defaultStickerColor ?? COLOURS[1];
    popover.hidden = false; render(); if (options.focus !== false) focus();
    const token = generation;
    loadStickerFont().then(loaded => { if (loaded && generation === token && !popover.hidden) render(popover.contains?.(host.ownerDocument?.activeElement) ?? options.focus !== false); });
  }
  return { open, close, focus, position, isOpen: () => !popover.hidden, element: popover };
}

// Keep the menu and its sticker catalogue one pointer/keyboard interaction.
export function bindStickerFlyout({ picker, trigger, menu, chunkId, closeMenu, delay = 260 }) {
  const popover = picker.element, listeners = [];
  let opened = false, timer;
  const listen = (node, type, action, options) => {
    node.addEventListener(type, action, options);
    listeners.push(() => node.removeEventListener(type, action, options));
  };
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  function close(restoreFocus = false) {
    cancel();
    if (opened) picker.close({ restoreFocus });
  }
  function open(focus = false) {
    cancel();
    if (opened) { if (focus) picker.focus(); return; }
    picker.open(chunkId, { anchor: trigger, beside: menu, focus, onClose: options => {
      opened = false; cancel(); trigger.setAttribute('aria-expanded', 'false');
      if (options.restoreFocus && !menu.hidden) trigger.focus();
      if (options.fullDialog) closeMenu?.();
    } });
    opened = true; trigger.setAttribute('aria-expanded', 'true');
  }
  function leave(event) {
    if (!opened || menu.contains(event.relatedTarget) || popover.contains(event.relatedTarget)) return;
    cancel();
    timer = setTimeout(() => {
      const active = popover.ownerDocument?.activeElement;
      if (!popover.contains(active)) close();
    }, delay);
  }
  trigger.setAttribute('role', 'menuitem');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  listen(trigger, 'pointerenter', () => open());
  listen(trigger, 'click', () => open(true));
  listen(trigger, 'keydown', event => {
    if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); open(true);
    } else if (opened && ['ArrowLeft', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  });
  listen(menu, 'pointerenter', cancel);
  listen(menu, 'pointerleave', leave);
  listen(menu, 'keydown', event => {
    if (opened && ['Escape', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }, true);
  listen(popover, 'pointerenter', cancel);
  listen(popover, 'pointerleave', leave);
  // The application's outside-click listener treats this sibling as outside
  // the menu; contain the gesture while its submenu is attached.
  listen(popover, 'pointerdown', event => { if (opened) event.stopPropagation(); });
  listen(popover, 'keydown', event => {
    if (opened && ['Escape', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }, true);
  const viewport = menu.ownerDocument?.defaultView;
  if (viewport?.addEventListener) listen(viewport, 'resize', () => { if (opened) picker.position(); });
  return { close, destroy() { close(); listeners.forEach(remove => remove()); } };
}
