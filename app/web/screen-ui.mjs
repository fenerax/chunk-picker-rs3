import { createSaveStatus } from './screen-save-status.mjs';
import { browserUUID } from './save-address.mjs';

// Main-screen ui; shared values and callbacks live in the explicit screen context.
export function createScreenUi(c) {
  function perfMark(name, detail = {}) {
    const probe = globalThis.__rs3Perf;
    if (probe?.enabled && probe.events.length < 1000) probe.events.push({ name, time: performance.now(), ...detail });
  }

  function iconLink(href, label, name) { const node = c.el('a', undefined, 'icon-button'); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.title = label; node.setAttribute('aria-label', label); node.append(c.icon(name)); return node; }

  function iconButton(label, name, action) { const node = c.button('', action, 'icon-button'); node.title = label; node.setAttribute('aria-label', label); node.append(c.icon(name)); return node; }

  function lazyJSON(title, value) { const node = c.details(title); let loaded = false; node.addEventListener('toggle', () => { if (node.open && !loaded) { loaded = true; node.append(c.jsonPreview(value)); } }); return node; }

  function showError(error) { c.notice(error.message || String(error), true); }

  function notice(message, error = false) { clearTimeout(c.noticeTimer); c.$('notice').setAttribute('role', error ? 'alert' : 'status'); c.$('notice').replaceChildren(c.el('span', message), c.button('Dismiss', () => { c.$('notice').hidden = true; c.reviewSaveRefusal?.(); })); c.$('notice').hidden = false; c.$('notice').className = error ? 'error' : ''; if (!error) c.noticeTimer = setTimeout(() => { c.$('notice').hidden = true; }, 10000); }

  const saved = createSaveStatus(c);

  Object.assign(c, { perfMark, browserUUID, iconLink, iconButton, lazyJSON, showError, notice, saved });

  c.$ = id => document.getElementById(id);

  c.plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();

  c.el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };

  c.button = (text, action, cls) => { const node = c.el('button', text, cls); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(action).catch(c.showError)); return node; };

  c.check = (text, checked, action) => { const label = c.el('label'); const input = c.el('input'); input.type = 'checkbox'; input.checked = checked; input.disabled = !c.canWrite(); let previous = checked, sequence = 0; input.addEventListener('change', async () => { if (!c.canWrite()) { input.checked = previous; return; } const generation = c.dialogGeneration, request = ++sequence, value = input.checked; try { await action(value); previous = value; } catch (error) { if (c.dialogCurrent(generation) && request === sequence) { input.checked = previous; c.showError(error); } } }); label.append(input, document.createTextNode(text)); return label; };

  c.fieldSequence = 0;

  // Compound fields render a wrapper but label their operable inner control.
  c.field = (text, control, labelControl = control) => {
    const wrap = c.el('div', undefined, 'form-field'), label = c.el('label', text);
    if (!labelControl.id) labelControl.id = `field-${++c.fieldSequence}`;
    label.htmlFor = labelControl.id; label.id = `${labelControl.id}-label`;
    wrap.append(label, control); return wrap;
  };

  c.wikiSearch = name => `https://runescape.wiki/w/Special:Search?search=${encodeURIComponent(name)}`;

  c.icon = name => { const node = c.el('span', undefined, `icon icon-${name}`); node.setAttribute('aria-hidden', 'true'); return node; };

  c.input = (type, value = '') => { const node = c.el('input'); node.type = type; node.value = value; return node; };

  c.select = (values, value) => {
    const node = c.el('select');
    for (const item of values) {
      const option = c.el('option', typeof item === 'string' ? item : item.label);
      option.value = typeof item === 'string' ? item : item.value; node.append(option);
    }
    node.value = value;
    const members = (c.state?.members ?? []).filter(member => [...node.children].some(option => option.value === member.id));
    return members.length ? memberSelect(node, members) : node;
  };

  c.list = values => { const node = c.el('ul'); values.forEach(value => node.append(c.el('li', value))); return node; };

  c.details = (title, ...children) => { const node = c.el('details'); node.append(c.el('summary', title), ...children); return node; };

  c.jsonPreview = value => c.el('pre', JSON.stringify(value, null, 2), 'data-preview');
}

// Display only: never write a shortened identity back into state or commands.
export function shortMemberName(name) {
  const characters = Array.from(String(name));
  return characters.length > 20 ? characters.slice(0, 20).join('') + '…' : String(name);
}

/** Compact bars, chips and control labels retain their full accessible text. */
// Elements whose role accepts aria-label; generic span/strong text ignores it.
const NAMEABLE = /^(BUTTON|OPTION|A|SELECT|INPUT|SUMMARY)$/;
// Nodes this helper shortened: their full and displayed text. A repeat call on
// unchanged text restores the full name; new short text clears the old labels.
const labelled = new WeakMap();
export function memberDisplay(node, members) {
  // A repeat call on an already-split generic label starts from its full text.
  const spoken = node.querySelector?.(':scope > .member-name-full');
  const current = String(spoken ? spoken.textContent : node.textContent ?? ''), previous = labelled.get(node);
  const full = previous && !spoken && current === previous.display ? previous.full : current;
  let display = full;
  // Replace longer names first so one member's name can be a prefix of another.
  for (const { name } of members.filter(member => typeof member.name === 'string').sort((a, b) => b.name.length - a.name.length)) {
    if (name && full.includes(name)) display = display.replaceAll(name, shortMemberName(name));
  }
  if (display === full) {
    if (labelled.has(node)) {
      labelled.delete(node);
      if (node.removeAttribute) { node.removeAttribute('title'); node.removeAttribute('aria-label'); }
      else { node.title = ''; delete node.attributes?.['aria-label']; }
    }
    return node;
  }
  labelled.set(node, { full, display }); node.title = full;
  const document = node.ownerDocument;
  if (!node.tagName || NAMEABLE.test(node.tagName) || node.hasAttribute?.('role') || !document?.createElement) {
    node.textContent = display; node.setAttribute('aria-label', full);
    return node;
  }
  // Generic text: show the compact name, but let assistive technology read the full one.
  const visible = document.createElement('span'); visible.textContent = display; visible.setAttribute('aria-hidden', 'true');
  const hidden = document.createElement('span'); hidden.className = 'sr-only member-name-full'; hidden.textContent = full;
  node.replaceChildren(visible, hidden);
  return node;
}

/** Re-sync a member select's title and label after code assigns its value directly. */
export function refreshMemberSelect(node) { selects.get(node)?.(); return node; }

const selects = new WeakMap();
/** Keep the native dropdown arrow, full option names and selected-name tooltip. */
export function memberSelect(node, members) {
  for (const option of node.children) memberDisplay(option, members);
  // Once installed, always refresh: rebuilt options may no longer need shortening.
  if (!selects.has(node) && ![...node.children].some(option => option.title)) return node;
  if (!selects.has(node)) {
    // Extend only an explicit aria-label; adding one would override an associated <label>.
    const label = node.getAttribute?.('aria-label');
    const refresh = () => {
      const selected = [...node.children].find(option => option.value === node.value);
      const name = selected?.title || selected?.textContent || '';
      node.title = name;
      if (label) node.setAttribute('aria-label', `${label}: ${name}`);
    };
    selects.set(node, refresh); node.addEventListener('change', refresh);
  }
  selects.get(node)();
  return node;
}
