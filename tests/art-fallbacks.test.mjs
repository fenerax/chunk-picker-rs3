import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setArtStatus, artStatusText, categoryPlaceholder, placeholderPicture, resolvePicture, recordPictureFailure, installPictureFallbacks, observeArtStatus } from '../app/web/art-status.mjs';
import { taskIcon, taskCategoryIcon } from '../app/web/browser-task-icons.mjs';
import { taskItemIcon, taskArtworkProvenance } from '../app/web/task-artwork.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { loadIcons, skillIcon } from '../app/web/icons.mjs';

afterEach(() => setArtStatus(null));

test('missing artwork keeps exact inventory names and uses a generic bag instead of guessed gear or skill identity', () => {
  setArtStatus({ placeholderPictures: true, pack: null, availableRoutes: [] });
  const task = { item: 'Unknown weapon (tier 99)', category: 'Smithing', label: 'Obtain Unknown weapon (tier 99)' };
  assert.equal(taskIcon(task), '/placeholder-art/item.svg');
  assert.equal(task.item, 'Unknown weapon (tier 99)');
  assert.equal(taskIcon({ category: 'Quest', label: 'Speak to ~|Unknown NPC|~' }), '/placeholder-art/task-quest.svg');
  assert.equal(taskCategoryIcon('Mining'), '/placeholder-art/skill-mining.svg');
  assert.equal(taskCategoryIcon('Clue'), '/placeholder-art/task-clue.svg');
  assert.equal(taskCategoryIcon('../../outside'), null);
});

test('installed exact inventory and legacy category routes retain their existing URLs', () => {
  const original = '/assets/SVG/rs3/quest-rs3.svg', skill = '/assets/SVG/rs3/mining-rs3.svg', exact = '/assets/map/icons-items.2026-10-12.v1/exact.png';
  setArtStatus({ placeholderPictures: false, pack: { kind: 'art', version: '1.0.0', health: 'ready' }, availableRoutes: [original, skill] });
  assert.equal(taskCategoryIcon('Quest'), original);
  assert.equal(taskIcon({ item: 'Exact gear', category: 'Smithing' }, { itemIcon: name => name === 'Exact gear' ? exact : null }), exact);
  assert.equal(taskCategoryIcon('Music'), '/placeholder-art/task-music.svg');
  assert.equal(taskCategoryIcon('Mining', () => '/placeholder-art/skill-mining.svg'), skill);
  assert.equal(taskIcon({ category: 'Mining', label: 'Mine a rock' }, { skillIcon: () => '/placeholder-art/skill-mining.svg' }), skill);
});

test('Profile and Area check keep their empty skill image slot when healthy SVG art exists without optional PNGs', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    await loadIcons();
    setArtStatus({ placeholderPictures: false, availableRoutes: ['/assets/SVG/rs3/mining-rs3.svg'] });
    assert.equal(skillIcon('Mining'), null);
    setArtStatus({ placeholderPictures: true, availableRoutes: [] });
    assert.equal(skillIcon('Mining'), '/placeholder-art/skill-mining.svg');
  } finally { globalThis.fetch = previousFetch; }
});

test('both special task pictures respect per-file availability before falling back', () => {
  const route = `/task-item-artwork.2026-10-09.v1/${taskArtworkProvenance[0].sha256}.png`;
  setArtStatus({ placeholderPictures: true, availableRoutes: [route] });
  assert.equal(taskItemIcon('Team-1 cape', () => null), route);
  assert.equal(taskItemIcon('Skull lantern (tier 10)', () => null), '/placeholder-art/item.svg');
  assert.equal(taskItemIcon('Uncatalogued exact name', () => null), '/placeholder-art/item.svg');
});

