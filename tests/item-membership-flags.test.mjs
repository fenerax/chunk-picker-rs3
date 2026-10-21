import test from 'node:test';
import assert from 'node:assert/strict';
import { rawItemMembership,rawItemMembershipCatalogue } from '../app/data/item-membership-flags.mjs';
import { itemMembershipCatalogue,itemMembership } from '../app/data/item-membership.mjs';

test('raw flag table retains every decoded ID, including all unnamed/template exclusions',()=>{
  const data=rawItemMembershipCatalogue;
  assert.equal(data.rows.length,63798);assert.equal(new Set(data.rows.map(row=>row[0])).size,63798);
  assert.equal(data.provenance.raw.sha256,itemMembershipCatalogue.provenance.raw.sha256);
  assert.equal(data.summary.rawMembersTrue,26797);assert.equal(data.summary.rawMembersFalse,37001);
  assert.equal(data.summary.unnamedIds,19317);assert.equal(data.summary.templateIds,13797);
  assert.equal(data.summary.namedTemplateIds,0);assert.equal(data.summary.unnamedNonTemplateIds,5520);
  assert.equal(data.summary.namedOrdinaryIds,44481);assert.equal(data.summary.explicitlyFalseFields,0);
  assert.equal(data.rows.filter(row=>row[2]?.includes('unnamed')).length,19317);
  assert.equal(data.rows.filter(row=>row[2]?.some(reason=>reason!=='unnamed')).length,13797);
});

test('ordinary name IDs preserve raw bits and templates never imply a free ordinary identity',()=>{
  for(const entry of itemMembershipCatalogue.entries){
    for(const id of entry.freeIds)assert.equal(rawItemMembership(id).rawMembers,false);
    for(const id of entry.memberIds)assert.equal(rawItemMembership(id).rawMembers,true);
  }
  assert.equal(rawItemMembership(6571).rawMembers,true);assert.equal(itemMembership('Uncut onyx').members,true);
  const template=rawItemMembershipCatalogue.rows.find(row=>row[2]?.includes('noteTemplate'));
  assert.equal(rawItemMembership(template[0]).namePresent,false);assert.ok(rawItemMembership(template[0]).templateFields.includes('noteTemplate'));
  assert.equal(rawItemMembership(-1),null);
});
