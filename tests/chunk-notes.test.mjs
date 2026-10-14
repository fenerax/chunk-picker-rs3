import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenChunkNotes } from '../app/web/screen-chunk-notes.mjs';

class FakeNode {
  constructor(tagName = 'div', text = '', className = '') {
    Object.assign(this, {
      tagName: tagName.toUpperCase(), textContent: text, className, children: [], parent: null,
      events: {}, attributes: {}, dataset: {}, hidden: false, value: '', readOnly: false,
      clientHeight: 40,
    });
  }
  get scrollHeight() {
    const text = this.tagName === 'TEXTAREA' ? this.value : this.textContent;
    const lines = String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0);
    return lines * 20;
  }
  get isConnected() { return !!this.connected || !!this.parent?.isConnected; }
  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.events[type] ??= []).push(handler); }
  async emit(type, event = {}) { for (const handler of this.events[type] ?? []) await handler({ target: this, ...event }); }
  querySelector(selector) {
    const matches = node => selector.startsWith('.')
      ? node.className.split(/\s+/).includes(selector.slice(1))
      : node.tagName.toLowerCase() === selector.toLowerCase();
    const visit = node => {
      for (const child of node.children) {
        if (!(child instanceof FakeNode)) continue;
        if (matches(child)) return child;
        const found = visit(child); if (found) return found;
      }
    };
    return visit(this);
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => { for (const child of node.children) if (child instanceof FakeNode) { if (selector.startsWith('.') ? child.className.split(/\s+/).includes(selector.slice(1)) : child.tagName.toLowerCase() === selector.toLowerCase()) found.push(child); visit(child); } };
    visit(this); return found;
  }
}

const walk = node => [node, ...node.children.filter(child => child instanceof FakeNode).flatMap(walk)];
const connect = node => { node.connected = true; for (const child of node.children) if (child instanceof FakeNode) connect(child); };
const findText = (root, text) => walk(root).find(node => node.textContent === text);

function fixture({ canWrite = true, members = [], memberId = 'actor1', revision = 1, ResizeObserverClass } = {}) {
  const calls = [], frames = [], drafts = new Map();
  const actor1 = members.find(member => member.id === 'actor1') ?? { id: 'actor1', name: 'Player', notes: {} };
  const reed = members.find(member => member.id === 'reed') ?? { id: 'reed', name: 'Reed', notes: {} };
  const c = {
    memberId, chunkId: '12341', state: { revision, members: members.length ? members : [actor1, reed] }, chunkDrafts: drafts,
    canWrite: () => canWrite,
    member() { return this.state.members.find(member => member.id === this.memberId); },
    el: (tag, text, className) => new FakeNode(tag, text ?? '', className ?? ''),
    button(label, action, className = '') { const node = new FakeNode('button', label, className); node.addEventListener('click', action); return node; },
    field(label, control) { const node = new FakeNode('label', '', 'field'); const caption = new FakeNode('span', label); node.append(caption, control); return node; },
    panelContext: undefined,
  };
  c.panelContext = {
    el: c.el, button: c.button, field: c.field, canWrite: c.canWrite,
    state: () => c.state,
    command: async (...args) => { calls.push(args); return { state: { revision: c.state.revision + 1 } }; },
    showError(error) { throw error; },
  };
  const previousRAF = globalThis.requestAnimationFrame;
  const previousResizeObserver = globalThis.ResizeObserver;
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  if (ResizeObserverClass) globalThis.ResizeObserver = ResizeObserverClass;
  const api = createScreenChunkNotes(c);
  const element = c.chunkNote('12341'); connect(element);
  const settleFrames = () => { while (frames.length) frames.shift()(); };
  return {
    c, calls, drafts, element, api, settleFrames,
    restore() { globalThis.requestAnimationFrame = previousRAF; globalThis.ResizeObserver = previousResizeObserver; },
    all(selector) { return element.querySelectorAll(selector); },
    one(selector) { return element.querySelector(selector); },
    ownerNote(id) { return element.querySelector('.chunk-own-note')?.querySelector('textarea'); },
    partnerSections() { return element.querySelectorAll('.chunk-partner-note'); },
    refresh() { c.refreshChunkNotes(); },
  };
}

