import { PHONE_QUERY } from './phone-layout.mjs';

// The phone sheet borrows the live legend, including its layer controls. There
// is still exactly one key for renderLegend() and existing event listeners.
export function createMapControlDiscovery(c, { document = globalThis.document, media = globalThis.matchMedia?.(PHONE_QUERY) } = {}) {
  const actions = c.$('phone-map-actions'), trigger = c.$('phone-legend-open');
  const sheet = c.$('phone-legend-sheet'), host = c.$('phone-legend-content');
  const legend = c.$('legend-details'), toolbar = document.querySelector('.map-toolbar');
  const history = c.$('undo'), historyHost = c.$('phone-undo-host');
  const historyParent = history.parentNode, historyNext = history.nextSibling;
  let home, next, wasOpen, mounted = false;

  function close({ restoreFocus = false } = {}) {
    if (sheet.hidden) return false;
    const hadFocus = sheet.contains(document.activeElement);
    sheet.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    home.insertBefore(legend, next); legend.open = wasOpen;
    if (restoreFocus && media.matches) trigger.focus();
    else if (hadFocus) c.$('map-hover')?.focus();
    return true;
  }
  function open() {
    if (!media?.matches || !sheet.hidden) return;
    c.mapDisplay?.close(); c.closeChunkMenu(); c.stickerPicker?.close();
    home = legend.parentNode; next = legend.nextSibling; wasOpen = legend.open;
    host.append(legend); legend.open = true;
    sheet.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    c.$('phone-legend-close').focus();
  }
  function scrollControls() {
    const atEnd = toolbar.scrollLeft + toolbar.clientWidth >= toolbar.scrollWidth - 2;
    toolbar.scrollTo({ left: atEnd ? 0 : toolbar.scrollLeft + toolbar.clientWidth * .8, behavior: 'auto' });
  }
  function adapt() {
    close(); actions.hidden = !media.matches;
    if (media.matches) historyHost.append(history);
    else historyParent.insertBefore(history, historyNext);
  }
  function mount() {
    if (mounted || !media) return;
    mounted = true;
    trigger.addEventListener('click', () => sheet.hidden ? open() : close({ restoreFocus: true }));
    c.$('phone-legend-close').addEventListener('click', () => close({ restoreFocus: true }));
    const more = c.$('phone-map-controls');
    more.addEventListener('click', scrollControls);
    toolbar.addEventListener('scroll', () => {
      const atEnd = toolbar.scrollLeft + toolbar.clientWidth >= toolbar.scrollWidth - 2;
      more.textContent = atEnd ? 'First controls' : 'More controls';
    }, { passive: true });
    document.addEventListener('pointerdown', event => {
      if (!sheet.hidden && !sheet.contains(event.target) && !trigger.contains(event.target)) close();
    });
    media.addEventListener('change', adapt); adapt();
  }
  return { mount, open, close, isOpen: () => !sheet.hidden };
}

// Use the same optional capability and guarded review as Settings → Map.
export function mountMembersStartEntry(c) {
  const entry = c.$('members-start-open');
  function refresh() {
    entry.hidden = !c.canWrite() || !c.panelContext.membersStart;
    entry.disabled = entry.hidden || c.panelContext.membersStartAvailable?.() === false;
  }
  entry.addEventListener('click', () => {
    refresh();
    if (!entry.disabled) Promise.resolve().then(() => c.panelContext.membersStart()).catch(c.showError);
  });
  refresh();
  return { refresh };
}
