import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectTierInventoryImage } from '../scripts/export-tier-item-icons.mjs';
import { parseEquipmentWikiPage } from '../scripts/research/equipment-wiki.mjs';
import { createIconCatalogue } from '../app/data/icons.mjs';
import { createIconHelper } from '../app/web/icons.mjs';
import { taskItemIcon } from '../app/tasks/task-icons.mjs';

const page = (title, content) => parseEquipmentWikiPage({ title, revisions: [{ revid: 1, timestamp: '2026-10-09T00:00:00Z', slots: { main: { content } } }] });
const good = '{{Infobox Item|name=Skull lantern|image=[[File:Skull lantern (tier 10).png]]|id1=1|version1=During|id2=1|version2=After}}{{Infobox Bonuses|tier=10}}';

test('tier artwork selection needs exact reviewed title, short name, matching tier and state-image agreement', () => {
  const name = 'Skull lantern (tier 10)';
  assert.equal(selectTierInventoryImage(name, page(name, good)).fileTitle, 'File:Skull lantern (tier 10).png');
  assert.equal(selectTierInventoryImage('Skull lantern', page(name, good)).reason, 'unreviewed-tier-page');
  assert.equal(selectTierInventoryImage(name, page('Other', good)).reason, 'unreviewed-tier-page');
  assert.equal(selectTierInventoryImage(name, page(name, good.replace('name=Skull lantern', 'name=Death guard'))).reason, 'conflicting-tier-item-identity');
  assert.equal(selectTierInventoryImage(name, page(name, good.replace('tier=10', 'tier=20'))).reason, 'conflicting-tier-bonuses');
  assert.equal(selectTierInventoryImage(name, page(name, good.replace('id2=1', 'image2=[[File:Different.png]]|id2=1'))).reason, 'ambiguous-tier-inventory-image');
  assert.equal(selectTierInventoryImage(name, page(name, good.replace('tier=10', 'tier=20|tier=10'))).reason, 'conflicting-tier-bonuses');
});

test('immutable supplement adds all 63 qualified Necromancy names and preserves all 50 Team capes', async () => {
  const old = JSON.parse(await readFile(new URL('../app/data/item-icons.2026-10-08.v1.json', import.meta.url)));
  const added = JSON.parse(await readFile(new URL('../app/data/item-icons.2026-10-09.v1.json', import.meta.url)));
  const reviewBytes = await readFile(new URL('../docs/research/item-icon-review.2026-10-09.v1.json', import.meta.url));
  const review = JSON.parse(reviewBytes);
  assert.equal(added.source.reviewSha256, createHash('sha256').update(reviewBytes).digest('hex'));
  assert.deepEqual(added.coverage, { requested: 63, mapped: 63, unmatchedRequested: 0 });
  const catalogue = createIconCatalogue([old, added]);
  const helper = createIconHelper(async () => ({ ok: true, json: async () => catalogue.manifest }));
  assert.equal(await helper.loadIcons(), true);
  for (const [name, icon] of Object.entries(added.icons)) {
    assert.equal(old.icons[name], undefined);
    assert.equal(icon.itemId, undefined);
    assert.deepEqual(icon.aliases, []);
    assert.equal(icon.source.infoboxName, name.replace(/ \(tier \d+\)$/u, ''));
    assert.match(icon.source.itemPage.url, /\?oldid=\d+$/u);
    assert.match(icon.source.fileRevisionUrl, /\?oldid=\d+$/u);
    assert.equal(icon.source.itemPage.revisionId, review.selections[name].itemPage.revisionId);
    assert.equal(icon.width, icon.source.wikiUploadWidth);
    assert.equal(icon.height, icon.source.wikiUploadHeight);
    assert.match(icon.sha256, /^[a-f0-9]{64}$/u);
    assert.match(icon.source.downloadSha1, /^[a-f0-9]{40}$/u);
    assert.match(icon.source.licenseTemplate, /Inventory license/iu);
    assert.equal(taskItemIcon({ label: `Obtain a ${name}` }, helper.itemIcon), catalogue.lookup('item', name).url);
  }
  for (let number = 1; number <= 50; number++) {
    const name = `Team-${number} cape`;
    assert.equal(taskItemIcon({ label: `Obtain a ${name}` }, helper.itemIcon), catalogue.lookup('item', name).url);
    assert.equal(catalogue.lookup('item', name).url, `/assets/map/${old.assetDirectory}/${old.icons[name].file}`);
  }
  assert.equal(helper.itemIcon('Skull lantern'), null);
  assert.equal(helper.itemIcon('Deathwarden hood'), null);
  assert.equal(helper.itemIcon('Skull lantern (tier 99)'), null);
  const files = new Map(Object.values(added.icons).map(icon => [icon.file, icon]));
  assert.equal(added.uniqueFiles, files.size);
  assert.equal(added.totalBytes, [...files.values()].reduce((sum, icon) => sum + icon.bytes, 0));
});
