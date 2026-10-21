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
