import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { retainedItemIconNames, retainedInventoryEntry, exportRetainedItemIcons, RETAINED_BINDING_SHA256 } from '../scripts/export-retained-item-icons.mjs';
import { createIconCatalogue } from '../app/data/icons.mjs';
import { createIconHelper } from '../app/web/icons.mjs';

const manifest = JSON.parse(await readFile(new URL('../app/data/item-icons.2026-10-12.v1.json', import.meta.url)));

test('retained supplement binds every reviewed name to exact local inventory bytes', async () => {
  assert.deepEqual(Object.keys(manifest.icons), [...retainedItemIconNames]);
  assert.equal(manifest.source.bindingSha256, RETAINED_BINDING_SHA256);
  let total = 0;
  for (const [name, entry] of Object.entries(manifest.icons)) {
    const bytes = await readFile(new URL('../' + entry.source.sourcePath, import.meta.url));
    assert.equal(entry.source.equipmentName, name);
    assert.equal(entry.source.sourcePath, `resources/equipment_icons/${name.replaceAll(' ', '_')}.png`);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(entry.bytes, bytes.length); total += bytes.length;
    assert.equal(entry.width, bytes.readUInt32BE(16)); assert.equal(entry.height, bytes.readUInt32BE(20));
    assert.equal(entry.source.kind, 'retained-equipment-inventory');
  }
  assert.equal(manifest.coverage.totalBytes, total);
  assert.equal(manifest.icons['Zamorak robe (bottom)'], undefined);
  assert.equal(manifest.icons['Ghost hunter body'], undefined);
});

test('new version resolves reviewed typographic aliases on server and client without guessing variants', async () => {
  const catalogue = createIconCatalogue([manifest]);
  const helper = createIconHelper(async () => ({ ok: true, json: async () => catalogue.manifest }));
  assert.equal(await helper.loadIcons(), true);
  const canonical = helper.itemIcon("Monk's robe (top)");
  for (const name of ['MONK’S ROBE (TOP)', 'Monk‘s robe (top)']) {
    assert.equal(helper.itemIcon(name), canonical);
    assert.equal(catalogue.lookup('item', name).url, canonical);
  }
  for (const name of ['Monk robe', 'Zamorak robe top', 'Zamorak robe (bottom)', 'Ghost hunter body', 'First tower hat (4)']) assert.equal(helper.itemIcon(name), null);
});

test('offline exporter refuses unknown names, non-inventory bytes and existing outputs', async () => {
  const bytes = await readFile(new URL('../resources/equipment_icons/First_tower_hat.png', import.meta.url));
  assert.throws(() => retainedInventoryEntry('Ghost hunter body', bytes, { 'Ghost hunter body': {} }), /Unreviewed/);
  assert.throws(() => retainedInventoryEntry('First tower hat', Buffer.from('not png'), { 'First tower hat': {} }), /PNG/);
  await assert.rejects(exportRetainedItemIcons({ root: '.', output: 'app', manifestPath: 'never-created.json' }), /overwrite/);
  await assert.rejects(exportRetainedItemIcons({ root: '.', output: '.local/never-created-icons', manifestPath: '.local/never-created.json' }), /upstream index.js/);
});
