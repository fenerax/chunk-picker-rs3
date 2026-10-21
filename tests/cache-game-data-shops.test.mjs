import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { extractInventories, compareShopCandidates, reviewWikiStocks, runtimeShopDataset,
  parseWikiShopPage, scanTypedReferences, printableSpans, retainedShopDeclarations } from '../scripts/cache/game-data-shops.mjs';

const items = new Map([[10, { name: 'Air rune' }], [11, { name: 'Water pack', members: true }], [12, { name: 'Empty pot' }]]);
const page = (title, rows, extra = '') => ({ title, revisions: [{ revid: 42, timestamp: '2026-10-08T00:00:00Z', slots: { main: {
  content: `{{Infobox Shop\n|members = No\n|owner = [[Keeper]]\n}}\n${rows.map(([name, stock, fields = '']) => `{{StoreLine|name=${name}|stock=${stock}${fields}}}`).join('\n')}\n${extra}` } } }] });
const inv = defs => extractInventories(new Map(defs), items);

test('inventory export keeps all raw slots, zero stocks, unknown identities and absent item definitions', () => {
  const result = inv([[1, { size: 5, shopdata: [{ item: 10, stock: 0 }, { item: 11, stock: 70 }, { item: 999, stock: 1 }] }]]);
  assert.deepEqual(result[0].stock.map(row => row.baseStock), [0, 70, 1]);
  assert.equal(result[0].stock[1].membersMarked, true);
  assert.equal(result[0].stock[2].name, null);
  assert.equal(result[0].stock[2].membersMarked, null);
  assert.deepEqual(result[0].source, { major: 2, minor: 5, subid: 1 });
  assert.equal(result[0].name, null);
  assert.equal(result[0].currency, null);
  assert.equal(result[0].members, null);
  assert.deepEqual(result[0].keeperNpcIds, []);
});

test('empty encoded shopdata differs from storage config lacking shopdata', () => {
  const result = inv([[1, { size: 28 }], [2, { size: 40, shopdata: [] }]]);
  assert.equal(result[0].shopdataPresent, false);
  assert.equal(result[1].shopdataPresent, true);
  assert.equal(result[1].stock.length, 0);
});

test('retained exact-name sets remain unproven and ambiguous inventories are preserved', () => {
  const result = inv([[1, { shopdata: [{ item: 10, stock: 30 }] }], [2, { shopdata: [{ item: 10, stock: 700 }] }]]);
  const comparison = compareShopCandidates(result, { shopItems: { 'Rune store': { 'Air rune': true } } });
  assert.deepEqual(comparison.comparisons[0].exactNameSetInventoryIds, [1, 2]);
  assert.equal(comparison.summary.ambiguousExactNameSet, 1);
  assert.equal(comparison.comparisons[0].additions, null);
  assert.equal(comparison.comparisons[0].removals, null);
});

test('chunk shop declarations preserve sections and declaration values', () => {
  const rows = retainedShopDeclarations({ chunks: { 1: { Shop: { Main: true }, Sections: { 2: { Shop: { Inside: 7 } } } } } });
  assert.deepEqual(rows, [{ address: '1', name: 'Main', value: true }, { address: '1-2', name: 'Inside', value: 7 }]);
});

test('complete dated Wiki witness keeps external membership separate from cache item marks', () => {
  const result = inv([[1, { shopdata: [{ item: 11, stock: 70 }] }]]);
  const reviews = reviewWikiStocks(result, { shopItems: { Store: { 'Water pack': true } } }, {
    pages: [page('Store', [['Water pack', 70, '|members=Yes']])] });
  const runtime = runtimeShopDataset(reviews, {});
  assert.equal(runtime.shops.length, 1);
  assert.equal(runtime.shops[0].stock[0].wikiMembers, true);
  assert.equal(runtime.shops[0].stock[0].membersMarked, true);
  assert.equal(runtime.shops[0].cacheMembers, null);
  assert.equal(runtime.shops[0].wiki.members, false);
  assert.equal(runtime.shops[0].wiki.owner, 'Keeper');
  assert.equal(runtime.shops[0].wiki.currency, null);
  assert.deepEqual(runtime.shops[0].reference.beforeShopItems, { 'Water pack': true });
});

test('quantity disagreement excludes proposed named inventory even when item names all match', () => {
  const result = inv([[1, { shopdata: [{ item: 10, stock: 8 }] }]]);
  const reviews = reviewWikiStocks(result, { shopItems: { Store: { 'Air rune': true } } }, {
    pages: [page('Store', [['Air rune', 4]])] }, { Store: [1] });
  assert.equal(reviews[0].status, 'incomplete-or-disagrees');
  assert.equal(reviews[0].mismatches.length, 1);
  assert.equal(runtimeShopDataset(reviews, {}).shops.length, 0);
});

