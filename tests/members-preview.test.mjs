import test from 'node:test';
import assert from 'node:assert/strict';
import { createMembersPreview } from '../app/web/members-preview.mjs';

function fixture({ members = false, sandbox = false, writable = true, api } = {}) {
  const node = (tag, text = '', className) => ({ tag, textContent: text, className, children: [], attributes: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; } });
  let content, generation = 0;
  const calls = [], c = { state: { revision: 4, rules: { 'content.f2p': !members }, members: [{ id: 'one', name: 'Explorer' }], history: [] },
    memberId: 'one', sandbox: { active: sandbox }, world: { areas: new Map([['inside', { name: 'Inside the tower' }]]) },
    canWrite: () => writable, el: node, plain: String,
    openDialog: (title, value) => { content = value; return ++generation; }, dialogCurrent: token => token === generation,
    button: (label, click) => Object.assign(node('button', label), { click }),
    list: labels => { const list = node('ul'); list.append(...labels.map(label => node('li', label))); return list; },
    details: (label, body) => { const details = node('details'); details.append(node('summary', label), body); return details; },
    api: async (...args) => { calls.push(args); return api ? api(...args) : { memberId: 'one', stateRevision: 4, delta: { tasksAdded: [] } }; },
  };
  const nodes = root => root ? [root, ...root.children.flatMap(nodes)] : [];
  return { c, preview: createMembersPreview(c), calls, nodes: () => nodes(content), text: () => nodes(content).map(row => row.textContent).join(' '), close: () => ++generation };
}

test('members preview is on demand, expandable, read only and groups clue spots like chunk Preview', async () => {
  const h = fixture({ api: async () => ({ memberId: 'one', stateRevision: 4, delta: {
    tasksAdded: [{ id: 'one', category: 'Quest', label: 'Members quest' }, ...['a', 'b'].map(id => ({ id, category: 'Nonskill', label: `Spot ${id}`, record: { ClueTier: 'elite', ClueType: 'Scan' } }))],
    itemsAdded: [{ name: 'Members item' }], areasAdded: ['inside'], objectsAdded: ['Members tree'], shopsAdded: ['Members shop'],
  } }) });
  const before = structuredClone(h.c.state);
  assert.equal(h.calls.length, 0);
  await h.preview.open();
  assert.deepEqual(h.calls, [['/api/sandbox/evaluate', { memberId: 'one', baseRevision: 4, changes: { members: true } }]]);
  for (const text of ['3 new possible tasks', 'Quest (1)', 'Nonskill (2)', 'Elite scan clue spots (2)', 'Items (1)', 'Areas (1)', 'Inside the tower', 'Objects (1)', 'Shops (1)']) assert.ok(h.text().includes(text), text);
  assert.ok(h.nodes().filter(row => row.tag === 'details').every(row => !row.open));
  assert.deepEqual(h.c.state, before);
});

test('already members, Sandbox and view-only links do not start a calculation', async () => {
  for (const options of [{ members: true }, { sandbox: true }, { writable: false }]) {
    const h = fixture(options); await h.preview.open(); assert.equal(h.calls.length, 0);
    if (options.members) assert.match(h.text(), /already members/);
    if (options.sandbox) assert.match(h.text(), /Leave Sandbox/);
  }
});

test('a dataset without membership support explains the limit without calculating', async () => {
  const h = fixture(); h.c.registry = { get: () => undefined };
  await h.preview.open();
  assert.equal(h.calls.length, 0);
  assert.match(h.text(), /dataset does not support membership comparisons/);
});

test('loading is announced and a dismissed result cannot overwrite another dialog', async () => {
  let resolve;
  const h = fixture({ api: () => new Promise(done => { resolve = done; }) });
  const pending = h.preview.open();
  assert.match(h.text(), /Working out/);
  assert.equal(h.nodes().find(row => row.className === 'unlock-preview').attributes['aria-busy'], 'true');
  assert.equal(h.nodes().find(row => row.attributes.role === 'status').attributes['aria-live'], 'polite');
  h.close(); resolve({ memberId: 'one', stateRevision: 4, delta: { tasksAdded: [{ label: 'Stale' }] } }); await pending;
  assert.doesNotMatch(h.text(), /Stale/);
});

test('changed maps, wrong response scope and failed requests offer recalculation without publishing additions', async () => {
  for (const mode of ['revision', 'member', 'response', 'failure']) {
    const h = fixture({ api: async () => {
      if (mode === 'revision') h.c.state.revision++;
      if (mode === 'member') h.c.memberId = 'two';
      if (mode === 'failure') throw new Error('Calculation failed');
      return { memberId: 'one', stateRevision: mode === 'response' ? 3 : 4, delta: { tasksAdded: [{ label: 'Stale' }] } };
    } });
    await h.preview.open();
    assert.doesNotMatch(h.text(), /Stale/);
    assert.match(h.text(), /Recalculate/);
    assert.equal(h.nodes().find(row => row.className === 'unlock-preview').attributes['aria-busy'], 'false');
  }
});
