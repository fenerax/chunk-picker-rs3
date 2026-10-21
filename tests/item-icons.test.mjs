import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractItemNames, inventoryImageFile, selectInventoryImage, exportItemIcons, inventoryByteProvenance, deliveryUploadComparison } from '../scripts/export-item-icons.mjs';
import { parseEquipmentWikiPage } from '../scripts/research/equipment-wiki.mjs';

const page = (title, content) => parseEquipmentWikiPage({title,revisions:[{revid:1,timestamp:'2026-10-08T00:00:00Z',slots:{main:{content}}}]});

test('item extraction follows aliases, outputs, section spawns and named shop stock without treating task labels as items', () => {
  const result=extractItemNames({equipment:{'Rune platebody':{}},codeItems:{itemsPlus:{'Axes[+]':['Bronze hatchet','Iron hatchet']}},skillItems:{Cooking:{FishTable:{'Raw trout':{}}}},
    challenges:{Cooking:{'Catch a fish':{Items:['Axes[+]x2','Hammer*','Unknown[+]'],Output:'FishTable'},'Equip tools':{Items:['Bronze hatchet'],Category:['BIS Skilling']},'Use oven':{'Output Object':'Oven'},'Burn logs':{Output:'Ashes','Output Object':'Player fire'}}},
    chunks:{1:{Spawn:{Coins:1},Sections:{1:{Spawn:{'Raw shrimps':1},Shop:{Fishmonger:true}}}}},shopItems:{Fishmonger:{'Raw sardine':true,'Raw herring':false},Unreachable:{Lobster:true}}});
  assert.deepEqual(result.names,['Ashes','Bronze hatchet','Coins','Hammer','Iron hatchet','Raw sardine','Raw shrimps','Raw trout','Rune platebody']);
  assert.deepEqual(result.categories.bisGoals,['Bronze hatchet']);
  assert.deepEqual(result.excluded,[{name:'Unknown[+]',reason:'unresolved-declarative-item-selector'}]);
});

test('inventory file extraction rejects dynamic or multiple file expressions', () => {
  assert.equal(inventoryImageFile('[[File:Rune_platebody.png]]'),'File:Rune platebody.png');
  assert.equal(inventoryImageFile('Bronze dagger.png'),'File:Bronze dagger.png');
  assert.equal(inventoryImageFile('[[File:One.png]] [[File:Two.png]]'),null);
  assert.equal(inventoryImageFile('{{Inventory image|Something}}'),null);
});

test('CDN-delivered PNG hashes can differ from the stored upload while dimensions remain bound', () => {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=','base64');
  const info={width:1,height:1,size:100,sha1:'0'.repeat(40)},headers={'cf-polished':'ok, orig_size=100'};
  const result=inventoryByteProvenance(png,info,headers);
  assert.notEqual(result.downloadSha1,info.sha1);assert.equal(result.wikiSha1,info.sha1);assert.equal(result.wikiUploadBytes,100);assert.deepEqual(result.getResponseHeaders,headers);
  assert.throws(()=>inventoryByteProvenance(png,{...info,width:2}),/dimensions differ/);
  assert.throws(()=>inventoryByteProvenance(Buffer.from('not png'),info),/not a PNG/);
  assert.deepEqual(deliveryUploadComparison({one:{file:'one.png',source:result},two:{file:'one.png',source:result}}),{sourceRecordsChecked:2,sourceRecordsMatching:0,sourceRecordsDifferent:2,uniquePngFilesChecked:1,uniquePngFilesWithAnyDifferentUploadHash:1});
});

test('selector expansion prefers an exact key and rejects multiple case-insensitive aliases', () => {
  const result=extractItemNames({codeItems:{itemsPlus:{'Axes[+]':['Bronze hatchet'],'axes[+]':['Iron hatchet']}},challenges:{Woodcutting:{One:{Items:['Axes[+]','AXES[+]']}}}});
  assert.deepEqual(result.names,['Bronze hatchet']);
  assert.deepEqual(result.excluded,[{name:'AXES[+]',reason:'ambiguous-declarative-item-selector'}]);
});

test('task unlock metadata can introduce shop stock and spawns absent from chunks', () => {
  const result=extractItemNames({chunks:{1:{Shop:{MissingShop:1}}},taskUnlocks:{Shops:{TicketExchange:{1:true},'Ignored^selector':{1:true}},Spawns:{'New item':{1:true}}},shopItems:{TicketExchange:{'Ballista base':true}}});
  assert.deepEqual(result.names,['Ballista base','New item']);
  assert.deepEqual(result.shopCoverage,{namedShops:2,withoutStock:['MissingShop']});
});

test('verified cache ID selects only its reviewed suffix and image', () => {
  const parsed=page('Weapon','{{Infobox Item|name=Weapon|id1=123|version1=New|image1=[[File:New.png]]|id2=124|version2=Used|image2=[[File:Used.png]]}}');
  const identity={status:'verified',cacheId:124,variant:'Used',wiki:{itemSuffix:'2'}};
  const result=selectInventoryImage('Weapon',parsed,identity);
  assert.equal(result.fileTitle,'File:Used.png');assert.equal(result.itemId,124);assert.equal(result.identityMethod,'verified-cache-wiki-variant');
  assert.equal(selectInventoryImage('Weapon',parsed,{...identity,cacheId:999}).reason,'verified-variant-not-present-in-snapshot');
});

