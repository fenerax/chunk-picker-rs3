export const PHONE_QUERY = '(max-width: 720px)';
export const PHONE_TAB_KEY = 'picker.phone-tab';
const tabs = ['map', 'tasks', 'more'];

// Move the actual panels and tools, so their listeners and future menu entries
// keep one owner. Their original positions are restored above the breakpoint.
export function createPhoneLayout({ root, tabBar, buttons, panels, tools, moreTools, moreMap, recent, summary, media, storage, onChange = () => {} }) {
  let chosen = 'map', mounted = false;
  try { const saved = storage?.getItem(PHONE_TAB_KEY); if (tabs.includes(saved)) chosen = saved; } catch {}
  const moves = [[tools, moreTools], [recent, moreMap], [summary, moreMap]].map(([node, host]) => ({ node, host, parent: node.parentNode, next: node.nextSibling }));
  const panelSemantics = Object.fromEntries(tabs.map(tab => [tab, {
    role: panels[tab].getAttribute('role'), labelledby: panels[tab].getAttribute('aria-labelledby'),
  }]));

  function render() {
    const phone = media.matches;
    root.classList.toggle('phone-layout', phone);
    root.dataset.phoneTab = chosen;
    tabBar.hidden = !phone;
    for (const tab of tabs) {
      panels[tab].hidden = phone ? tab !== chosen : tab === 'more';
      for (const [name, value] of [['role', phone ? 'tabpanel' : panelSemantics[tab].role], ['aria-labelledby', phone ? buttons[tab].id : panelSemantics[tab].labelledby]]) {
        if (value == null) panels[tab].removeAttribute(name); else panels[tab].setAttribute(name, value);
      }
      buttons[tab].setAttribute('aria-selected', String(tab === chosen));
      buttons[tab].tabIndex = tab === chosen ? 0 : -1;
    }
    onChange(chosen, phone);
  }

  function select(tab, { persist = true, focus = false } = {}) {
    if (!tabs.includes(tab)) return false;
    chosen = tab;
    if (persist) { try { storage?.setItem(PHONE_TAB_KEY, tab); } catch {} }
    render();
    if (focus && media.matches) buttons[tab].focus();
    return true;
  }

  function adapt() {
    for (const { node, host, parent, next } of moves) {
      if (media.matches) host.append(node);
      else parent.insertBefore(node, next);
    }
    // A menu anchored in the previous layout should not linger after a resize.
    for (const menu of tools.querySelectorAll('details')) menu.open = false;
    render();
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    for (const tab of tabs) {
      buttons[tab].addEventListener('click', () => select(tab));
      buttons[tab].addEventListener('keydown', event => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next = event.key === 'Home' ? 'map' : event.key === 'End' ? 'more' : offset ? tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length] : null;
        if (next) { event.preventDefault(); select(next, { focus: true }); }
      });
    }
    media.addEventListener('change', adapt);
    adapt();
  }
  return { mount, select, get tab() { return chosen; }, get isPhone() { return media.matches; } };
}
