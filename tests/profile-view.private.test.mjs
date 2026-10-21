import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProfile, createProfileView } from '../app/web/profile-view.mjs';
import { buildProfileModel } from '../app/web/profile-model.mjs';
import { formatProfileSummary } from '../app/web/profile-copy.mjs';
import { loadBiSMemberResult } from '../app/web/bis-results.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {}, listeners: {}, value: '',
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, action) { this.listeners[name] = action; },
    focus() { this.focused = true; }, select() { this.selected = true; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const context = { el: node, plain: value => String(value ?? ''),
  skillIcon: skill => `/skills/${skill}.png`, itemIcon: name => `/items/${name}.png`,
  button: (label, action, cls) => ({ ...node('button', label, cls), action }) };
const fixture = () => ({ revision: 7, rules: { 'content.f2p': true }, tasks: [],
  members: [{ id: 'player1', name: 'Player 1', runescapeName: 'exampleGIMab', unlocked: ['1'], completedTasks: [], taskStatus: {} },
    { id: 'player2', name: 'Player 2', runescapeName: 'twosamplegim', unlocked: ['2', '3'], completedTasks: [], taskStatus: {} }] });
const result = (memberId = 'player1', extra = {}) => ({ memberId, stateRevision: 7, tasks: [],
  currentBiS: { owned: { recordedObtained: [], recordedBest: { recommendations: [], loadouts: [] } } }, ...extra });
function harness() {
  let generation = 0, content;
  const menu = node('button'), calls = [], details = [];
  const c = { ...context, state: fixture(), memberId: 'player1', definitions: {}, sandbox: { active: false },
    fullResult: result(), duoDetails: new Map(), loadIcons: async () => true,
    api: async path => { calls.push(path); return { stateRevision: 7, members: [] }; },
    ensureDuoDetails: async id => { details.push(id); const value = result(id); c.duoDetails.set(`7:${id}`, value); return value; },
    openDialog: (title, root) => { content = root; return ++generation; }, dialogCurrent: value => value === generation,
    $: () => menu, showError: error => { throw error; } };
  const view = createProfileView(c);
  return { c, view, calls, details, menu, close: () => generation++,
    get content() { return content; }, find: text => all(content).find(row => row.textContent === text) };
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('Profile renders all skills, unknown facts, compact counts and no save controls', () => {
  const model = buildProfileModel(fixture(), 'player1', result());
  const root = renderProfile(context, model, { openBiS: () => {} }), nodes = all(root);
  assert.equal(nodes.filter(row => row.className.includes('profile-skill') && row.tag === 'div').length, 29);
  assert.ok(nodes.some(row => row.textContent === 'Total — · Combat —'));
  assert.ok(nodes.some(row => row.textContent.includes('No synced levels yet')));
  assert.ok(nodes.some(row => row.textContent === '0 ticked in the picker'));
  assert.ok(nodes.some(row => row.textContent === 'Current BiS →'));
  assert.deepEqual(nodes.filter(row => row.tag === 'button').map(row => row.textContent), ['Copy summary', 'Select all', 'Close', 'Current BiS →']);
  assert.ok(nodes.every(row => !Object.keys(row.attributes).some(name => /^(?:style|on)/.test(name))));
  assert.ok(nodes.every(row => row.tag !== 'script'));
});

