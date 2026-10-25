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
    el: (tag, content, className) => Object.assign(new Node(tag, content), className ? { className } : {}),
    button: (label, action) => Object.assign(new Node('button', label), { action }),
    field: (label, control) => { const node = new Node('label', label); node.append(control); return node; },
    list: values => { const node = new Node('ul'); node.append(...values.map(value => new Node('li', value))); return node; },
    plain: value => value, adopt: state => { c.state = state; },
    wikiSearch: name => `https://runescape.wiki/w/Special:Search?search=${encodeURIComponent(name)}`,
    iconLink: (href, label) => Object.assign(new Node('a'), { href, className: 'icon-button', attributes: { 'aria-label': label } }),
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
  for (const label of ['Create plugin key', 'Copy key once', 'Revoke key', 'Apply selected', 'Dismiss snapshot', 'Skip']) assert.equal(button(root, label), undefined);
  assert.deepEqual(f.posts, []);
});

const ticks = root => all(root).filter(node => node.tag === 'input' && node.type === 'checkbox');
const summaryText = root => all(root).find(node => node.className === 'game-plugin-summary').textContent;
const partFor = (root, heading) => all(root).find(node => node.tag === 'h5' && node.textContent.startsWith(heading)).parent.parent;

test('single matches start selected, several start skipped, and apply sends only the chosen tasks', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = [
    { achievementId: 1, title: 'Ambiguous achievement', reason: 'unclear', world: 'beta', candidates: [{ taskId: 'first', label: 'First task' }, { taskId: 'second', label: 'Second task' }] },
    { achievementId: 2, title: 'Beta achievement', reason: 'beta', world: 'beta', candidates: [{ taskId: 'beta', label: 'Beta task' }] },
    { achievementId: 3, title: 'Other achievement', reason: 'beta', world: 'beta', candidates: [{ taskId: 'other', label: 'Other task' }] },
  ];
  f.setPreview(preview); const root = await f.open();
  const choice = all(root).find(node => node.tag === 'select');
  assert.equal(choice.value, ''); assert.equal(choice.attributes['aria-label'], 'Task for Ambiguous achievement');
  assert.deepEqual(all(root).filter(node => node.tag === 'a' && node.className === 'icon-button').map(node => [node.href, node.attributes['aria-label']]), [
    ['https://runescape.wiki/w/Special:Search?search=Ambiguous%20achievement', 'Open Ambiguous achievement on the RuneScape Wiki'],
    ['https://runescape.wiki/w/Special:Search?search=Beta%20achievement', 'Open Beta achievement on the RuneScape Wiki'],
    ['https://runescape.wiki/w/Special:Search?search=Other%20achievement', 'Open Other achievement on the RuneScape Wiki']]);
  assert.deepEqual(ticks(root).map(node => node.checked), [true, true]);
  assert.match(text(root), /One matching task \(2\) · 2 selected/);
  assert.equal(summaryText(root), 'Apply saves 1 skill level, 1 quest and 2 achievement ticks.');
  assert.deepEqual(f.posts, []);
  choice.value = 'second'; choice.emit('change');
  ticks(root)[1].checked = false; ticks(root)[1].emit('change');
  await f.client.refresh(); await settle();
  assert.equal(all(root).find(node => node.tag === 'select').value, 'second');
  assert.deepEqual(ticks(root).map(node => node.checked), [true, false]);
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, {
    previewId: preview.previewId, expectedRevision: 1, achievements: [{ achievementId: 1, taskId: 'second' }, { achievementId: 2, taskId: 'beta' }],
  });
});

test('item evidence is labelled and only ticked item tasks are applied', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.items = [
    { taskId: 'goal', label: 'Obtain a Yew shortbow', gameItemId: 857, gameName: 'Yew shortbow', evidence: 'owned', seen: 'owned when first seen; source unknown', world: 'beta' },
    { taskId: 'wear', label: 'Wear a Gud raider item', gameItemId: 34830, gameName: 'Gud raider chainbody', evidence: 'worn', seen: 'worn 2026-10-19T12:00:00Z', world: 'beta' },
  ];
  preview.unmappedItems = [{ gameItemId: 99999, name: 'Mystery item' }];
  f.setPreview(preview); const root = await f.open();
  const items = partFor(root, 'Items (2)');
  assert.match(text(items), /Having an item does not show where it came from/);
  assert.match(text(items), /Owned: Yew shortbow \(game item 857\) · owned when first seen; source unknown/);
  assert.match(text(items), /Worn: Gud raider chainbody \(game item 34830\)/);
  assert.match(text(items), /no reviewed ID \(1\)/); assert.match(text(items), /Mystery item · game item 99999/);
  const boxes = ticks(items);
  assert.equal(boxes.length, 2); assert.ok(boxes.every(box => !box.checked));
  boxes[1].checked = true; boxes[1].emit('change');
  assert.match(summaryText(root), /and 1 item task\.$/);
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, { previewId: preview.previewId, expectedRevision: 1, items: [{ taskId: 'wear' }] });
});

