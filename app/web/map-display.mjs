const STORAGE_KEY = 'picker.map-display';
const SIZE_KEYS = ['rollNumberScale', 'chunkIdScale', 'stickerScale', 'taskCountScale'];
const clampScale = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(.6, Math.min(2, value)) : 1;

// Sizes belong to this browser, independent of either player's saved map.
export function createMapDisplay(c) {
  const sizes = Object.fromEntries(SIZE_KEYS.map(key => [key, 1]));
  sizes.showTaskCounts = true;
  sizes.showPlaceNames = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const key of SIZE_KEYS) sizes[key] = clampScale(saved?.[key]);
    if (typeof saved?.showTaskCounts === 'boolean') sizes.showTaskCounts = saved.showTaskCounts;
    if (typeof saved?.showPlaceNames === 'boolean') sizes.showPlaceNames = saved.showPlaceNames;
  } catch { /* The live controls also work when browser storage is unavailable. */ }
  const panel = c.$('map-display-panel');
  let returnFocus, frame = null, builtFor, controls = new Map();

  function paintSizes() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes)); } catch {}
      c.map?.setDisplayPreferences?.(sizes);
      c.renderLegend?.();
    });
  }

  function sizeRow(key, title) {
    const row = c.el('div', undefined, 'map-display-size');
    const control = c.input('range', sizes[key]);
    control.id = `map-display-${key}`; control.min = '.6'; control.max = '2'; control.step = '.05';
    const label = c.el('label', title); label.htmlFor = control.id;
    const output = c.el('output'); output.htmlFor = control.id;
    function sync() { control.value = sizes[key]; output.textContent = `${Math.round(sizes[key] * 100)}%`; control.setAttribute('aria-valuetext', output.textContent); }
    control.addEventListener('input', () => { sizes[key] = clampScale(Number(control.value)); sync(); paintSizes(); });
    controls.set(key, { control, sync }); sync();
    row.append(label, output, control); return row;
  }

  function taskCountOption() {
    const row = c.el('label', undefined, 'map-display-option'), control = c.input('checkbox');
    control.id = 'map-display-task-counts';
    const sync = () => { control.checked = sizes.showTaskCounts; };
    control.addEventListener('change', () => { sizes.showTaskCounts = control.checked; paintSizes(); });
    controls.set('showTaskCounts', { control, sync }); sync();
    row.append(control, c.el('span', 'Show task counts')); return row;
  }

  function placeNamesOption() {
    const row = c.el('label', undefined, 'map-display-option'), control = c.input('checkbox');
    control.id = 'map-display-place-names';
    const sync = () => { control.checked = sizes.showPlaceNames; };
    control.addEventListener('change', () => { sizes.showPlaceNames = control.checked; paintSizes(); });
    controls.set('showPlaceNames', { control, sync }); sync();
    row.append(control, c.el('span', 'Place names')); return row;
  }

  function savedControl(id, title, type = 'checkbox') {
    const row = c.el('label', undefined, 'map-display-option'), control = c.input(type);
    control.setAttribute('aria-label', title);
    const ownerId = c.memberId;
    function sync() { const value = c.preferences()[id]; if (type === 'checkbox') control.checked = !!value; else control.value = value || '#FF0000'; }
    const entry = { control, sync, pending: false };
    control.addEventListener('change', async () => {
      const value = type === 'checkbox' ? control.checked : control.value;
      if (!c.canWrite()) { if (id === 'ids') c.setViewerPreference('ids', value); return; }
      entry.pending = true; control.disabled = true;
      try { await c.command({ type: 'set-preference', memberId: ownerId, preferenceId: id, value }); }
      catch (error) { if (c.memberId === ownerId) { sync(); c.showError(error); } }
      finally { entry.pending = false; control.disabled = !!c.sandbox?.active; refresh(); }
    });
    controls.set(id, entry); sync();
    if (type === 'checkbox') row.append(control, c.el('span', title));
    else row.append(c.el('span', title), control);
    return row;
  }

  function build() {
    controls = new Map();
    const content = c.$('map-display-content'); content.replaceChildren();
    content.append(sizeRow('rollNumberScale', 'Roll numbers size'), savedControl('ids', 'Show chunk IDs'), sizeRow('chunkIdScale', 'Chunk IDs size'), sizeRow('stickerScale', 'Sticker and flag size'));
    content.append(taskCountOption(), sizeRow('taskCountScale', 'Task counts size'), c.el('p', 'Counts use the default Active Tasks filters.', 'map-display-note'));
    if (c.supportsFeature?.('mapMetadata') !== false) content.append(placeNamesOption(), c.el('p', 'Zoom in for smaller places. Crowded names are hidden.', 'map-display-note'));
    if (c.activityLayers) content.append(c.activityLayers.controls('display'));
    if (c.canWrite()) {
      const saved = c.el('div', undefined, 'map-display-saved');
      saved.append(c.el('p', `Saved for ${c.member().name}`, 'map-display-note'), savedControl('highvis', 'High visibility map'), savedControl('unlockedBorderColor', 'Unlocked border colour', 'color'), savedControl('defaultStickerColor', 'Default sticker colour', 'color'));
      const starting = c.button('Choose starting marker…', () => { close(); c.mapTools.startingChunk(); }, 'map-display-starting');
      starting.disabled = !!c.sandbox?.active;
      controls.set('startingChunk', { control: starting, sync() {} });
      saved.append(starting); content.append(saved);
    }
    content.append(c.el('p', 'Sizes, task counts and place names stay on this browser. Zoom in to see chunk IDs and stickers.', 'map-display-note'));
    builtFor = `${c.memberId}:${c.canWrite()}`;
  }

  function refresh() {
    c.activityLayers?.sync();
    if (!panel || panel.hidden || !c.state || !c.member()) return;
    if (builtFor !== `${c.memberId}:${c.canWrite()}`) build();
    for (const [key, entry] of controls) {
      if (!entry.pending) entry.sync();
      if (!SIZE_KEYS.includes(key) && !['showTaskCounts', 'showPlaceNames'].includes(key)) entry.control.disabled = !!entry.pending || c.canWrite() && !!c.sandbox?.active;
    }
  }

  function open() {
    if (!panel || !c.state || !c.member()) return;
    returnFocus = document.activeElement;
    c.closeDialog(); c.closeTopMenus();
    panel.hidden = false; build(); refresh();
    c.usage?.panelOpened('map-display-panel');
    c.$('map-display-open')?.setAttribute('aria-expanded', 'true');
    c.$('map-display-done').focus();
  }

  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    c.$('map-display-open')?.setAttribute('aria-expanded', 'false');
    // Return to the map when the entry was inside the now-closed Settings dialog/menu.
    const target = returnFocus?.closest?.('dialog, .more-tools-menu') ? c.$('map-hover') : returnFocus;
    (target?.isConnected ? target : c.$('map-hover'))?.focus();
  }

  c.$('map-display-open')?.addEventListener('click', open);
  c.$('map-display-done')?.addEventListener('click', close);
  c.$('map-display-reset')?.addEventListener('click', () => { for (const key of SIZE_KEYS) sizes[key] = 1; refresh(); paintSizes(); });
  return { sizes, open, close, refresh, isOpen: () => !!panel && !panel.hidden };
}