test('exact item name with differing variant images stays unmatched; shared image does not establish ID', () => {
  const ambiguous=page('Weapon','{{Infobox Item|name=Weapon|id1=123|version1=New|image1=[[File:New.png]]|id2=124|version2=Used|image2=[[File:Used.png]]}}');
  assert.equal(selectInventoryImage('Weapon',ambiguous).reason,'ambiguous-variant-inventory-image');
  const shared=page('Weapon','{{Infobox Item|name=Weapon|image=[[File:Weapon.png]]|id1=123|version1=New|id2=124|version2=Used}}');
  const result=selectInventoryImage('Weapon',shared);assert.equal(result.fileTitle,'File:Weapon.png');assert.equal(result.itemId,null);
});

test('quantity-dependent inventory image lists require a quantity instead of choosing the first file', () => {
  const coins=page('Coins','{{Infobox Item|name=Coins|id=995|image=[[File:Coins 1.png]] [[File:Coins 1000.png]]}}');
  assert.equal(selectInventoryImage('Coins',coins).reason,'multiple-inventory-images');
});

test('unrelated infobox name and conflicting image never become an exact-name match', () => {
  assert.equal(selectInventoryImage('Other',page('Weapon','{{Infobox Item|name=Weapon|image=[[File:Weapon.png]]|id=1}}')).reason,'no-exact-item-name-variant');
  assert.equal(selectInventoryImage('Weapon',page('Weapon','{{Infobox Item|name=Unrelated|image=[[File:Other.png]]|id=1}}')).reason,'no-exact-item-name-variant');
  assert.equal(selectInventoryImage('Weapon',page('Weapon','{{Infobox Item|name=Weapon|image=[[File:Weapon.png]]|image=[[File:Other.png]]|id=1}}')).reason,'no-exact-item-name-variant');
});

test('export refuses a finalized existing manifest before any network fetch or output writes', async () => {
  await assert.rejects(exportItemIcons({manifestPath:fileURLToPath(new URL('../package.json',import.meta.url)),assetDirectory:'unused-finalized-output-test'}),/Finalized manifest already exists/);
});

test('versioned item manifest has bounded filenames, per-file provenance, complete category accounting and no unreviewed cache IDs', async () => {
  const manifest=JSON.parse(await readFile(new URL('../app/data/item-icons.2026-10-08.v1.json',import.meta.url),'utf8'));
  const review=JSON.parse(await readFile(new URL('../docs/research/cache-equipment-corrections.2026-10-08.v1.json',import.meta.url),'utf8'));
  const verified=new Map(review.identityReview.filter(x=>x.status==='verified').map(x=>[x.name,x.cacheId]));
  assert.equal(manifest.kind,'items');assert.equal(manifest.schemaVersion,1);assert.equal(manifest.coverage.mapped,Object.keys(manifest.icons).length);
  assert.match(manifest.source.hashScopes.downloadSha1,/response body bytes/);assert.match(manifest.source.hashScopes.wikiSha1,/stored upload/);
  const files=new Map();
  for(const [name,icon] of Object.entries(manifest.icons)) {
    assert.match(icon.file,/^[A-Za-z0-9_-]+\.png$/);assert.match(icon.sha256,/^[a-f0-9]{64}$/);assert.ok(icon.width>0&&icon.height>0&&icon.bytes>0);
    assert.ok(Array.isArray(icon.aliases));assert.equal(icon.source.kind,'wiki-inventory');assert.match(icon.source.filePageUrl,/^https:\/\/runescape\.wiki\/w\/File/);
    assert.ok(icon.source.timestamp);assert.match(icon.source.licenseNote,/Jagex/);assert.ok(icon.source.fileRevisionId);
    assert.match(icon.source.downloadSha1,/^[a-f0-9]{40}$/);assert.equal(icon.width,icon.source.wikiUploadWidth);assert.equal(icon.height,icon.source.wikiUploadHeight);
    if(icon.itemId!==undefined) assert.equal(icon.itemId,verified.get(name));
    if(icon.source.identityMethod==='exact-name-infobox') assert.equal(icon.source.infoboxName,name);
    files.set(icon.file,icon);
  }
  assert.equal(manifest.uniqueFiles,files.size);assert.equal(manifest.totalBytes,[...files.values()].reduce((n,x)=>n+x.bytes,0));
  assert.deepEqual(manifest.source.deliveryUploadComparison,deliveryUploadComparison(manifest.icons));
  for(const category of Object.values(manifest.coverage.byCategory)) assert.ok(category.mapped<=category.requested);
  assert.equal(manifest.icons['Rune platebody'].itemId,45543);
  assert.equal(manifest.coverage.unmatchedRequested,manifest.coverage.requested-manifest.coverage.mapped);
  assert.equal(manifest.coverage.excludedSelectors,manifest.unmatched.filter(x=>x.requested===false).length);
  const requested=extractItemNames(JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url),'utf8')));
  assert.equal(manifest.coverage.requested,requested.names.length);
  const unmatched=new Set(manifest.unmatched.map(x=>x.name));
  for(const name of requested.names) assert.ok(manifest.icons[name]||unmatched.has(name),`Unaccounted ${name}`);
});
