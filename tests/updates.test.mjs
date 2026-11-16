import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUpdates } from '../app/web/updates.mjs';

class Node {
  constructor(tag, text = '') { this.tagName = tag; this.textContent = text; this.children = []; this.events = {}; this.hidden = true; this.dataset = {}; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, action) { this.events[name] = action; }
}
const el = (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; };
const button = (text, action) => { const node = el('button', text); node.addEventListener('click', action); return node; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function dialogFixture(t, api) {
  let generation = 0, open = false, content;
  const seen = new Map(), dot = new Set(), previous = globalThis.document;
  globalThis.document = { getElementById: () => ({ classList: { toggle: (name, enabled) => enabled ? dot.add(name) : dot.delete(name) } }) };
  t.after(() => { globalThis.document = previous; });
  const updates = createUpdates({ el, button, api, banner: new Node('div'),
    openDialog: (title, node) => { content = node; open = true; return ++generation; },
    dialogCurrent: token => open && token === generation,
    storage: { getItem: key => seen.get(key), setItem: (key, value) => seen.set(key, value) } });
  return { updates, seen, dot, content: () => content,
    close: () => { open = false; }, replace: () => { generation++; content = el('div', 'Other dialog'); } };
}
const release = { entries: [{ date: '2026-10-02', title: 'Synthetic release', items: ['A change'] }] };
const roadmap = { updated: '2026-10-02', themes: [] };

for (const leave of ['close', 'replace', 'reopen']) test(`late What's new response after ${leave} keeps entries unread`, async t => {
  const request = Promise.withResolvers(), fixture = dialogFixture(t, () => request.promise);
  const loading = fixture.updates.openList(), oldContent = fixture.content();
  let reopened;
  if (leave === 'reopen') reopened = fixture.updates.openList(); else fixture[leave]();
  request.resolve(release); await loading;
  assert.equal(oldContent.children[0].textContent, 'Loading…', 'a stale view is not rendered');
  if (reopened) await reopened;
  else {
    assert.equal(fixture.seen.size, 0, 'unseen entries must not be acknowledged');
    assert(fixture.dot.has('has-news'));
    await fixture.updates.openList();
  }
  assert.equal(fixture.content().children[0].children[0].textContent, 'Synthetic release');
  assert.equal(fixture.seen.get('picker.changelogSeen'), '2026-10-02|Synthetic release');
  assert.equal(fixture.dot.has('has-news'), false);
});

for (const [method, route, value] of [['openList', '/api/changelog', release], ['openRoadmap', '/api/roadmap', roadmap]]) {
  test(`${method} retries in place with one busy request`, async t => {
    const retry = Promise.withResolvers(); let requests = 0;
    const fixture = dialogFixture(t, async path => {
      if (path !== route) return { entries: [] };
      if (++requests === 1) throw new Error('Synthetic failure');
      return retry.promise;
    });
    await fixture.updates[method]();
    const content = fixture.content(), action = content.children.find(node => node.textContent === 'Retry');
    assert(action, 'failed view has a Retry action');
    assert.equal(content.children[0].textContent, 'Synthetic failure');
    assert.equal(content.attributes['aria-busy'], 'false');
    const loading = action.events.click();
    action.events.click(); action.events.click();
    assert.equal(requests, 2, 'repeated clicks cannot start overlapping requests');
    assert.equal(action.disabled, true);
    assert.equal(content.attributes['aria-busy'], 'true');
    assert.equal(content.children[0].textContent, 'Loading…');
    retry.resolve(value); await loading;
    assert.equal(fixture.content(), content, 'retry stays inside the same dialog');
    assert.equal(content.attributes['aria-busy'], 'false');
    assert.equal(content.children.some(node => node.className === 'error'), false);
    if (method === 'openList') assert.equal(fixture.dot.has('has-news'), false);
    else assert.equal(content.children[0].className, 'roadmap-intro');
  });

  for (const outcome of ['success', 'failure']) test(`${method} ignores late retry ${outcome} after dialog replacement`, async t => {
    const retry = Promise.withResolvers(); let requests = 0;
    const fixture = dialogFixture(t, async path => {
      if (path !== route) return { entries: [] };
      if (++requests === 1) throw new Error('Synthetic failure');
      return retry.promise;
    });
    await fixture.updates[method]();
    const content = fixture.content(), action = content.children.find(node => node.textContent === 'Retry');
    assert(action, 'failed view has a Retry action');
    const loading = action.events.click(); fixture.replace();
    if (outcome === 'success') retry.resolve(value); else retry.reject(new Error('Late failure'));
    await loading;
    assert.equal(fixture.content().textContent, 'Other dialog');
    assert.equal(content.children[0].textContent, 'Loading…', 'stale content is untouched');
    assert.equal(fixture.seen.size, 0);
    action.events.click(); assert.equal(requests, 2, 'stale Retry cannot load again');
  });
}

test('changelog is valid and newest first', async () => {
  const log = JSON.parse(await readFile(new URL('../app/data/changelog.json', import.meta.url), 'utf8'));
  assert.equal(log.schemaVersion, 1); assert.ok(log.entries.length);
  for (const entry of log.entries) { assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(entry.title); assert.ok(entry.items.length); }
  assert.deepEqual(log.entries.map(entry => entry.date), [...log.entries.map(entry => entry.date)].sort().reverse());
});

test('banner appears only when the server version changes after the first one', async () => {
  const banner = new Node('div'), opened = [];
  const api = async () => ({ entries: [{ date: '2026-10-09', title: 'New things', items: ['a'] }] });
  const updates = createUpdates({ el, button, openDialog: (title, node) => opened.push([title, node]), api, banner, storage: null });
  updates.seen('v1'); await flush(); assert.equal(banner.hidden, true, 'first version is just remembered');
  updates.seen('v1'); await flush(); assert.equal(banner.hidden, true, 'same version after a reconnect');
  updates.seen('v2'); await flush(); await flush();
  assert.equal(banner.hidden, false);
  assert.match(banner.children[0].textContent, /New things/);
  assert.deepEqual(banner.children.slice(1).map(node => node.textContent), ['Refresh', 'What’s new', 'Later']);
  banner.children[3].events.click(); assert.equal(banner.hidden, true);
  await updates.openList(); assert.equal(opened[0][0], 'What’s new');
});

test('a version change refreshes the banner and list with one coalesced changelog request', async () => {
  const banner = new Node('div'), opened = [], refresh = Promise.withResolvers();
  const old = { entries: [{ date: '2026-10-01', title: 'Old release', items: ['Old item'] }] };
  const latest = { entries: [{ date: '2026-10-02', title: 'New release', items: ['New item'] }] };
  let requests = 0;
  const api = async () => ++requests === 1 ? old : refresh.promise;
  const updates = createUpdates({ el, button, openDialog: (title, node) => opened.push(node), api, banner, storage: null });
  updates.seen('v1'); await flush();
  await updates.openList();
  assert.equal(opened[0].children[0].children[0].textContent, 'Old release');
  assert.equal(requests, 1, 'first version uses the startup request');

  updates.seen('v2'); updates.seen('v2');
  const list = updates.openList();
  refresh.resolve(latest);
  await list; await flush();
  assert.match(banner.children[0].textContent, /New release/);
  assert.equal(opened[1].children[0].children[0].textContent, 'New release');
  assert.equal(requests, 2, 'repeated version events and the list share one refresh');
  await updates.openList();
  updates.seen('v2'); await flush();
  assert.equal(requests, 2, 'the refreshed result stays cached for the observed version');

  updates.seen('v3'); await flush();
  assert.equal(requests, 3, 'each newly observed version invalidates the cache once');
});

test('a failed version refresh can retry and share its retry with the list', async () => {
  const banner = new Node('div'), opened = [], retry = Promise.withResolvers();
  let requests = 0;
  const api = async () => {
    requests++;
    if (requests === 1) return { entries: [] };
    if (requests === 2) throw new Error('Refresh unavailable');
    return retry.promise;
  };
  const updates = createUpdates({ el, button, openDialog: (title, node) => opened.push(node), api, banner, storage: null });
  updates.seen('v1'); await flush();
  updates.seen('v2'); await flush();
  assert.equal(banner.children[0].textContent, 'The picker has been updated.');
  assert.equal(requests, 2);

  updates.seen('v2');
  const list = updates.openList();
  retry.resolve({ entries: [{ date: '2026-10-02', title: 'Recovered release', items: ['Recovered item'] }] });
  await list; await flush();
  assert.equal(requests, 3);
  assert.match(banner.children[0].textContent, /Recovered release/);
  assert.equal(opened[0].children[0].children[0].textContent, 'Recovered release');
});

test('superseded changelog requests cannot replace the latest banner or evict its cache', async () => {
  const banner = new Node('div'), opened = [], requests = [];
  const api = () => { const request = Promise.withResolvers(); requests.push(request); return request.promise; };
  const updates = createUpdates({ el, button, openDialog: (title, node) => opened.push(node), api, banner, storage: null });
  updates.seen('v1'); updates.seen('v2'); updates.seen('v3');
  assert.equal(requests.length, 3);
  requests[2].resolve({ entries: [{ date: '2026-10-03', title: 'Latest release', items: ['Latest item'] }] });
  await flush();
  requests[1].resolve({ entries: [{ date: '2026-10-02', title: 'Superseded release', items: ['Old item'] }] });
  requests[0].reject(new Error('Old request failed'));
  await flush();
  assert.match(banner.children[0].textContent, /Latest release/);
  await updates.openList();
  assert.equal(opened[0].children[0].children[0].textContent, 'Latest release');
  assert.equal(requests.length, 3, 'an old failure must not clear a newer cached request');
});

test('roadmap is valid: known statuses, unique ids, dates on done items', async () => {
  const map = JSON.parse(await readFile(new URL('../app/data/roadmap.json', import.meta.url), 'utf8'));
  assert.equal(map.schemaVersion, 1); assert.match(map.updated, /^\d{4}-\d{2}-\d{2}$/);
  const items = map.themes.flatMap(theme => theme.items), ids = items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of items) {
    assert.ok(item.title && item.what && item.why, item.id);
    assert.ok(map.statuses[item.status], `${item.id} status ${item.status}`);
    assert.ok(map.sizes[item.size], `${item.id} size ${item.size}`);
    if (item.status === 'done') assert.match(item.done, /^\d{4}-\d{2}-\d{2}$/, item.id);
  }
});

