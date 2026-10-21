import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemMembership, pickerEntityMembership, itemMembershipCatalogue, itemMembershipReviewCatalogue } from '../app/data/item-membership.mjs';
import { sourceMembershipBlocker } from '../app/data/source-membership.mjs';
import { itemMembershipBlocker } from '../app/tasks/membership.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

test('five wiki decisions preserve the disagreeing cache flags and literal selected IDs', () => {
  const cases = [['Herbert', true, [38095]], ['Medium XP lamp', false, [23714]], ['Sneakerpeeper', true, [19895]],
    ['Wingsuit v1', true, [49381,50120]], ['Wingsuit v2', true, [49382,50121]]];
  for (const [name, members, ids] of cases) {
    const fact = itemMembership(name), raw = itemMembershipCatalogue.entries.find(row => row.name === name);
    assert.equal(fact.members, members, name); assert.equal(fact.reason, 'reviewed-wiki-over-cache-conflict');
    assert.deepEqual(fact.resolvedIds, ids); assert.deepEqual(fact.review.cacheEvidence.freeIds, raw.freeIds);
    assert.deepEqual(fact.review.cacheEvidence.memberIds, raw.memberIds); assert.ok(raw.wikiDisagreement);
    assert.equal(itemMembership(name, { reviews: null }).members, null);
  }
});

test('the 23 residual selector labels have reviewed identities and pinned evidence', () => {
  assert.equal(itemMembershipReviewCatalogue.summary.residualLabels, 23);
  assert.equal(itemMembershipReviewCatalogue.entries.length, 37);
  for (const row of itemMembershipReviewCatalogue.entries) {
    const fact = pickerEntityMembership(row.name);
    assert.notEqual(fact.status, 'unknown', row.name);
    assert.equal(fact.members, row.members, row.name);
    assert.match(fact.wiki.url, /^https:\/\/runescape\.wiki\/w\/Special:PermanentLink\/\d+$/);
  }
  assert.equal(itemMembership('Gold amulet(unstrung)').members, false);
  assert.equal(itemMembership('herbert').members, true);
  assert.equal(itemMembership('timepiece').members, false);
  assert.equal(pickerEntityMembership('slayer xp').status, 'unknown');
  assert.deepEqual(itemMembership('Gold amulet(unstrung)').resolvedIds, [1673]);
  assert.deepEqual(itemMembership('Timepiece').resolvedIds, [15061,15063,15064]);
});

test('seven current copied-save aliases resolve without borrowing Monster IDs or banning free trinkets', () => {
  const cases = [['Dragon trinket',false,[34808]],['Metallic dragon trinket',false,[37193]],
    ['Player-Owned Port enhancer',true,[32719,34171]],['Scroll of excavating',true,[61429]],
    ['Split dragontooth nekclace',true,[19887]],['Crassian scuttler pet',true,[47540,47541]],['Magma golem pet',true,[43395,43396]]];
  for (const [name,members,ids] of cases) {
    const fact = itemMembership(name); assert.equal(fact.members,members,name); assert.deepEqual(fact.resolvedIds,ids,name);
    assert.equal(itemMembershipBlocker(name,false),null);
  }
  assert.equal(itemMembershipBlocker('Dragon trinket',true),null);
  assert.equal(itemMembershipBlocker('Metallic dragon trinket',true),null);
  for (const name of ['Tetch','Micah','Crassian scuttler pet','Magma golem pet']) {
    const fact = itemMembership(name); assert.equal(fact.members,true,name);
    assert.equal(fact.reason,'reviewed-wiki-over-cache-conflict');
    assert(fact.review.cacheEvidence.selected.every(row => row.members === false));
  }
  assert.equal(itemMembershipReviewCatalogue.summary.additionalCopiedSaveLabels,7);
  assert.equal(itemMembershipReviewCatalogue.summary.additionalCacheDisagreements,2);
});

test('progress items select the single Spirit item without turning stage labels into new game IDs', () => {
  for (const stage of ['Dragon','Demon','Dark beast','Icefiend','Vampyre']) {
    const fact = pickerEntityMembership(`Revenant Spirit#${stage}`);
    assert.equal(fact.members, true); assert.deepEqual(fact.resolvedIds, [47660]);
    assert.ok(itemMembershipBlocker(`Revenant Spirit#${stage}`, true));
    assert.equal(itemMembershipBlocker(`Revenant Spirit#${stage}`, false), null);
  }
});

test('virtual rewards and empty rolls do not inherit spell or item membership', () => {
  assert.equal(pickerEntityMembership('Nothing').status, 'not-applicable');
  assert.equal(pickerEntityMembership('Nothing').entityKind, 'empty-outcome');
  assert.equal(pickerEntityMembership('Slayer XP').entityKind, 'experience-reward');
  assert.equal(pickerEntityMembership('Slayer XP').members, false);
  assert.equal(pickerEntityMembership('Runes for Slayer Dart').members, false);
  for (const name of ['Air rune','Death rune','Runes for Slayer Dart','Slayer XP','Nothing','Ceremonial sword']) assert.equal(itemMembershipBlocker(name, true), null, name);
});

test('free upgrade purchases survive while exact member sword creation goals are gated', () => {
  assert.equal(pickerEntityMembership('Ceremonial sword').entityKind, 'method-capability');
  assert.equal(pickerEntityMembership('Ceremonial sword').review.membersToUse, true);
  assert.equal(sourceMembershipBlocker('ShopItem', 'Ceremonial sword', true, "Artisans' Workshop Reward Shop"), null);
  assert.equal(itemMembershipReviewCatalogue.sourceRows.length, 60);
  for (const row of itemMembershipReviewCatalogue.sourceRows) {
    assert.ok(sourceMembershipBlocker('Task', row.source, true, 'Extra'), row.source);
    assert.equal(sourceMembershipBlocker('Task', row.source, false, 'Extra'), null);
  }
  assert.equal(sourceMembershipBlocker('Task', 'Make a hypothetical ceremonial sword', true, 'Extra'), null);
});

test('removed items preserve historical membership separately from current availability', () => {
  for (const name of ['Racing boots','Starting horn','Super large egg']) {
    const fact = itemMembership(name); assert.equal(fact.members, false); assert.match(fact.availability, /^removed-/);
  }
  const hedge = itemMembership('Topiary hedge (bagged)'); assert.equal(hedge.members, true);
  assert.equal(hedge.availability, 'removed-2026-07-13'); assert.deepEqual(hedge.resolvedIds, []);
});

test('review provenance is current and custom catalogues stay isolated', () => {
  for (const input of [itemMembershipReviewCatalogue.provenance.catalogue, itemMembershipReviewCatalogue.provenance.reference,
    itemMembershipReviewCatalogue.provenance.generator,...itemMembershipReviewCatalogue.provenance.libraries]) assert.equal(input.sha256, sha256RepositoryText(readFileSync(new URL(`../${input.path}`, import.meta.url))), input.path);
  const catalogue = { entries: [] };
  for (const name of ['Herbert','Gold amulet(unstrung)','Nothing','Slayer XP','Timepiece']) assert.equal(pickerEntityMembership(name,{catalogue}).status, 'unknown', name);
});
