// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewCache } from '../app/web/browser-state.mjs';
import { appendTaskHow } from '../app/web/task-how.mjs';
import { appendTaskWhy } from '../app/web/task-why.mjs';
import { createWhyChainDisclosure } from '../app/web/task-why-chain.mjs';

class Node {
  constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; this.attributes = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, action) { this.events[key] = action; }
}
const text = node => typeof node === 'string' ? node : [node.textContent ?? '', ...node.children.map(text)].join(' ');
const document = { createElement: tag => new Node(tag) };
const button = (label, action) => Object.assign(new Node('button', label), { events: { click: action } });
const task = { id: 'synthetic:goal', label: 'Synthetic goal', category: 'Extra', status: 'available' };
const proof = label => ({ proofStatus: 'complete', root: 'root', nodes: { root: { kind: 'task', label, allOf: [] } } });
const chain = label => ({ memberId: 'member', stateRevision: 7, root: { kind: 'task', label, children: [] } });
function harness(view) {
  const cache = createViewCache({ storage: null }); cache.configure(['dataset', 'picker', 'member', 'writer']);
  let resolve, reject, revision = 7;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const row = new Node('div'), selector = { taskId: task.id };
  const cached = view === 'how' ? proof('Old answer') : view === 'why-chain' ? chain('Old answer')
    : { rules: [], sources: [], neededFor: [], hidden: ['Old answer'] };
  cache.remember(view, view === 'why-chain' ? JSON.stringify(['member', selector]) : task.id, 6, cached);
  let toggle, open, close;
  const options = { document, button, cache, revision: () => revision, scope: () => 'member', load: () => pending };
  if (view === 'why-chain') {
    toggle = createWhyChainDisclosure({ api: () => pending, viewCache: cache,
      el: (tag, label) => new Node(tag, label), button: (label, action) => Object.assign(new Node('button', label), { action }),
      details: (label, body) => { const node = new Node('details', label); node.append(body); return node; },
    }, selector, { memberId: 'member', revision: 7, current: () => revision === 7 });
    row.append(toggle);
    open = () => { toggle.open = true; return toggle.events.toggle(); };
    close = () => { toggle.open = false; return toggle.events.toggle(); };
  } else {
    toggle = view === 'how' ? appendTaskHow(row, task, options) : appendTaskWhy(row, task, { ...options, icon: () => new Node('span') });
    open = close = () => toggle.events.click();
  }
  return { row, cache, open, close, reject, changeRevision: () => { revision++; },
    resolve: () => resolve(view === 'how' ? proof('Current answer') : view === 'why-chain' ? chain('Current answer')
      : { task, result: { tasks: [], presentation: { suppressed: { [task.id]: ['Current answer'] } } } }) };
}

for (const view of ['why', 'how', 'why-chain']) {
  test(`${view} shows older evidence only while updating, then replaces it with the live answer`, async () => {
    const h = harness(view), loading = h.open();
    assert.match(text(h.row), /Updating….*Old answer/);
    h.resolve(); await loading;
    assert.match(text(h.row), /Current answer/); assert.doesNotMatch(text(h.row), /Old answer|Updating…/);
  });
  for (const [kind, error] of [['failed', new Error('Read failed')],
    ['refused', Object.assign(new Error('Read refused'), { status: 403, code: 'PERMISSION_DENIED' })]]) {
    test(`${view} removes provisional evidence when the live read is ${kind}`, async () => {
      const h = harness(view), loading = h.open();
      assert.match(text(h.row), /Updating….*Old answer/);
      h.reject(error); await loading;
      assert.match(text(h.row), new RegExp(`Read ${kind}`)); assert.doesNotMatch(text(h.row), /Old answer|Updating…/);
    });
  }
  for (const stop of ['close', 'permission', 'revision']) {
    test(`${view} clears provisional evidence after ${stop} and ignores the late answer`, async () => {
      const h = harness(view), loading = h.open();
      assert.match(text(h.row), /Updating….*Old answer/);
      if (stop === 'close') { h.close(); assert.doesNotMatch(text(h.row), /Old answer/); }
      else if (stop === 'permission') h.cache.configure(['another-permission']);
      else h.changeRevision();
      h.resolve(); await loading;
      assert.doesNotMatch(text(h.row), /Old answer|Current answer|Updating…/);
    });
  }
}
