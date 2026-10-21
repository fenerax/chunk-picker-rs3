import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { applyCacheShops, cacheShopContentsEnabled } from '../app/data/cache-shops.mjs';
import { npcMetadataPayload, lookupNpcMetadata } from '../app/data/cache-npcs.mjs';
import { previewNpcsAndShops } from '../scripts/preview-npcs-and-shops.mjs';
import { duoFixture } from './fixtures/partner.mjs';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import shops from '../app/data/cache-shops.2026-10-08.v1.json' with { type: 'json' };

const review = stock => ({ name: 'Wares', confidence: 'reviewed-complete-stock', stock,
  reference: { beforeShopItems: { 'Partner sword': true } } });
const stock = [{ name: 'Replacement sword', itemId: 1, baseStock: 5 }, { name: 'Sold-out item', itemId: 2, baseStock: 0 }];

test('shop contents default OFF and preserve custom drift, identities and locations', () => {
  const { data } = duoFixture();
  const original = JSON.stringify(data);
  assert.equal(cacheShopContentsEnabled(), process.env.RS3_CACHE_SHOP_CONTENTS === '1');
  assert.equal(applyCacheShops(data, { enabled: false, shops: [review(stock)] }), data);
  const after = applyCacheShops(data, { enabled: true, shops: [review(stock)] });
  assert.deepEqual(after.shopItems.Wares, { 'Replacement sword': true });
  assert.equal(after.chunks, data.chunks);
  assert.equal(after.challenges, data.challenges);
  assert.equal(JSON.stringify(data), original);
  assert.equal(applyCacheShops(after, { enabled: true, shops: [review(stock)], strict: true }), after);
  const custom = { ...data, shopItems: { Wares: { Custom: true } } };
  assert.equal(applyCacheShops(custom, { enabled: true, shops: [review(stock)] }), custom);
  assert.throws(() => applyCacheShops(custom, { enabled: true, shops: [review(stock)], strict: true }), /drift/);
  assert.equal(applyCacheShops(data, { enabled: true, shops: [{ ...review(stock), confidence: 'candidate' }] }), data);
});

test('fixture preview reports source losses, own-map obligations and collection changes per member', () => {
  const { data, state } = duoFixture();
  state.members[1].taskRules = { 'All Shops': true };
  data.challenges.Extra.ReplacementItem = { Items: ['Replacement sword'] };
  const input = JSON.stringify({ data, state });
  const result = previewNpcsAndShops({ state, definitions: data, shops: [review(stock)] });
  assert.deepEqual(result.changedShops, ['Wares']);
  assert.equal(result.members.length, 2);
  for (const member of result.members) {
    assert(member.availability.addedItems.includes('Replacement sword'));
    assert(member.availability.removedItems.includes('Partner sword'));
    assert(member.changedTaskCount > 0);
    assert(member.tasks.some(row => row.label === 'PartnerItem' && row.before.status === 'available' && row.after.status === 'blocked'));
    assert(member.tasks.some(row => row.label === 'ReplacementItem' && row.before.status === 'blocked' && row.after.status === 'available'));
    assert(!member.availability.addedItems.includes('Sold-out item'));
  }
  assert(result.members.find(row => row.id === 'player2').availability.removedOwnItems.includes('Partner sword'));
  assert(result.members.find(row => row.id === 'player2').tasks.some(row => row.label.includes('Replacement sword') && row.before === null));
  assert(result.members.find(row => row.id === 'player2').tasks.some(row => row.label.includes('Partner sword') && row.after === null));
  assert.equal(JSON.stringify({ data, state }), input);
});