test('a failed route is shared across subsequent resolutions and DOM errors switch images once', () => {
  setArtStatus({ placeholderPictures: false, availableRoutes: ['/assets/SVG/rs3/fishing-rs3.svg'] });
  let listener;
  installPictureFallbacks({ addEventListener: (name, callback, capture) => { assert.equal(name, 'error'); assert.equal(capture, true); listener = callback; } });
  const route = '/assets/SVG/rs3/fishing-rs3.svg';
  const image = { tagName: 'IMG', src: route, getAttribute() { return this.src; } };
  listener({ target: image });
  assert.equal(image.src, '/placeholder-art/skill-fishing.svg');
  assert.equal(resolvePicture(route), null);
  listener({ target: image });
  assert.equal(image.src, '/placeholder-art/skill-fishing.svg');
  recordPictureFailure('/assets/world.png');
  assert.equal(resolvePicture('/assets/world.png'), null);
  const item = '/assets/map/icons-items.2026-10-12.v1/exact.png';
  const bag = { tagName: 'IMG', src: item, getAttribute() { return this.src; } };
  listener({ target: bag });
  assert.equal(bag.src, '/placeholder-art/item.svg');
  assert.equal(taskItemIcon('Exact weapon (tier 70)', () => item), '/placeholder-art/item.svg');
});

test('missing world artwork settles to the coordinate grid without assigning a broken image request', () => {
  setArtStatus({ placeholderPictures: true, availableRoutes: [] });
  let assignments = 0, unavailable = 0;
  const map = { image: { set src(value) { assignments++; } }, stage: { dataset: {} }, terrain: { setFallbackUnavailable() { unavailable++; } } };
  ChunkMap.prototype.loadWorldPicture.call(map);
  ChunkMap.prototype.loadWorldPicture.call(map);
  assert.equal(assignments, 0);
  assert.equal(unavailable, 2);
  assert.equal(map.imageStatus, 'placeholder');
  assert.equal(map.stage.dataset.mapImage, 'placeholder');
});

test('Settings status shows only bounded kind/version/health fields and excludes paths and server reasons', () => {
  assert.equal(artStatusText({ placeholderPictures: true, pack: { health: 'invalid' } }), 'Using placeholder pictures · Art pack unavailable · invalid');
  assert.equal(artStatusText({ placeholderPictures: false, pack: { kind: 'art', version: '1.0.0+local.1', health: 'healthy' } }), 'Pictures installed · art 1.0.0+local.1 · healthy');
  setArtStatus({ placeholderPictures: true, pack: { kind: 'art', version: '1.0.0', health: 'damaged', root: 'C:/private/art', reason: 'C:/secret/pack.json' }, availableRoutes: [] });
  assert.equal(artStatusText(), 'Using placeholder pictures · art 1.0.0 · damaged');
  setArtStatus({ placeholderPictures: true, pack: { kind: 'art', version: 'C:/private', health: '<script>' } });
  assert.equal(artStatusText(), 'Using placeholder pictures · art unknown · unknown');
});

test('a later file failure updates the short status without changing the selected pack version', () => {
  setArtStatus({ placeholderPictures: false, pack: { kind: 'art', version: '1.2.3', health: 'ready' }, availableRoutes: ['/assets/world.png'] });
  const values = [], stop = observeArtStatus(value => values.push(value));
  recordPictureFailure('/assets/world.png');
  recordPictureFailure('/assets/world.png');
  stop();
  assert.equal(values.length, 2);
  assert.equal(artStatusText(), 'Using placeholder pictures · art 1.2.3 · damaged');
});

test('the authored contract supplies 29 skills, five task types, seven pin groups and one generic item as inert SVGs', () => {
  const root = new URL('../app/web/placeholder-art/', import.meta.url);
  const files = readdirSync(root).filter(name => name.endsWith('.svg'));
  assert.equal(files.length, 42);
  assert.equal(files.filter(name => name.startsWith('skill-')).length, 29);
  for (const file of files) {
    const stem = file.slice(0, -4), svg = readFileSync(new URL(file, root), 'utf8');
    assert.equal(placeholderPicture(stem), `/placeholder-art/${file}`);
    assert.match(svg, /^<svg[^>]+viewBox=/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image)\b|\bon[a-z]+=|\bhref=/i);
  }
  assert.equal(categoryPlaceholder('__proto__'), null);
  assert.equal(placeholderPicture('../item'), null);
  assert.equal(placeholderPicture('skill-unknown'), null);
});
