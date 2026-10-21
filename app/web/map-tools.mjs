import { stickerDefinitions, resolveMemberStickers, resolveStartingChunk, MAX_STICKERS_PER_CHUNK } from '../core/map-markers.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';

// Declarative colours from the retained picker's nine named themes. The names
// below map those values onto the authored interface's existing CSS variables.
export const themePalettes = Object.freeze({
  // Dark, gray and light are the duo picker's own warm "ledger" palettes; the other seven keep the retained picker's colours.
  light: { bg: '#ece5d6', panel: '#faf6ec', surface: '#efe7d5', border: '#d5c9b1', text: '#2a241b', muted: '#5c5243', link: '#80520a', accent: '#efe7d5', focus: '#8f6100', fog: 'rgba(222,213,193,.6)', highvisFog: 'rgba(222,213,193,.38)', mapBg: '#d6ccb6', scheme: 'light' },
  gray: { bg: '#2b2926', panel: '#35332f', surface: '#46433e', border: '#5a5650', text: '#f1ece2', muted: '#cdc5b8', link: '#f0c770', accent: '#46433e', focus: '#ffd166', fog: 'rgba(86,82,76,.58)', highvisFog: 'rgba(86,82,76,.38)', mapBg: '#23211e', scheme: 'dark' },
  dark: { bg: '#141310', panel: '#1c1a16', surface: '#2b2822', border: '#3b372f', text: '#ece4d3', muted: '#b9af9d', link: '#e8bd68', accent: '#2b2822', focus: '#f5c451', fog: 'rgba(40,37,32,.62)', highvisFog: 'rgba(40,37,32,.42)', mapBg: '#0f0e0b', scheme: 'dark' },
  terminal: { bg: '#141414', panel: '#0a0a0a', surface: '#282828', border: '#414141', text: '#00ff00', muted: '#66ff00', link: '#ffb000', accent: '#282828', focus: '#ffcc00', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'dark' },
  neon: { bg: '#141e3c', panel: '#071637', surface: '#182336', border: '#263449', text: '#f005cd', muted: '#b30ea3', link: '#fbe488', accent: '#182336', focus: '#ffcc00', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'dark' },
  pumpkin: { bg: '#141414', panel: '#0a0a0a', surface: '#282828', border: '#414141', text: '#e45f06', muted: '#eb6710', link: '#ffb000', accent: '#282828', focus: '#ffcc00', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'dark' },
  mono: { bg: '#141414', panel: '#0a0a0a', surface: '#282828', border: '#414141', text: '#ffffff', muted: '#dcdcdc', link: '#b9b9b9', accent: '#282828', focus: '#9b9b9b', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'dark' },
  winter: { bg: '#9bc8f0', panel: '#cbe8ff', surface: '#a5cce7', border: '#abd8ff', text: '#354f5c', muted: '#455f6f', link: '#3cafff', accent: '#a5cce7', focus: '#ffcc00', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'light' },
  autumn: { bg: '#283618', panel: '#606c38', surface: '#734619', border: '#5f2805', text: '#dda15e', muted: '#e8ab68', link: '#9a0f37', accent: '#734619', focus: '#9b9b9b', fog: 'rgba(50,50,50,.6)', highvisFog: 'rgba(50,50,50,.4)', scheme: 'dark' },
  voyage: { bg: '#05141a', panel: '#081f36', surface: '#123b5e', border: '#184c76', text: '#a7d9ef', muted: '#87c9e8', link: '#22b6ff', accent: '#123b5e', focus: '#cccc00', fog: 'rgba(19,59,80,.6)', highvisFog: 'rgba(19,59,80,.4)', scheme: 'dark' },
});