test('item review sends no items when none are ticked, and an item alone can be applied', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.items = [{ taskId: 'goal', label: 'Obtain a Yew shortbow', gameItemId: 857, gameName: 'Yew shortbow', evidence: 'owned', seen: 'new since 2026-10-19T12:00:00Z', world: 'live' }];
  f.setPreview(preview); const root = await f.open();
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, { previewId: preview.previewId, expectedRevision: 1 });

  const g = fixture(t), only = g.proposal();
  only.items = preview.items;
  g.setPreview(only); const other = await g.open();
  for (const node of all(other).filter(node => node.tag === 'button' && node.textContent === 'Skip')) await node.action();
  assert.equal(button(other, 'Apply selected').disabled, true);
  const [box] = ticks(partFor(other, 'Items (1)')); box.checked = true; box.emit('change');
  assert.equal(summaryText(other), 'Apply saves 1 item task.'); assert.equal(button(other, 'Apply selected').disabled, false);
  await button(other, 'Apply selected').action();
  assert.deepEqual(g.posts.find(row => row.path.endsWith('/apply')).body, { previewId: only.previewId, expectedRevision: 1, skills: false, quests: false, items: [{ taskId: 'goal' }] });
});

test('bulk actions skip every achievement and reselect the single matches', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = Array.from({ length: 4 }, (_, index) => ({ achievementId: index, title: `Achievement ${index}`, reason: 'beta', world: 'beta', candidates: [{ taskId: `task-${index}`, label: `Task ${index}` }] }));
  preview.achievements.push({ achievementId: 9, title: 'Two ways', reason: 'unclear', world: 'beta', candidates: [{ taskId: 'a', label: 'A' }, { taskId: 'b', label: 'B' }] });
  f.setPreview(preview); const root = await f.open();
  const choice = all(root).find(node => node.tag === 'select'); choice.value = 'b'; choice.emit('change');
  await button(root, 'Skip all achievements').action();
  assert.ok(ticks(root).every(node => !node.checked)); assert.equal(choice.value, '');
  for (const node of all(root).filter(node => node.tag === 'button' && node.textContent === 'Skip')) await node.action();
  assert.equal(summaryText(root), 'Nothing is selected. Dismiss clears this snapshot without changes.');
  assert.equal(button(root, 'Apply selected').disabled, true);
  await button(root, 'Select all single matches').action();
  assert.ok(ticks(root).every(node => node.checked)); assert.equal(choice.value, '');
  assert.equal(summaryText(root), 'Apply saves 4 achievement ticks.');
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, { previewId: preview.previewId, expectedRevision: 1, skills: false, quests: false,
    achievements: [0, 1, 2, 3].map(index => ({ achievementId: index, taskId: `task-${index}` })) });
});

test('skipping levels or quests sends false for that part only', async t => {
  const f = fixture(t); f.setPreview(f.proposal()); const root = await f.open();
  const skills = partFor(root, 'Skill levels'), skip = all(skills).find(node => node.tag === 'button' && node.textContent === 'Skip');
  await skip.action();
  assert.equal(skip.attributes['aria-pressed'], 'true'); assert.match(skills.className, /is-skipped/); assert.match(text(skills), /Skipped\. These stay unchanged\./);
  assert.equal(summaryText(root), 'Apply saves 1 quest.');
  await all(skills).find(node => node.tag === 'button' && node.textContent === 'Apply').action(); await skip.action();
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body, { previewId: 'review-one', expectedRevision: 1, skills: false });
});

test('the beta warning appears once; rows carry world tags only when worlds are mixed', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = Array.from({ length: 30 }, (_, index) => ({ achievementId: index, title: `Achievement ${index}`, reason: 'beta', world: 'beta', candidates: [{ taskId: `task-${index}`, label: `Task ${index}` }] }));
  f.setPreview(preview); const root = await f.open();
  assert.equal(all(root).filter(node => node.className === 'warning').length, 1);
  assert.equal(all(root).filter(node => node.className === 'game-plugin-tag').length, 0);
  assert.equal(all(root).find(node => node.tag === 'details').open, false);

  const g = fixture(t), mixed = g.proposal('mixed-world-review', { id: 1, beta: false });
  const reports = [{ reason: 'unclear', world: 'beta' }, { reason: 'retry', world: 'unknown' }, { reason: 'beta', world: 'beta' }, { reason: 'retry', world: 'live' }];
  mixed.achievements = reports.map((report, index) => ({ ...report, achievementId: index + 1, title: `Achievement ${index + 1}`,
    candidates: report.reason === 'unclear' ? [{ taskId: 'x', label: 'X' }, { taskId: 'y', label: 'Y' }] : [{ taskId: `task-${index + 1}`, label: `Task ${index + 1}` }] }));
  g.setPreview(mixed); const other = await g.open();
  assert.deepEqual(all(other).filter(node => node.className === 'warning').map(node => node.textContent), [
    'Achievements tagged Beta came from a beta world. Beta progress may differ from your main account. Check before applying.',
    'Achievements tagged World unknown were reported without a world type. Check before applying.']);
  const tagsFor = title => all(all(other).find(node => node.tag === 'strong' && node.textContent === title).parent).filter(node => node.className === 'game-plugin-tag').map(node => node.textContent);
  assert.deepEqual(reports.map((_, index) => tagsFor(`Achievement ${index + 1}`)), [['Beta'], ['World unknown', 'Auto-tick failed'], ['Beta'], ['Auto-tick failed']]);
});

