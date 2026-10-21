import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createFeedback } from '../app/web/feedback.mjs';

class Node {
  constructor(tag, text = '') { this.tagName = tag; this.textContent = text; this.children = []; this.attributes = {}; this.events = {}; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  removeEventListener(key, action) { this.events[key] = (this.events[key] ?? []).filter(value => value !== action); }
  async emit(key) { for (const action of this.events[key] ?? []) await action({ preventDefault() {} }); }
  focus() {}
}
const note = (id, status = 'new') => ({ id, status, kind: 'bug', at: '2026-10-12T12:00:00Z', from: { label: 'Reed' }, text: `Note ${id}`, ...(status === 'done' ? { doneAt: '2026-10-12T13:00:00Z' } : {}) });
function harness({ admin = true, readOnly = false, route } = {}) {
  const el = (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; };
  const button = (text, action, cls) => { const node = el('button', text, cls); node.addEventListener('click', action); return node; };
  const input = type => { const node = el('input'); node.type = type; return node; };
  const field = (text, control) => { const node = el('label', text); node.append(control); return node; };
  const document = new Node('document'); document.visibilityState = 'visible';
  const entryButton = el('button', 'Feedback'), calls = [], seen = new Set();
  let items = [note('first')], content, generation = 0, open = false, callback, cancelled = false, masked = false, subscriber;
  const api = async (path, body) => {
    calls.push({ path, body });
    const custom = await route?.(path, body); if (custom !== undefined) return custom;
    if (path === '/api/feedback/summary') return { unread: items.filter(item => !seen.has(item.id)).length };
    if (path === '/api/feedback' && !body || path === '/api/feedback/own') return { items: structuredClone(items) };
    if (path === '/api/feedback/seen') { body.ids.forEach(id => seen.add(id)); return { unread: items.filter(item => !seen.has(item.id)).length }; }
    if (path === '/api/feedback') { const item = note('sent'); item.text = body.text; items.push(item); return { item }; }
    if (path.endsWith('/status')) { const id = path.split('/').at(-2); const item = items.find(item => item.id === id); item.status = body.status; return { item: structuredClone(item) }; }
    throw new Error(`Unexpected route ${path}`);
  };
  const ui = createFeedback({ api, el, button, input, field, entryButton, document,
    isAdmin: () => admin, isReadOnly: () => readOnly, advanced: () => true,
    setInterval: action => { callback = action; return 1; }, clearInterval: () => { cancelled = true; },
    openDialog: (title, node) => { content = node; open = true; return ++generation; }, dialogCurrent: value => open && value === generation,
    streamSafe: { enabled: () => masked, safeText: value => String(value).replace(/\/join\/[^\s]+/g, '/join/[redacted]'), subscribe: action => { subscriber = action; return () => { subscriber = undefined; }; } } });
  const all = () => { const walk = node => [node, ...node.children.flatMap(walk)]; return content ? walk(content) : []; };
  return { ui, calls, all, document, entryButton, get badge() { return entryButton.children[0]; }, find: text => all().find(node => node.textContent === text),
    setItems: value => { items = value; }, poll: () => callback?.(), close: () => { open = false; generation++; },
    mask: value => { masked = value; subscriber?.(); }, get cancelled() { return cancelled; }, get subscriber() { return subscriber; } };
}

test('owner badge refreshes on visible polling and stops all listeners and timers', async () => {
  const h = harness(); h.ui.start(); await h.ui.refresh();
  assert.equal(h.badge.hidden, false); assert.equal(h.badge.textContent, '1');
  assert.equal(h.entryButton.attributes['aria-label'], 'Feedback, 1 unread');
  h.setItems([note('first'), note('second')]); h.poll(); await h.ui.refresh();
  assert.equal(h.badge.textContent, '2');
  const before = h.calls.length; h.document.visibilityState = 'hidden'; h.poll(); await nextTurn();
  assert.equal(h.calls.length, before);
  h.document.visibilityState = 'visible'; await h.document.emit('visibilitychange'); await h.ui.refresh();
  assert.ok(h.calls.length > before);
  h.ui.stop(); assert.equal(h.cancelled, true); assert.equal(h.subscriber, undefined);
  assert.deepEqual(h.document.events.visibilitychange, []);
});

test('opening acknowledges exact displayed IDs while handled rows remain unread until shown', async () => {
  const h = harness(); h.setItems([note('first'), note('handled', 'done')]);
  await h.ui.refresh(); h.ui.open(); await nextTurn();
  assert.deepEqual(h.calls.find(call => call.path === '/api/feedback/seen').body, { ids: ['first'] });
  assert.equal(h.badge.textContent, '1');
  const toggle = h.all().find(node => node.tagName === 'input' && node.type === 'checkbox' && !node.checked);
  toggle.checked = true; await toggle.emit('change'); await nextTurn();
  assert.ok(h.find('Handled')); assert.equal(h.badge.hidden, true);
  assert.deepEqual(h.calls.filter(call => call.path === '/api/feedback/seen').at(-1).body, { ids: ['handled'] });
});

test('players see their own handled notes without admin controls or an owner badge', async () => {
  const h = harness({ admin: false }); h.setItems([note('mine', 'done')]);
  h.ui.open(); await nextTurn();
  assert.ok(h.find('Your feedback')); assert.ok(h.find('Handled'));
  assert.equal(h.find('Mark handled'), undefined); assert.equal(h.find('Reopen'), undefined);
  assert.equal(h.badge.hidden, true);
  assert.ok(h.calls.some(call => call.path === '/api/feedback/own'));
  assert.ok(!h.calls.some(call => call.path === '/api/feedback' && !call.body));
});

test('viewers expose no feedback controls, badge, write calls or polling requests', async () => {
  const h = harness({ readOnly: true }); h.ui.start(); h.ui.open(); await h.ui.refresh();
  assert.equal(h.entryButton.hidden, true); assert.equal(h.badge.hidden, true);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.all(), []); h.ui.stop();
});