const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
function luminance(color) {
  const [red, green, blue] = rgb(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
export function contrastRatio(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function readableColor(foreground, background, minimum = 4.5) {
  return readableColorAgainst(foreground, [background], minimum);
}
function readableColorAgainst(foreground, backgrounds, minimum = 4.5) {
  const lowestContrast = color => Math.min(...backgrounds.map(background => contrastRatio(color, background)));
  if (lowestContrast(foreground) >= minimum) return foreground;
  const target = lowestContrast('#ffffff') > lowestContrast('#000000') ? 255 : 0;
  const channels = rgb(foreground);
  for (let percent = 1; percent <= 100; percent++) {
    const mixed = `#${channels.map(channel => Math.round(channel + (target - channel) * percent / 100).toString(16).padStart(2, '0')).join('')}`;
    if (lowestContrast(mixed) >= minimum) return mixed;
  }
  return target ? '#ffffff' : '#000000';
}
const mixColor = (foreground, background, proportion) => {
  const under = rgb(background);
  return `#${rgb(foreground).map((channel, index) => Math.round(channel * proportion + under[index] * (1 - proportion)).toString(16).padStart(2, '0')).join('')}`;
};

/** Keep source palette data intact and derive readable component foregrounds. */
export function applyTheme(root, theme, completedTaskColor = '#a5d2be') {
  const palette = themePalettes[theme] ?? themePalettes.dark;
  // Match the opaque equivalents of the section and hovered row CSS layers:
  // task groups sit flat on the panel and a hovered row takes a light surface tint.
  const taskBackground = palette.panel;
  const taskHoverBackground = mixColor(palette.surface, taskBackground, .6);
  const taskBackgrounds = [taskBackground, taskHoverBackground];
  root.dataset.theme = themePalettes[theme] ? theme : 'dark';
  root.style.colorScheme = palette.scheme;
  for (const [key, value] of Object.entries(palette)) if (!['scheme', 'fog', 'highvisFog', 'mapBg'].includes(key)) root.style.setProperty(`--${key}`, value);
  root.style.setProperty('--map-bg', palette.mapBg ?? '#060b10');
  root.dataset.scheme = palette.scheme;
  const derived = {
    text: readableColor(palette.text, palette.bg), muted: readableColor(palette.muted, palette.bg), link: readableColor(palette.link, palette.bg),
    'panel-text': readableColor(palette.text, palette.panel), 'panel-muted': readableColor(palette.muted, palette.panel), 'panel-link': readableColor(palette.link, palette.panel),
    'surface-text': readableColor(palette.text, palette.surface), 'surface-muted': readableColor(palette.muted, palette.surface), 'surface-link': readableColor(palette.link, palette.surface),
    focus: readableColorAgainst(palette.focus, [palette.bg, palette.panel, palette.surface], 3),
    'task-text': readableColorAgainst(palette.text, taskBackgrounds, 4.55), 'task-muted': readableColorAgainst(palette.muted, taskBackgrounds, 4.55), 'task-link': readableColorAgainst(palette.link, taskBackgrounds, 4.55),
    'completed-colour': readableColorAgainst(completedTaskColor, taskBackgrounds, 4.55),
  };
  for (const [key, value] of Object.entries(derived)) root.style.setProperty(`--${key}`, value);
  return palette;
}

const definitionsById = new Map(stickerDefinitions.map(definition => [definition.id, definition]));
const symbolCodes = { skull: 0xf54c, 'skull-crossbones': 0xf714, bomb: 0xf1e2, 'exclamation-circle': 0xf06a, dice: 0xf522, poo: 0xf2fe, frown: 0xf119, 'grin-alt': 0xf581, heart: 0xf004, star: 0xf005, gem: 0xf3a5, award: 0xf559, crown: 0xf521, flag: 0xf024, asterisk: 0xf069, clock: 0xf017, hourglass: 0xf254, link: 0xf0c1, 'map-marker-alt': 0xf3c5, 'radiation-alt': 0xf7ba, 'shoe-prints': 0xf54b, 'thumbs-down': 0xf165, 'thumbs-up': 0xf164, crow: 0xf520, 'utensil-spoon': 0xf2e5, lock: 0xf023, 'unlock-alt': 0xf13e, sailboat: 0xe445, anchor: 0xf13d, 'circle-question': 0xf059 };
let fontLoaded = false, fontPromise;
export function loadStickerFont() {
  if (selectedDataset.capabilities?.independent === true) return Promise.resolve(false);
  if (fontPromise) return fontPromise;
  if (typeof globalThis.FontFace !== 'function' || typeof document === 'undefined') return Promise.resolve(false);
  const font = new FontFace('ChunkStickerSymbols', 'url("/assets/fontawesome/fa-solid-900.woff2")', { weight: '900' });
  fontPromise = font.load().then(loaded => { document.fonts.add(loaded); fontLoaded = true; return true; }).catch(() => false);
  return fontPromise;
}
export function stickerAsset(type) { return definitionsById.get(type)?.iconUrl ?? null; }
export function stickerGlyph(type) { return fontLoaded && symbolCodes[type] ? String.fromCodePoint(symbolCodes[type]) : definitionsById.get(type)?.glyph ?? type.slice(0, 2).toUpperCase(); }
export function stickerFont(type) { return fontLoaded && symbolCodes[type] ? 'ChunkStickerSymbols' : '"Segoe UI Symbol", "Segoe UI", sans-serif'; }
export function stickerLabel(type) { return definitionsById.get(type)?.label ?? type; }

/** Only documented roll history creates entries; markers never create rolls. */
export function recentRolls(state, memberId, world, limit = 5) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Recent roll limit must be a nonnegative integer.');
  if (limit === 0) return [];
  const owner = state.members.find(member => member.id === memberId);
  if (!owner) throw new RangeError(`Unknown member: ${memberId}.`);
  const entries = [];
  const add = (chunkId, time, source, revision) => {
    const id = String(chunkId), at = typeof time === 'number' ? time : Date.parse(time);
    if (!Number.isFinite(at) || at <= 0 || !world.surface.has(id)) return;
    entries.push({ id, at, source, revision, unlocked: owner.unlocked.includes(id) });
  };
  for (const [time, chunkId] of Object.entries(state.legacy?.maps?.[owner.sourceMapId]?.chunkOrder ?? {})) add(chunkId, Number(time.replace(/^\*fb\*_/, '')), 'Imported roll');
  for (const event of state.history ?? []) {
    const command = event.command;
    if (event.undoneRevision || command?.memberId !== memberId) continue;
    if (['roll', 'random-start'].includes(event.type) && (command.count ?? 1) === 1) {
      for (const id of command.rolled ?? []) add(id, event.at, event.type === 'random-start' ? 'Random start' : 'Roll', event.revision);
    } else if (event.type === 'unlock-selection') add(command.chunkId, event.at, 'Chosen roll', event.revision);
    else if (event.type === 'unlock-both') {
      const full = event.undo?.members?.find(member => member.id === memberId)?.pendingRoll;
      const sparse = event.undo?.memberChanges?.find(member => member.id === memberId)?.changes?.find(change => change.path.length === 1 && change.path[0] === 'pendingRoll')?.before?.value;
      for (const id of full ?? sparse ?? []) add(id, event.at, 'Both roll choices', event.revision);
    }
  }
  entries.sort((a, b) => b.at - a.at || (b.revision ?? 0) - (a.revision ?? 0));
  const recent = [];
  for (const entry of entries) {
    const previous = recent.at(-1);
    if (previous?.id === entry.id && previous.at - entry.at <= 10000) continue;
    recent.push(entry);
    if (recent.length === limit) break;
  }
  return recent;
}

/** Context follows the existing authored UI helpers. All edits pin their owner. */
export function createMapTools(ctx) {
  const { el, button, input, select, field, openDialog, command, showError } = ctx;
  const advanced = () => ctx.canWrite?.() !== false && ctx.preferences?.()?.advanced === true;
  const chunkName = id => {
    const name = ctx.world().chunks.get(id)?.name;
    return name ? `${name}${advanced() ? ` (${id})` : ''}` : id;
  };
  function ownerContext() {
    const state = ctx.state(), id = ctx.memberId(), member = state.members.find(owner => owner.id === id);
    if (!member) throw new RangeError(`Unknown member: ${id}.`);
    return { state, id, member, revision: state.revision };
  }
  function sticker(chunkId) {
    let generation;
    const { state, id: memberId, member, revision: initialRevision } = ownerContext();
    if (!ctx.world().surface.has(chunkId)) throw new RangeError(`Unknown surface chunk: ${chunkId}.`);
    let revision = initialRevision, stickers = resolveMemberStickers(state, member)[chunkId] ?? [], selectedId = stickers[0]?.id ?? null, busy = false;
    const content = el('div', undefined, 'form-stack'), list = el('div', undefined, 'sticker-editor-list');
    list.setAttribute('aria-label', 'Current stickers');
    const status = el('p', '', 'status-detail'); status.setAttribute('role', 'status');
    const type = { value: stickers[0]?.type ?? 'star' };
    const color = input('color', stickers[0]?.color ?? ctx.preferences(memberId).defaultStickerColor ?? '#ffffff');
    const text = el('textarea'); text.value = stickers[0]?.text ?? ''; text.maxLength = 5000;
    const preview = el('div', undefined, 'marker-preview'), grid = el('div', undefined, 'sticker-grid');
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Sticker type');
    const stickerFace = (id, size, tint = color.value) => {
      const asset = stickerAsset(id);
      if (asset) { const img = el('img'); img.src = asset; img.alt = ''; img.width = img.height = size; return img; }
      const glyph = el('span', stickerGlyph(id), 'sticker-glyph'); glyph.style.color = tint; glyph.style.fontFamily = stickerFont(id); glyph.style.fontSize = `${size * .75}px`; return glyph;
    };
    const renderGrid = () => {
      grid.replaceChildren(...stickerDefinitions.map(definition => {
        const option = button('', () => { if (!ctx.dialogCurrent(generation) || busy) return; type.value = definition.id; renderGrid(); renderPreview(); }, 'sticker-option');
        option.title = definition.label; option.setAttribute('aria-label', definition.label); option.setAttribute('aria-pressed', String(type.value === definition.id)); option.disabled = busy;
        option.append(stickerFace(definition.id, 24), el('span', definition.label, 'sticker-option-label')); return option;
      }));
    };
    const renderPreview = () => {
      preview.replaceChildren(stickerFace(type.value, 32), el('span', text.value || stickerLabel(type.value)));
    };
    function choose(sticker) {
      if (busy || !ctx.dialogCurrent(generation)) return;
      selectedId = sticker?.id ?? null;
      type.value = sticker?.type ?? 'star'; color.value = sticker?.color ?? ctx.preferences(memberId).defaultStickerColor ?? '#ffffff'; text.value = sticker?.text ?? '';
      renderList(); renderGrid(); renderPreview();
    }
    async function mutate(payload, after) {
      if (!ctx.dialogCurrent(generation) || busy) return;
      busy = true; renderList(); renderGrid();
      try {
        const response = await command({ ...payload, memberId, chunkId }, revision);
        if (!ctx.dialogCurrent(generation)) return;
        const nextState = response?.state ?? ctx.state(), nextMember = nextState.members.find(owner => owner.id === memberId);
        revision = nextState.revision; stickers = resolveMemberStickers(nextState, nextMember)[chunkId] ?? [];
        after?.();
        if (selectedId && !stickers.some(sticker => sticker.id === selectedId)) { selectedId = null; text.value = ''; }
      } catch (error) { if (ctx.dialogCurrent(generation)) showError(error); }
      finally { if (ctx.dialogCurrent(generation)) { busy = false; renderList(); renderGrid(); renderPreview(); } }
    }
    const save = button('Save sticker', () => {
      const value = { type: type.value, color: color.value, text: text.value };
      if (!selectedId && stickers.length >= MAX_STICKERS_PER_CHUNK) return;
      return mutate(selectedId ? { type: 'update-sticker', stickerId: selectedId, sticker: value } : { type: 'add-sticker', sticker: value }, () => {
        if (!selectedId) text.value = '';
      });
    });
    const add = button('New sticker', () => choose(null));
    const clear = button('Clear all stickers', () => mutate({ type: 'clear-stickers' }, () => { selectedId = null; text.value = ''; }));
    const reload = button('Reload stickers', () => {
      if (!ctx.dialogCurrent(generation) || busy) return;
      const latest = ctx.state(), owner = latest.members.find(value => value.id === memberId);
      revision = latest.revision; stickers = resolveMemberStickers(latest, owner)[chunkId] ?? [];
      choose(stickers.find(sticker => sticker.id === selectedId) ?? null);
    });
    function renderList() {
      list.replaceChildren();
      for (const sticker of stickers) {
        const row = el('div', undefined, 'sticker-editor-item');
        const chooseButton = button('', () => choose(sticker), 'sticker-editor-select'); chooseButton.disabled = busy;
        chooseButton.setAttribute('aria-label', `Edit ${stickerLabel(sticker.type)}${sticker.text ? `: ${sticker.text}` : ''}`);
        chooseButton.setAttribute('aria-pressed', String(selectedId === sticker.id));
        chooseButton.append(stickerFace(sticker.type, 24, sticker.color), el('span', sticker.text || stickerLabel(sticker.type)));
        const remove = button('Remove', () => mutate({ type: 'remove-sticker', stickerId: sticker.id }), 'sticker-quick-link danger-link'); remove.disabled = busy;
        remove.setAttribute('aria-label', `Remove ${stickerLabel(sticker.type)}`); row.append(chooseButton, remove); list.append(row);
      }
      status.textContent = busy ? 'Saving stickers…' : `${stickers.length}/${MAX_STICKERS_PER_CHUNK} stickers · ${selectedId ? 'editing selected sticker' : 'adding a new sticker'}${stickers.length >= MAX_STICKERS_PER_CHUNK && !selectedId ? '. Remove one to add another.' : '.'}`;
      save.disabled = busy || (!selectedId && stickers.length >= MAX_STICKERS_PER_CHUNK);
      add.disabled = busy || stickers.length >= MAX_STICKERS_PER_CHUNK; clear.disabled = busy || !stickers.length; reload.disabled = busy; color.disabled = text.disabled = busy;
    }
    color.addEventListener('input', () => { renderGrid(); renderPreview(); }); text.addEventListener('input', renderPreview);
    const actions = el('div', undefined, 'sticker-editor-actions'); actions.append(add, clear, reload);
    content.append(el('p', `Stickers for ${member.name} · ${chunkName(chunkId)}. Select one to edit its symbol, colour or label.`, 'section-intro'), list, status, actions, preview, el('p', 'Sticker', 'field-title'), grid, field('Sticker colour', color), field('Sticker text', text), save);
    generation = openDialog(`${member.name}’s stickers · ${chunkName(chunkId)}`, content);
    renderList(); renderGrid(); renderPreview();
    loadStickerFont().then(loaded => { if (loaded && ctx.dialogCurrent(generation) && preview.isConnected) { renderGrid(); renderPreview(); } });
  }
  function startingChunk() {
    let generation;
    const { state, id: memberId, member, revision } = ownerContext();
    const content = el('div', undefined, 'form-stack'), search = input('search'), matches = el('div', undefined, 'search-results');
    const current = resolveStartingChunk(state, member);
    search.placeholder = 'Place name or chunk number…';
    const status = el('p', current ? `Current starting marker: ${chunkName(current)}` : 'No starting marker recorded.', 'status-detail');
    const choose = async id => {
      if (!ctx.dialogCurrent(generation)) return;
      if (id !== null && !ctx.world().surface.has(id)) throw new RangeError(`Unknown surface chunk: ${id}.`);
      try {
        await command({ type: 'set-starting-chunk', memberId, chunkId: id }, revision);
        if (!ctx.dialogCurrent(generation)) return;
        if (id) ctx.centerOnChunk(id);
        ctx.closeDialog(generation);
      } catch (error) { if (ctx.dialogCurrent(generation)) showError(error); }
    };
    const render = () => {
      const query = search.value.trim().toLowerCase();
      matches.replaceChildren();
      if (!query) return;
      const found = [...ctx.world().surface].map(id => ctx.world().chunks.get(id)).filter(chunk => `${chunk.id} ${chunk.name}`.toLowerCase().includes(query));
      matches.append(el('p', `${found.length} matching chunks${found.length > 25 ? ' · refine your search' : ''}`, 'status-detail'));
      for (const chunk of found.slice(0, 25)) {
        const row = el('div', undefined, 'search-result');
        row.append(el('span', chunkName(chunk.id)), button('Set starting marker', () => choose(chunk.id)));
        matches.append(row);
      }
    };
    search.addEventListener('input', render);
    content.append(el('p', `Record where ${member.name} began. The green flag is a map annotation; it does not unlock that chunk or prove access.`, 'section-intro'), status, field('Find starting chunk', search), matches, button('Clear starting marker', () => choose(null)));
    generation = openDialog(`${member.name}’s starting chunk`, content);
    search.focus();
  }
  function recentPanel() {
    const { state, id: memberId, member } = ownerContext();
    const recent = recentRolls(state, memberId, ctx.world());
    const panel = el('section', undefined, 'recent-rolls'); panel.setAttribute('aria-label', `${member.name}’s recent rolls`);
    panel.append(el('h3', `${member.name} · Recent Chunks`));
    if (!recent.length) { panel.append(el('p', 'No recorded rolls yet.', 'status-detail')); return panel; }
    const days = Math.max(0, Math.floor((Date.now() - recent[0].at) / 86400000));
    panel.append(el('p', `${days} ${days === 1 ? 'day' : 'days'} since last recorded roll`, 'status-detail'));
    for (const roll of recent) {
      const row = el('div', undefined, 'recent-roll');
      const date = new Date(roll.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const control = button(`${date} · ${chunkName(roll.id)}`, () => { ctx.centerOnChunk(roll.id); ctx.showChunk(roll.id); });
      control.title = `${ctx.world().chunks.get(roll.id)?.name ?? roll.id} · ${new Date(roll.at).toLocaleString()} · ${roll.source}${roll.unlocked ? '' : ' · currently locked'}`;
      row.append(control); panel.append(row);
    }
    return panel;
  }
  return { sticker, startingChunk, recentPanel };
}
