import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEquipmentWeights, hashEquipmentRow } from '../scripts/research/import-equipment-weights.mjs';

function fixture(name, candidateIds, content, equipmentRow = { slot: 'feet' }) {
  return { equipment: { [name]: equipmentRow }, comparison: { equipment: [{ name, candidateIds }] },
    items: { records: candidateIds.map(id => ({ id, normalizedName: name, equipmentCandidate: true })) },
    wikiSnapshot: { fetchedAt: '2026-10-08T00:00:00Z', completedAt: '2026-10-08T01:00:00Z', requestedTitles: [name], resolutions: { [name]: name }, pages: [{ title: name, revisions: [{ revid: 99, slots: { main: { content } } }] }] } };
}

test('Boots of lightness uses verified worn ID89, preserving inventory ID88 separately', () => {
  const input = fixture('Boots of lightness', [88, 89], '{{Infobox Item|name=Boots of lightness|version1=Inventory|version2=worn|id1=88|id2=89|weight1=0.34|weight2=-4.535}}');
  const before = JSON.stringify(input), output = buildEquipmentWeights(input), row = output.records['Boots of lightness'];
  assert.equal(row.weight, -4.535);
  assert.equal(row.wornWeight, -4.535);
  assert.equal(row.inventoryWeight, 0.34);
  assert.deepEqual(row.identity.wikiIds, [89]);
  assert.deepEqual(row.identity.inventoryIds, [88]);
  assert.equal(row.source.field, 'Infobox Item.weight2');
  assert.deepEqual(row.source.inventoryFields, ['Infobox Item.weight1']);
  assert.equal(row.before, null);
  assert.equal(row.equipmentBeforeSha256, hashEquipmentRow(input.equipment['Boots of lightness']));
  assert.equal(JSON.stringify(input), before);
});

test('Bonuses weight safely fills a missing Item weight only for the exact declared variant', () => {
  const input = fixture('Item', [10], '{{Infobox Item|name=Item|version1=new|version2=used|id1=10|id2=11|weight=}}\n{{Infobox Bonuses|version1=used|version2=new|weight1=7|weight2=2}}');
  const output = buildEquipmentWeights(input);
  assert.equal(output.records.Item.weight, 2);
  assert.equal(output.records.Item.source.field, 'Infobox Bonuses.weight2');
  const absent = fixture('Item', [10], '{{Infobox Item|version=new|id=10|weight=}}\n{{Infobox Bonuses|version=used|weight=7}}');
  assert.equal(buildEquipmentWeights(absent).unresolved[0].reason, 'wiki-weight-missing-or-nonnumeric');
  const shared = fixture('Item', [10, 11], '{{Infobox Item|version1=new|version2=used|id1=10|id2=11|weight=}}\n{{Infobox Bonuses|weight=2}}');
  assert.equal(buildEquipmentWeights(shared).records.Item.weight, 2);
  assert.equal(buildEquipmentWeights(shared).records.Item.source.field, 'Infobox Bonuses.weight');
  const isolated = fixture('Item', [10], '{{Infobox Item|version=new|id=10|weight=}}\n{{Infobox Bonuses|weight1=2|weight2=7}}');
  assert.equal(buildEquipmentWeights(isolated).unresolved[0].reason, 'wiki-weight-missing-or-nonnumeric');
  const unnamedSuffix = fixture('Item', [10], '{{Infobox Item|version=new|id=10|weight=}}\n{{Infobox Bonuses|weight1=2}}');
  assert.equal(buildEquipmentWeights(unnamedSuffix).unresolved[0].reason, 'wiki-weight-missing-or-nonnumeric');
  const conflictedBinding = fixture('Item', [10], '{{Infobox Item|version=used|id=10|weight=}}\n{{Infobox Bonuses|bucketname=new|bucketname=used|weight=3}}');
  assert.equal(buildEquipmentWeights(conflictedBinding).unresolved[0].reason, 'wiki-weight-missing-or-nonnumeric');
});

