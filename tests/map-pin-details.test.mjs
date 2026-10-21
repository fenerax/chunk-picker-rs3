import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyMapPinDetails } from '../app/data/map-pin-details.mjs';
import MAP_PIN_DETAILS from '../archive/data/map-pin-details.2026-10-08.v1.json' with { type: 'json' };
import { buildMapPinDetails } from '../scripts/build-map-pin-details.mjs';
import { categoryForCachePin } from '../app/data/map-pin-categories.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../app/data/${name}`, import.meta.url)));
const input = read('map-pin-details.inputs.2026-10-08.v1.json');
const wiki = read('map-pin-details.wiki.2026-10-08.v1.json');
// The original generator and v1 evidence remain independently reproducible.
const mapPinDetailForId = id => MAP_PIN_DETAILS.pins.find(pin => pin.id === id) ?? null;
const at = (x,y,category) => mapPinDetailForId(input.pins.find(p=>p.x===x&&p.y===y&&(!category || categoryForCachePin(p).id===category)).id);
const names = detail => detail.resources.map(r=>r.name);

test('every immutable cache pin has one detail with explicit evidence and unknowns', () => {
  assert.equal(input.pins.length, 2994);
  assert.equal(MAP_PIN_DETAILS.pins.length, 2994);
  assert.deepEqual(new Set(MAP_PIN_DETAILS.pins.map(p=>p.id)), new Set(input.pins.map(p=>p.id)));
  assert.equal(new Set(MAP_PIN_DETAILS.pins.map(p=>p.id)).size, 2994);
  for (const pin of MAP_PIN_DETAILS.pins) {
    assert.ok(pin.title && pin.description && pin.categoryLabel);
    assert.ok([true,false,null].includes(pin.members));
    assert.ok(['basic','specific'].includes(pin.specificity));
    assert.ok(pin.provenance.some(p=>p.kind==='cache-pin'&&p.pinId===pin.id));
    assert.ok(pin.unknowns.length>0);
    assert.ok(Array.isArray(pin.resources)&&Array.isArray(pin.destinations));
    for (const destination of pin.destinations) for (const key of ['x','y','plane','mapId']) assert.ok(Number.isInteger(destination[key]));
  }
});

test('coverage exactly distinguishes category labels from specific evidence', () => {
  assert.equal(MAP_PIN_DETAILS.coverage.specific, 1282);
  assert.equal(MAP_PIN_DETAILS.coverage.basic, 1712);
  assert.equal(MAP_PIN_DETAILS.coverage.provenance, 2994);
  assert.deepEqual(MAP_PIN_DETAILS.coverage.categories['fishing-spot'], {total:81,basic:9,specific:72,provenance:81});
  assert.deepEqual(MAP_PIN_DETAILS.coverage.categories['mining-site'], {total:98,basic:30,specific:68,provenance:98});
  assert.deepEqual(MAP_PIN_DETAILS.coverage.categories['rare-tree'], {total:44,basic:2,specific:42,provenance:44});
  for (const [category, count] of Object.entries(MAP_PIN_DETAILS.coverage.categories)) {
    const pins=MAP_PIN_DETAILS.pins.filter(p=>p.categoryId===category);
    assert.equal(pins.length,count.total);
    assert.equal(count.basic+count.specific,count.total);
    assert.equal(count.provenance,count.total);
  }
});

test('bounded Wiki site joins provide ordinary river, seashore and crayfish catches', () => {
  for (const [x,y] of [[3239,3248],[3108,3431]]) {
    const detail=at(x,y,'fishing-spot');
    assert.deepEqual(names(detail),['Raw trout','Raw salmon','Raw rainbow fish','Raw pike']);
    assert.equal(detail.members,false);
    assert.equal(detail.resources.find(r=>r.name==='Raw rainbow fish').members,true);
    assert.match(detail.description,/Fly fishing rod or Fishing rod/);
    assert.match(detail.description,/rainbow fish \(members; stripy feathers\)/);
    assert.ok(detail.resources.every(r=>r.scope==='reviewed-local-site'));
  }
  assert.deepEqual(names(at(3085,3228,'fishing-spot')),['Raw shrimps','Raw anchovies','Raw sardine','Raw herring']);
  assert.deepEqual(names(at(3260,3204,'fishing-spot')),['Raw crayfish']);
  assert.deepEqual(names(at(2926,3177,'fishing-spot')),['Raw lobster','Raw tuna','Raw swordfish']);
});

