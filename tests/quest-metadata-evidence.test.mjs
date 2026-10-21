import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const read = url => JSON.parse(readFileSync(url,'utf8'));
const evidence = read(new URL('../docs/research/cache-quest-metadata-corrections.2026-10-08.v1.json',import.meta.url));
const referenceUrl = new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url);
const reference = read(referenceUrl);
const get = (object,field) => field.split('.').reduce((value,key)=>value?.[key],object);

test('quest corrections are bound to the retained reference and distinct exact targets',()=>{
  assert.equal(sha256RepositoryText(readFileSync(referenceUrl)),evidence.sources.reference.sha256);
  const seen = new Set();
  for (const correction of evidence.corrections) {
    assert.equal(correction.category,'Quest');
    assert.ok(reference.challenges.Quest[correction.label]);
    for (const change of correction.changes) {
      const key = `${correction.label}:${change.field}`;
      assert.ok(!seen.has(key),`Duplicate change ${key}`); seen.add(key);
      assert.equal(get(reference.challenges.Quest[correction.label],change.field) ?? null,change.before,key);
      assert.notEqual(change.before,change.after);
      assert.match(change.field,/^(?:Not F2P|BaseQuest|QuestPointsNeeded|Skills\.[A-Za-z]+)$/);
      assert.ok(Number.isSafeInteger(change.cache.id));
      assert.ok(Number.isSafeInteger(change.wiki.revisionId));
      assert.equal(change.wiki.url,`https://runescape.wiki/w/Special:PermanentLink/${change.wiki.revisionId}`);
      assert.ok(change.wiki.snippet);
    }
  }
});

test('numeric and partial-membership review preserves operation and completion distinctions',()=>{
  const changes = evidence.corrections.flatMap(row=>row.changes.map(change=>({label:row.label,...change})));
  const numeric = changes.filter(change=>change.field.startsWith('Skills.') || change.field === 'QuestPointsNeeded');
  for (const change of numeric) {
    assert.equal(change.after,change.cache.value);
    assert.equal(change.after,change.wiki.value);
    assert.equal(typeof change.before,'number');
    assert.equal(typeof change.after,'number');
  }
  const protectedLabels = [
    '~|Recipe for Disaster: Freeing Skrach Uglogwee|~ 3',
    "~|Benedict's World Tour (miniquest)|~ Complete the miniquest",
    '~|Princess and the Pauper|~ 1',
  ];
  for (const label of protectedLabels) {
    assert.ok(!evidence.corrections.some(row=>row.label === label));
    assert.ok(evidence.review.some(row=>row.label === label && row.decision === 'preserve'));
  }
  const coverage = evidence.coverage.numericRequirements;
  assert.equal(coverage.skillValues,coverage.skillComparable + coverage.achievementSkillComparisons.length + coverage.uncomparedSkillValues.length);
  assert.equal(coverage.qpValues,coverage.qpComparable);
  assert.equal(evidence.coverage.difficultyAndLength.storedFields.length,0);
});

test('Kili identity does not turn a prerequisite or state condition into a quest alias',()=>{
  const correction = evidence.corrections.find(row=>row.label === "~|Kili's Knowledge|~ Complete the lore activity");
  assert.deepEqual(correction.changes.map(change=>[change.field,change.before,change.after]),[['BaseQuest','Kindred Spirits',"Kili's Knowledge"]]);
  assert.equal(reference.challenges.Quest[correction.label].QuestPoints,0);
  assert.deepEqual(evidence.identityReview.questListEntries,[]);
  assert.equal(evidence.identityReview.achievementRecords.length,10);
  for (const achievement of evidence.identityReview.achievementRecords) {
    assert.deepEqual(achievement.associatedQuestReferences,[]);
    assert.deepEqual(achievement.miniquestQuestReferences,[{id:500,name:'Kili Row',resolved:true}]);
  }
  const kiliVarbits = evidence.identityReview.achievementRecords.flatMap(row=>row.stateConditions.progress_states_v2.flatMap(state=>state.varbits));
  const kindredVarbits = evidence.identityReview.unrelatedQuest.stateFields.varbitsV2.map(state=>state.varbit);
  assert.ok(kiliVarbits.every(id=>!kindredVarbits.includes(id)));
});