test('Item and matched Bonuses numeric conflicts remain unresolved; agreement retains both fields', () => {
  const content = '{{Infobox Item|version=new|id=10|weight=2}}\n{{Infobox Bonuses|bucketname=new|weight=3}}';
  assert.equal(buildEquipmentWeights(fixture('Item', [10], content)).unresolved[0].reason, 'conflicting-item-and-bonuses-weights');
  const unrelated = '{{Infobox Item|version=new|id=10|weight=2}}\n{{Infobox Bonuses|bucketname=used|weight=3}}';
  assert.equal(buildEquipmentWeights(fixture('Item', [10], unrelated)).records.Item.weight, 2);
  const agreed = '{{Infobox Item|version=new|id=10|weight=2}}\n{{Infobox Bonuses|bucketname=new|weight=2}}';
  assert.deepEqual(buildEquipmentWeights(fixture('Item', [10], agreed)).records.Item.source.fields, ['Infobox Item.weight', 'Infobox Bonuses.weight']);
});

test('all ambiguous cache candidates must be identified, and non-context weights must agree', () => {
  const complete = fixture('Item', [10, 11], '{{Infobox Item|name=Item|version1=new|version2=used|id1=10|id2=11|weight=9.979}}');
  assert.equal(buildEquipmentWeights(complete).records.Item.weight, 9.979);
  const incomplete = fixture('Item', [10, 11], '{{Infobox Item|name=Item|id=10|weight=9.979}}');
  assert.equal(buildEquipmentWeights(incomplete).unresolved[0].reason, 'wiki-does-not-identify-all-cache-candidates');
  const differing = fixture('Item', [10, 11], '{{Infobox Item|name=Item|version1=new|version2=used|id1=10|id2=11|weight1=1|weight2=2}}');
  assert.equal(buildEquipmentWeights(differing).unresolved[0].reason, 'cache-variants-have-different-wiki-weights');
});

test('missing weight, absent identities, duplicate fields, and existing weights cannot become synthesized facts', () => {
  assert.equal(buildEquipmentWeights(fixture('Item', [10], '{{Infobox Item|id=10|weight=}}')).unresolved[0].reason, 'wiki-weight-missing-or-nonnumeric');
  assert.equal(buildEquipmentWeights(fixture('Item', [], '{{Infobox Item|id=10|weight=0}}')).unresolved[0].reason, 'no-exact-equippable-cache-identity');
  assert.equal(buildEquipmentWeights(fixture('Item', [10], '{{Infobox Item|id=10|weight=1|weight=2}}')).unresolved[0].reason, 'conflicting-wiki-infobox-fields');
  assert.equal(buildEquipmentWeights(fixture('Item', [10], '{{Infobox Item|id=10|weight=0}}', { weight: 1 })).unresolved[0].reason, 'picker-weight-already-present');
  assert.equal(buildEquipmentWeights(fixture('Item', [10], '{{Infobox Item|id=10|weight=0}}')).records.Item.weight, 0);
});

test('versioned artifact partitions every retained equipment name with guarded, revision-linked facts', async () => {
  const artifact = JSON.parse(await readFile(new URL('../app/data/equipment-weights.2026-10-08.v1.json', import.meta.url), 'utf8'));
  const reference = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const names = [...Object.keys(artifact.records), ...artifact.unresolved.map(row => row.name)];
  assert.equal(names.length, 3550);
  assert.deepEqual([...new Set(names)].sort(), Object.keys(reference.equipment).sort());
  assert.equal(artifact.provenance.requestedEquipmentRows, 3550);
  assert.equal(artifact.summary.resolved + artifact.summary.unresolved, 3550);
  for (const [name, record] of Object.entries(artifact.records)) {
    assert.ok(Number.isFinite(record.wornWeight));
    assert.equal(record.weight, record.wornWeight);
    assert.equal(record.before, null);
    assert.equal(record.equipmentBeforeSha256, hashEquipmentRow(reference.equipment[name]));
    assert.ok(record.identity.wikiIds.length);
    assert.ok(record.identity.wikiIds.every(id => record.identity.cacheCandidateIds.includes(id)));
    assert.match(record.source.url, /runescape\.wiki\/w\/.+\?oldid=\d+$/);
    assert.equal(record.source.revisionId, Number(record.source.url.split('oldid=')[1]));
    assert.match(record.source.field, /Infobox (?:Item|Bonuses)\.weight\d*/);
    assert.ok(record.source.fields.length);
  }
  assert.equal(artifact.records['Boots of lightness'].weight, -4.535);
  assert.equal(artifact.records['Bronze platebody'].weight, 0.025);
  assert.equal(artifact.records['Rune platebody'].identity.wikiIds[0], 45543);
  assert.equal(artifact.records['Torva platebody'].weight, 9.979);
});
