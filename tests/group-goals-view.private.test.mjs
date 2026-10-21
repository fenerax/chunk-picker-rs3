import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupGoals } from '../app/web/group-goals.mjs';

class Node {
  constructor(tag, text = '') {
    Object.assign(this, { tagName: tag.toUpperCase(), textContent: text, children: [], events: {}, attributes: {}, dataset: {}, value: '', hidden: false, disabled: false });
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, handler) { this.events[event] = handler; }
  emit(event, detail = {}) { return this.events[event]?.({ preventDefault() {}, ...detail }); }
  focus() { this.focused = true; this.document.activeElement = this; }
  contains(node) { return walk(this).includes(node); }
}
const walk = root => [root, ...root.children.flatMap(walk)];
// The fold toggle only shows or hides the list, so viewers keep it.
const writeControl = node => ['INPUT', 'SELECT', 'BUTTON', 'FORM'].includes(node.tagName) && node.className !== 'group-goals-fold';
const visible = (root, predicate) => root.hidden ? [] : [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => visible(child, predicate))];
const goal = (id = 'one', extra = {}) => ({ id: `group-goal:${id}`, text: 'Get the guild key', completion: 'players', completedBy: ['player1'], done: false, ...extra });

function ui(list = [], writable = true) {
  const document = { activeElement: null };
  const root = new Node('section');
  const c = { state: { revision: 7, groupGoals: list, tasks: [], members: [{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }] },
    document, sandbox: { active: false }, write: writable, canWrite: () => c.write, calls: [], errors: [],
    $: id => id === 'group-goals' ? root : undefined,
    plain: text => String(text ?? '').replace(/<[^>]*>/g, '').trim(), browserUUID: () => 'new-id',
    el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; node.document = document; return node; },
    input: (type, value = '') => { const node = new Node('input'); node.type = type; node.value = value; node.document = document; return node; },
    select: (choices, value) => { const node = new Node('select'); node.choices = choices; node.value = value; return node; },
    field: (text, control) => { const node = new Node('div', text); node.className = 'form-field'; node.append(control); return node; },
    button: (text, handler, cls) => { const node = new Node('button', text); node.className = cls; node.document = document; node.addEventListener('click', handler); return node; },
    command: async (...args) => { c.calls.push(args); }, showError: error => c.errors.push(error) };
  createGroupGoals(c); c.groupGoals.render();
  c.root = root;
  c.find = text => walk(root).find(node => node.textContent === text && !node.hidden);
  c.form = () => walk(root).find(node => node.tagName === 'FORM');
  c.fieldControl = text => walk(root).find(node => node.className === 'form-field' && node.textContent === text).children[0];
  c.checkbox = label => walk(root).find(node => node.type === 'checkbox' && node.attributes['aria-label'].startsWith(`${label}:`));
  return c;
}

test('item link loads details only for a search and saves permanent item identity, skipping unregistered labels', async () => {
  const c = ui(); let loads = 0;
  c.ensureFullResult = async guard => { assert.equal(guard, false); loads++; return { items: [{ name: 'Yew logs' }, { name: 'Yew mystery fixture' }] }; };
  await c.find('Add goal').emit('click'); c.fieldControl('Goal').value = 'Supply a yew log';
  const kind = c.fieldControl('Link (optional)'); kind.value = 'item'; await kind.emit('change'); assert.equal(loads, 0);
  const search = c.fieldControl('Find a link'); search.value = 'y'; await search.emit('input'); assert.equal(loads, 0);
  search.value = 'yew'; await search.emit('input'); assert.equal(loads, 1);
  const matches = walk(c.root).find(node => node.className === 'group-goal-matches');
  assert.equal(matches.children.length, 1); assert.equal(matches.children[0].textContent, 'Yew logs');
  await matches.children[0].emit('click'); await c.form().emit('submit');
  assert.match(c.calls[0][0].link.id, /^rs3:entity:/); assert.equal(c.calls[0][0].link.label, 'Yew logs');
});

