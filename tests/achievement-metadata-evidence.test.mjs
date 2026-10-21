import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { achievementInfoboxes, wikiVariant } from '../scripts/research/achievement-metadata-evidence.mjs';

test('achievement identity excludes an identically named item and a different achievement ID', () => {
  const raw = '{{Infobox Item|name=Ghost Hunter|id=3315|members=Yes|score=5}}\n{{Infobox Achievement|name=Ghost Hunter|id=999|score=15|members=No}}';
  assert.equal(achievementInfoboxes(raw).length, 1);
  assert.equal(wikiVariant(raw, 3315), null);
});

test('tier metadata selects the matching ID and preserves nested requirement pipes', () => {
  const raw = '{{Infobox Achievement\n|name=Tier\n|id1=1\n|id2=2\n|score1=5\n|score2=10\n|members=Yes\n|requirements={{Skillreq|Hunter|68}}\n}}';
  const second = wikiVariant(raw, 2);
  assert.equal(second.score, 10);
  assert.equal(second.members, true);
  assert.equal(second.scoreField, 'score2');
  assert.equal(second.membersField, 'members');
  assert.equal(achievementInfoboxes(raw)[0].requirements, '{{Skillreq|Hunter|68}}');
  assert.equal(wikiVariant(raw + raw, 2), null, 'duplicate ID witnesses are ambiguous');
});

test('missing and template-encoded Wiki values remain unresolved', () => {
  const variant = wikiVariant('{{Infobox Achievement|id=1|score={{Value|5}}}}', 1);
  assert.equal(variant.score, null);
  assert.equal(variant.members, null);
});

test('all versioned achievement changes have exact retained guards and matching Wiki identity', async () => {
  const retainedBytes = await fs.readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url));
  const rows = JSON.parse(retainedBytes).challenges.Diary;
  const evidence = JSON.parse(await fs.readFile(new URL('../docs/research/cache-achievement-metadata-corrections.2026-10-08.v1.json', import.meta.url)));
  assert.equal(sha256RepositoryText(retainedBytes), evidence.sources.retained.sha256);
  const seen = new Set();
  const tally = { RuneScore: 0, 'Not F2P': 0 };
  for (const correction of evidence.corrections) {
    assert.equal(correction.category, 'Diary');
    assert.ok(Object.hasOwn(rows, correction.label));
    for (const change of correction.changes) {
      const key = correction.label + '\0' + change.field;
      assert.ok(!seen.has(key), 'duplicate target field');
      seen.add(key);
      assert.ok(Object.hasOwn(tally, change.field), 'only authorized metadata fields');
      assert.equal(rows[correction.label][change.field] ?? null, change.before);
      assert.notEqual(change.after, change.before);
      assert.notEqual(change.after, null, 'corrections never delete data');
      assert.equal(change.wiki.achievementId, change.cache.id);
      assert.equal(change.wiki.url, `https://runescape.wiki/w/Special:PermanentLink/${change.wiki.revisionId}`);
      assert.equal(change.after, change.wiki.value);
      assert.equal(change.after, change.field === 'RuneScore' ? change.cache.value : !change.cache.value);
      assert.equal(typeof change.after, change.field === 'RuneScore' ? 'number' : 'boolean');
      if (change.field === 'RuneScore') assert.equal(Number(change.wiki.rawValue), change.after);
      else assert.equal(change.wiki.rawValue.toLowerCase(), change.after ? 'yes' : 'no');
      tally[change.field]++;
    }
  }
  assert.deepEqual(tally, evidence.coverage.corrections);
  assert.deepEqual(tally, { RuneScore: 173, 'Not F2P': 517 });
  for (const row of evidence.review) for (const field of row.fields ?? []) {
    assert.ok(!seen.has(row.label + '\0' + field.field), 'review fields cannot be applied');
  }
  const allFields = evidence.corrections.flatMap(row => row.changes);
  assert.equal(allFields.filter(change => change.field === 'RuneScore' && change.before === null).length, 12);
  assert.equal(allFields.filter(change => change.field === 'Not F2P' && change.after === false).length, 12);
  const missing = evidence.review.find(row => row.label.includes("Gotta Catch 'Em Both!"));
  assert.equal(missing.fields[0].status, 'missing-cache-field');
  assert.equal(missing.fields[0].before, 10);
});
