import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskHover, renderTaskHover, taskHoverPosition, taskHoverSources } from '../app/web/task-hover.mjs';
import { createTaskMethods } from '../app/web/task-methods.mjs';

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.box = { left: 900, right: 1250, top: 350, bottom: 400, width: 350, height: 50 }; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get firstChild() { return this.children[0]; }
  get isConnected() { return this.connected || !!this.parent?.isConnected; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  removeEventListener(key, action) { this.events[key] = (this.events[key] ?? []).filter(value => value !== action); }
  emit(key, event = {}) { return Promise.all((this.events[key] ?? []).map(action => action(event))); }
  getBoundingClientRect() { return this.tagName === 'aside' ? { width: 320, height: 230 } : this.box; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
}
const all = node => [node, ...node.children.flatMap(all)];
const text = node => all(node).map(value => value.textContent ?? '').join(' ');
const task = { id: 'task:boss', label: 'Chaos Elemental', category: 'Combat', level: 60, status: 'available' };
function harness(options = {}) {
  const document = new Node('document'); document.createElement = tag => new Node(tag); document.body = new Node('body'); document.body.connected = true;
  const viewport = new Node('window'); viewport.innerWidth = 1440; viewport.innerHeight = 900;
  const timers = new Map(); let scope = 'actor1:7';
  const hover = createTaskHover({ document, viewport, getScope: () => scope, setTimeout: (action, delay) => { const id = Symbol(); timers.set(id, { action, delay }); return id; }, clearTimeout: id => timers.delete(id), ...options });
  const row = new Node('div'), target = new Node('button'); row.append(target); document.body.append(row); hover.attach(row, target, task);
  const fire = async delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); await timer.action(); } };
  return { document, viewport, hover, row, target, timers, fire, changeScope: value => { scope = value; } };
}

test('hover waits, loads once shown, and restores accessible description on leave', async () => {
  let calls = 0; const h = harness({ getDetails: async row => { calls++; return { ...row, record: { Description: 'Defeat the Chaos Elemental 25 times.' } }; } });
  h.target.setAttribute('aria-describedby', 'existing-help');
  await h.row.emit('pointerenter', { pointerType: 'mouse' }); assert(h.hover.element.hidden); assert.equal(calls, 0);
  await h.fire(250); assert.equal(calls, 1); assert.equal(h.hover.element.hidden, false);
  assert(text(h.hover.element).includes('Defeat the Chaos Elemental 25 times.'));
  assert.equal(h.hover.element.dataset.side, 'left'); assert(h.target.getAttribute('aria-describedby').includes(h.hover.element.id));
  await h.row.emit('pointerleave', { pointerType: 'mouse' }); assert(h.hover.element.hidden); assert.equal(h.target.getAttribute('aria-describedby'), 'existing-help');
});

test('passing over a row and touch scrolling do not request detail', async () => {
  let calls = 0; const h = harness({ getDetails: async row => { calls++; return row; } });
  await h.row.emit('pointerenter', {}); await h.row.emit('pointerleave', {}); await h.fire(250);
  await h.row.emit('pointerdown', { pointerType: 'touch', target: h.target, clientX: 4, clientY: 8 });
  await h.row.emit('pointermove', { clientX: 4, clientY: 40 }); await h.fire(500);
  assert.equal(calls, 0); assert(h.hover.element.hidden);
});

test('keyboard focus shows card and Escape, scroll and focus leaving dismiss it', async () => {
  for (const dismiss of [h => h.document.emit('keydown', { key: 'Escape' }), h => h.viewport.emit('scroll'), h => h.row.emit('focusout', { relatedTarget: new Node('button') })]) {
    const h = harness(); await h.row.emit('focusin', { target: h.target }); await h.fire(250); assert(!h.hover.element.hidden);
    await dismiss(h); assert(h.hover.element.hidden); assert.equal(h.target.getAttribute('aria-describedby'), null);
  }
});

