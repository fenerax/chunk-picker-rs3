import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sha256, sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { sourceMembershipBlocker, sourceMembershipRecord, sourceMembershipRequiredItems, sourceMembershipIncidentalOutput, sourceMembershipCatalogue } from '../app/data/source-membership.mjs';
import { sourceInfobox } from '../scripts/lib/source-membership-evidence.mjs';

test('member resources and monsters are independent of geographic F2P admission', () => {
  assert.equal(sourceMembershipBlocker('Object', 'Magic tree', true).wiki.revisionId, 37158111);
  assert(sourceMembershipBlocker('Monster', 'Black demon', true));
  for (const source of ['Green dragon', 'Chaos Elemental', 'Deadly red spider']) assert.equal(sourceMembershipBlocker('Monster', source, true), null);
  assert.equal(sourceMembershipBlocker('Area', 'Rune Essence mine', true), null);
  assert.equal(sourceMembershipRecord('Object', 'Rune essence rock').members, null, 'mixed rune/pure variants remain unresolved');
  assert.equal(sourceMembershipBlocker('Object', 'Never reviewed custom resource', true), null);
  assert(sourceMembershipBlocker('Monster', 'Demon Boss (Wilderness)', true));
});

test('case and nested template membership cannot misclassify a source', () => {
  assert.deepEqual(sourceInfobox('{{infobox monster\n|members=YES\n}}'), { type: 'Monster', fields: ['YES'], names: [], ids: [], ambiguous: false, members: true });
  assert.equal(sourceInfobox('{{INFOBOX NPC\n|members=No\n|other={{Infobox Recipe\n|members=Yes\n}}\n}}').members, false);
  assert.equal(sourceInfobox('{{Infobox Scenery\n|members=No\n|members2=Yes\n}}').members, null);
  assert.equal(sourceInfobox('{{Infobox Scenery\n|members=Yes'), null);
  assert.equal(sourceMembershipBlocker('Object', 'Chaos altar', true), null, 'generic prayer altar cannot become the Runecrafting altar');
  assert.equal(sourceMembershipBlocker('Object', 'Closed chest', true), null, 'generic chest cannot become a redirected sinister chest');
  for (const source of ['Rock face', 'Opening', 'Statue']) assert.equal(sourceMembershipBlocker('Object', source, true), null, 'generic scenery lacks globally unique source identity');
  assert.equal(sourceMembershipBlocker('NPC', 'Wizard', true), null, 'Monster page cannot certify an NPC source');
});

test('free item can require membership at a specific drop or shop source', () => {
  for (const source of ['King Black Dragon', 'RareDropTable+', 'GemDropTable+']) assert(sourceMembershipBlocker('DropItem', 'Magic logs', true, source));
  assert.equal(sourceMembershipBlocker('DropItem', 'Magic logs', true, 'Unreviewed source'), null);
  assert.equal(sourceMembershipBlocker('DropItem', 'Magic logs', true, 'King Black Dragon').detail, 'Members-only drop source for Magic logs: King Black Dragon.');
  assert.equal(sourceMembershipBlocker('DropItem', 'Uncut sapphire', true, 'GemDropTable+'), null);
  assert(sourceMembershipBlocker('ShopItem', 'Jug of water pack', true, "Beefy Bill's Supplies"));
  assert.equal(sourceMembershipBlocker('ShopItem', 'Jug of water pack', true, "Beefy Bill's Supplies").detail, "Members-only shop stock: Jug of water pack at Beefy Bill's Supplies.");
  assert.equal(sourceMembershipBlocker('ShopItem', 'Jug of water pack', true, 'Unreviewed shop'), null);
  assert.equal(sourceMembershipBlocker('Shop', "Sir Renitee's Construction Supplies", true).wiki.revisionId, 37179191);
  assert.equal(sourceMembershipBlocker('Shop', "Sir Renitee's Construction Supplies", false), null);
  assert.equal(sourceMembershipBlocker('Shop', 'Garden Centre', true), null, 'historically deleted plants do not make a free shop members-only');
});

