import { TOP_BAR_PREFERENCE, topBarButtons, hiddenTopBarButtons } from '../core/top-bar-settings.mjs';

// The top bar element each customisable button stands for. Moving the real
// nodes keeps their listeners, ids, feature flags and viewer hiding intact.
export const topBarTargets = Object.freeze({ helper: 'helper-open', search: 'search-open', info: 'info-tools', sync: 'runemetrics-open', more: 'more-tools' });
const plainButtons = ['helper', 'search', 'sync'];
const lockedIds = new Set(topBarButtons.filter(row => row.locked).map(row => row.id));
const keywords = 'top bar buttons helper search info sync levels more menu reset to default hide show';
const isHeading = node => String(node.className ?? '').split(' ').includes('menu-heading');

/** Hidden buttons move to the start of More, ahead of a Tools heading for More's own items. */
export function createTopBarLayout({ document, lookup = id => document.getElementById(id) }) {
  const more = lookup(topBarTargets.more)?.querySelector('.more-tools-menu');
  const info = lookup(topBarTargets.info), infoMenu = info?.querySelector('.more-tools-menu');
  let current = [], infoItems = [];
  if (!more) return { apply() {}, get hidden() { return current; } };
  const overflow = document.createElement('div'), divider = document.createElement('p');
  overflow.id = 'top-bar-overflow'; overflow.className = 'top-bar-overflow'; overflow.hidden = true;
  divider.className = 'menu-heading'; divider.textContent = 'Tools';
  overflow.append(divider); more.insertBefore(overflow, more.firstChild);
  const anchors = plainButtons.map(id => [id, lookup(topBarTargets[id])]).filter(([, node]) => node)
    .map(([id, node]) => ({ id, node, parent: node.parentNode, next: node.nextSibling }));

  function restore() {
    for (const { node, parent, next } of [...anchors].reverse()) parent.insertBefore(node, next?.parentNode === parent ? next : null);
    if (info) { for (const node of infoItems) infoMenu.append(node); info.hidden = false; }
    infoItems = [];
  }

  function apply(hidden = []) {
    const next = topBarButtons.map(row => row.id).filter(id => hidden.includes(id) && !lockedIds.has(id));
    if (next.join() !== current.join()) {
      restore();
      for (const { id, node } of anchors) if (next.includes(id)) overflow.insertBefore(node, divider);
      if (info && next.includes('info')) {
        infoItems = [...infoMenu.children]; info.open = false; info.hidden = true;
        for (const node of infoItems) overflow.insertBefore(node, divider);
      }
      current = next;
    }
    // Feature flags and viewer rules hide buttons too; an empty group stays out of the menu.
    const moved = [...anchors.filter(({ id }) => current.includes(id)).map(({ node }) => node), ...infoItems];
    overflow.hidden = !moved.some(node => !node.hidden && !isHeading(node));
  }
  return { apply, get hidden() { return current; } };
}

/** Settings rows: one switch per button, More locked on, and Reset to default. */
export function createTopBarSettings({ el, button, input, command, preferences, showError, advanced = () => false, available = () => true }) {
  function matches(query = '') { return !query || keywords.includes(query); }

  function rows(memberId, { isCurrent = () => true } = {}) {
    const box = el('div', undefined, 'top-bar-settings');
    let busy = false;
    async function save(value) {
      busy = true; paint();
      try { await command({ type: 'set-preference', memberId, preferenceId: TOP_BAR_PREFERENCE, value }); }
      catch (error) { if (isCurrent()) showError(error); }
      finally { busy = false; if (isCurrent()) paint(); }
    }
    function paint() {
      const prefs = preferences(memberId), hidden = hiddenTopBarButtons(prefs);
      const intro = el('div', undefined, 'rule-row settings-option top-bar-intro'), copy = el('div', undefined, 'field-copy');
      copy.append(el('strong', 'Top bar buttons'), el('p', 'Choose which buttons stay in the top bar. Hidden buttons move into More.', 'field-help'));
      if (advanced(memberId)) copy.append(el('p', `Saved as ${TOP_BAR_PREFERENCE}: ${JSON.stringify(hidden)}`, 'field-help'));
      const reset = button('Reset to default', () => save([]));
      reset.disabled = busy || !hidden.length; intro.append(copy, reset);
      const list = [intro];
      for (const row of topBarButtons) {
        if (!row.locked && !available(row.id)) continue;
        const item = el('div', undefined, 'rule-row setting-row settings-option'), text = el('div', undefined, 'field-copy');
        const control = input('checkbox'), help = el('p', row.locked ? `Always shown. ${row.reason}` : hidden.includes(row.id) ? 'In the More menu.' : 'In the top bar.', 'field-help');
        control.id = `setting-${memberId}-top-bar-${row.id}`; help.id = `${control.id}-help`;
        control.checked = row.locked || !hidden.includes(row.id); control.disabled = busy || !!row.locked;
        control.setAttribute('aria-label', `Show ${row.label}`); control.setAttribute('aria-describedby', help.id);
        const label = el('label', undefined, 'setting-title'); label.htmlFor = control.id; label.append(el('strong', row.label));
        text.append(label, help); item.append(text, control); list.push(item);
        if (!row.locked) control.addEventListener('change', () => save(control.checked ? hidden.filter(id => id !== row.id) : [...hidden, row.id]));
      }
      box.replaceChildren(...list);
    }
    paint();
    return box;
  }
  return { matches, rows };
}

// Screen wiring: the saved choice follows the shown player, like other display
// preferences. Viewer links always keep the default bar and never get the rows.
export function createScreenTopBar(c, { document = globalThis.document } = {}) {
  const layout = createTopBarLayout({ document, lookup: c.$ });
  const apply = () => layout.apply(c.state && c.canWrite() ? hiddenTopBarButtons(c.preferences()) : []);
  const applyPreferences = c.applyPreferences;
  c.applyPreferences = (...args) => { const result = applyPreferences(...args); apply(); return result; };
  c.topBar = createTopBarSettings({ el: c.el, button: c.button, input: c.input, command: c.command, showError: c.showError,
    preferences: id => c.preferences(id), advanced: id => c.canWrite() && c.preferences(id).advanced === true,
    available: id => { const node = c.$(topBarTargets[id]); return !!node && !node.disabled; } });
  if (c.panelContext) c.panelContext.topBar = c.topBar;
  return { layout, apply };
}
