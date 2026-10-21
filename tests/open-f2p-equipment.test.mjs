import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEquipment } from '../scripts/lib/open-f2p-equipment.mjs';
import { templates } from '../scripts/build-open-f2p.mjs';

// Small invented pages only. This suite neither discovers data nor starts a server.
function fixture() {
  const item = (name, id, rest = '') => `{{Infobox Item|name=${name}|id=${id}|members=no|equipable=yes}}${rest}`;
  const texts = {
    'Practice blade': item('Practice blade', 101, '{{Infobox Bonuses|slot=weapon|class=melee|tier=20|damage=42.5|accuracy=80|requirements={{sc|Attack|20}}{{sc|Strength|10}}}}' +
      '{{Infobox Recipe|members=no|output1=Practice blade|output1qty=1|skill1=Smithing|skill1lvl=12|mat1=Practice bar|mat1qty=2|tool=Hammer|facility=Practice anvil}}'),
    'Practice bar': item('Practice bar', 102), Hammer: item('Hammer', 103),
    'Practice anvil': '{{ObjectLocLine|name=Practice anvil|loc=Field|mem=no|plane=0|mapID=28|map=objectid:77, x:3200, y:3200}}',
    'Practice forge': '{{ObjectLocLine|name=Practice forge|loc=Field|mem=no|plane=0|mapID=28|map=objectid:78, x:3201, y:3200}}',
    'Practice creature': '{{Infobox Monster|id1=201|members1=no|id2=202|members2=yes}}' +
      '{{LocLine|loc=Field|mem=no|plane=0|mapID=28|map=npcid:201, x:3200, y:3200; npcid:202, x:3201, y:3200}}' +
      '==Free table==\n{{DropsLine|name=Practice blade|quantity=1-2|rarity=3/128}}\n==Other table==\n{{DropsLine|name=Practice blade|quantity=99|rarity=Always}}',
  };
  const pages = new Map(Object.entries(texts).map(([page, text], index) => [page, { text,
    provenance: { page, revision: index + 1, url: `https://runescape.wiki/w/${page.replaceAll(' ', '_')}?oldid=${index + 1}` } }]));
  const spec = {
    equipmentActivities: [{ page: 'Practice blade', slug: 'practice-blade' }],
    equipmentFacilities: [{ page: 'Practice anvil', slug: 'anvil', kind: 'anvil', locations: ['Field'] },
      { page: 'Practice forge', slug: 'forge', kind: 'forge', locations: ['Field'] }],
    monsterActivities: [{ page: 'Practice creature', slug: 'creature', name: 'Practice creature', variant: 'Free', variants: ['1'], npcIds: [201], locations: ['Field'],
      dropSection: { start: '==Free table==', end: '==Other table==' }, drops: [{ page: 'Practice blade' }] }],
    equipmentRecipes: [{ page: 'Practice blade', slug: 'practice-blade', recipeFacility: 'Practice anvil', facilities: ['anvil:12850', 'forge:12850'] }],
  };
  const args = { spec, pages, cells: new Map([['12850', {}]]), templates, stock: [], sources: [] };
  return { args, run: () => buildEquipment(args), change: (page, from, to) => { pages.get(page).text = pages.get(page).text.replace(from, to); } };
}

test('equipment keeps exact item, free encounter variant, raw drop table and wield requirements', () => {
  const { run } = fixture(), result = run();
  assert.equal(result.equipment.length, 1);
  const [item] = result.equipment;
  assert.equal(item.itemId, 101);
  assert.equal(item.item, 'Practice blade');
  assert.deepEqual(item.requirements, { Attack: 20, Strength: 10 });
  assert.equal(item.ability_damage, 42.5);
  assert.equal(item.accuracy, 80);
  assert.deepEqual(result.monsters[0].coordinates, [{ npcId: 201, x: 3200, y: 3200, plane: 0 }]);
  assert.equal(result.monsters[0].variant, 'Free');
  assert.equal(result.drops.length, 1, 'The unselected table cannot contribute a drop');
  assert.equal(result.drops[0].quantity, '1-2');
  assert.equal(result.drops[0].rate, '3/128');
  assert.equal(result.drops[0].probability, 3 / 128);
  assert.equal(result.drops[0].itemId, 101);
  assert.equal(result.drops[0].monsterId, result.monsters[0].id);
  assert.deepEqual(new Set(result.acquisitions.map(row => row.sourceKind)), new Set(['drop', 'recipe']));
  const wield = result.tasks.find(row => row.sourceId === item.id);
  assert.deepEqual(wield.supplyItems, ['Practice blade']);
  assert.deepEqual(wield.skillRequirements, item.requirements);
  assert.deepEqual(run(), result, 'Repeated derivation is deterministic');
});

