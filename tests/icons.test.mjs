import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createIconCatalogue, ICON_VERSION, ICON_MANIFEST_PATH, ICON_BUNDLES } from '../app/data/icons.mjs';
import { createIconHelper } from '../app/web/icons.mjs';
import { categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture, pictureAvailable, setArtStatus, recordPictureFailure } from '../app/web/art-status.mjs';

const browserSource = (await readFile(new URL('../app/web/icons.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function browserIconsFor(dataset, fetch) {
  return runInNewContext(`${browserSource}\n({ loadIcons, skillIcon, itemIcon })`, {
    selectedDataset: dataset, fetch, categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture, pictureAvailable,
  });
}

const image = { file: 'attack.png', width: 24, height: 24, bytes: 3, sha256: 'a'.repeat(64), aliases: ['Melee attack'] };
const skillVersion = ICON_BUNDLES[0].version;
const bundle = icons => ({ schemaVersion: 1, version: skillVersion, kind: 'skills', assetDirectory: `icons-skills.${skillVersion}`, icons });

test('partial legacy art keeps available catalogue icons and replaces only failed pictures', async () => {
  const skillUrl = `/assets/map/icons-skills.${skillVersion}/attack.png`;
  const itemUrl = `/assets/map/icons-items.${ICON_VERSION}/sample.png`;
  const manifest = { schemaVersion: 1, version: ICON_VERSION, skills: { Attack: { url: skillUrl, aliases: [] } }, items: { Sample: { url: itemUrl, aliases: [] } } };
  let requests = 0;
  setArtStatus({ placeholderPictures: true, pack: { kind: 'pack', version: '1.0.0', health: 'partial' }, availableRoutes: [] });
  try {
    const icons = browserIconsFor({ capabilities: {} }, async () => { requests++; return { ok: true, json: async () => manifest }; });
    assert.equal(await icons.loadIcons(), true);
    assert.equal(icons.skillIcon('Attack'), skillUrl); assert.equal(icons.itemIcon('Sample'), itemUrl);
    assert.equal(icons.itemIcon('Missing'), '/placeholder-art/item.svg');
    recordPictureFailure(itemUrl);
    assert.equal(icons.itemIcon('Sample'), '/placeholder-art/item.svg');
    assert.equal(icons.skillIcon('Attack'), skillUrl);
    assert.equal(requests, 1);
  } finally { setArtStatus(null); }
});

test('independent dataset avoids catalogue requests and retains placeholders', async () => {
  let requests = 0;
  setArtStatus({ placeholderPictures: true, availableRoutes: [] });
  try {
    const icons = browserIconsFor({ capabilities: { independent: true } }, async () => { requests++; throw Error('Unexpected legacy request'); });
    assert.equal(await icons.loadIcons(), false);
    assert.equal(icons.skillIcon('Attack'), '/placeholder-art/skill-attack.svg');
    assert.equal(icons.itemIcon('Sample'), '/placeholder-art/item.svg');
    assert.equal(await icons.loadIcons(), false); assert.equal(requests, 0);
  } finally { setArtStatus(null); }
});

test('icon catalogue resolves canonical names and explicit aliases, normalizing case and whitespace', () => {
  const catalogue = createIconCatalogue([bundle({ Attack: image })]);
  assert.equal(catalogue.lookup('skill', '  ATTACK  ').name, 'Attack');
  assert.equal(catalogue.lookup('skill', 'melee   attack').url, `/assets/map/icons-skills.${skillVersion}/attack.png`);
  assert.equal(catalogue.lookup('item', 'Attack'), null);
  for (const name of [undefined, null, {}, 'missing', '__proto__']) assert.equal(catalogue.lookup('skill', name), null);
  assert.equal(catalogue.files.size, 1);
});

test('icon catalogue excludes ambiguous aliases and rejects path and file conflicts', () => {
  const catalogue = createIconCatalogue([bundle({ Attack: image, Strength: { ...image, file: 'strength.png', aliases: ['Melee attack'] } })]);
  assert.equal(catalogue.lookup('skill', 'Melee attack'), null);
  assert.ok(catalogue.lookup('skill', 'Strength'));
  assert.throws(() => createIconCatalogue([bundle({ Attack: { ...image, file: '../private.png' } })]), /Invalid icon/);
  assert.throws(() => createIconCatalogue([{ ...bundle({ Attack: image }), assetDirectory: '../private' }]), /Invalid icon manifest/);
  assert.throws(() => createIconCatalogue([bundle({ Attack: image, Strength: { ...image, sha256: 'b'.repeat(64) } })]), /Conflicting icon file/);
});

test('client helper loads once on demand and returns synchronous URLs or null after readiness', async () => {
  const manifest = createIconCatalogue([bundle({ Attack: image })]).manifest;
  let calls = 0;
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  const helper = createIconHelper(async (url, options) => {
    calls++; assert.equal(url, ICON_MANIFEST_PATH); assert.equal(options.credentials, 'same-origin');
    return response;
  });
  assert.equal(calls, 0);
  assert.equal(helper.skillIcon('Attack'), null);
  assert.equal(helper.itemIcon('missing'), null);
  const first = helper.loadIcons();
  assert.equal(first, helper.loadIcons());
  complete({ ok: true, json: async () => manifest });
  assert.equal(await first, true);
  assert.equal(helper.skillIcon('Melee attack'), `/assets/map/icons-skills.${skillVersion}/attack.png`);
  assert.equal(helper.itemIcon('Attack'), null);
  assert.equal(helper.skillIcon('unknown'), null);
  assert.equal(calls, 1);
});

test('client helper quietly handles missing, denied, malformed and failed manifests once', async () => {
  for (const fetcher of [async () => ({ ok: false }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({ schemaVersion: 7 }) }),
    async () => ({ ok: true, json: async () => ({ schemaVersion: 1, version: ICON_VERSION, skills: { Attack: { url: 'https://example.com/a.png', aliases: [] } }, items: {} }) })]) {
    let calls = 0;
    const helper = createIconHelper((...args) => { calls++; return fetcher(...args); });
    assert.equal(await helper.loadIcons(), false);
    assert.equal(helper.skillIcon('Attack'), null);
    assert.equal(await helper.loadIcons(), false);
    assert.equal(calls, 1);
  }
});

test('client rejects ambiguous aliases and cross-kind paths without partial lookup results', async () => {
  const manifest = createIconCatalogue([bundle({ Attack: image, Strength: { ...image, file: 'strength.png', aliases: ['Melee attack'] } })]).manifest;
  const helper = createIconHelper(async () => ({ ok: true, json: async () => manifest }));
  assert.equal(await helper.loadIcons(), true);
  assert.equal(helper.skillIcon('Melee attack'), null);
  manifest.skills.Strength.url = `/assets/map/icons-items.${ICON_VERSION}/strength.png`;
  const bad = createIconHelper(async () => ({ ok: true, json: async () => manifest }));
  assert.equal(await bad.loadIcons(), false);
  assert.equal(bad.skillIcon('Attack'), null);
});