test('renders selected player first with named partner attribution and own-only save command', async t => {
  const h = fixture({ memberId: 'reed', members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'Player note' } },
    { id: 'reed', name: 'Reed', notes: { '12341': 'Reed note' } },
  ] });
  t.after(h.restore);
  const own = h.one('.chunk-own-note'), partner = h.partnerSections()[0];
  assert.equal(h.element.children[0], own, 'selected player editor is first');
  assert.equal(own.querySelector('textarea').value, 'Reed note');
  assert.equal(own.querySelector('label').children[0].textContent, 'Reed’s note');
  assert.equal(partner.getAttribute?.('aria-label') ?? partner.attributes['aria-label'], 'Player’s note');
  assert.equal(partner.querySelector('.chunk-note-text').textContent, 'Player note');
  const textarea = own.querySelector('textarea'); textarea.value = 'Reed updated'; await textarea.emit('input');
  const save = findText(own, 'Save chunk note'); assert.ok(save); await save.emit('click');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0][0], { type: 'set-note', memberId: 'reed', chunkId: '12341', note: 'Reed updated' });
});

test('omits blank and whitespace-only partner notes while preserving literal multiline markup text', t => {
  const text = '<b>literal</b>\nsecond line';
  const h = fixture({ members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'Own note' } },
    { id: 'reed', name: 'Reed', notes: { '12341': ' \n  ' } },
    { id: 'guest', name: 'Guest', notes: { '12341': text } },
  ] });
  t.after(h.restore);
  assert.equal(h.partnerSections().length, 1);
  assert.equal(h.partnerSections()[0].querySelector('.chunk-note-text').textContent, text);
  assert.equal(h.one('b'), undefined, 'markup-like note text is not parsed as HTML');
});

test('viewer renders both notes read-only and exposes no save controls or commands', async t => {
  const h = fixture({ canWrite: false, members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'Viewer owner' } },
    { id: 'reed', name: 'Reed', notes: { '12341': 'Viewer partner' } },
  ] });
  t.after(h.restore);
  const textarea = h.ownerNote();
  assert.equal(textarea.value, 'Viewer owner'); assert.equal(textarea.readOnly, true);
  assert.equal(h.partnerSections()[0].querySelector('textarea'), undefined);
  assert.equal(findText(h.element, 'Save chunk note'), undefined);
  await textarea.emit('input'); await h.partnerSections()[0].emit('input');
  assert.equal(h.calls.length, 0);
});

test('partner updates refresh in place without replacing a focused own draft', t => {
  const h = fixture({ members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'Initial own' } },
    { id: 'reed', name: 'Reed', notes: { '12341': 'Initial partner' } },
  ] });
  t.after(h.restore);
  const editor = h.one('.chunk-own-note'), textarea = editor.querySelector('textarea');
  textarea.value = 'Unsaved draft'; textarea.emit('input');
  h.c.state.revision++;
  h.c.state.members[1].notes['12341'] = 'Updated partner';
  h.refresh();
  assert.equal(h.one('.chunk-own-note'), editor);
  assert.equal(editor.querySelector('textarea'), textarea);
  assert.equal(textarea.value, 'Unsaved draft');
  assert.equal(h.partnerSections()[0].querySelector('.chunk-note-text').textContent, 'Updated partner');
  assert.equal(h.drafts.get('actor1:12341').value, 'Unsaved draft');
});

