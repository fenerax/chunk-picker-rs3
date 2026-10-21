import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiTemplates, parseEquipmentWikiPage, selectWikiVariants, selectWikiBonusVariants, wikiNumber, wikiItemIds } from '../scripts/research/equipment-wiki.mjs';

const page = content => ({ title: 'Variant item', pageid: 42, revisions: [{ revid: 123, timestamp: '2026-10-08T00:00:00Z', slots: { main: { content } } }] });

test('nested templates, template arguments, and links retain complete Infobox fields', () => {
  const parsed = parseEquipmentWikiPage(page(`<!-- {{Infobox Item|id=999}} -->
{{Wrapper|{{Infobox Item|name=[[Variant item|Item]]|id=10|weight=1.5|examine={{Thing|a=b|c=d}}}}}}
{{Infobox Bonuses|requirements={{sc|defence|80}}, {{sc|constitution|80}}|armour=389.6|image=[[File:Picture.png|thumb|text]]|note={{{fallback|a=b}}}}}`));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, 'Item');
  assert.deepEqual(parsed.items[0].ids, [10]);
  assert.equal(parsed.items[0].weight, 1.5);
  assert.equal(parsed.bonuses[0].fields.requirements, '{{sc|defence|80}}, {{sc|constitution|80}}');
  assert.equal(parsed.bonuses[0].fields.armour, '389.6');
  assert.equal(parsed.bonuses[0].fields.image, '[[File:Picture.png|thumb|text]]');
  assert.equal(parsed.bonuses[0].fields.note, '{{{fallback|a=b}}}');
  assert.equal(parsed.source.url, 'https://runescape.wiki/w/Variant_item?oldid=123');
});

test('variant suffix overrides preserve blanks and never leak another variant stats', () => {
  const parsed = parseEquipmentWikiPage(page(`{{Infobox Item|name=Variant item|version1=Charged|version2=Uncharged|id1=10|id2=11|weight=2|weight2=}}
{{Infobox Bonuses|version1=Charged|version2=Uncharged|tier1=50|tier2=0|armour1=170|requirements={{sc|defence|50}}}}`));
  assert.equal(parsed.items[0].weight, 2);
  assert.equal(parsed.items[1].weight, null);
  assert.equal(parsed.bonuses[0].fields.armour, '170');
  assert.equal(parsed.bonuses[1].fields.armour, undefined);
  assert.equal(parsed.bonuses[1].fields.tier, '0');
  assert.deepEqual(selectWikiVariants(parsed, [11]).map(v => v.ids), [[11]]);
  assert.deepEqual(selectWikiBonusVariants(parsed, parsed.items[1]).map(v => v.fields.tier), ['0']);
});

test('bonus buckets match labels across differing suffix positions and explicit shared labels', () => {
  const parsed = parseEquipmentWikiPage(page(`{{Infobox Item|version1=new|version2=used|id1=10|id2=11|weight=1}}
{{Infobox Bonuses|version1=Used display|bucketname1=used|tier1=50|version2=New display|bucketname2=new|tier2=60}}
{{Infobox Bonuses|bucketname=new¦used|prayer=2}}`));
  assert.deepEqual(selectWikiBonusVariants(parsed, parsed.items[0]).map(v => v.fields.tier ?? v.fields.prayer), ['60', '2']);
});

test('unknown weights and nonliteral IDs stay unknown; conflicting fields remain visible', () => {
  assert.equal(wikiNumber(''), null);
  assert.equal(wikiNumber('{{Weight|1}}'), null);
  assert.equal(wikiNumber('unknown'), null);
  assert.equal(wikiNumber('−4.535 kg<ref>source</ref>'), -4.535);
  assert.equal(wikiNumber('0'), 0);
  assert.deepEqual(wikiItemIds('88, 89'), [88, 89]);
  assert.deepEqual(wikiItemIds('88 (inventory)'), []);
  assert.deepEqual(parseWikiTemplates('{{Infobox Item|id=88|id=89}}')[0].conflicts, ['id']);
});

test('conflicting item identity and bonus variant bindings cannot select the last value', () => {
  const itemConflict = parseEquipmentWikiPage(page('{{Infobox Item|id=10|id=11|version=new|weight=2}}\n{{Infobox Bonuses|bucketname=new|weight=2}}'));
  assert.deepEqual(selectWikiVariants(itemConflict, [11]), []);
  assert.deepEqual(selectWikiBonusVariants(itemConflict, itemConflict.items[0]), []);
  const nameConflict = parseEquipmentWikiPage(page('{{Infobox Item|id=10|name1=Wrong|name1=Item|version1=new|weight=2}}'));
  assert.deepEqual(selectWikiVariants(nameConflict, [10]), []);
  const versionConflict = parseEquipmentWikiPage(page('{{Infobox Item|id=10|version1=new|version1=used|weight=2}}'));
  assert.deepEqual(selectWikiVariants(versionConflict, [10]), []);
  const bucketConflict = parseEquipmentWikiPage(page('{{Infobox Item|id=10|version=used|weight=}}\n{{Infobox Bonuses|bucketname=new|bucketname=used|weight=3}}'));
  assert.deepEqual(selectWikiBonusVariants(bucketConflict, bucketConflict.items[0]), []);
  const bonusVersionConflict = parseEquipmentWikiPage(page('{{Infobox Item|id=10|version=used|weight=}}\n{{Infobox Bonuses|version1=new|version1=used|weight1=3}}'));
  assert.deepEqual(selectWikiBonusVariants(bonusVersionConflict, bonusVersionConflict.items[0]), []);
});
