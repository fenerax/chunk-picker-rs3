import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamePlugin, drawGamePluginPositions, positionAge } from '../app/web/game-plugin.mjs';

class Node {
  constructor(tag, textContent = '') {
    Object.assign(this, { tag, textContent, value: '', children: [], isConnected: true, attributes: {}, listeners: {} });
  }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) if (typeof node === 'object') node.parent = this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, action) { (this.listeners[key] ??= new Set()).add(action); }
  removeEventListener(key, action) { this.listeners[key]?.delete(action); }
  emit(key) { for (const action of [...(this.listeners[key] ?? [])]) action(); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  focus() {}
  select() {}
}
const all = node => [node, ...node.children.filter(node => typeof node === 'object').flatMap(all)];
const text = node => all(node).map(node => node.textContent).join(' ');
const button = (root, label) => all(root).find(node => node.tag === 'button' && node.textContent === label);
const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

function fixture(t, { viewer = false } = {}) {
  const original = Object.fromEntries(['document', 'navigator', 'addEventListener'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dialog = new Node('dialog'), document = Object.assign(new Node('document'), { hidden: true });
  const copied = [], posts = [];
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    navigator: { value: { clipboard: { writeText: async value => copied.push(value) } }, configurable: true },
    addEventListener: { value() {}, configurable: true },
  });
  t.after(() => {
    dialog.emit('close');
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  let preview, keys = [], nextFailure = false;
  const c = {
    state: { revision: 1, members: [{ id: 'one', name: 'Explorer' }] }, sessionMember: 'one', sandbox: { active: false },
    canWrite: () => !viewer, queue: Promise.resolve(), $: id => id === 'tool-dialog' ? dialog : null,
    el: (tag, content) => new Node(tag, content),
    button: (label, action) => Object.assign(new Node('button', label), { action }),
    field: (label, control) => { const node = new Node('label', label); node.append(control); return node; },
    list: values => { const node = new Node('ul'); node.append(...values.map(value => new Node('li', value))); return node; },
    plain: value => value, adopt: state => { c.state = state; },
    api: async (path, body) => {
      if (body) posts.push({ path, body });
      if (path === '/api/game-plugin') return { keys: structuredClone(keys), positions: [], active: false };
      if (path.startsWith('/api/game-plugin/review')) {
        if (nextFailure) { nextFailure = false; throw new Error('Connection interrupted. Retry.'); }
        return structuredClone(preview ?? { preview: null });
      }
      if (path === '/api/game-plugin/keys') {
        const record = { id: 'key-one', player: body.memberId, label: body.label };
        keys.push(record); return { key: 'one-time-secret', record };
      }
      if (path.endsWith('/revoke')) { keys[0] = { ...keys[0], revoked: true }; return { record: keys[0] }; }
      if (path.endsWith('/apply') || path.endsWith('/dismiss')) { preview = undefined; return {}; }
      if (path === '/api/state') return { state: { ...c.state, revision: 2 }, pools: {} };
      throw new Error(`Unexpected route: ${path}`);
    },
  };
  const client = createGamePlugin(c);
  const proposal = (id = 'review-one', world = { id: 201, beta: true }) => ({
    previewId: id, memberId: 'one', stateRevision: c.state.revision, fetchedAt: '2026-10-19T12:00:00Z', world,
    skills: [{ skill: 'Attack', before: { level: 1, xp: 0 }, after: { level: 2, xp: 90 } }],
    quests: [{ title: 'Known quest' }], unmatched: { quests: [{ title: 'Unknown quest', reason: 'unmapped' }] },
  });
  return { c, client, posts, copied, proposal, dialog,
    setPreview: value => { preview = value; }, failReview: () => { nextFailure = true; },
    setKeys: value => { keys = value; },
    open: async () => { await client.refresh(); const root = client.controls({ memberId: 'one', keys: true }); await settle(); return root; },
  };
}

test('viewers can read plugin review but cannot see keys or mutate progress', async t => {
  const f = fixture(t, { viewer: true }); f.setPreview(f.proposal());
  f.setKeys([{ id: 'private', player: 'one', label: 'Private key label' }]);
  const root = await f.open();
  assert.match(text(root), /Known quest/); assert.match(text(root), /View only/);
  assert.doesNotMatch(text(root), /Private key label/);
  for (const label of ['Create plugin key', 'Copy key once', 'Revoke key', 'Apply plugin snapshot', 'Dismiss snapshot']) assert.equal(button(root, label), undefined);
  assert.deepEqual(f.posts, []);
});

test('new keys can be copied once, clear on close and remain revocable', async t => {
  const f = fixture(t), root = await f.open();
  await button(root, 'Create plugin key').action();
  assert.equal(f.posts[0].body.label, 'Game plugin');
  const input = all(root).find(node => node.value === 'one-time-secret'); assert.ok(input); assert.equal(input.type, 'password');
  const copy = button(root, 'Copy key once'); await copy.action();
  assert.deepEqual(f.copied, ['one-time-secret']); assert.equal(input.value, ''); assert.equal(button(root, 'Copy key once'), undefined);
  await copy.action(); assert.equal(f.copied.length, 1);
  await button(root, 'Revoke key').action(); assert.match(text(root), /Revoked/);
  await button(root, 'Create plugin key').action();
  const secondInput = all(root).find(node => node.value === 'one-time-secret'); f.dialog.emit('close'); assert.equal(secondInput.value, '');
});

test('plugin review shows beta and unmatched quests; apply is queued and dismiss is explicit', async t => {
  const f = fixture(t); f.setPreview(f.proposal()); const root = await f.open();
  assert.match(text(root), /beta world/); assert.match(text(root), /Unknown quest/); assert.match(text(root), /Unmatched quests are skipped/);
  assert.deepEqual(f.posts, []);
  let release; f.c.queue = new Promise(resolve => { release = resolve; });
  const apply = button(root, 'Apply plugin snapshot').action(); await settle(); assert.deepEqual(f.posts, []);
  release(); await apply;
  assert.deepEqual(f.posts[0], { path: '/api/game-plugin/apply', body: { previewId: 'review-one', expectedRevision: 1 } });
  assert.equal(f.c.state.revision, 2);
  f.setPreview(f.proposal('review-two', { id: 1, beta: false })); await f.client.refresh(); await settle();
  assert.doesNotMatch(text(root), /beta world/);
  await button(root, 'Dismiss snapshot').action(); assert.deepEqual(f.posts.at(-1), { path: '/api/game-plugin/dismiss', body: { previewId: 'review-two' } });
});

test('an interrupted review can retry the same unchanged preview', async t => {
  const f = fixture(t); f.setPreview(f.proposal()); const root = await f.open();
  f.failReview(); await f.client.refresh(); await settle(); assert.ok(button(root, 'Retry'));
  await button(root, 'Retry').action(); assert.ok(button(root, 'Apply plugin snapshot'));
});

test('recent markers use each player colour and chunk center, fade and expire after ten minutes', () => {
  const now = Date.parse('2026-10-19T12:10:00Z'), dots = [], labels = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, arc(x, y) { this.point = [x, y]; },
    fill() { dots.push({ point: this.point, color: this.fillStyle, alpha: this.globalAlpha }); }, stroke() {},
    measureText: () => ({ width: 90 }), fillRect() {}, fillText(value) { labels.push(value); } };
  const members = [{ id: 'one', name: 'Explorer', color: '#ff8800' }, { id: 'two', name: 'Partner', color: '#00aaff' }];
  const map = { members, visibleMembers: [members[0]], zoom: 1, offset: { x: 10, y: 20 }, width: 800, height: 600,
    gamePluginPositions: [
      { memberId: 'one', chunkId: '123', position: { x: 1, z: 1, floor: 0 }, seenAt: '2026-10-19T12:05:00Z' },
      { memberId: 'two', chunkId: '123', position: { x: 1, z: 1, floor: 0 }, seenAt: '2026-10-19T12:10:00Z' },
      { memberId: 'one', chunkId: '123', seenAt: '2026-10-19T12:00:00Z' },
    ] };
  drawGamePluginPositions(ctx, map, () => ({ x: 1, y: 2 }), now);
  assert.deepEqual(dots, [{ point: [202, 340], color: '#ff8800', alpha: .5 }, { point: [202, 340], color: '#00aaff', alpha: 1 }]);
  assert.deepEqual(labels, ['Explorer · 5m ago', 'Partner · just now']);
  assert.equal(positionAge('2026-10-19T12:00:00Z', now), null);
  assert.equal(positionAge('invalid', now), null);
  assert.equal(positionAge('2026-10-19T12:11:00Z', now), null);
});