test('stream safe repaints sender names and context and masks join links in bodies and errors', async () => {
  const h = harness(); const item = note('first'); item.text = 'See /join/private-fixture'; item.context = { player: 'Reed' };
  h.setItems([item]); h.ui.start(); await h.ui.refresh(); h.ui.open(); await nextTurn();
  assert.ok(h.all().some(node => node.className === 'feedback-meta' && node.textContent.includes('Reed')));
  assert.ok(h.find('See /join/[redacted]'));
  h.mask(true);
  assert.ok(h.all().some(node => node.className === 'feedback-meta' && node.textContent.includes('Sender')));
  assert.ok(!h.all().some(node => node.textContent.includes('Reed')));
  h.mask(false); assert.ok(h.find('player: Reed')); h.ui.stop();
  const failure = harness({ route: path => { if (path === '/api/feedback') throw new Error('Failed /join/private-fixture'); } });
  failure.ui.open(); await nextTurn(); assert.ok(failure.find('Failed /join/[redacted]'));
});

test('closing before a list response does not acknowledge unopened feedback', async () => {
  let resolve;
  const h = harness({ route: path => path === '/api/feedback' ? new Promise(done => { resolve = done; }) : undefined });
  h.ui.open(); await nextTurn(); h.close(); resolve({ items: [note('late')] }); await nextTurn();
  assert.ok(!h.calls.some(call => call.path === '/api/feedback/seen'));
});

test('a slow list response in a hidden tab stays unread until a visible refresh', async () => {
  let resolve, slow = true;
  const h = harness({ route: path => path === '/api/feedback' && slow ? new Promise(done => { resolve = done; }) : undefined });
  h.ui.start(); await h.ui.refresh(); h.ui.open(); await nextTurn();
  h.document.visibilityState = 'hidden'; resolve({ items: [note('first')] }); await nextTurn();
  assert.ok(!h.calls.some(call => call.path === '/api/feedback/seen'));
  assert.equal(h.badge.textContent, '1');
  slow = false; h.document.visibilityState = 'visible'; await h.document.emit('visibilitychange'); await h.ui.refresh(); await nextTurn();
  assert.deepEqual(h.calls.find(call => call.path === '/api/feedback/seen').body, { ids: ['first'] });
  assert.equal(h.badge.hidden, true); h.ui.stop();
});

test('session changes discard an old in-flight badge response', async () => {
  let resolve;
  const h = harness({ route: path => path === '/api/feedback/summary' ? new Promise(done => { resolve = done; }) : undefined });
  const pending = h.ui.refresh(); await nextTurn(); h.ui.setSession({ admin: false, readOnly: true });
  resolve({ unread: 8 }); await pending;
  assert.equal(h.badge.hidden, true); assert.equal(h.badge.textContent, '0');
});

