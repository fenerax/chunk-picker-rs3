import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamSafe, createPrivateLink, nonTokenUrl, maskLinkText, streamSafeKey, editLinkWarning } from '../app/web/stream-safe.mjs';

function harness(storage = new Map()) {
  class Node {
    constructor(tag, text) { Object.assign(this, { tag, textContent: text ?? '', children: [], attributes: {}, events: {}, value: '', hidden: false }); }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, listener) { this.events[key] = listener; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
    remove() { this.removed = true; }
  }
  const el = (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; };
  const button = (text, click, cls) => { const node = el('button', text, cls); node.events.click = click; return node; };
  const input = type => { const node = el('input'); node.type = type; return node; };
  const indicator = el('span'), menuButton = button('Stream-safe mode');
  const location = { href: 'https://picker.invalid/join/secret?map=one&token=another#tasks' }, replacements = [];
  const history = { state: { retained: true }, replaceState: (...args) => replacements.push(args) };
  const controller = createStreamSafe({ el, button, input, indicator, menuButton, location, history,
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  const privateLink = options => createPrivateLink({ value: 'https://picker.invalid/join/private-secret', el, button, input, streamSafe: controller, ...options });
  const walk = node => [node, ...node.children.flatMap(walk)];
  return { controller, privateLink, indicator, menuButton, replacements, location, storage, walk };
}

test('one browser preference synchronizes Settings and More, persists and never issues a save command', () => {
  const h = harness(), row = h.controller.settingsRow(), control = h.walk(row).find(node => node.tag === 'input');
  assert.equal(control.checked, false); assert.equal(h.indicator.hidden, true);
  h.menuButton.events.click();
  assert.equal(control.checked, true); assert.equal(h.menuButton.attributes['aria-checked'], 'true'); assert.equal(h.indicator.hidden, false);
  assert.equal(h.storage.get(streamSafeKey), 'true'); assert.equal(harness(h.storage).controller.enabled(), true);
  control.checked = false; control.events.change(); assert.equal(h.controller.enabled(), false);
  row.dispose(); h.controller.set(true); assert.equal(control.checked, false);
});

test('address cleanup waits for an authenticated session and retains ordinary URL state', () => {
  const h = harness(); h.controller.set(true); assert.equal(h.replacements.length, 0);
  h.controller.sessionReady(); assert.deepEqual(h.replacements[0], [{ retained: true }, '', '/?map=one#tasks']);
  const off = harness(); off.controller.sessionReady(); assert.equal(off.replacements.length, 0);
  assert.equal(nonTokenUrl('https://picker.invalid/?view=group&access_token=secret#token=other'), '/?view=group');
  assert.equal(nonTokenUrl('https://picker.invalid/%2fjoin%2fsecret?zoom=2'), '/?zoom=2');
  assert.equal(nonTokenUrl('https://picker.invalid/?map=one#tasks'), '/?map=one#tasks');
});

test('masked edit/master links keep secrets out of DOM until Show and confirmation', () => {
  const h = harness(); h.controller.set(true); const link = h.privateLink();
  const nodes = h.walk(link.node), show = nodes.find(node => node.textContent === 'Show'), confirm = nodes.find(node => node.textContent === 'Show link');
  assert.equal(nodes.some(node => /private-secret/.test(node.textContent + node.value + JSON.stringify(node.attributes))), false);
  show.events.click(); assert.equal(link.masked(), true); assert.ok(nodes.find(node => node.textContent === editLinkWarning));
  nodes.find(node => node.textContent === 'Cancel').events.click(); assert.equal(link.masked(), true);
  show.events.click(); confirm.events.click(); assert.match(link.input.value, /private-secret/); assert.equal(link.masked(), false);
  h.controller.set(true); assert.equal(link.masked(), true); assert.doesNotMatch(link.input.value, /private-secret/);
  link.clear(); assert.equal(link.value(), ''); assert.equal(link.input.value, '');
});

test('ordinary mode shows the link, viewer reveal explains view access, stale confirms reveal nothing', () => {
  const h = harness(); const ordinary = h.privateLink(); assert.match(ordinary.input.value, /private-secret/); ordinary.clear();
  h.controller.set(true); let current = true; const link = h.privateLink({ viewer: true, current: () => current });
  const nodes = h.walk(link.node); assert.ok(nodes.find(node => node.textContent === 'Anyone who sees this link can view your save.'));
  nodes.find(node => node.textContent === 'Show').events.click(); current = false; nodes.find(node => node.textContent === 'Show link').events.click();
  assert.equal(link.masked(), true); assert.doesNotMatch(link.input.value, /private-secret/);
});

test('join URLs and token parameters embedded in display text are masked in stream-safe mode', () => {
  const h = harness(); h.controller.set(true);
  const raw = 'Visit https://picker.invalid/join/secret or /%2Fjoin%2Fsecond and /?token=third';
  assert.doesNotMatch(h.controller.safeText(raw), /secret|second|third/);
  assert.equal(maskLinkText('/join/secret'), '/join/[hidden]');
  h.controller.set(false); assert.equal(h.controller.safeText(raw), raw);
});

test('unavailable browser storage preserves a working switch', () => {
  const streamSafe = createStreamSafe({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  streamSafe.set(true); assert.equal(streamSafe.enabled(), true);
});

test('another picker tab changes the browser mode and notifies rendered controls', () => {
  let onStorage;
  const streamSafe = createStreamSafe({ storage: null, eventTarget: { addEventListener: (name, callback) => { assert.equal(name, 'storage'); onStorage = callback; } } });
  let repainted = 0; streamSafe.subscribe(() => { repainted++; });
  onStorage({ key: streamSafeKey, newValue: 'true' }); assert.equal(streamSafe.enabled(), true); assert.equal(repainted, 1);
  onStorage({ key: 'unrelated', newValue: 'false' }); assert.equal(streamSafe.enabled(), true);
  onStorage({ key: streamSafeKey, newValue: 'false' }); assert.equal(streamSafe.enabled(), false); assert.equal(repainted, 2);
});

test('stale cross-tab storage events cannot disable a newer stream-safe choice', () => {
  let onStorage; const saved = new Map();
  const streamSafe = createStreamSafe({ storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    eventTarget: { addEventListener: (name, callback) => { onStorage = callback; } } });
  streamSafe.set(true); onStorage({ key: streamSafeKey, newValue: 'false' }); assert.equal(streamSafe.enabled(), true);
  saved.clear(); onStorage({ key: null, newValue: null }); assert.equal(streamSafe.enabled(), false);
  saved.set(streamSafeKey, 'true'); streamSafe.refreshFromStorage(); assert.equal(streamSafe.enabled(), true);
});
