import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import review from '../app/data/monster-membership-review.2026-10-12.v1.json' with { type: 'json' };
import original from '../app/data/source-membership.2026-10-08.v1.json' with { type: 'json' };
import { sourceMembershipBlocker, sourceMembershipRecord } from '../app/data/source-membership.mjs';
import { monsterInfoboxes, monsterVariantMembership, monsterVariants } from '../scripts/lib/monster-membership-evidence.mjs';
import { sha256, sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

test('Monster review records every formerly unknown label and independently audits all known pinned policies', () => {
  const monsterRows = original.records.filter(row => row.kind === 'Monster');
  assert.equal(monsterRows.length, 1199);
  assert.deepEqual(new Set(review.records.map(row => row.source)), new Set(monsterRows.filter(row => row.members === null).map(row => row.source)));
  assert.deepEqual(new Set(review.knownAudit.map(row => row.source)), new Set(monsterRows.filter(row => row.members !== null).map(row => row.source)));
  assert.equal(review.knownAudit.length, 895);
  assert.equal(review.counts.knownPinnedRevisions, 870);
  assert.equal(review.knownAudit.filter(row => row.status !== 'retained-pinned-consensus-audited').length, 1);
  assert.equal(review.knownAudit.find(row => row.source === 'Goblin').status, 'retained-free-ordinary-variants-with-mixed-family');
});

test('independent infoboxes and nested templates cannot leak membership between entity types or empty fields', () => {
  const text = '{{Multi infobox\n|item1={{Infobox Monster\n|name=Sample\n|assigned_by=\n|members=No\n|note={{Recipe\n|members=Yes\n}}\n}}\n|item2={{Infobox NPC\n|name=Sample\n|members=Yes\n}}\n}}';
  const boxes = monsterInfoboxes(text);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].members, false);
  assert.equal(boxes[0].fields.assigned_by, '');
  assert.equal(boxes[1].type, 'NPC');
  assert.equal(boxes[1].members, true);
  assert.equal(monsterInfoboxes('{{Infobox Monster\n|members=Yes')[0], undefined);
});

test('exact version selection preserves variant IDs and rejects partial or missing selectors', () => {
  const box = monsterInfoboxes('{{Infobox Monster\n|name=Sample\n|version1=Common\n|version2=Member quest\n|members1=No\n|members2=Yes\n|id1=47, 48\n|id2=3007\n}}')[0];
  assert.equal(box.members, null);
  assert.equal(monsterVariantMembership(box, 'common'), false);
  assert.equal(monsterVariantMembership(box, 'Member quest'), true);
  assert.equal(monsterVariantMembership(box, 'quest'), null);
  assert.equal(monsterVariantMembership(box, 'Unreviewed'), null);
  assert.deepEqual(monsterVariants(box).map(row => [row.version, row.members, row.npcIds]), [['Common', false, [47, 48]], ['Member quest', true, [3007]]]);
});

test('retained place identities select precise monsters while free bull and skillchompa entities survive', () => {
  for (const source of ['Warrior', 'Archer', 'Soldier', 'Shadow', 'Lava monster', 'Bandit', 'Mummy']) {
    const row = sourceMembershipRecord('Monster', source);
    assert.equal(row.members, true, source);
    assert(row.identityReview || row.supportingWiki?.length, source);
    assert(sourceMembershipBlocker('Monster', source, true), source);
  }
  for (const source of ['Bull', 'Rock', 'Lumbridge guard', 'Azure skillchompa', 'Cobalt skillchompa', 'Cow#Burthorpe', 'Crawling hand#Burthorpe']) {
    assert.equal(sourceMembershipRecord('Monster', source).members, false, source);
    assert.equal(sourceMembershipBlocker('Monster', source, true), null, source);
  }
  assert(sourceMembershipRecord('Monster', 'Bull').wiki.title.includes('(monster)'));
  assert.equal(sourceMembershipRecord('Monster', 'Azure skillchompa').wiki.title, 'Azure skillchompa (Hunter)');
});

test('normal free Rasial and Hermod do not inherit their member quest or NPC versions', () => {
  for (const source of ['Rasial, the First Necromancer', 'Hermod, the Spirit of War']) {
    const row = sourceMembershipRecord('Monster', source);
    assert.equal(row.members, false);
    assert.deepEqual(row.selectedVariants, ['Normal']);
    assert(row.variants.some(variant => variant.members === true));
    assert(row.variants.some(variant => variant.members === false));
    assert.equal(sourceMembershipBlocker('Monster', source, true), null);
  }
  for (const title of ['Alpha vs Omega', 'The Spirit of War']) {
    const quest = original.records.find(row => row.kind === 'Task' && row.category === 'Quest' && row.wiki?.title === title && row.members === true);
    assert(quest, title);
    assert(sourceMembershipBlocker('Task', quest.source, true, 'Quest'), title);
  }
});

