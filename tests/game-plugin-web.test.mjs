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
    state: { revision: 1, members: [{ id: 'one', name: 'Explorer 1' }] }, sessionMember: 'one', sandbox: { active: false },
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

test('achievement review sends only chosen matches and retains revision checks', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = [
    { achievementId: 1, title: 'Ambiguous achievement', reason: 'unclear', candidates: [{ taskId: 'first', label: 'First task' }, { taskId: 'second', label: 'Second task' }] },
    { achievementId: 2, title: 'Beta achievement', reason: 'beta', candidates: [{ taskId: 'beta', label: 'Beta task' }] },
  ];
  f.setPreview(preview); const root = await f.open();
  const choices = all(root).filter(node => node.tag === 'select');
  assert.equal(choices.length, 2); assert.ok(choices.every(node => node.value === ''));
  choices[0].value = 'second'; choices[0].emit('change');
  await f.client.refresh(); await settle();
  assert.equal(all(root).find(node => node.tag === 'select').value, 'second');
  await button(root, 'Apply plugin snapshot').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, {
    previewId: preview.previewId, expectedRevision: 1, achievements: [{ achievementId: 1, taskId: 'second' }],
  });
});

test('achievement world warnings stay on each row beside live skill review and preserve choices', async t => {
  const f = fixture(t), preview = f.proposal('mixed-world-review', { id: 1, beta: false });
  const reports = [
    { reason: 'unclear', world: 'beta' }, { reason: 'unclear', world: 'unknown' },
    { reason: 'retry', world: 'beta' }, { reason: 'retry', world: 'unknown' },
    { reason: 'beta', world: 'beta' }, { reason: 'world-unknown', world: 'unknown' },
    { reason: 'unclear', world: 'live' },
  ];
  preview.achievements = reports.map((report, index) => ({ ...report, achievementId: index + 1, title: `Achievement ${index + 1}`,
    candidates: [{ taskId: `task-${index + 1}`, label: `Task ${index + 1}` }, { taskId: `alternative-${index + 1}`, label: `Alternative ${index + 1}` }] }));
  f.setPreview(preview); const root = await f.open();
  assert.match(text(root), /Review plugin progress for Explorer 1/);
  assert.match(text(root), /Attack: level 1 → 2/);
  assert.doesNotMatch(text(root), /This snapshot came from a beta world/);
  for (const [index, report] of reports.entries()) {
    const row = all(root).find(node => node.tag === 'strong' && node.textContent === `Achievement ${index + 1}`).parent;
    const betaNotes = all(row).filter(node => node.textContent === 'Reported from a beta world. Check against your main account.');
    const unknownNotes = all(row).filter(node => node.textContent === 'World type was not reported. Check before applying.');
    assert.equal(betaNotes.length, report.world === 'beta' ? 1 : 0);
    assert.equal(unknownNotes.length, report.world === 'unknown' ? 1 : 0);
    if (report.reason === 'unclear') assert.match(text(row), /Choose the matching task/);
    if (report.reason === 'retry') assert.match(text(row), /Automatic ticking could not finish/);
    const choice = all(row).find(node => node.tag === 'select');
    assert.equal(choice.disabled, false); assert.equal(choice.value, '');
    assert.deepEqual(choice.children.map(option => option.value), ['', `task-${index + 1}`, `alternative-${index + 1}`]);
    choice.value = `task-${index + 1}`; choice.emit('change');
  }
  assert.equal(button(root, 'Apply plugin snapshot').disabled, false);
  assert.ok(button(root, 'Dismiss snapshot'));
  await button(root, 'Apply plugin snapshot').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body.achievements,
    reports.map((_, index) => ({ achievementId: index + 1, taskId: `task-${index + 1}` })));
});

test('achievement review bounds rows and labels and reports assembly counts once per player', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = Array.from({ length: 205 }, (_, index) => ({ achievementId: index, title: `Achievement ${index} ${'x'.repeat(300)}`, reason: 'world-unknown', candidates: [{ taskId: `task-${index}`, label: 'y'.repeat(300) }] }));
  preview.achievementsMore = 4;
  f.setPreview(preview);
  const summary = { snapshot: 'one', received: 2, parts: 3, completeCount: 17, matchedTaskCount: 12, lastTickedCount: 4, lastTickedAt: '2026-10-20T12:00:00Z' };
  f.setKeys([{ id: 'a', player: 'one', achievements: summary }, { id: 'b', player: 'one', achievements: summary }]);
  const root = await f.open();
  assert.equal(all(root).filter(node => node.tag === 'select').length, 200);
  assert.equal(all(root).filter(node => node.tag === 'option' && node.value).every(node => node.textContent.length <= 160), true);
  assert.match(text(root), /9 more achievement matches/);
  assert.equal(text(root).split('Achievement snapshot:').length, 2);
  assert.match(text(root), /2 of 3 parts received · 17 complete · 12 matched tasks · Last ticked 4 tasks/);
});

test('viewer achievement review is read only', async t => {
  const f = fixture(t, { viewer: true }), preview = f.proposal();
  preview.achievements = [{ achievementId: 1, title: 'Reported', reason: 'retry', candidates: [{ taskId: 'a', label: 'Task' }] }];
  f.setPreview(preview); const root = await f.open();
  assert.equal(all(root).find(node => node.tag === 'select').disabled, true);
  assert.match(text(root), /Automatic ticking could not finish/);
  assert.deepEqual(f.posts, []);
});

test('a new achievement preview resets selections and skipped matches are omitted from apply', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = [{ achievementId: 1, title: 'Reported', reason: 'beta', candidates: [{ taskId: 'a', label: 'Task' }] }];
  f.setPreview(preview); const root = await f.open();
  const choice = all(root).find(node => node.tag === 'select'); choice.value = 'a'; choice.emit('change');
  f.setPreview({ ...preview, previewId: 'new-review' }); await f.client.refresh(); await settle();
  assert.equal(all(root).find(node => node.tag === 'select').value, '');
  await button(root, 'Apply plugin snapshot').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, { previewId: 'new-review', expectedRevision: 1 });
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
