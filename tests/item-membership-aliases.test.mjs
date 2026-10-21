import test from 'node:test';
import assert from 'node:assert/strict';
import { itemMembership,pickerEntityMembership,itemMembershipAliasCatalogue,pickerEntityMembershipCatalogue } from '../app/data/item-membership.mjs';
import { wikiAliasItemFacts,resolveWikiItemAlias,wikiCurrencyEntityFacts } from '../scripts/lib/item-membership-alias-evidence.mjs';

const page=text=>({title:'Example',pageid:1,revisions:[{revid:123,timestamp:'2026-10-08T00:00:00Z',slots:{main:{content:text}}}]});

test('reviewed obtainable member aliases resolve literal current Wiki IDs',()=>{
  const cases={'Spirit shards pack':[15262],'Crawling hand (item)':[7975],'Crawling hand':[7975],
    'Broad arrows':[4160],'Broad bolts':[13280],'Bullseye lantern (frame)':[4544],'Bullseye lantern (oil)':[4548],'Bullseye lantern (lit)':[4550],
    'Fancy hedge (bagged)':[8445],'Small box hedge (bagged)':[8441],'Tall box hedge (bagged)':[8449],'Tall fancy hedge (bagged)':[8447],
    'Black robe (top)':[34384],'Black robe (bottom)':[34386],'Royale cannon':[52172]};
  for(const[name,ids]of Object.entries(cases)){const fact=itemMembership(name);assert.equal(fact.members,true,name);assert.deepEqual(fact.resolvedIds,ids,name);assert.ok(fact.wiki.revid>0,name);}
  assert.equal(itemMembership('Ring of Slaying').members,true);
  assert.deepEqual(itemMembership('Ring of Slaying').resolvedIds,[13281,13282,13283,13284,13285,13286,13287,13288]);
});

test('generic ordinary Games necklace stays free and compacted necklace stays members',()=>{
  const ordinary=itemMembership('Games necklace');assert.equal(ordinary.members,false);
  assert.deepEqual(ordinary.resolvedIds,[3853,3855,3857,3859,3861,3863,3865,3867]);
  assert.ok(!ordinary.resolvedIds.includes(41070));assert.equal(itemMembership('Games necklace (c)').members,true);
  assert.equal(itemMembership('games necklace').members,false);
});

test('free alias variants retain exact typed IDs without collapsing stages or colours',()=>{
  assert.deepEqual(itemMembership('Cat').resolvedIds,[1561,1562,1563,1564,1565,1566]);
  assert.deepEqual(itemMembership('Cat').cacheNames,['Pet cat']);
  for(const name of ['Cat','Death guard (tier 10)','Skull lantern (tier 10)','Spider silk wand','Spider silk orb','Off-hand mihril crossbow','Diamond amulet (unstrung)'])assert.equal(itemMembership(name).members,false,name);
  assert.deepEqual(itemMembership('Toy horsey (black)').resolvedIds,[2524]);
  assert.deepEqual(itemMembership('Toy horsey (white)').resolvedIds,[2522]);
  assert.deepEqual(itemMembership('Death guard (tier 10)').resolvedIds,[55502]);
  assert.equal(itemMembership('Death guard (tier 99)').members,null);
});

test('historical alias catalogue retains its original unresolved evidence',()=>{
  for(const name of ['Nothing','Slayer XP','Revenant Spirit#Dragon','Runes for Slayer Dart','Racing boots','Starting horn','Super large egg','Topiary hedge (bagged)','Arrav heraldry'])assert.equal(itemMembership(name,{reviews:null}).members,null,name);
  assert.equal(itemMembershipAliasCatalogue.reviews.length,112);
  assert.deepEqual(itemMembershipAliasCatalogue.summary,{selectedNames:112,queriedTitles:96,resolvedFree:52,resolvedMembers:21,unknown:39,totalAliasEntries:74,supplementaryAliases:1});
});

test('nested Item fields cannot replace outer identity or membership, and unclosed boxes reject',()=>{
  const facts=wikiAliasItemFacts(page('{{Infobox Item\n|name=Example\n|members=No\n|image={{Nested\n|id=999\n|members=Yes\n}}\n|id=7\n}}\n{{Infobox NPC\n|id=999\n|members=Yes\n}}\n{{Infobox Recipe\n|id=999\n|members=Yes\n}}'));
  assert.deepEqual(facts.boxes[0].variants.map(v=>[v.id,v.members]),[[7,false]]);
  assert.equal(wikiAliasItemFacts(page('{{Infobox Item\n|name=Example\n|members=No\n|id=7')).boxes.length,0);
  const raw=new Map([[7,{definition:{name:'Charged example (1)'}}]]);
  assert.equal(resolveWikiItemAlias('Example',facts,raw).members,false);
  assert.equal(resolveWikiItemAlias('Example',facts,new Map([[7,{definition:{name:'Example',members:true}}]])).status,'unknown');
});

test('Wiki alias mixtures, absent IDs, unknown flags and templates all reject',()=>{
  const raw=new Map([[1,{definition:{name:'Example'}}],[2,{definition:{name:'Example',members:true}}],[3,{definition:{name:'Example',noteTemplate:799}}]]);
  for(const text of ['{{Infobox Item\n|members1=No\n|id1=1\n|members2=Yes\n|id2=2\n}}',
    '{{Infobox Item\n|members=No\n|id=1, 999\n}}','{{Infobox Item\n|members=Perhaps\n|id=1\n}}','{{Infobox Item\n|members=No\n|id=3\n}}'])assert.equal(resolveWikiItemAlias('Example',wikiAliasItemFacts(page(text)),raw).status,'unknown');
});

test('custom catalogues remain isolated from default aliases and virtual entities',()=>{
  const catalogue={entries:[]};
  assert.equal(itemMembership('Games necklace',{catalogue}).members,null);
  assert.equal(pickerEntityMembership('Slayer points',{catalogue}).members,null);
  assert.equal(itemMembership('Games necklace',{catalogue,aliases:itemMembershipAliasCatalogue}).members,false);
});

test('virtual Slayer points are free while physical cache token remains members',()=>{
  const physical=itemMembership('Slayer points');assert.equal(physical.members,true);assert.ok(physical.candidateIds.includes(50250));
  const virtual=pickerEntityMembership('Slayer points');assert.equal(virtual.members,false);assert.equal(virtual.entityKind,'currency');assert.equal(virtual.wiki.revid,37162661);
  assert.deepEqual(virtual.excludedPhysicalItems.map(row=>[row.id,row.members]),[[50250,true]]);
  assert.equal(pickerEntityMembership('Unreviewed reward currency').members,null);
  assert.equal(pickerEntityMembership('slayer points').entityKind,undefined); // exact reviewed canonical entity only
  assert.equal(pickerEntityMembershipCatalogue.entries.length,1);
  const currency=wikiCurrencyEntityFacts(page('{{Infobox Currency\n|name=Points\n|image={{nested\n|members=Yes\n}}\n|members=No\n}}'));
  assert.equal(currency.boxes[0].fields.members,'No');
});