test('roadmap dialog lists work in progress and filters by status', async () => {
  const opened = [];
  const roadmap = { updated: '2026-10-12', statuses: { working: 'In progress', soon: 'Soon', done: 'Done' }, sizes: { S: 'Small' },
    themes: [{ title: 'Duo', blurb: 'b', items: [
      { id: 'A', title: 'Later thing', what: 'w', why: 'y', size: 'S', status: 'soon' },
      { id: 'B', title: 'Busy thing', what: 'w', why: 'y', size: 'S', status: 'working', note: 'Halfway.' },
      { id: 'C', title: 'Old thing', what: 'w', why: 'y', size: 'S', status: 'done', done: '2026-10-01' }] }] };
  const api = async route => route === '/api/roadmap' ? roadmap : { entries: [] };
  const updates = createUpdates({ el, button, openDialog: (title, node) => opened.push([title, node]), api, banner: new Node('div'), storage: null });
  await updates.openRoadmap();
  const [title, content] = opened[0]; assert.equal(title, 'Roadmap');
  const [, now, filters, body] = content.children;
  assert.equal(now.className, 'roadmap-now'); assert.equal(now.children[0].textContent, 'In progress');
  assert.deepEqual(filters.children.map(chip => chip.textContent), ['Everything', 'In progress 1', 'Soon 1', 'Done 1']);
  const titles = () => body.children.flatMap(section => section.children.slice(2).map(card => card.children[0].children[0].textContent));
  assert.deepEqual(titles(), ['Busy thing', 'Later thing', 'Old thing'], 'sorted by status');
  filters.children[3].events.click();
  assert.deepEqual(titles(), ['Old thing']); assert.equal(filters.children[3].attributes['aria-pressed'], 'true');
});
