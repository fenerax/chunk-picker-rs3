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

  c.check = (text, checked, action) => { const label = c.el('label'); const input = c.el('input'); input.type = 'checkbox'; input.checked = checked; input.disabled = !c.canWrite(); let previous = checked; input.addEventListener('change', async () => { if (!c.canWrite()) { input.checked = previous; return; } const generation = c.dialogGeneration; input.disabled = true; try { await action(input.checked); previous = input.checked; } catch (error) { if (c.dialogCurrent(generation)) { input.checked = previous; c.showError(error); } } finally { if (c.dialogCurrent(generation)) input.disabled = !c.canWrite(); } }); label.append(input, document.createTextNode(text)); return label; };

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

  c.select = (values, value) => { const node = c.el('select'); for (const item of values) { const option = c.el('option', typeof item === 'string' ? item : item.label); option.value = typeof item === 'string' ? item : item.value; node.append(option); } node.value = value; return node; };

  c.list = values => { const node = c.el('ul'); values.forEach(value => node.append(c.el('li', value))); return node; };

  c.details = (title, ...children) => { const node = c.el('details'); node.append(c.el('summary', title), ...children); return node; };

  c.jsonPreview = value => c.el('pre', JSON.stringify(value, null, 2), 'data-preview');
}