test('an absent equipment selection emits no facts and reads no pages', () => {
  const result = buildEquipment({ spec: {}, pages: { get() { throw new Error('Unexpected page read'); } }, cells: new Map(), templates });
  assert.deepEqual(result, { equipment: [], monsters: [], drops: [], facilities: [], recipes: [], acquisitions: [], tasks: [], equipmentReview: [] });
});

test('recipe retains quantities, tools and every required facility without a self-supply cycle', () => {
  const { run } = fixture(), result = run(), [recipe] = result.recipes;
  assert.deepEqual(recipe.inputs, [{ item: 'Practice bar', quantity: 2 }]);
  assert.deepEqual(recipe.tools, ['Hammer']);
  assert.deepEqual(recipe.supplyItems, ['Practice bar', 'Hammer']);
  assert.deepEqual(recipe.skillRequirements, { Smithing: 12 });
  assert.deepEqual(recipe.objectRequirements, ['Practice anvil', 'Practice forge']);
  assert.equal(recipe.facilityIds.length, 2);
  assert.deepEqual(recipe.output, ['Practice blade']);
  const source = result.acquisitions.find(row => row.sourceId === recipe.id);
  const task = result.tasks.find(row => row.sourceId === source.id);
  assert.deepEqual(task.output, ['Practice blade']);
  assert.deepEqual(task.supplyItems, recipe.supplyItems);
  assert.deepEqual(task.objectRequirements, recipe.objectRequirements);
  assert.ok(!task.supplyItems.includes('Practice blade'));
  assert.match(recipe.itemChecks.join(' '), /2 Practice bar/);
  assert.ok(recipe.provenance.some(row => row.page === 'Practice bar'));
  assert.ok(recipe.provenance.some(row => row.page === 'Hammer'));
});

test('equipment derivation rejects ambiguous or members-only items and uncertain requirements', () => {
  for (const [from, to, pattern] of [
    ['members=no', 'members=yes', /exact free item/],
    ['id=101', 'id=101, 104', /item id/],
    ['{{sc|Attack|20}}', '{{Skillreq|Attack|20}}', /wield requirements/],
    ['|class=melee', '|class=unknown', /slot\/class/],
  ]) {
    const fixtureCase = fixture(); fixtureCase.change('Practice blade', from, to);
    assert.throws(fixtureCase.run, pattern);
  }
  const ambiguous = fixture(); ambiguous.args.pages.get('Practice blade').text += '{{Infobox Item|name=Practice blade|id=104|members=no}}';
  assert.throws(ambiguous.run, /Ambiguous equipment\/item variants/);
});

test('selected encounter and facility locations reject gates, membership, interiors and unknown cells', () => {
  for (const page of ['Practice creature', 'Practice anvil']) for (const [from, to] of [
    ['mem=no', 'mem=yes'], ['plane=0', 'plane=1'], ['mapID=28', 'mapID=99'], ['|mem=no', '|requirements={{QuestReq|Example}}|mem=no'],
  ]) {
    const fixtureCase = fixture(); fixtureCase.change(page, from, to);
    assert.throws(fixtureCase.run, /Gated\/member\/interior/);
  }
  const wrongVariant = fixture(); wrongVariant.args.spec.monsterActivities[0].npcIds = [202];
  assert.throws(wrongVariant.run, /Unreviewed exact monster IDs/);
  const memberVariant = fixture(); memberVariant.args.spec.monsterActivities[0].variants = ['2'];
  assert.throws(memberVariant.run, /No free monster variant/);
  const outside = fixture(); outside.args.cells.clear();
  assert.throws(outside.run, /no existing reviewed cell/);
  const unknownMap = fixture(); unknownMap.change('Practice anvil', '|mapID=28', '');
  assert.throws(unknownMap.run, /Unknown surface defaults/);
});