test('paid and free repeated item rows need a complete quantity multiset across inventories', () => {
  const result = inv([[1, { shopdata: [{ item: 10, stock: 2100 }] }], [2, { shopdata: [{ item: 10, stock: 30 }] }]]);
  const snapshot = { pages: [page('Store', [['Air rune', 30], ['Air rune', 2100]])] };
  const reviews = reviewWikiStocks(result, { shopItems: { Store: { 'Air rune': true } } }, snapshot, { Store: [1, 2] });
  assert.equal(reviews[0].status, 'reviewed-complete-stock');
  assert.deepEqual(runtimeShopDataset(reviews, {}).shops[0].stock.map(row => row.baseStock), [2100, 30]);
  const incomplete = reviewWikiStocks(result, {}, snapshot, { Store: [1] });
  assert.equal(incomplete[0].status, 'incomplete-or-disagrees');
});

test('duplicate multiplicity and surplus rows cannot be hidden by a set match', () => {
  const result = inv([[1, { shopdata: [{ item: 10, stock: 30 }, { item: 12, stock: 1 }] }]]);
  const reviews = reviewWikiStocks(result, {}, { pages: [page('Store', [['Air rune', 30], ['Air rune', 30]])] }, { Store: [1] });
  assert.equal(reviews[0].mismatches.length, 1);
  assert.equal(reviews[0].extraRows[0].name, 'Empty pot');
  assert.equal(reviews[0].status, 'incomplete-or-disagrees');
});

test('automatic exact-stock match refuses indistinguishable inventory definitions', () => {
  const result = inv([[1, { shopdata: [{ item: 10, stock: 30 }] }], [2, { shopdata: [{ item: 10, stock: 30 }] }]]);
  const reviews = reviewWikiStocks(result, {}, { pages: [page('Store', [['Air rune', 30]])] });
  assert.deepEqual(reviews[0].inventoryIds, [1, 2]);
  assert.equal(reviews[0].status, 'incomplete-or-disagrees');
});

test('missing Wiki, missing pages and nonnumeric stocks never produce runtime shops', () => {
  assert.deepEqual(reviewWikiStocks([], {}, null), []);
  const witness = parseWikiShopPage(page('Store', [['Air rune', 'Unlimited']]));
  assert.equal(witness.stock[0].baseStock, null);
  const reviews = reviewWikiStocks(inv([[1, { shopdata: [{ item: 10, stock: 30 }] }]]), {}, {
    pages: [{ title: 'Missing', missing: true }, page('Store', [['Air rune', 'Unlimited']])] }, { Store: [1] });
  assert.equal(runtimeShopDataset(reviews, {}).shops.length, 0);
});

test('typed references distinguish inventory semantics from numeric coincidences', () => {
  const params = new Map([[1, { type: { vartype: 39 } }], [2, { type: { vartype: 0 } }]]);
  const scan = scanTypedReferences({ params, enums: new Map([[1, { key_type2: 0, value_type2: 39, intArrayValue1: [[0, 7]] }]]),
    structs: new Map([[1, { extra: [{ prop: 2, intvalue: 7 }] }], [2, { extra: [{ prop: 1, intvalue: 7 }] }]]),
    npcs: new Map([[3, { name: 'Keeper', extra: [{ prop: 2, intvalue: 7 }] }]]) }, [{ id: 7, shopdataPresent: true }]);
  assert.equal(scan.structInventoryReferences.length, 1);
  assert.equal(scan.structInventoryReferences[0].id, 2);
  assert.equal(scan.npcInventoryReferences.length, 0);
  assert.deepEqual(scan.inventoryEnums[0].stockInventoryRefs, [[0, 7]]);
});

test('raw script ASCII scanner reports byte offsets without assigning opcode semantics', () => {
  const bytes = Buffer.from([0, 83, 104, 111, 112, 0, 65, 66, 255, 83, 116, 111, 114, 101]);
  assert.deepEqual(printableSpans(bytes), [{ offset: 1, text: 'Shop' }, { offset: 9, text: 'Store' }]);
});

test('committed shop review and runtime bind the exact LF extractor and retained reference', () => {
  const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url));
  const review = JSON.parse(bytes('docs/research/cache-game-data-shops.2026-10-08.v1.json'));
  const runtimeBytes = bytes('app/data/cache-shops.2026-10-08.v1.json'), runtime = JSON.parse(runtimeBytes);
  assert.equal(review.runtime.sha256, sha256RepositoryText(runtimeBytes));
  assert.equal(review.extractor.sha256, sha256RepositoryText(bytes('scripts/cache/game-data-shops.mjs')));
  assert.equal(runtime.provenance.extractor.sha256, review.extractor.sha256);
  assert.equal(review.reference.sha256, sha256RepositoryText(bytes('rs3-chunkpicker-chunkinfo-export.json')));
  assert.equal(runtime.provenance.reference.sha256, review.reference.sha256);
  for (const shop of runtime.shops) {
    const witness = review.wikiReviews.find(row => row.name === shop.name);
    assert.equal(witness.status, 'reviewed-complete-stock');
    assert.equal(witness.wikiRows, shop.stock.length);
    assert.equal(shop.wiki.revisionId, witness.revisionId);
    assert.deepEqual(witness.mismatches, []);
  }
});
