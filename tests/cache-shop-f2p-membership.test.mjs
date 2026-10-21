import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { collectBaseItemSources } from '../app/tasks/access.mjs';
import shops from '../app/data/cache-shops.2026-10-08.v1.json' with { type: 'json' };

const shop = "Beefy Bill's Supplies", pack = 'Jug of water pack', water = 'Jug of water';
const reviewed = shops.shops.find(row => row.name === shop);
const label = 'Open a jug of water pack*';

function fixture(f2p) {
  const definitions = {
    chunks: { '12595': { Shop: { [shop]: true } } }, sections: { '12595': { 0: [] } },
    walkableChunks: ['12595'], walkableChunksF2P: ['12595'],
    shopItems: { [shop]: { ...reviewed.reference.beforeShopItems } }, codeItems: {},
    challenges: { Nonskill: { [label]: { Items: [`${pack}*`], Output: water } } },
  };
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic', unlocked: ['12595'] }]);
  state.rules['content.f2p'] = f2p;
  state.members[0].taskRules = { 'All Shops': true };
  return { definitions, state };
}

test('reviewed Beefy Bill evidence distinguishes member stock from the free shop', () => {
  assert.equal(reviewed.wiki.members, false);
  const row = reviewed.stock.find(row => row.name === pack);
  assert.equal(row.membersMarked, true);
  assert.equal(row.wikiMembers, true);
  assert.equal(reviewed.wiki.revisionId, 37117521);
});

for (const cacheShops of [false, true]) for (const f2p of [true, false]) {
  test(`Beefy Bill pack source, opening task and All Shops goal respect F2P=${f2p}, cacheShops=${cacheShops}`, () => {
    const { definitions, state } = fixture(f2p);
    const original = JSON.stringify({ definitions, state });
    const result = createTaskEngine(definitions, {
      cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops,
    }).evaluate(state, 'synthetic');
    const collections = createCollectionEngine(definitions, { cacheShops }).evaluate(state, 'synthetic', result);
    assert(result.access.shops.includes(shop));
    assert.equal(result.items.some(row => row.name === pack), !f2p);
    assert.equal(result.tasks.find(row => row.rawLabel === label).status, f2p ? 'blocked' : 'available');
    assert.equal(collections.tasks.some(row => row.item === pack && row.collectionSource === shop), !f2p);
    const stockItems = result.items.filter(row => row.sources.some(source => source.kind === 'shop' && source.source === shop)).map(row => row.name).sort();
    assert.deepEqual(stockItems, Object.keys(definitions.shopItems[shop]).filter(name => !f2p || name !== pack).sort());
    assert(result.items.some(row => row.name === water && row.sources.some(source => source.kind === 'shop' && source.source === shop)));
    assert(collections.tasks.some(row => row.item === water && row.collectionSource === shop));
    if (f2p) assert(result.diagnostics.some(row => row.code === 'members-only-source' && row.item === pack && row.source === shop));
    assert.equal(JSON.stringify({ definitions, state }), original);
  });
}

test('member item flags exclude alternate spawns as well as the witnessed purchase source', () => {
  const { definitions } = fixture(true);
  definitions.taskUnlocks = { Shops: { [`${shop}^${pack}`]: { '12595': true } } };
  const access = {
    shops: new Set([shop]), spawns: new Map([[pack, 1]]), monsters: new Set(), objects: new Set(),
    bases: new Set(['12595']), sections: new Set(), areas: new Set(),
    locations: new Map([[`Shop:${shop}`, ['12595']], [`Spawn:${pack}`, ['synthetic alternate source']]]),
  };
  const result = collectBaseItemSources(definitions, access, { rules: { F2P: true } });
  assert.equal(result.items.has(pack), false);
  assert.equal(result.sources.has(pack), false);
  assert(result.diagnostics.some(row => row.code === 'members-only-item' && row.item === pack && row.sourceKind === 'spawn'));
  assert(result.diagnostics.some(row => row.code === 'members-only-source' && row.item === pack && row.source === shop));
  assert(result.sources.get(water).some(row => row.kind === 'shop' && row.source === shop));
  const members = collectBaseItemSources(definitions, access, { rules: { F2P: false } });
  assert(members.sources.get(pack).some(row => row.kind === 'spawn'));
  assert(members.sources.get(pack).some(row => row.kind === 'shop'));
});