test('drops reject unknown rates, unsupported quantities, notes, members and wrong table sections', () => {
  for (const [from, to, pattern] of [
    ['rarity=3/128', 'rarity=Rare', /Unknown selected drop rate/],
    ['rarity=3/128', 'rarity=1/0', /Unknown selected drop rate/],
    ['quantity=1-2', 'quantity=1;2', /Unknown drop quantity/],
    ['|quantity=1-2', '', /Unknown drop quantity/],
    ['|quantity=1-2', '|members=yes|quantity=1-2', /Conditional\/member drop/],
    ['|quantity=1-2', '|noted=yes|quantity=1-2', /Conditional\/member drop/],
    ['|quantity=1-2', '|raritynotes=Special event|quantity=1-2', /Unreviewed drop notes/],
  ]) {
    const fixtureCase = fixture(); fixtureCase.change('Practice creature', from, to);
    assert.throws(fixtureCase.run, pattern);
  }
  const wrongTable = fixture(); wrongTable.args.spec.monsterActivities[0].dropSection.start = '==Missing table==';
  assert.throws(wrongTable.run, /Missing exact drop-table section/);
});

test('F2P-only drop notes need exact reviewed text and pinned evidence', () => {
  const fixtureCase = fixture();
  fixtureCase.change('Practice creature', '|quantity=1-2', '|namenotes={{F2POnly}}|quantity=1-2');
  const review = fixtureCase.args.spec.monsterActivities[0].drops[0];
  review.notes = '{{F2POnly}}';
  review.f2pOnly = true;
  review.noteEvidence = [{ page: 'Practice creature', needle: '|namenotes={{F2POnly}}' }];
  assert.equal(fixtureCase.run().drops[0].world, 'free');
  fixtureCase.change('Practice creature', '{{F2POnly}}', '{{F2POnly}}Changed restriction');
  assert.throws(fixtureCase.run, /Unreviewed drop notes/);
  const stale = fixture(); stale.args.spec.monsterActivities[0].evidence = [{ page: 'Practice creature', needle: 'Missing proof' }];
  assert.throws(stale.run, /Equipment evidence changed/);
});

test('leather sewing retains both needle and thread and rejects a missing thread review', () => {
  const fixtureCase = fixture();
  fixtureCase.change('Practice blade', '|skill1=Smithing', '|skill1=Crafting');
  fixtureCase.change('Practice blade', '|tool=Hammer|facility=Practice anvil', '|tool=Needle');
  for (const [index, page] of ['Needle', 'Thread'].entries()) fixtureCase.args.pages.set(page, {
    text: `{{Infobox Item|name=${page}|id=${301 + index}|members=no}}`,
    provenance: { page, revision: 1, url: `https://runescape.wiki/w/${page}?oldid=1` },
  });
  const selection = fixtureCase.args.spec.equipmentRecipes[0];
  selection.recipeFacility = ''; selection.facilities = []; selection.cell = '12850';
  assert.throws(fixtureCase.run, /lacks thread/);
  selection.extraSupplies = ['Thread'];
  const [recipe] = fixtureCase.run().recipes;
  assert.deepEqual(recipe.supplyItems, ['Practice bar', 'Needle', 'Thread']);
  assert.deepEqual(recipe.tools, ['Needle']);
  assert.deepEqual(recipe.skillRequirements, { Crafting: 12 });
});

test('recipes require exact free method, material membership, skill, tools and facilities', () => {
  for (const [page, from, to, pattern] of [
    ['Practice blade', '|skill1lvl=12', '|skill1lvl=unknown', /recipe skill/],
    ['Practice blade', '|mat1qty=2', '|mat1qty=unknown', /material quantity/],
    ['Practice blade', '|members=no|output1', '|members=yes|output1', /No exact free recipe/],
    ['Practice bar', '|members=no', '|members=yes', /exact free item/],
    ['Hammer', '|members=no', '|members=yes', /exact free item/],
    ['Practice blade', '|output1qty=1', '|output1qty=2', /Unsupported multi-output/],
  ]) {
    const fixtureCase = fixture(); fixtureCase.change(page, from, to);
    assert.throws(fixtureCase.run, pattern);
  }
  const noForge = fixture(); noForge.args.spec.equipmentRecipes[0].facilities = ['anvil:12850'];
  assert.throws(noForge.run, /lacks reviewed forge/);
  const wrongFacility = fixture(); wrongFacility.args.spec.equipmentRecipes[0].facilities = ['forge:12850'];
  assert.throws(wrongFacility.run, /Wrong recipe facility/);
});
