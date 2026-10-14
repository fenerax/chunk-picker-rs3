import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayPanel } from '../app/web/overlay-panel.mjs';

// Isolated DOM, API and clipboard fixtures; no server or persisted state.
function harness({ route, clipboard } = {}) {
  class Node {
    constructor(tag, text = '') { Object.assign(this, { tagName: tag, textContent: text, children: [], events: {}, attributes: {}, value: '', hidden: false, disabled: false }); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    async emit(key) { for (const action of this.events[key] ?? []) await action({ preventDefault() {} }); }
    focus() { this.focused = true; }
  }
  const calls = [], copies = [], dialog = new Node('dialog');
  let generation = 0, content, nextId = 0;
  const saved = { id: 'saved', widget: 'goals', player: 'reed', createdAt: '2026-10-13T12:00:00Z', revoked: false };
  const el = (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; };
  const button = (text, action) => { const node = el('button', text); node.addEventListener('click', action); return node; };
  const api = async (path, body) => {
    calls.push({ path, body });
    const response = await route?.(path, body); if (response !== undefined) return response;
    if (path === '/api/overlays' && body === undefined) return { links: [{ ...saved }] };
    if (path === '/api/overlays') return { overlay: { ...saved, ...body, id: `new-${++nextId}` }, link: `https://fixture.invalid/overlay/${body.widget}#key=private-fixture-${nextId}` };
    if (path.endsWith('/revoke')) return { overlay: { ...saved, id: path.split('/')[3], revoked: true } };
    throw new Error('Unexpected route');
  };
  const ui = createOverlayPanel({ api, el, button, dialog, members: () => [{ id: 'reed', name: 'Reed' }, { id: 'actor1', name: 'Player' }],
    clipboard: clipboard ?? { writeText: async value => copies.push(value) },
    openDialog: (title, node) => { content = node; dialog.open = true; return ++generation; },
    dialogCurrent: value => dialog.open && generation === value });
  const all = () => { const walk = node => [node, ...node.children.flatMap(walk)]; return content ? walk(content) : []; };
  const find = text => all().find(node => node.textContent === text);
  const choice = name => all().find(node => node.attributes['aria-label'] === name);
  const form = () => all().find(node => node.tagName === 'form');
  const close = async () => { dialog.open = false; generation++; await dialog.emit('close'); };
  const masked = () => assert.ok(all().every(node => !JSON.stringify({ text: node.textContent, value: node.value, attributes: node.attributes }).includes('private-fixture')), 'Secret must stay outside DOM');
  return { ui, calls, copies, all, find, choice, form, close, masked, cancel: () => dialog.emit('cancel') };
}

test('one creation uses chosen scope, layout and text size with readable metadata', async () => {
  const h = harness(); await h.ui.open();
  assert.ok(h.find('Active goals · Reed'));
  assert.deepEqual(h.choice('Players').children.map(option => option.value), ['duo', 'reed', 'actor1']);
  assert.deepEqual(h.choice('Overlay').children.map(option => option.value), ['goals', 'roll', 'count']);
  assert.deepEqual(h.choice('Layout').children.map(option => option.value), ['full', 'compact']);
  assert.deepEqual(h.choice('Text size').children.map(option => option.value), ['small', 'medium', 'large']);
  h.choice('Overlay').value = 'roll'; await h.choice('Overlay').emit('change');
  assert.ok(h.all().some(node => /600 × 180/.test(node.textContent)));
  h.choice('Players').value = 'actor1'; h.choice('Layout').value = 'compact'; h.choice('Text size').value = 'large';
  await h.form().emit('submit');
  assert.deepEqual(h.calls.find(call => call.body?.widget)?.body, { widget: 'roll', player: 'actor1', variant: 'compact', size: 'large' });
  assert.ok(h.find('Last roll · Player')); h.masked();
});

test('goal sources default to personal pins and carry the chosen scope into masked links', async () => {
  const h = harness(); await h.ui.open();
  const goals = h.choice('Show goals'), player = h.choice('Players');
  assert.deepEqual(goals.children.map(option => [option.value, option.textContent]), [['personal', 'Personal pins'], ['group', 'Group goals'], ['both', 'Both']]);
  assert.equal(goals.value, 'personal');
  await h.form().emit('submit');
  assert.equal(h.calls.at(-1).body.goals, 'personal');
  player.value = 'actor1'; goals.value = 'both'; await goals.emit('change');
  assert.equal(player.disabled, false);
  await h.form().emit('submit');
  assert.deepEqual(h.calls.at(-1).body, { widget: 'goals', player: 'actor1', variant: 'full', size: 'medium', goals: 'both' });
  assert.ok(h.find('Active goals · Player · Both'));
  goals.value = 'group'; await goals.emit('change');
  assert.equal(player.disabled, true); assert.equal(player.value, 'duo');
  await h.form().emit('submit');
  assert.equal(h.calls.at(-1).body.player, 'duo'); assert.equal(h.calls.at(-1).body.goals, 'group');
  assert.equal(player.disabled, true); h.masked();
  h.choice('Overlay').value = 'count'; await h.choice('Overlay').emit('change');
  assert.equal(goals.parent.hidden, true); assert.equal(player.disabled, false); assert.equal(player.value, 'actor1');
  await h.form().emit('submit'); assert.equal(Object.hasOwn(h.calls.at(-1).body, 'goals'), false);
});

test('generated links stay masked, copy only to clipboard, and expire on close or next creation', async () => {
  const h = harness(); await h.ui.open(); await h.form().emit('submit');
  const oldCopy = h.find('Copy link'); assert.ok(h.find('Link hidden')); h.masked();
  await oldCopy.emit('click'); assert.equal(h.copies.length, 1); assert.ok(h.copies[0].includes('#key=')); h.masked();
  await h.form().emit('submit'); await oldCopy.emit('click'); assert.equal(h.copies.length, 1);
  const newCopy = h.find('Copy link'); await h.close(); await newCopy.emit('click'); assert.equal(h.copies.length, 1);
  await h.ui.open(); assert.equal(h.find('Copy link'), undefined); h.masked();
});

test('clipboard and API failures cannot leak error details and remain retryable', async () => {
  let fail = true;
  const h = harness({ clipboard: { writeText: async () => { throw Error('private-fixture-error'); } }, route: (path, body) => {
    if (path === '/api/overlays' && body && fail) { fail = false; throw Error('private-fixture-error'); }
  } });
  await h.ui.open(); await h.form().emit('submit'); h.masked();
  assert.equal(h.find('Create overlay link').disabled, false);
  await h.form().emit('submit'); await h.find('Copy link').emit('click'); h.masked();
  assert.ok(h.all().some(node => /Allow clipboard access/.test(node.textContent)));
  assert.equal(h.find('Copy link').disabled, false);
});

test('closing during creation or copying ignores late results', async () => {
  let complete;
  const h = harness({ route: (path, body) => path === '/api/overlays' && body ? new Promise(resolve => { complete = resolve; }) : undefined });
  await h.ui.open(); const pending = h.form().emit('submit'); await h.form().emit('submit');
  assert.equal(h.calls.filter(call => call.body?.widget).length, 1);
  await h.close(); complete({ overlay: { id: 'late', widget: 'count', player: 'duo' }, link: 'private-fixture-late' });
  await pending; assert.equal(h.find('Copy link'), undefined); h.masked();
  let rejectCopy;
  const copyHarness = harness({ clipboard: { writeText: () => new Promise((resolve, reject) => { rejectCopy = reject; }) } });
  await copyHarness.ui.open(); await copyHarness.form().emit('submit');
  const oldCopy = copyHarness.find('Copy link'), copying = oldCopy.emit('click');
  await copyHarness.close(); await copyHarness.ui.open(); rejectCopy(Error('private-fixture-error')); await copying;
  assert.equal(copyHarness.find('Copy link'), undefined); copyHarness.masked();
});

test('revocation confirms, cancellation sends nothing, failure allows retry, success clears new secret', async () => {
  let fail = true;
  const h = harness({ route: path => { if (path.endsWith('/revoke') && fail) { fail = false; throw Error('private-fixture-error'); } } });
  await h.ui.open(); await h.form().emit('submit'); const copy = h.find('Copy link');
  const revoke = h.all().filter(node => node.textContent === 'Revoke').at(-1);
  await revoke.emit('click'); await h.find('Cancel').emit('click');
  assert.equal(h.calls.filter(call => call.path.endsWith('/revoke')).length, 0);
  await revoke.emit('click'); await h.find('Revoke link').emit('click'); h.masked();
  assert.equal(h.find('Revoke link').disabled, false);
  await h.find('Revoke link').emit('click');
  assert.ok(h.find('Overlay link revoked.')); assert.equal(h.find('Copy link'), undefined);
  await copy.emit('click'); assert.equal(h.copies.length, 0); h.masked();
});

test('listing failure offers a safe retry and stale listing cannot replace a later dialog', async () => {
  let fail = true;
  const h = harness({ route: () => { if (fail) { fail = false; throw Error('private-fixture-error'); } } });
  await h.ui.open(); h.masked(); await h.find('Retry').emit('click'); assert.ok(h.form());
  let complete;
  const stale = harness({ route: () => new Promise(resolve => { complete = resolve; }) });
  const pending = stale.ui.open(); await stale.close(); complete({ links: [] }); await pending;
  assert.equal(stale.form(), undefined);
});

test('cancel clears the private link and invalidates pending creation even before close', async () => {
  const h = harness(); await h.ui.open(); await h.form().emit('submit');
  const copy = h.find('Copy link'); await h.cancel(); await copy.emit('click');
  assert.equal(h.copies.length, 0); assert.equal(h.find('Copy link'), undefined);
  let complete;
  const pendingHarness = harness({ route: (path, body) => body?.widget ? new Promise(resolve => { complete = resolve; }) : undefined });
  await pendingHarness.ui.open(); const pending = pendingHarness.form().emit('submit');
  await pendingHarness.cancel(); complete({ overlay: { id: 'late', widget: 'count', player: 'duo' }, link: 'private-fixture-late' });
  await pending; assert.equal(pendingHarness.find('Copy link'), undefined); pendingHarness.masked();
});