test('a task is never chosen for two achievements', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = [
    { achievementId: 1, title: 'First', reason: 'beta', world: 'beta', candidates: [{ taskId: 'shared', label: 'Shared task' }] },
    { achievementId: 2, title: 'Second', reason: 'beta', world: 'beta', candidates: [{ taskId: 'shared', label: 'Shared task' }] },
    { achievementId: 3, title: 'Third', reason: 'unclear', world: 'beta', candidates: [{ taskId: 'shared', label: 'Shared task' }, { taskId: 'own', label: 'Own task' }] },
  ];
  f.setPreview(preview); const root = await f.open();
  assert.deepEqual(ticks(root).map(node => node.checked), [true, false]);
  ticks(root)[1].checked = true; ticks(root)[1].emit('change');
  assert.equal(ticks(root)[1].checked, false); assert.match(text(root), /already chosen for another achievement/);
  const choice = all(root).find(node => node.tag === 'select'); choice.value = 'shared'; choice.emit('change');
  assert.equal(choice.value, '');
  await button(root, 'Apply selected').action();
  assert.deepEqual(f.posts.find(row => row.path.endsWith('/apply')).body.achievements, [{ achievementId: 1, taskId: 'shared' }]);
});

test('achievement review bounds rows and labels and reports assembly counts once per player', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = Array.from({ length: 205 }, (_, index) => ({ achievementId: index, title: `Achievement ${index} ${'x'.repeat(300)}`, reason: 'world-unknown', world: 'unknown', candidates: [{ taskId: `task-${index}`, label: 'y'.repeat(300) }] }));
  preview.achievementsMore = 4;
  f.setPreview(preview);
  const summary = { snapshot: 'one', received: 2, parts: 3, completeCount: 17, matchedTaskCount: 12, lastTickedCount: 4, lastTickedAt: '2026-10-20T12:00:00Z' };
  f.setKeys([{ id: 'a', player: 'one', achievements: summary }, { id: 'b', player: 'one', achievements: summary }]);
  const root = await f.open();
  assert.equal(ticks(root).length, 200);
  assert.ok(all(root).filter(node => node.className === 'game-plugin-task' || node.tag === 'strong').every(node => node.textContent.length <= 160));
  assert.match(text(root), /9 more achievement matches/);
  assert.equal(summaryText(root), 'Apply saves 1 skill level, 1 quest and 200 achievement ticks.');
  assert.equal(text(root).split('Achievement snapshot:').length, 2);
  assert.match(text(root), /2 of 3 parts received · 17 complete · 12 matched tasks · Last ticked 4 tasks/);
});

test('viewer achievement review is read only', async t => {
  const f = fixture(t, { viewer: true }), preview = f.proposal();
  preview.achievements = [{ achievementId: 1, title: 'Reported', reason: 'retry', world: 'live', candidates: [{ taskId: 'a', label: 'Task' }] },
    { achievementId: 2, title: 'Two', reason: 'unclear', world: 'live', candidates: [{ taskId: 'b', label: 'B' }, { taskId: 'c', label: 'C' }] }];
  f.setPreview(preview); const root = await f.open();
  assert.ok(ticks(root).every(node => node.disabled)); assert.equal(all(root).find(node => node.tag === 'select').disabled, true);
  for (const label of ['Select all single matches', 'Skip all achievements', 'Apply', 'Skip', 'Apply selected']) assert.equal(button(root, label), undefined);
  assert.match(text(root), /Auto-tick failed/);
  assert.deepEqual(f.posts, []);
});

test('a new achievement preview resets selections and unticked matches are omitted from apply', async t => {
  const f = fixture(t), preview = f.proposal();
  preview.achievements = [{ achievementId: 1, title: 'Reported', reason: 'beta', world: 'beta', candidates: [{ taskId: 'a', label: 'Task' }] }];
  f.setPreview(preview); const root = await f.open();
  ticks(root)[0].checked = false; ticks(root)[0].emit('change');
  await all(partFor(root, 'Skill levels')).find(node => node.textContent === 'Skip').action();
  f.setPreview({ ...preview, previewId: 'new-review' }); await f.client.refresh(); await settle();
  assert.equal(ticks(root)[0].checked, true); assert.equal(partFor(root, 'Skill levels').className, 'game-plugin-part');
  ticks(root)[0].checked = false; ticks(root)[0].emit('change');
  await button(root, 'Apply selected').action();
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
  assert.match(text(root), /beta world/); assert.match(text(root), /Not in the picker, so not applied \(1\): +Unknown quest/);
  assert.deepEqual(f.posts, []);
  let release; f.c.queue = new Promise(resolve => { release = resolve; });
  const apply = button(root, 'Apply selected').action(); await settle(); assert.deepEqual(f.posts, []);
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
  await button(root, 'Retry').action(); assert.ok(button(root, 'Apply selected'));
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
