import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPartnerSupply, createPartnerSupplyCopy, createPartnerSupplyView } from '../app/web/partner-supply-view.mjs';
import { createGroupState } from '../app/core/state.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {}, listeners: {}, dataset: {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener(name, action) { this.listeners[name] = action; },
    focus() { this.focused = true; }, select() { this.selected = true; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const context = () => ({ el: node, button: (label, action, cls) => ({ ...node('button', label, cls), action }), plain: text => text, canWrite: () => false });
const model = () => ({ revision: 0, members: [{ id: 'a', name: 'Player', ready: true, requests: [{ key: 'planks', label: 'Oak plank', choiceCount: null,
  items: [{ name: 'Oak plank', quantity: 5, sources: [{ kind: 'shop', source: 'Sawmill', location: '1', memberId: 'b', memberName: 'Reed' }] }],
  needs: [{ taskId: 'build', label: 'Build shelves', quantity: 5, status: 'blocked' }] }] }, { id: 'b', name: 'Reed', ready: true, requests: [] }] });

test('view lists amounts, reasons and gather sources without write controls or inline CSP attributes', () => {
  const c = context(); c.world = { chunks: new Map([['1', { name: 'Sawmill yard' }]]), areas: new Map() };
  const nodes = all(renderPartnerSupply(c, model()));
  assert.ok(nodes.some(node => node.textContent === 'Ask Reed for: 5 × Oak plank'));
  assert.ok(nodes.some(node => node.textContent === 'For Build shelves · 5 needed · other requirements remain'));
  assert.ok(nodes.some(node => node.textContent === 'Reed: Oak plank · Sawmill · Sawmill yard'));
  assert.ok(nodes.some(node => node.textContent === 'No partner supplies needed for the current tasks.'));
  assert.ok(nodes.every(node => !['input', 'form', 'button'].includes(node.tag)));
  assert.ok(nodes.every(node => !Object.keys(node.attributes).some(key => /^(?:style|on)/.test(key))));
});

test('Discord copy succeeds and offers selectable fallback when clipboard is unavailable', async () => {
  let copied;
  const nodes = all(createPartnerSupplyCopy(context(), model(), () => ({ writeText: async text => { copied = text; } })));
  await nodes.find(node => node.textContent === 'Copy for Discord').action();
  assert.match(copied, /5 × Oak plank/); assert.equal(nodes.find(node => node.tag === 'output').textContent, 'Copied');
  const fallback = all(createPartnerSupplyCopy(context(), model(), () => undefined));
  await fallback.find(node => node.textContent === 'Copy for Discord').action();
  const text = fallback.find(node => node.tag === 'textarea'); assert.equal(text.readOnly, true); assert.equal(text.selected, true);
  assert.ok(fallback.some(node => node.className === 'list-copy-fallback' && !node.hidden));
});

test('closed dialogs discard pending results and failed loading offers retry', async () => {
  const c = context(); c.state = createGroupState([{ id: 'a', name: 'Player' }]); c.memberId = 'a'; c.sandbox = { active: false };
  let generation = 0, shown, resolve, fail = false;
  c.$ = () => null; c.openDialog = (title, root) => { shown = root; return ++generation; }; c.dialogCurrent = value => value === generation;
  c.ensureDuoDetails = () => fail ? Promise.reject(new Error('Failed')) : new Promise(done => { resolve = done; });
  const view = createPartnerSupplyView(c), pending = view.open(); generation++;
  resolve({ memberId: 'a', stateRevision: 0, tasks: [], items: [] }); await pending;
  assert.ok(all(shown).some(node => node.textContent === 'Loading partner supplies…'));
  fail = true; await view.open(); assert.ok(all(shown).some(node => node.textContent === 'Refresh partner supplies'));
});
