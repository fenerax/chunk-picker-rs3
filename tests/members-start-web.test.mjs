import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMembersStart } from '../app/web/members-start.mjs';

const data = JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url)));
function harness({ writable = true, api } = {}) {
  class Node {
    constructor(tag, text, className) { Object.assign(this, { tag, textContent: text ?? '', className, children: [], events: {}, attributes: {}, value: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
    focus() {}
  }
  let state = { revision: 4, members: ['player1', 'player2'].map(id => ({ id, name: id === 'player1' ? 'Player 1' : 'Player 2', unlocked: ['1234', '5678'], selected: ['9012'], pendingRoll: ['3456'], preferences: {} })) }, content, generation = 0, title;
  const calls = [], el = (tag, text, cls) => new Node(tag, text, cls);
  const ctx = { el, state: () => state, canWrite: () => writable, input: type => Object.assign(el('input'), { type }), button: (text, click, cls) => { const node = el('button', text, cls); node.events.click = click; return node; },
    openDialog: (text, node) => { title = text; content = node; return ++generation; }, closeDialog: () => { generation++; }, dialogCurrent: token => token === generation,
    api: api ?? (async () => ({ data })), command: async (payload, revision, note, current) => { assert.ok(current()); calls.push({ payload, revision }); state = { ...state, revision: revision + 1, members: state.members.map(member => ({ ...member, unlocked: ['16692'] })) }; return { state }; } };
  const walk = node => node ? [node, ...node.children.flatMap(walk)] : [];
  const nodes = () => walk(content), text = () => nodes().map(node => node.textContent).join(' '), findButton = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const choose = label => { const row = nodes().find(node => node.tag === 'label' && walk(node).some(child => child.textContent === label)); const control = row.children[0]; control.checked = true; control.events.change(); };
  return { panel: createMembersStart(ctx), ctx, calls, nodes, text, choose, button: findButton, title: () => title, changeState: () => { state = { ...state, revision: state.revision + 1 }; } };
}

test('members entry is unavailable to a read-only link', async () => {
  let requests = 0; const h = harness({ writable: false, api: async () => { requests++; return { data }; } });
  await h.panel.open(); assert.equal(requests, 0); assert.equal(h.title(), undefined);
});

test('bank preview uses personal Trader Woes confirmation and hides impossible pairing', async () => {
  const h = harness(); await h.panel.open(); assert.match(h.text(), /Player 1: 19 banks/);
  assert.match(h.text(), /19 banks for each player/); assert.match(h.text(), /1 bank for each player/);
  h.choose('Havenhythe'); assert.match(h.text(), /Both players start at Wendlewick/); assert.equal(h.text().includes('Fully random'), false);
  h.choose('Player 1: I have done Trader Woes'); assert.match(h.text(), /Player 1: 2 banks/); assert.match(h.text(), /Player 2: 1 bank/); assert.match(h.text(), /Fully random/);
});

test('review requires typed confirmation and rejects a changed saved revision', async () => {
  const h = harness(); await h.panel.open(); h.button('Review members start').events.click();
  const apply = h.button('Reset group maps and roll starting banks'), typed = h.nodes().find(node => node.tag === 'input');
  assert.equal(apply.disabled, true); typed.value = 'members'; typed.events.input(); assert.equal(apply.disabled, false);
  h.changeState(); await apply.events.click(); assert.equal(h.calls.length, 0); assert.match(h.text(), /saved maps changed/);
});

test('confirmed group start submits reviewed options and reports names and Undo', async () => {
  const h = harness(); await h.panel.open(); h.choose('Havenhythe'); h.button('Review members start').events.click();
  const typed = h.nodes().find(node => node.tag === 'input'); typed.value = 'members'; typed.events.input(); await h.button('Reset group maps and roll starting banks').events.click();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].revision, 4); assert.equal(h.calls[0].payload.type, 'go-members'); assert.equal(h.calls[0].payload.options.pool, 'optionB');
  assert.match(h.text(), /Player 1: Wendlewick/); assert.match(h.text(), /Player 2: Wendlewick/); assert.match(h.text(), /Undo in History/);
});

test('closing during bank loading cannot replace another dialog', async () => {
  let resolve; const h = harness({ api: () => new Promise(done => { resolve = done; }) }), pending = h.panel.open();
  h.ctx.closeDialog(); h.ctx.openDialog('Other dialog', h.ctx.el('p', 'Other content')); resolve({ data }); await pending;
  assert.equal(h.title(), 'Other dialog');
});
