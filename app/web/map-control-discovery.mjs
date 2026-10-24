import { PHONE_QUERY } from './phone-layout.mjs';

export const PHONE_CONTROLS_KEY = 'picker.phone-map-controls';

// Borrow the live roll button so player labels, permissions and commands keep
// their existing owner. Desktop gets the exact original node order back.
function createPhoneMapControls(c, { media, document, storage, closeLegend }) {
  const primary = c.$('phone-map-primary'), toggle = c.$('phone-controls-toggle');
  const toolbar = c.$('map-toolbar'), extras = c.$('phone-map-extras');
  const roll = c.$('pick'), rollHost = c.$('phone-roll-host');
  const parent = roll.parentNode, next = roll.nextSibling;
  let expanded = false;
  try { expanded = storage()?.getItem(PHONE_CONTROLS_KEY) === 'expanded'; } catch {}

  function render() {
    const phone = media.matches;
    primary.hidden = !phone;
    toolbar.hidden = phone && !expanded;
    extras.hidden = !phone || !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    if (phone) rollHost.append(roll);
    else parent.insertBefore(roll, next);
  }
  function setExpanded(value) {
    expanded = value;
    if (!expanded) closeLegend();
    render();
    try { storage()?.setItem(PHONE_CONTROLS_KEY, expanded ? 'expanded' : 'folded'); } catch {}
    if (expanded) {
      toolbar.scrollLeft = 0;
      const first = [...toolbar.querySelectorAll('button')].find(button =>
        !button.disabled && !button.hidden && button.checkVisibility());
      (first ?? toggle).focus();
    } else toggle.focus();
  }
  function adapt() {
    const hadFocus = primary.contains(document.activeElement) || toolbar.contains(document.activeElement) || extras.contains(document.activeElement);
    render();
    if (hadFocus && document.activeElement?.checkVisibility?.() === false) {
      (media.matches ? toggle : c.$('map-hover')).focus();
    }
  }
  toggle.addEventListener('click', () => setExpanded(!expanded));
  media.addEventListener('change', adapt);
  adapt();
}

// The phone sheet borrows the live legend, including its layer controls. There
// is still exactly one key for renderLegend() and existing event listeners.
export function createMapControlDiscovery(c, { document = globalThis.document, media = globalThis.matchMedia?.(PHONE_QUERY), storage = () => globalThis.localStorage } = {}) {
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
    createPhoneMapControls(c, { media, document, storage, closeLegend: close });
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