test('distinct encoded marker types prevent nearest-coordinate fishing mistakes', () => {
  assert.deepEqual(names(at(4016,4250,'fishing-spot')),['Raw trout','Raw salmon','Raw rainbow fish','Raw pike']);
  assert.deepEqual(names(at(4019,4252,'fishing-spot')),['Raw lobster','Raw tuna','Raw swordfish']);
  assert.match(at(2606,3417,'fishing-spot').resources[0].fishingSpotType,/big fishing net/);
  assert.equal(at(4105,4135,'fishing-spot').specificity,'basic');
  for (const detail of MAP_PIN_DETAILS.pins.filter(p=>p.categoryId==='fishing-spot'&&p.specificity==='specific')) {
    const evidence=detail.provenance.find(p=>p.kind==='wiki-fishing-site');
    assert.ok(evidence.distanceTiles<=12);
    assert.match(evidence.url,/^https:\/\/runescape\.wiki\/w\//);
    assert.ok(detail.resources.every(r=>r.wikiNpcIds.length&&r.methods.length));
  }
  const shark=at(2857,3424,'fishing-spot').resources.find(r=>r.name==='Raw great white shark');
  assert.match(shark.conditions,/tier 5/);
});

test('trees and ores retain same-area placement evidence without claiming travel access', () => {
  for (const detail of MAP_PIN_DETAILS.pins.filter(p=>['mining-site','rare-tree'].includes(p.categoryId))) {
    const pin=input.pins.find(p=>p.id===detail.id);
    for (const resource of detail.resources) {
      assert.ok(['exact-placement','nearby-area'].includes(resource.scope));
      assert.ok(!resource.classKey.includes(':unknown:'));
      for (const p of resource.coordinates) {
        assert.equal(String(Math.floor(p.x/64)*256+Math.floor(p.y/64)),pin.chunkId);
        assert.ok(Math.hypot(p.x-pin.x,p.y-pin.y)<=32);
      }
    }
    assert.equal(detail.members,null);
  }
  const named=MAP_PIN_DETAILS.pins.find(p=>p.title==='Elder tree');
  assert.ok(named);
  assert.ok(named.provenance.some(p=>p.kind==='cache-object-definition'));
});

test('typed cache lodestones retain names, exact landing coordinates and requirements', () => {
  const detail=MAP_PIN_DETAILS.pins.find(p=>p.title==='Lumbridge Lodestone');
  assert.ok(detail);
  assert.deepEqual({...detail.destinations[0],structIds:undefined},{name:'Lumbridge Lodestone',x:3233,y:3222,plane:0,mapId:28,source:'cache-typed-lodestone-struct',structIds:undefined});
  assert.equal(detail.members,false);
  assert.ok(detail.unknowns.some(s=>s.includes('activation')));
  for (const detail of MAP_PIN_DETAILS.pins.filter(p=>p.categoryId==='transportation'&&p.destinations.length)) assert.equal(detail.destinations[0].coordinateKind,'destination-map-marker');
});

test('unknown shop identities stay basic while verified shops retain their names', () => {
  const shop=at(2096,3903,'general-store');
  assert.equal(shop.title,'General store');
  assert.equal(shop.specificity,'basic');
  assert.ok(shop.unknowns.some(s=>s.includes('Shop identity')));
  const shopNames=MAP_PIN_DETAILS.pins.filter(p=>p.provenance.some(p=>p.kind==='wiki-shop-site')).map(p=>p.title).sort();
  assert.deepEqual(shopNames,["Aubury's Rune Shop","Betty's Magic Emporium",'Lumbridge Fishing Supplies','Lumbridge General Store']);
});

test('quest marker sequence joins are independently corroborated by exact start paths',()=>{
  const quests=MAP_PIN_DETAILS.pins.filter(p=>['quest','quest-in-progress'].includes(p.categoryId));
  assert.equal(quests.length,577);
  assert.ok(quests.every(p=>p.specificity==='specific'));
  assert.equal(quests.filter(p=>p.provenance.find(e=>e.kind==='cache-quest-definition').exactStartCoordinate).length,407);
  const cook=at(3209,3215,'quest');
  assert.equal(cook.title,"Cook's Assistant");assert.equal(cook.members,false);
  const evidence=cook.provenance.find(e=>e.kind==='cache-quest-definition');
  assert.equal(evidence.questId,257);assert.equal(evidence.sequence,1);assert.equal(evidence.exactStartCoordinate,true);
  assert.match(cook.description,/cook in the kitchen of Lumbridge Castle/);
  assert.match(cook.description,/^Cook's Assistant\. Start guidance:/);
  assert.ok(quests.every(p=>!p.description.startsWith('Quest start:')));
});

test('reviewed ferry endpoints remain dock marker coordinates with exact landing unknown',()=>{
  const sarim=at(3029,3219,'transportation'),musa=at(2958,3143,'transportation');
  assert.equal(sarim.title,'Port Sarim – Musa Point ferry');assert.equal(musa.title,'Musa Point – Port Sarim ferry');
  assert.deepEqual([sarim.destinations[0].x,sarim.destinations[0].y],[2958,3143]);
  assert.deepEqual([musa.destinations[0].x,musa.destinations[0].y],[3029,3219]);
  for(const p of [sarim,musa]) {assert.equal(p.members,false);assert.equal(p.destinations[0].kind,'boat');assert.ok(p.unknowns.some(s=>s.includes('Exact ship landing tile is unknown')));assert.ok(p.provenance.some(s=>s.kind==='wiki-boat-route'));}
});

test('retained input generation is deterministic and requires no external files', () => {
  assert.deepEqual(buildMapPinDetails(input,wiki),MAP_PIN_DETAILS);
  const hash = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(MAP_PIN_DETAILS.inputSha256,hash(input));
  assert.equal(MAP_PIN_DETAILS.wikiSha256,hash(wiki));
});

test('generation rejects duplicate identities and invalid surface coordinates',()=>{
  assert.throws(()=>buildMapPinDetails({...input,pins:[input.pins[0],input.pins[0]]},wiki),/Duplicate stable pin ID/);
  assert.throws(()=>buildMapPinDetails({...input,pins:[{...input.pins[0],plane:1}]},wiki),/Invalid surface pin coordinate/);
});

test('detail lookups never use guessed coordinate matches or mutate pins', () => {
  const known={id:input.pins[0].id}, old={id:'mejrs:baseline',x:input.pins[0].x,y:input.pins[0].y};
  const result=applyMapPinDetails([known,old]);
  assert.ok(result[0].detail);
  assert.equal(known.detail,undefined);
  assert.equal(result[1],old);
  assert.equal(mapPinDetailForId('mejrs:baseline'),null);
});
