import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemMembership, itemMembershipCatalogue, buildItemMembershipIndex } from '../app/data/item-membership.mjs';
import { createItemMembershipLookup } from '../app/data/item-membership-index.mjs';
import { wikiItemFacts, crosscheckItemMembership } from '../scripts/lib/item-membership-evidence.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

test('dated raw membership catalogue preserves cache IDs and input provenance',()=>{
  const data=itemMembershipCatalogue;
  assert.equal(data.summary.decodedRows,63798);
  assert.equal(data.provenance.reference.sha256,sha256RepositoryText(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url))));
  assert.equal(data.provenance.wiki.schema.opcode,'0x10');
  assert.equal(data.provenance.wiki.schema.exportSchemaSha256,data.provenance.decoder.schemaHashes['items.jsonc']);
  assert.equal(data.entries.length,data.summary.namedEntries);
  assert.equal(new Set(data.entries.map(e=>e.name)).size,data.entries.length);
  for(const entry of data.entries){
    assert.ok(entry.freeIds.length+entry.memberIds.length>0);
    assert.equal(entry.members,entry.freeIds.length&&entry.memberIds.length?null:entry.memberIds.length>0);
    if(entry.wikiResolution){
      assert.equal(entry.members,null); assert.ok(entry.wikiResolution.revid>0);
      assert.ok(entry.wikiResolution.ids.every(id=>(entry.wikiResolution.members?entry.memberIds:entry.freeIds).includes(id)));
    }
  }
});

test('ordinary onyx jewellery/glory resolve exact Wiki IDs while retaining conflicting placeholders',()=>{
  for(const name of ['Onyx','Uncut onyx','Onyx ring','Onyx necklace','Onyx amulet','Onyx bracelet','Amulet of glory','Saradomin staff','Guthix staff','Zamorak staff'])assert.equal(itemMembership(name).members,true,name);
  const ring=itemMembership('Onyx ring'); assert.deepEqual(ring.candidateIds,[6564,6575]);
  assert.deepEqual(ring.resolvedIds,[6575]); assert.equal(ring.cacheMembers,null);
  const glory=itemMembership('Amulet of glory'); assert.deepEqual(glory.resolvedIds,[1704]);
});

test('free magic logs do not classify members products as free',()=>{
  assert.equal(itemMembership('Magic logs').members,false);
  assert.equal(itemMembership('Magic incense sticks').members,false);
  for(const name of ['Magic shortbow','Magic longbow','Magic shortbow (unstrung)','Magic longbow (unstrung)','Magic stock','Magic pyre logs','Magic plank','Magic frame'])assert.equal(itemMembership(name).members,true,name);
});

test('lookup keeps conflict and missing names unknown and only uniquely casefolds',()=>{
  const entries=buildItemMembershipIndex([
    {id:1,definition:{name:'A',members:true}},{id:2,definition:{name:'A'}},
    {id:3,definition:{name:'B',members:true}},{id:4,definition:{name:'B',noteTemplate:799}},
    {id:5,definition:{name:'C',combine_template_old:1}},
    {id:6,definition:{name:'Apple',members:true}},{id:7,definition:{name:'apple'}},
  ]);
  const lookup=createItemMembershipLookup(entries);
  assert.equal(lookup('A').members,null);assert.equal(lookup('b').members,true);
  assert.equal(lookup('C').reason,'unmatched');assert.equal(lookup('APPLE').reason,'ambiguous-casefold');
  assert.equal(lookup('Apple').members,true);assert.equal(lookup('apple').members,false);
  assert.equal(itemMembership('Magic logs*').members,null);
  assert.equal(itemMembership('~|Magic logs|~').members,null);
  assert.equal(itemMembership('Item definitely absent from cache').reason,'unmatched');
});

test('Wiki membership parsing avoids Recipe fields and guards indexed variants/IDs',()=>{
  const page={title:'Thing',pageid:1,revisions:[{revid:123,timestamp:'2026-10-08T00:00:00Z',slots:{main:{content:'{{Infobox Item\n|name=Thing\n|image={{nested|thing}}\n|members1=No\n|members2=Yes\n|id1=10\n|id2=20\n}}\n{{Infobox Recipe\n|members=Yes\n|id=99\n}}'}}}]};
  const facts=wikiItemFacts(page);assert.deepEqual(facts.variants.map(v=>[v.id,v.members]),[[10,false],[20,true]]);
  const rawById=new Map([[10,{definition:{name:'Thing'}}],[20,{definition:{name:'Thing',members:true}}]]);
  const entry={name:'Thing',freeIds:[10],memberIds:[20],members:null};
  assert.equal(crosscheckItemMembership(entry,facts,rawById).status,'ambiguous-wiki-members');
  assert.equal(crosscheckItemMembership(entry,{...facts,variants:[{id:99,members:true}]},rawById).status,'no-matching-explicit-ids');
  assert.equal(crosscheckItemMembership(entry,{...facts,variants:[{id:10,members:true}]},rawById).status,'cache-wiki-disagreement');
  assert.equal(crosscheckItemMembership(entry,{...facts,variants:[{id:20,members:true}]},rawById).status,'conflict-resolved-by-explicit-wiki-ids');
});

test('dated cache/Wiki disagreements stay visible in raw evidence and every runtime conflict is audited',()=>{
  const rawLookup=createItemMembershipLookup(itemMembershipCatalogue.entries);
  for(const check of itemMembershipCatalogue.wikiCrosschecks.filter(c=>c.status==='cache-wiki-disagreement')){
    assert.equal(rawLookup(check.name).members,null,check.name);
    assert.equal(rawLookup(check.name).reason,'cache-wiki-disagreement');
  }
  const checked=new Set(itemMembershipCatalogue.wikiCrosschecks.map(c=>c.name));
  const entries=new Map(itemMembershipCatalogue.entries.map(e=>[e.name,e]));
  for(const row of itemMembershipCatalogue.runtimeCoverage)if(entries.get(row.name)?.members===null)assert.ok(checked.has(row.name),row.name);
});