test('membership is attached to precise spell prayer and recipe methods', () => {
  assert(sourceMembershipBlocker('Task', 'Cast ~|Vengeance|~', true, 'Magic'));
  assert(sourceMembershipBlocker('Task', 'Use the ~|smite|~ prayer', true, 'Prayer'));
  assert.equal(sourceMembershipBlocker('Task', 'Cast ~|Lumbridge Teleport|~', true, 'Magic'), null);
  assert(sourceMembershipBlocker('Task', 'Fletch ~|shafts|~ using magic logs', true, 'Fletching'));
  assert.equal(sourceMembershipBlocker('Task', 'Fletch ~|shafts|~ using normal logs', true, 'Fletching'), null);
});

test('onyx engraving is intrinsically free but its missing supply is guarded', () => {
  const label = "Engrave the onyx amulet after ~|Gunnar's Ground|~", record = { Level: 90 };
  assert.equal(sourceMembershipBlocker('Task', label, true, 'Crafting'), null);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, record, true), ['Onyx amulet']);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, { Level: 90, Items: ['Custom amulet'] }, true), []);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, { Level: 80 }, true), []);
  assert.deepEqual(sourceMembershipRequiredItems('Crafting', label, record, false), []);
});

test('a blanket member-area flag cannot exclude a pinned free quest location', () => {
  for (const source of ["Sabbot's Cave", 'Land of Snow']) {
    assert.equal(sourceMembershipBlocker('Area', source, true), null);
    const record = sourceMembershipRecord('Area', source);
    assert.equal(record.status, 'membership-contradiction');
    assert(record.freeQuestEvidence.length);
    assert(record.freeQuestEvidence.every(row => row.wiki.infobox === 'Quest' && row.wiki.memberValues.every(value => value.toLowerCase() === 'no')));
  }
  assert.equal(sourceMembershipBlocker('Task', '~|Death Plateau|~ 2', true, 'Quest'), null);
  assert.equal(sourceMembershipBlocker('Task', '~|Violet is Blue|~ Complete the quest', true, 'Quest'), null);
});

test('guarded incidental member loot does not certify the underlying method as member-only', () => {
  const definitions = JSON.parse(readFileSync('rs3-chunkpicker-chunkinfo-export.json'));
  for (const [category, label] of [['Firemaking', 'Light a fire using ~|acadia logs|~'], ['Woodcutting', 'Cut ~|trees|~ around Wendlewick']]) {
    const record = definitions.challenges[category][label];
    assert(sourceMembershipIncidentalOutput(category, label, record, true));
    assert.equal(sourceMembershipIncidentalOutput(category, label, record, false), false);
    assert.equal(sourceMembershipIncidentalOutput(category, label, { ...record, Output: 'Custom principal product' }, true), false);
    assert.equal(sourceMembershipIncidentalOutput(category, label, { ...record, Level: 99 }, true), false);
    assert.equal(sourceMembershipIncidentalOutput(category, label, { ...record, Items: ['Members-only mandatory input'] }, true), false);
  }
});

test('free Slayer currency never establishes membership access to advanced assignment methods', () => {
  for (const master of ['Vannaka', 'The Raptor', 'Mazchna', 'Chaeldar']) assert(sourceMembershipBlocker('Task', `Receive a slayer assignment from ~|${master}|~`, true, 'Slayer'));
  for (const master of ['Turael', 'Jacquelyn']) assert.equal(sourceMembershipBlocker('Task', `Receive a slayer assignment from ~|${master}|~`, true, 'Slayer'), null);
});

test('the verified catalogue never restricts F2P-off evaluation', () => {
  for (const row of sourceMembershipCatalogue.records) assert.equal(sourceMembershipBlocker(row.kind, row.source, false, row.category), null);
  assert.equal(sourceMembershipBlocker('DropItem', 'Magic logs', false, 'RareDropTable+'), null);
  assert.equal(sourceMembershipBlocker('Task', 'Fletch ~|shafts|~ using magic logs', false, 'Fletching'), null);
});

test('source provenance matches retained input, generators and available external snapshots', () => {
  const provenance = sourceMembershipCatalogue.provenance;
  for (const record of [provenance.reference, ...provenance.generators, ...provenance.identityInputs]) assert.equal(sha256RepositoryText(readFileSync(record.path)), record.sha256, record.path);
  if (existsSync(provenance.snapshotManifest.path)) {
    const bytes = readFileSync(provenance.snapshotManifest.path);
    assert.equal(sha256(bytes), provenance.snapshotManifest.sha256);
    const manifest = JSON.parse(bytes);
    for (const record of [manifest.requests, ...manifest.artifacts]) assert.equal(sha256(readFileSync(record.path)), record.sha256, record.path);
  }
});
