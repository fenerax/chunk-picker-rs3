import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuest, normalizeAchievement, compareRetained, buildWikiEvidence } from '../scripts/cache/game-data-quests.mjs';

test('quest aliases cannot replace complete quest metadata, and missing params stay missing', () => {
  const raw = new Map([[6, { name: "Cook's Assistant", quest_list_name: '', extra: [{ prop: 9462, intvalue: 1 }] }],
    [257, { name: "Cook's Assistant", quest_list_name: "Cook's Assistant", quest_points: 1, quest_difficulty: 0 }]]);
  const enums = new Map([[2251, { stringArrayValue2: { values: [[0, 'Novice']] } }],
    [13354, { stringArrayValue2: { values: [[4, 'Medium']] } }]]);
  const rows = [...raw].map(([id, q]) => normalizeQuest(id, q, raw, enums));
  assert.equal(rows[0].listEntry, false);
  assert.equal(rows[0].questPoints, null);
  assert.equal(rows[1].length.code, null);
  assert.equal(rows[1].length.label, null);
  const result = compareRetained({ quests: { "Cook's Assistant": '' }, challenges: { Quest: {
    "~|Cook's Assistant|~ Complete the quest": { BaseQuest: "Cook's Assistant", QuestPoints: 1 },
  } } }, rows, []);
  assert.deepEqual(result.questRows[0].questIds, [257]);
  assert.deepEqual(result.questRows[0].metadata.map(row => row.status), ['match', 'match']);
});

test('achievement state tests preserve selectors without becoming skill or quest requirements', () => {
  const raw = { name: 'Encoded gate', subach_skills: [{ ironman: 1, skill: 17, level: 5, unk_0: 3 }],
    quest_ids: [9], reqs25_v2: [{ type: 1, varbit: 65536, value: 7, requirement: 44, subbit: 2 }],
    sub_achievements: [{ unk0: 4, achievement: 99 }] };
  const row = normalizeAchievement(128, raw, new Map(), new Map());
  assert.deepEqual(row.source, { major: 57, minor: 1, subid: 0 });
  assert.equal(row.encodedRequirements.skills[0].skillName, 'Thieving');
  assert.equal(row.encodedRequirements.skills[0].ironman, 1);
  assert.equal(row.encodedRequirements.associatedQuestReferences[0].resolved, false);
  assert.deepEqual(row.stateConditions.reqs25_v2, raw.reqs25_v2);
  assert.equal(row.encodedRequirements.subAchievements[0].unk0, 4);
  assert.equal(row.encodedRequirements.subAchievements[0].resolved, false);
});

test('full retained comparison reports ambiguity and disagreements rather than selecting duplicate names', () => {
  const q = [{ id: 1, name: 'Q', listEntry: true, members: true, questPoints: 2 }];
  const a = [{ id: 1, name: 'Duplicate', runescore: 5 }, { id: 2, name: 'Duplicate', runescore: 5 },
    { id: 3, name: 'Single', runescore: 10, description: { descr: 'New description.' } }];
  const data = { quests: { Q: '', Missing: '' }, challenges: {
    Quest: { '~|Q|~ Complete the quest': { QuestPoints: 1, BaseQuest: 'Q', Chunks: ['1'] }, '~|Q|~ 1': { BaseQuest: 'Q' } },
    Diary: { '~|Group#Easy|~ Duplicate': { RuneScore: 5 }, '~|Group#Easy|~ Single': { RuneScore: 5, Description: 'Old description.' } },
  } };
  const result = compareRetained(data, q, a);
  assert.equal(result.questNameRows.length, 2);
  assert.deepEqual(result.questRows[0].metadata.map(row => row.status), ['mismatch', 'mismatch']);
  assert.equal(result.achievementRows[0].status, 'ambiguous-name');
  assert.deepEqual(result.achievementRows[0].metadata, []);
  assert.deepEqual(result.achievementRows[1].metadata.map(row => row.status), ['mismatch', 'mismatch']);
  assert.equal(result.summary.replacementEstimates.completeQuestStepReplacement, 0);
  assert.equal(result.summary.replacementEstimates.completeAchievementTaskReplacement, 0);
});

test('Wiki checks use snapshot values and report absent fields instead of frozen expected values', () => {
  const record = { id: 257, members: false, difficulty: { label: 'Novice' }, length: { label: 'Short' }, questPoints: 1 };
  const snapshot = text => ({ query: { pages: { 195: { pageid: 195, title: "Cook's Assistant",
    revisions: [{ revid: 123, timestamp: '2026-10-08T00:00:00Z', slots: { main: { '*': text } } }] } } } });
  const base = '|id = 257\n|members = No\n|difficulty = Novice\n|length = Short\n';
  const absent = buildWikiEvidence(snapshot(base), [record], [])[0];
  assert.equal(absent.fields.find(row => row.field === 'questPoints').status, 'wiki-field-missing');
  const changed = buildWikiEvidence(snapshot(base + '|qp = 2\n'), [record], [])[0];
  assert.deepEqual(changed.fields.find(row => row.field === 'questPoints'), { field: 'questPoints', wiki: 2, cache: 1, status: 'mismatch' });
  assert.equal(changed.revisionUrl, 'https://runescape.wiki/w/Special:PermanentLink/123');
});