test('NPC metadata keeps variant and membership unknowns and rejects stale reviewed IDs', () => {
  const spider = lookupNpcMetadata('Giant spider');
  assert.equal(spider.members, null);
  assert.equal(spider.consensusCombatLevel, null);
  assert(spider.candidates.some(row => row.combatLevel === 4));
  assert.equal(spider.reviewedMetadata, undefined);
  assert.equal(lookupNpcMetadata('Invented monster'), null);
  const data = { records: { A: { candidates: [{ id: 1, combatLevel: 16 }], consensusCombatLevel: 16 } } };
  const correction = { label: 'A', combatLevel: 16, cacheIds: [2] };
  assert.equal(npcMetadataPayload({ data, corrections: [correction] }).records.A.reviewedMetadata, undefined);
  correction.cacheIds = [1];
  assert.equal(npcMetadataPayload({ data, corrections: [correction] }).records.A.reviewedMetadata.combatLevel, 16);
});

test('preview reports a lost shop source when another source still supplies the item', () => {
  const { data, state } = duoFixture();
  data.shopItems.Wares = { Gem: true };
  state.members.forEach(member => { member.taskRules = {}; });
  const shops = [{ ...review([]), reference: { beforeShopItems: { Gem: true } } }];
  const result = previewNpcsAndShops({ state, definitions: data, shops });
  for (const member of result.members) {
    assert.deepEqual(member.availability.removedItems, []);
    const change = member.availability.changedItemSources.find(row => row.name === 'Gem');
    assert(change.before.some(row => row.kind === 'shop'));
    assert(!change.after.some(row => row.kind === 'shop'));
    assert(change.after.some(row => row.kind === 'drop'));
  }
});

test('preview retains hidden equipment duties when BiS display is disabled', () => {
  const { data, state } = duoFixture();
  state.members.forEach(member => { member.taskRules = { 'Show Best in Slot Tasks': false }; });
  const result = previewNpcsAndShops({ state, definitions: data, shops: [review([])] });
  const duty = result.members.find(row => row.id === 'player2').tasks.find(row => row.label === 'Obtain a Partner sword');
  assert(duty, 'Lost hidden equipment duty must appear in preview');
  assert.equal(duty.before.hidden, true);
  assert.equal(duty.before.obligation, true);
  assert.equal(duty.after, null);
});

test('committed stock reviews apply to retained preconditions, with complete Wiki and cache receipts', () => {
  const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  assert(shops.shops.length > 0);
  const after = applyCacheShops(definitions, { enabled: true, strict: true });
  assert.equal(after.chunks, definitions.chunks);
  for (const shop of shops.shops) {
    assert.equal(shop.confidence, 'reviewed-complete-stock');
    assert(shop.inventoryIds.length > 0);
    assert(Number.isSafeInteger(shop.wiki.revisionId));
    assert.match(shop.wiki.url, /runescape\.wiki/);
    assert.equal(shop.cacheCurrency, null);
    assert.equal(shop.cacheMembers, null);
    assert.deepEqual(shop.cacheKeeperNpcIds, []);
    assert(shop.stock.every(row => Number.isSafeInteger(row.itemId) && Number.isSafeInteger(row.baseStock)));
  }
});

test('NPC/shop endpoint is authenticated, cached and leaves gameplay revision unchanged', async t => {
  const root = path.resolve(import.meta.dirname, '../.local/npcshops-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const app = await createServer({ port: 0, dataDir: directory,
    definitions: { chunks: { '12339': {} }, sections: {}, walkableChunks: ['12339'], walkableChunksF2P: ['12339'] },
    taskMap: {}, initialState: createGroupState([{ id: 'fixture', name: 'Fixture' }]) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen();
  const url = new URL(app.inviteUrl), headers = { authorization: `Bearer ${url.pathname.split('/').at(-1)}` };
  assert.equal((await fetch(`${url.origin}/api/npcs-and-shops`)).status, 401);
  const before = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  const response = await fetch(`${url.origin}/api/npcs-and-shops`, { headers });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.npcs.metadataOnly, true);
  assert.equal(data.npcs.spawnPositions, null);
  assert.equal(data.npcs.records['Giant spider'].members, null);
  assert(data.shops.shops.length > 0);
  assert.equal((await fetch(`${url.origin}/api/npcs-and-shops`, { headers: { ...headers, 'if-none-match': response.headers.get('etag') } })).status, 304);
  const after = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  assert.equal(before.state.revision, after.state.revision);
});
