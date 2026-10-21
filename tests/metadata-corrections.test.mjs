import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMetadataCorrections, metadataCorrections } from '../app/data/metadata-corrections.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { createQuestMapping } from '../app/integrations/runemetrics.mjs';

const definitions = challenges => ({ challenges, chunks: { '12850': {} }, sections: {}, walkableChunks: ['12850'], walkableChunksF2P: ['12850'] });
const correction = (category, label, field, before, after) => ({ category, label, changes: [{ field, before, after }] });
const state = { members: [{ id: 'a', name: 'A', unlocked: ['12850'], selected: [], completedTasks: [] }], rules: { 'content.f2p': true } };

test('reviewed scalar metadata preserves authored text, identifiers, steps and unrelated fields', () => {
  const raw = definitions({ Quest: { Q: { QuestPoints: 1, BaseQuest: 'Old', Description: 'Authored prose.', Tasks: { Step: 'Quest' } }, Step: {} }, Diary: { A: { RuneScore: 5 } } });
  const before = JSON.stringify(raw);
  const changes = [correction('Quest', 'Q', 'QuestPoints', 1, 2), correction('Quest', 'Q', 'BaseQuest', 'Old', 'New'), correction('Diary', 'A', 'RuneScore', 5, 10)];
  const after = applyMetadataCorrections(raw, { corrections: changes, strict: true });
  assert.equal(after.challenges.Quest.Q.QuestPoints, 2);
  assert.equal(after.challenges.Quest.Q.BaseQuest, 'New');
  assert.equal(after.challenges.Diary.A.RuneScore, 10);
  assert.equal(after.challenges.Quest.Q.Description, 'Authored prose.');
  assert.equal(after.challenges.Quest.Q.Tasks, raw.challenges.Quest.Q.Tasks);
  assert.equal(taskId('Quest', 'Q', after.challenges.Quest.Q), taskId('Quest', 'Q', raw.challenges.Quest.Q));
  assert.equal(JSON.stringify(raw), before);
  assert.equal(applyMetadataCorrections(after, { corrections: changes, strict: true }), after);
});

test('membership corrections add and clear gates for quests and achievements', () => {
  const raw = definitions({ Quest: { Members: {} }, Diary: { Free: { 'Not F2P': true } } });
  const after = applyMetadataCorrections(raw, { corrections: [correction('Quest', 'Members', 'Not F2P', null, true), correction('Diary', 'Free', 'Not F2P', true, false)] });
  const rows = createTaskEngine(after, { metadataCorrections: false }).evaluate(state, 'a').tasks;
  assert.equal(rows.find(row => row.rawLabel === 'Members').status, 'blocked');
  assert.equal(rows.find(row => row.rawLabel === 'Free').status, 'available');
  assert.equal(raw.challenges.Diary.Free['Not F2P'], true);
});

test('plain numeric requirements update only the verified leaf and keep other requirements', () => {
  const raw = definitions({ Quest: { Q: { SkillsNeeded: { Smithing: 50, Prayer: 10 }, QuestPointsNeeded: 43 } } });
  const after = applyMetadataCorrections(raw, { corrections: [correction('Quest', 'Q', 'SkillsNeeded.Smithing', 50, 65), correction('Quest', 'Q', 'QuestPointsNeeded', 43, 44)] });
  assert.deepEqual(after.challenges.Quest.Q.SkillsNeeded, { Smithing: 65, Prayer: 10 });
  assert.equal(after.challenges.Quest.Q.QuestPointsNeeded, 44);
  assert.equal(raw.challenges.Quest.Q.SkillsNeeded.Smithing, 50);
});

test('exact-target preconditions skip custom data and reject drift in strict audit', () => {
  const raw = definitions({ Diary: { A: { RuneScore: 25 } } });
  const changes = [correction('Diary', 'A', 'RuneScore', 5, 10)];
  assert.equal(applyMetadataCorrections(raw, { corrections: changes }), raw);
  assert.throws(() => applyMetadataCorrections(raw, { corrections: changes, strict: true }), /drift/);
  assert.throws(() => applyMetadataCorrections(raw, { corrections: [correction('Diary', 'Missing', 'RuneScore', 5, 10)], strict: true }), /Missing/);
  assert.throws(() => applyMetadataCorrections(raw, { corrections: [correction('Diary', 'A', 'Description', null, 'Changed')] }), /Unsupported/);
  assert.throws(() => applyMetadataCorrections(raw, { corrections: [correction('Diary', 'A', '__proto__.polluted', null, 1)] }), /Unsafe/);
});

test('every committed correction applies to the retained export and has dual-source evidence', () => {
  const raw = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  assert.ok(metadataCorrections.length > 0);
  const after = applyMetadataCorrections(raw, { strict: true });
  assert.deepEqual(Object.keys(after.challenges), Object.keys(raw.challenges));
  for (const entry of metadataCorrections) {
    const original = raw.challenges[entry.category][entry.label];
    const corrected = after.challenges[entry.category][entry.label];
    assert.deepEqual(Object.keys(after.challenges[entry.category]), Object.keys(raw.challenges[entry.category]));
    for (const change of entry.changes) {
      assert.ok(change.cache.artifact && change.cache.field, entry.label);
      assert.ok(Number.isSafeInteger(change.wiki.revisionId), entry.label);
      assert.match(change.wiki.url, /runescape\.wiki\/.+(?:PermanentLink\/|oldid=)\d+/);
      const path = change.field.split('.');
      const value = path.reduce((record, field) => record?.[field], corrected);
      assert.deepEqual(value, change.after, `${entry.label}: ${change.field}`);
    }
    for (const field of Object.keys(original)) if (!entry.changes.some(change => change.field.split('.')[0] === field)) assert.deepEqual(corrected[field], original[field], `${entry.label}: authored ${field}`);
  }
  assert.equal(applyMetadataCorrections(after, { strict: true }), after);
});

test('runtime engine and RuneMetrics mapping use corrected Kili identity without creating a quest alias', () => {
  const raw = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const entry = metadataCorrections.find(row => row.changes.some(change => change.field === 'BaseQuest'));
  assert.ok(entry);
  const sparse = definitions({ Quest: { [entry.label]: raw.challenges.Quest[entry.label] } });
  const row = createTaskEngine(sparse, { metadataCorrections: true }).evaluate(state, 'a').tasks[0];
  assert.equal(row.baseQuest, "Kili's Knowledge");
  assert.equal(row.record.QuestPoints, 0);
  const mapping = createQuestMapping(sparse);
  assert.equal(mapping.has('kindred spirits'), false);
  assert.equal(mapping.has('kili s knowledge'), false);
});
