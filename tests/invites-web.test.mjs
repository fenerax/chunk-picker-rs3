import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvites } from '../app/web/invites.mjs';
import { createStreamSafe, editLinkWarning } from '../app/web/stream-safe.mjs';

// Controlled DOM and API fixtures: no live server, clipboard or gameplay state.
function harness({ admin = true, origin = 'https://picker.fixture.invalid', clipboard, route, streamSafeMode = false, members = [] } = {}) {
  class Node {
    constructor(tag, text = '') { Object.assign(this, { tagName: tag, textContent: text, children: [], events: {}, attributes: {}, value: '', hidden: false, disabled: false }); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    async emit(key) { for (const action of this.events[key] ?? []) await action({ preventDefault() {} }); }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const calls = [], copies = [], dialog = new Node('dialog'), menuButton = new Node('button');
  let generation = 0, content, rows = [{ id: 'reed', label: 'Reed', createdAt: '2026-10-08T12:00:00Z', lastUsedAt: null, revoked: false, admin: false }];
  const el = (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; };
  const button = (text, action, cls) => { const node = el('button', text, cls); node.addEventListener('click', action); return node; };
  const input = (type, value = '') => { const node = el('input'); node.type = type; node.value = value; return node; };
  const field = (text, control) => { const node = el('label', text); node.append(control); return node; };
  const streamSafe = createStreamSafe({ storage: null }); streamSafe.set(streamSafeMode);
  const api = async (path, body) => {
    calls.push({ path, body });
    if (route) { const response = await route(path, body); if (response !== undefined) return response; }
    if (path === '/api/session') return { admin, kind: admin ? 'master' : 'invite', label: admin ? 'Player' : 'Reed' };
    if (path === '/api/invites' && body === undefined) return { invites: structuredClone(rows), publicOrigin: origin };
    if (path === '/api/invites') { const invite = { ...rows[0], ...body, id: 'new' }; rows.push(invite); return { invite, link: `${origin ?? 'http://private.fixture.invalid'}/?token=fixture-secret` }; }
    if (path === '/api/invites/reed/revoke') { rows[0] = { ...rows[0], revoked: '2026-10-08T13:00:00Z' }; return { invite: rows[0] }; }
    throw new Error(`Unexpected API path ${path}`);
  };
  const ui = createInvites({ api, el, button, input, field, dialog, menuButton, streamSafe,
    members: () => members,
    clipboard: clipboard ?? { writeText: async value => copies.push(value) },
    openDialog: (title, node) => { content = node; dialog.open = true; return ++generation; },
    dialogCurrent: value => dialog.open && value === generation });
  const all = () => { const walk = node => [node, ...node.children.flatMap(walk)]; return content ? walk(content) : []; };
  const find = text => all().find(node => node.textContent === text);
  const form = () => all().find(node => node.tagName === 'form');
  const label = () => all().find(node => node.tagName === 'input' && !node.readOnly && node.type === 'text');
  const permission = () => all().find(node => node.attributes['aria-label'] === 'Invite permission');
  const close = async () => { dialog.open = false; generation++; await dialog.emit('close'); };
  return { ui, calls, copies, all, find, form, label, permission, close, menuButton, streamSafe };
}

test('invite label suggests the second configured player with a generic empty-group fallback', async () => {
  for (const [members, expected] of [
    [[{ id: 'first', name: 'Player' }, { id: 'second', name: 'Reed' }], 'Reed'],
    [[{ id: 'first', name: 'Explorer 1' }, { id: 'second', name: 'Explorer 2' }], 'Explorer 2'],
    [[], 'Person'],
  ]) {
    const h = harness({ members }); await h.ui.open(); assert.equal(h.label().placeholder, expected);
  }
});

test('only an admin session exposes invite management and its metadata', async () => {
  const ordinary = harness({ admin: false }); await ordinary.ui.loadSession();
  assert.equal(ordinary.menuButton.hidden, true); await ordinary.ui.open();
  assert.ok(ordinary.find('Only admins can manage invite links.'));
  assert.ok(!ordinary.calls.some(call => call.path === '/api/invites'));
  const admin = harness(); await admin.ui.loadSession(); assert.equal(admin.menuButton.hidden, false);
  await admin.ui.open(); assert.ok(admin.find('Active · Player'));
  assert.ok(admin.all().some(node => /Last used: Never/.test(node.textContent)));
  assert.equal(admin.permission().value, 'player');
});

test('new link is shown once, copied, cleared on close and absent after reopening', async () => {
  const h = harness(); await h.ui.open(); h.label().value = ' Reed ';
  await h.form().emit('submit');
  assert.deepEqual(h.calls.find(call => call.body?.label).body, { label: 'Reed', admin: false });
  const link = h.all().find(node => node.readOnly); assert.equal(link.value, 'https://picker.fixture.invalid/?token=fixture-secret');
  await h.find('Copy link').emit('click'); assert.deepEqual(h.copies, [link.value]);
  assert.ok(h.find('Link copied.')); assert.equal(h.permission().value, 'player');
  await h.close(); assert.equal(link.value, '');
  await h.ui.open(); assert.ok(!h.all().some(node => node.readOnly)); assert.ok(!h.find('Copy link'));
});

test('stream-safe invites copy while masked, warn before revealing and remask on mode changes', async () => {
  const h = harness({ streamSafeMode: true }); await h.ui.open(); h.label().value = 'Player'; h.permission().value = 'admin';
  await h.form().emit('submit'); const link = h.all().find(node => node.readOnly);
  assert.doesNotMatch(link.value, /fixture-secret/); await h.find('Copy link').emit('click');
  assert.equal(h.find('Copy link').focused, true);
  assert.match(h.copies[0], /fixture-secret/); assert.doesNotMatch(link.value, /fixture-secret/);
  await h.find('Show').emit('click'); assert.ok(h.find(editLinkWarning)); assert.doesNotMatch(link.value, /fixture-secret/);
  await h.find('Show link').emit('click'); assert.match(link.value, /fixture-secret/);
  h.streamSafe.set(true); assert.doesNotMatch(link.value, /fixture-secret/);
  await h.close(); assert.equal(link.value, '');
});

test('clipboard failure does not reveal a masked invitation', async () => {
  const h = harness({ streamSafeMode: true, clipboard: { writeText: async () => { throw Error('Clipboard unavailable.'); } } });
  await h.ui.open(); h.label().value = 'Reed'; await h.form().emit('submit'); await h.find('Copy link').emit('click');
  assert.doesNotMatch(h.all().find(node => node.readOnly).value, /fixture-secret/);
  assert.ok(h.all().some(node => /Use Show to reveal/.test(node.textContent)));
});

test('optional admin choice is explicit and resets after creating a link', async () => {
  const h = harness(); await h.ui.open(); h.label().value = 'Helper'; h.permission().value = 'admin';
  await h.form().emit('submit');
  assert.equal(h.calls.find(call => call.body?.label).body.admin, true);
  assert.equal(h.permission().value, 'player'); assert.ok(h.find('Active · Admin'));
});

test('revoke needs confirmation; cancellation never sends a mutation', async () => {
  const h = harness(); await h.ui.open(); await h.find('Revoke').emit('click');
  assert.ok(h.all().some(node => /Revoke Reed’s link\?/.test(node.textContent)));
  await h.find('Cancel').emit('click'); assert.ok(!h.calls.some(call => call.path.includes('/revoke')));
  await h.find('Revoke').emit('click'); await h.find('Revoke link').emit('click');
  assert.deepEqual(h.calls.at(-1), { path: '/api/invites/reed/revoke', body: {} });
  assert.ok(h.find('Revoked · Player')); assert.ok(!h.find('Revoke'));
});

test('missing public origin still permits creation with the private address', async () => {
  const h = harness({ origin: null }); await h.ui.open();
  assert.equal(h.find('Create invite link').disabled, false);
  h.label().value = 'Reed'; await h.form().emit('submit');
  assert.ok(h.calls.some(call => call.body?.label));
  assert.equal(h.all().find(node => node.readOnly).value, 'http://private.fixture.invalid/?token=fixture-secret');
  assert.ok(h.all().some(node => /Public sharing requires RS3_PUBLIC_ORIGIN/.test(node.textContent)));
});

test('clipboard failure retains a selectable link and explains manual copying', async () => {
  const h = harness({ clipboard: { writeText: async () => { throw new Error('Clipboard denied.'); } } });
  await h.ui.open(); h.label().value = 'Reed'; await h.form().emit('submit');
  await h.find('Copy link').emit('click');
  assert.ok(h.all().some(node => /Clipboard denied.*copy it manually/.test(node.textContent)));
  const link = h.all().find(node => node.readOnly); assert.ok(link.value); assert.equal(link.selected, true);
});

test('closing during creation prevents a late response from exposing a secret', async () => {
  let complete;
  const h = harness({ route: (path, body) => path === '/api/invites' && body ? new Promise(resolve => { complete = resolve; }) : undefined });
  await h.ui.open(); h.label().value = 'Reed'; const request = h.form().emit('submit');
  await h.close(); complete({ invite: { id: 'new', label: 'Reed' }, link: 'https://picker.fixture.invalid/?token=late-secret' });
  await request; assert.ok(!h.all().some(node => node.readOnly)); assert.ok(!h.find('Copy link'));
});

test('failed creation keeps the label and allows retry', async () => {
  let fail = true;
  const h = harness({ route: (path, body) => { if (path === '/api/invites' && body && fail) { fail = false; throw new Error('Save failed. Retry.'); } } });
  await h.ui.open(); h.label().value = 'Reed'; await h.form().emit('submit');
  assert.ok(h.find('Save failed. Retry.')); assert.equal(h.label().value, 'Reed'); assert.equal(h.find('Create invite link').disabled, false);
  await h.form().emit('submit'); assert.ok(h.find('Copy link'));
});

test('duplicate submission during a pending creation sends only one mutation', async () => {
  let complete;
  const h = harness({ route: (path, body) => path === '/api/invites' && body ? new Promise(resolve => { complete = resolve; }) : undefined });
  await h.ui.open(); h.label().value = 'Reed';
  const pending = h.form().emit('submit'); await h.form().emit('submit');
  assert.equal(h.calls.filter(call => call.body?.label).length, 1);
  complete({ invite: { id: 'new', label: 'Reed', admin: false }, link: 'https://picker.fixture.invalid/?token=fixture-secret' });
  await pending; assert.ok(h.find('Copy link'));
});

test('a failed revoke preserves the confirmation and allows retry', async () => {
  let fail = true;
  const h = harness({ route: path => { if (path.endsWith('/revoke') && fail) { fail = false; throw new Error('Revoke failed. Retry.'); } } });
  await h.ui.open(); await h.find('Revoke').emit('click'); await h.find('Revoke link').emit('click');
  assert.ok(h.find('Revoke failed. Retry.')); assert.equal(h.find('Revoke link').disabled, false);
  await h.find('Revoke link').emit('click'); assert.ok(h.find('Revoked · Player'));
});

test('view-only permission is explicit, sent separately and labelled on the revocable row', async () => {
  const h = harness(); await h.ui.open(); h.label().value = 'Spectator'; h.permission().value = 'viewer';
  assert.deepEqual(h.permission().children.map(node => node.textContent), ['Player', 'Admin', 'View only']);
  await h.form().emit('submit');
  assert.deepEqual(h.calls.find(call => call.body?.label).body, { label: 'Spectator', admin: false, viewer: true });
  assert.ok(h.find('Active · View only')); assert.equal(h.permission().value, 'player');
  assert.ok(h.all().some(node => node.attributes['aria-label'] === 'Revoke Spectator’s link'));
  assert.ok(h.all().some(node => /watch both maps, tasks, notes and History live/.test(node.textContent)));
});