test('long press shows a card and consumes its synthetic click without opening the task', async () => {
  const h = harness(); await h.row.emit('pointerdown', { pointerType: 'touch', target: h.target, clientX: 2, clientY: 2 });
  await h.fire(500); await h.row.emit('pointerup', { pointerType: 'touch' }); assert(!h.hover.element.hidden);
  let prevented = false, stopped = false;
  await h.row.emit('click', { preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert(prevented && stopped); await h.document.emit('pointerdown', { target: new Node('button') }); assert(h.hover.element.hidden);
});

test('tooltip description follows keyboard focus between controls in one row', async () => {
  const h = harness(), other = new Node('input'); other.setAttribute('aria-describedby', 'checkbox-help'); h.row.append(other);
  await h.row.emit('focusin', { target: h.target }); await h.fire(250);
  await h.row.emit('focusout', { relatedTarget: other }); await h.row.emit('focusin', { target: other });
  assert(!h.hover.element.hidden); assert.equal(h.target.getAttribute('aria-describedby'), null);
  assert.equal(other.getAttribute('aria-describedby'), `checkbox-help ${h.hover.element.id}`);
  h.hover.hide(); assert.equal(other.getAttribute('aria-describedby'), 'checkbox-help');
});

test('late detail from a dismissed or changed member cannot reopen or replace the card', async () => {
  let resolve; const h = harness({ getDetails: () => new Promise(done => { resolve = done; }) });
  await h.row.emit('focusin', { target: h.target }); const pending = h.fire(250);
  h.changeScope('reed:8'); h.hover.hide(); resolve({ ...task, record: { Description: 'Old member detail' } }); await pending;
  assert(h.hover.element.hidden); assert(!text(h.hover.element).includes('Old member detail'));
});

test('detail failure retains compact facts and gives a retry route', async () => {
  const h = harness({ getDetails: async () => { throw new Error('Offline'); } }); await h.row.emit('pointerenter', {}); await h.fire(250);
  assert(text(h.hover.element).includes('Doable now')); assert(text(h.hover.element).includes('Open the task to retry.'));
  h.hover.dispose(); assert.equal(h.document.events.keydown.length, 0); assert.equal(h.viewport.events.scroll.length, 0);
});

test('phone hover stays inside viewport and never overlaps its row', () => {
  for (const top of [20, 300, 720]) {
    const row = { left: 16, right: 374, top, bottom: top + 55 };
    const point = taskHoverPosition(row, { width: 320, height: 230 }, { width: 390, height: 844 });
    assert(point.left >= 8 && point.left + point.width <= 382);
    const height = Math.min(point.maxHeight, 230);
    assert(point.top >= 8 && point.top + height <= 836);
    assert(point.top + height <= row.top - 10 || point.top >= row.bottom + 10);
  }
});

test('hover shows first blocker, useful description and at most three named source locations', () => {
  const h = harness(); const blocked = { ...task, status: 'blocked', record: { Description: 'Defeat the Chaos Elemental 25 times.' }, blockers: [{ detail: 'Requires level 60 Defence' }, { detail: 'Other blocker' }], sources: [{ source: 'Chaos Elemental', location: '1' }, { source: 'Shop', locations: ['2'] }, { source: 'Spawn', location: '3' }, { source: 'Fourth' }] };
  const card = renderTaskHover(blocked, { document: h.document, locationName: id => `Place ${id}`, skillLookup: () => '/icon.png' });
  assert(text(card).includes('Requires level 60 Defence')); assert(!text(card).includes('Other blocker'));
  assert(text(card).includes('Place 1')); assert(!text(card).includes('Fourth')); assert.equal(all(card).filter(node => node.tagName === 'img').length, 1);
  assert.deepEqual(taskHoverSources({ sources: [{ source: 'Shop', location: '1' }, { source: 'Shop', location: '1' }] }), ['Shop · 1']);
});

test('alternative methods show active choice, level, state, direct choosing and automatic reset', async () => {
  const h = harness(), chosen = [];
  const methods = createTaskMethods({ document: h.document, tasks: [task, { ...task, id: 'task:other', label: 'Other method', status: 'blocked', blockers: [{ detail: 'Need logs' }] }], activeId: task.id, canChoose: true, automatic: false, choose: id => chosen.push(id), open() {} });
  assert(text(methods).includes('Doable now (1)')); assert(text(methods).includes('Needs progress (1)')); assert(text(methods).includes('Level 60')); assert(text(methods).includes('Active choice')); assert(text(methods).includes('Need logs'));
  const buttons = all(methods).filter(node => node.tagName === 'button');
  await buttons.find(node => node.children.some(child => child.textContent === 'Other method')).emit('click');
  await buttons.find(node => node.textContent === 'Choose automatically').emit('click'); assert.deepEqual(chosen, ['task:other', null]);
});

test('method action failures stay visible and controls recover', async () => {
  const h = harness(); const methods = createTaskMethods({ document: h.document, tasks: [task], activeId: task.id, canChoose: true, choose: async () => { throw new Error('Saved map changed'); }, open() {} });
  const choice = all(methods).find(node => node.className === 'task-method-choice'); await choice.emit('click'); assert.equal(choice.disabled, false); assert(text(methods).includes('Saved map changed'));
});

test('long alternative lists start compact, keep the active method visible and reveal remaining choices', async () => {
  const h = harness(), tasks = Array.from({ length: 24 }, (_, index) => ({ ...task, id: `method:${index}`, label: `Method ${index}` }));
  const methods = createTaskMethods({ document: h.document, tasks, activeId: 'method:23', canChoose: true, choose() {}, open() {} });
  const choices = () => all(methods).filter(node => node.className === 'task-method-choice');
  assert.equal(choices().length, 6); assert(text(choices()[0]).includes('Method 23'));
  const more = () => all(methods).find(node => node.className === 'task-methods-more');
  assert.equal(more().textContent, 'Show more methods (18)'); await more().emit('click'); assert.equal(choices().length, 18);
  await more().emit('click'); assert.equal(choices().length, 24); assert.equal(more(), undefined);
});

test('generated equipment alternatives do not display their synthetic goal level as an equip requirement', () => {
  const h = harness(); const methods = createTaskMethods({ document: h.document, tasks: [{ ...task, category: 'BiS', generated: true, level: 1 }], activeId: task.id, canChoose: false, open() {} });
  assert(!text(methods).includes('Level 1')); assert(text(methods).includes('Doable now'));
});

test('Extra tasks name the group that added them; other categories do not', () => {
  const h = harness();
  const extra = renderTaskHover({ id: 'x:lantern', label: 'Obtain a lantern', category: 'Extra', status: 'available', record: { Label: 'Gear Goals' } }, { document: h.document });
  assert(text(extra).includes('Extra · Gear Goals'));
  const quest = renderTaskHover({ id: 'q:1', label: 'Fixture quest', category: 'Quest', status: 'available', record: { Label: 'Fixture series' } }, { document: h.document });
  assert(!text(quest).includes('Fixture series'));
});