test('expand control appears only for measured overflow and preserves partner expansion across updates', t => {
  const long = 'A long note that is deliberately beyond the measured collapsed height. '.repeat(8);
  const h = fixture({ members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'short' } },
    { id: 'reed', name: 'Reed', notes: { '12341': long } },
  ] });
  t.after(h.restore);
  h.settleFrames();
  const ownToggle = h.one('.chunk-own-note').querySelector('.chunk-note-expand');
  const partnerToggle = h.partnerSections()[0].querySelector('.chunk-note-expand');
  assert.equal(ownToggle.hidden, true, 'short own note has no visible expand control');
  assert.equal(partnerToggle.hidden, false, 'long partner note overflows the measured collapsed height');
  assert.equal(partnerToggle.attributes['aria-expanded'], 'false');
  partnerToggle.emit('click');
  assert.equal(partnerToggle.textContent, 'Collapse note');
  assert.equal(partnerToggle.attributes['aria-expanded'], 'true');
  assert.equal(partnerToggle.parent.dataset.expanded, 'true');
  h.c.state.revision++;
  h.c.state.members[1].notes['12341'] = `${long}Updated.`;
  h.refresh();
  const updatedToggle = h.partnerSections()[0].querySelector('.chunk-note-expand');
  assert.equal(updatedToggle.textContent, 'Collapse note');
  assert.equal(updatedToggle.attributes['aria-expanded'], 'true');
  assert.equal(updatedToggle.parent.dataset.expanded, 'true');
  updatedToggle.emit('click');
  assert.equal(updatedToggle.textContent, 'Expand note');
  assert.equal(updatedToggle.attributes['aria-expanded'], 'false');
});

test('resize observers remeasure, disconnect on replacement and disposal, and ignore late frames', t => {
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    fire() { this.callback(); }
  }
  const long = 'A long note that overflows at the collapsed height. '.repeat(5);
  const h = fixture({ ResizeObserverClass: Observer, members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'Own note' } },
    { id: 'reed', name: 'Reed', notes: { '12341': long } },
  ] });
  t.after(h.restore);
  h.settleFrames();
  assert.equal(observers.length, 2, 'one observer tracks each rendered note');
  const ownObserver = observers[0], oldPartnerObserver = observers[1];
  const oldToggle = h.partnerSections()[0].querySelector('.chunk-note-expand');
  assert.equal(oldToggle.hidden, false);
  oldPartnerObserver.target.clientHeight = 500; oldPartnerObserver.fire();
  assert.equal(oldToggle.hidden, true, 'a resize that removes overflow hides the control');
  oldPartnerObserver.target.clientHeight = 20; oldPartnerObserver.fire();
  assert.equal(oldToggle.hidden, false, 'a resize that adds overflow shows the control');

  h.c.state.revision++;
  h.c.state.members[1].notes['12341'] = `Replaced note: ${long}`;
  h.refresh();
  assert.equal(oldPartnerObserver.disconnected, true, 'replacing partner content disconnects its old observer');
  h.settleFrames();
  assert.equal(observers.length, 3);
  const newPartnerObserver = observers[2];

  h.c.disposeChunkNotes();
  assert.equal(ownObserver.disconnected, true, 'tab disposal disconnects the own-note observer');
  assert.equal(newPartnerObserver.disconnected, true, 'tab disposal disconnects the current partner observer');
  const replacement = h.c.chunkNote('12341'); connect(replacement);
  h.c.disposeChunkNotes();
  h.settleFrames();
  assert.equal(observers.length, 3, 'queued animation frames after disposal do not install observers');
});

test('accepting a long remote note immediately reveals own-note expansion control', async t => {
  const long = 'A remote note that is longer than the collapsed display can show. '.repeat(5);
  const h = fixture({ members: [
    { id: 'actor1', name: 'Player', notes: { '12341': 'short' } },
    { id: 'reed', name: 'Reed', notes: {} },
  ] });
  t.after(h.restore);
  h.c.panelContext.command = async () => { throw Object.assign(new Error('Conflict'), { noteConflict: true, remoteNote: long, revision: 2 }); };
  const textarea = h.ownerNote(), toggle = h.one('.chunk-own-note').querySelector('.chunk-note-expand');
  assert.equal(toggle.hidden, true);
  await findText(h.element, 'Save chunk note').emit('click');
  await findText(h.element, 'Use remote note').emit('click');
  assert.equal(textarea.value, long);
  assert.equal(toggle.hidden, false, 'programmatic remote replacement refreshes overflow immediately');
});