test('composed encounters use every member combatant without inheriting free NPC variants', () => {
  assert.equal(sourceMembershipRecord('Monster', 'Barrows').supportingWiki.length, 8);
  assert.equal(sourceMembershipRecord('Monster', 'Barrows: Rise of the Six').supportingWiki.length, 6);
  for (const source of ['Barrows', 'Barrows: Rise of the Six', 'Twin Furies', 'Twin Furies (Hard Mode)', 'Zemouregal & Vorkath (Story Mode)', 'Mummy']) {
    const row = sourceMembershipRecord('Monster', source);
    assert.equal(row.members, true, source);
    assert(row.supportingWiki.length, source);
    for (const page of row.supportingWiki) {
      assert.equal(page.infobox, 'Monster', source);
      assert(page.memberValues.length && page.memberValues.every(value => /^yes$/i.test(value)), source);
    }
  }
});

test('family membership does not invent Troll or Elf combat identities or apply a Daemonheim ban', () => {
  const troll = sourceMembershipRecord('Monster', 'Troll');
  assert.equal(troll.members, null);
  assert(troll.identityLimit);
  assert(troll.supportingWiki.some(page => page.infobox === 'NPC' && page.memberValues.includes('Yes')));
  assert(troll.supportingWiki.some(page => page.infobox === 'Monster' && page.memberValues.includes('No')));
  const elf = sourceMembershipRecord('Monster', 'Elf');
  assert.equal(elf.members, true);
  assert(elf.identityLimit);
  assert(elf.supportingWiki.some(page => page.infobox === 'NPC'));
  assert(elf.supportingWiki.some(page => page.infobox === 'Monster'));
  const daemonheim = sourceMembershipRecord('Monster', 'Monsters in Daemonheim');
  assert.equal(daemonheim.status, 'reviewed-mixed-family');
  assert.equal(daemonheim.members, null);
  assert.equal(sourceMembershipBlocker('Monster', daemonheim.source, true), null);
});

test('reviewed mixed families and unresolved generic identities never become a global member ban', () => {
  const mixed = review.records.filter(row => row.status === 'reviewed-mixed-family');
  assert.equal(mixed.length, review.counts.mixedFamilies);
  for (const row of mixed) {
    assert.equal(row.members, null, row.source);
    assert(row.variants.length || row.supportingVariants?.length || row.supportingWiki?.length, row.source);
    assert.equal(sourceMembershipBlocker('Monster', row.source, true), null, row.source);
  }
  for (const source of ['Rabbit', 'Dwarf', 'Crab', 'Crawling hand']) {
    const variants = sourceMembershipRecord('Monster', source).variants;
    assert(variants.some(row => row.members === true), source);
    assert(variants.some(row => row.members === false), source);
  }
  for (const row of review.records.filter(row => row.status === 'identity-unresolved')) assert.equal(sourceMembershipBlocker('Monster', row.source, true), null, row.source);
});

test('the overlay is exact, dated, and inactive for every member-inclusive source evaluation', () => {
  for (const row of review.records) {
    assert.equal(sourceMembershipRecord('Monster', row.source).members, row.members, row.source);
    assert.equal(sourceMembershipRecord('Monster', row.source).verifiedOn, '2026-10-12', row.source);
    assert.equal(sourceMembershipBlocker('Monster', row.source, false), null, row.source);
    if (row.members === true) assert.equal(sourceMembershipBlocker('Monster', row.source, true).verifiedOn, '2026-10-12', row.source);
  }
  assert.equal(sourceMembershipRecord('Monster', 'Invented unreviewed Monster'), null);
  assert.equal(sourceMembershipBlocker('Monster', 'Invented unreviewed Monster', true), null);
});

test('generated review and available pinned snapshots have exact provenance and complete decision tables', () => {
  for (const entry of [...review.provenance.inputs, ...review.provenance.generators]) assert.equal(sha256RepositoryText(readFileSync(entry.path)), entry.sha256, entry.path);
  const manifestEntry = review.provenance.snapshotManifest;
  if (existsSync(manifestEntry.path)) {
    const bytes = readFileSync(manifestEntry.path);
    assert.equal(sha256(bytes), manifestEntry.sha256);
    const manifest = JSON.parse(bytes);
    for (const entry of [manifest.requests, manifest.knownRequests, ...manifest.artifacts]) assert.equal(sha256(readFileSync(entry.path)), entry.sha256, entry.path);
  }
  const text = readFileSync('docs/research/monster-membership-review-2026-10-12.md', 'utf8');
  for (const row of [...review.records, ...review.knownAudit]) {
    assert(text.includes(`| ${row.source.replaceAll('|', '&#124;')} |`), row.source);
    if (row.wiki) assert(text.includes(`/${row.wiki.revisionId})`), row.source);
  }
});
