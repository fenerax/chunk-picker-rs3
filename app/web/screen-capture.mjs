import { MAX_MAP_IMAGE_SIDE, renderMapImage } from './map-capture.mjs';

/** Capture is a browser view, available to editors and viewers without commands. */
export function createScreenCapture(c) {
  let active = false, hintTimer, returnFocus, guardedMap, controller, touchStart, lastTap;
  const root = document.documentElement, hint = c.$('screenshot-hint');
  function leave() {
    if (!active) return;
    active = false; touchStart = lastTap = null; clearTimeout(hintTimer); hint.hidden = true;
    root.classList.remove('screenshot-mode');
    c.$('screenshot-open').setAttribute('aria-pressed', 'false');
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function enter() {
    if (!c.map?.model) return;
    if (c.phoneLayout?.isPhone) c.phoneLayout.select('map');
    if (active) { leave(); return; }
    if (guardedMap !== c.map) {
      const onChunk = c.map.onChunk, onContext = c.map.onContext;
      const setHover = c.map.setHover.bind(c.map);
      c.map.onChunk = (...args) => { if (!active) onChunk(...args); };
      c.map.onContext = (...args) => { if (!active) onContext(...args); };
      c.map.setHover = id => setHover(active ? null : id);
      guardedMap = c.map;
    }
    returnFocus = document.activeElement;
    if (returnFocus?.closest?.('#more-tools')) returnFocus = c.$('more-tools').querySelector('summary');
    c.closeTopMenus(); c.taskHover?.hide();
    for (const hover of c.duoHovers.values()) hover.hide();
    active = true; root.classList.add('screenshot-mode');
    c.$('screenshot-open').setAttribute('aria-pressed', 'true');
    c.map.setHover(null); c.$('map-hover').focus({ preventScroll: true });
    hint.hidden = false;
    hintTimer = setTimeout(() => { hint.hidden = true; }, 4500);
  }
  const typing = target => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
  function mount() {
    document.addEventListener('keydown', event => {
      if (active && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); leave(); return; }
      if (active && (event.key === '/' || event.key === 'Enter' && event.target !== hint || event.key === 'ContextMenu' || event.key === 'F10')) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.key.toLowerCase() === 's' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
        && !event.repeat && !typing(event.target) && !c.$('tool-dialog').open) {
        event.preventDefault(); event.stopImmediatePropagation(); enter();
      }
    }, true);
    c.$('map-stage').addEventListener('dblclick', event => {
      if (active) { event.preventDefault(); event.stopImmediatePropagation(); leave(); }
    }, true);
    c.$('map-stage').addEventListener('pointerdown', event => {
      if (active && event.pointerType === 'touch' && event.isPrimary !== false) touchStart = { x: event.clientX, y: event.clientY };
    }, true);
    // Touch exit does not depend on a browser synthesising a mouse double-click.
    // Bubble after the map finishes its drag, while its chunk callback is guarded.
    c.$('map-stage').addEventListener('pointerup', event => {
      if (!active || event.pointerType !== 'touch' || event.isPrimary === false || !touchStart) return;
      const start = touchStart; touchStart = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { lastTap = null; return; }
      const now = event.timeStamp;
      if (lastTap && now - lastTap.time < 400 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 24) leave();
      else lastTap = { time: now, x: event.clientX, y: event.clientY };
    });
    c.$('map-stage').addEventListener('pointercancel', () => { touchStart = lastTap = null; });
    hint.addEventListener('click', leave);
    c.$('screenshot-open').addEventListener('click', enter);
    c.$('tool-dialog').addEventListener('close', () => controller?.abort());
    c.$('tool-dialog').addEventListener('cancel', () => controller?.abort());
    c.$('map-image-open').addEventListener('click', downloadDialog);
  }

  function downloadDialog() {
    if (!c.map?.model) return;
    const mapVisible = c.$('map-stage').getClientRects?.().length !== 0;
    const status = c.el('p', mapVisible ? 'Choose the whole map or the area currently on screen.' : 'Return to the map for a visible-area image.', 'status-detail');
    status.setAttribute('role', 'status');
    const actions = c.el('div', undefined, 'map-capture-actions');
    const cancel = c.button('Cancel download', () => controller?.abort()); cancel.hidden = true;
    let generation;
    const buttons = ['full', 'visible'].map(area => c.button(area === 'full' ? 'Whole map PNG' : 'Visible area PNG', async () => {
      if (controller || area === 'visible' && !mapVisible) return;
      controller = new AbortController(); const request = controller;
      for (const button of buttons) button.disabled = true;
      cancel.hidden = false;
      status.textContent = 'Drawing map…';
      try {
        const name = c.map.active.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'map';
        const result = await renderMapImage(c.map, { area, signal: request.signal, onProgress: progress => {
          if (!c.dialogCurrent(generation)) request.abort();
          else status.textContent = `Drawing map… ${Math.round(progress * 100)}%`;
        } });
        if (!c.dialogCurrent(generation)) return;
        const url = URL.createObjectURL(result.blob), link = c.el('a');
        link.href = url; link.download = `${name}-${area === 'full' ? 'whole-map' : 'visible-map'}.png`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = `Downloaded ${result.width.toLocaleString()} × ${result.height.toLocaleString()} PNG.${result.missingTiles ? ' Some map artwork was unavailable.' : ''}`;
      } catch (error) {
        if (c.dialogCurrent(generation)) status.textContent = error.name === 'AbortError' ? 'Download cancelled.' : error.message;
      } finally {
        if (controller === request) controller = null;
        for (const button of buttons) button.disabled = button === buttons[1] && !mapVisible;
        cancel.hidden = true;
      }
    }));
    buttons[1].disabled = !mapVisible;
    actions.append(...buttons, cancel);
    generation = c.openDialog('Download map image', c.el('p', `Uses the current map display, including group view. Images are limited to ${MAX_MAP_IMAGE_SIDE.toLocaleString()} pixels on the longest side.`, 'section-intro'), actions, status);
  }
  c.mapCapture = { enter, leave, isActive: () => active, downloadDialog, mount };
}