test('a stale summary arriving after displayed-ID acknowledgment cannot resurrect the badge', async () => {
  let resolve;
  const h = harness({ route: path => path === '/api/feedback/summary' ? new Promise(done => { resolve = done; }) : undefined });
  const refresh = h.ui.refresh(); await nextTurn();
  h.ui.open(); await nextTurn(); assert.equal(h.badge.hidden, true);
  resolve({ unread: 1 }); await refresh; await nextTurn();
  assert.equal(h.badge.hidden, true); assert.equal(h.badge.textContent, '0');
});

test('seen acknowledgments serialize and remove duplicate IDs before the next write', async () => {
  let resolve;
  const h = harness({ route: (path, body) => path === '/api/feedback/seen' && body.ids.includes('first') ? new Promise(done => { resolve = done; }) : undefined });
  h.setItems([note('first'), note('handled', 'done')]); h.ui.open(); await nextTurn();
  const toggle = h.all().find(node => node.tagName === 'input' && node.type === 'checkbox' && !node.checked);
  toggle.checked = true; await toggle.emit('change'); await nextTurn();
  assert.equal(h.calls.filter(call => call.path === '/api/feedback/seen').length, 1);
  resolve({ unread: 1 }); await nextTurn();
  assert.deepEqual(h.calls.filter(call => call.path === '/api/feedback/seen').at(-1).body, { ids: ['handled'] });
});

test('pausing and restoring an open dialog repaints privacy and preserves a usable send form', async () => {
  const h = harness(); h.ui.start(); await h.ui.refresh(); h.ui.open(); await nextTurn();
  assert.ok(h.all().some(node => node.className === 'feedback-meta' && node.textContent.includes('Reed')));
  h.ui.pause(); assert.equal(h.subscriber, undefined);
  h.mask(true); h.ui.start();
  assert.ok(h.all().some(node => node.className === 'feedback-meta' && node.textContent.includes('Sender')));
  assert.ok(!h.all().some(node => node.textContent.includes('Reed')));
  const text = h.all().find(node => node.tagName === 'textarea'); text.value = 'After restoring';
  await h.all().find(node => node.tagName === 'form').emit('submit'); await nextTurn();
  assert.ok(h.find('Thanks, it’s been sent.'));
  assert.equal(h.calls.find(call => call.path === '/api/feedback' && call.body?.text).body.text, 'After restoring');
  assert.equal(h.document.events.visibilitychange.length, 1); h.ui.stop();
});

const inbox = count => Array.from({ length: count }, (_, index) => note(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`));

test('large inbox acknowledgments stay under the API body limit and clear the badge', async () => {
  const h = harness(), items = inbox(600); h.setItems(items);
  await h.ui.refresh(); assert.equal(h.badge.textContent, '600');
  h.ui.open(); await nextTurn();
  const calls = h.calls.filter(call => call.path === '/api/feedback/seen');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.flatMap(call => call.body.ids), items.map(item => item.id));
  for (const call of calls) {
    assert.ok(call.body.ids.length <= 256);
    assert.ok(Buffer.byteLength(JSON.stringify(call.body)) <= 16384);
  }
  assert.equal(h.badge.hidden, true); assert.equal(h.badge.textContent, '0');
});

test('retrying a partially failed large acknowledgment skips successful batches', async () => {
  const items = inbox(600); let failed = false;
  const h = harness({ route: (path, body) => {
    if (path === '/api/feedback/seen' && body.ids[0] === items[256].id && !failed) {
      failed = true; throw new Error('Temporary acknowledgment failure');
    }
  } });
  h.setItems(items); h.ui.open(); await nextTurn();
  assert.equal(h.badge.textContent, '344');
  assert.equal(h.calls.filter(call => call.path === '/api/feedback/seen').length, 2);
  await h.ui.refresh(); await nextTurn();
  const retries = h.calls.filter(call => call.path === '/api/feedback/seen').slice(2);
  assert.deepEqual(retries.flatMap(call => call.body.ids), items.slice(256).map(item => item.id));
  assert.equal(h.badge.hidden, true); assert.equal(h.badge.textContent, '0');
});
