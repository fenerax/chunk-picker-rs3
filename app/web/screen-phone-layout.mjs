import { createPhoneLayout, PHONE_QUERY } from './phone-layout.mjs';

export function createScreenPhoneLayout(c) {
  if (!globalThis.matchMedia) return;
  const root = document.documentElement;
  c.phoneLayout = createPhoneLayout({
    root, media: matchMedia(PHONE_QUERY), storage: (() => { try { return localStorage; } catch { return null; } })(),
    tabBar: c.$('phone-tabs'), buttons: { map: c.$('phone-tab-map'), tasks: c.$('phone-tab-tasks'), more: c.$('phone-tab-more') },
    panels: { map: c.$('map-panel'), tasks: document.querySelector('.task-sidebar'), more: c.$('phone-more') },
    tools: document.querySelector('.topbar nav'), moreTools: c.$('phone-tools'), moreMap: c.$('phone-map-summary'),
    recent: c.$('recent-panel'), summary: document.querySelector('.map-summary'),
    onChange: (tab, phone) => {
      c.mapControlDiscovery?.close();
      c.closeChunkMenu(); c.stickerPicker?.close(); c.map?.cancelTouchGesture();
      const hint = c.$('map-hint');
      if (hint && !c.map?.pointerTool?.active) hint.textContent = phone
        ? `Drag to pan · Pinch to zoom · Tap for chunk info · Hold for chunk menu`
        : 'Drag to pan · Scroll to zoom · Click for chunk info';
    }
  });
  const showChunk = c.showChunk;
  c.showChunk = (...args) => {
    if (c.phoneLayout.isPhone) c.phoneLayout.select('map');
    return showChunk(...args);
  };
  const openDisplay = c.mapDisplay.open;
  c.panelContext.mapDisplay = c.mapDisplay.open = (...args) => {
    if (c.phoneLayout.isPhone) c.phoneLayout.select('map');
    return openDisplay(...args);
  };
  // These tools act on the map. Capture runs first so it sees a visible canvas.
  for (const id of ['map-display-open', 'screenshot-open', 'map-image-open']) c.$(id).addEventListener('click', () => {
    if (c.phoneLayout.isPhone) c.phoneLayout.select('map');
  }, true);
}
