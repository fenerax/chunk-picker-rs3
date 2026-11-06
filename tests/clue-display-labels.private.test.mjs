// @test dataset=default
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId, plainLabel } from '../app/tasks/engine.mjs';
import { authoredTasks } from '../app/data/identity-registry.mjs';

test('all 1538 retained clue rows keep their full identity set when display context is added', () => {
  const source = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const challenges = Object.fromEntries(Object.entries(source.challenges).map(([category, rows]) =>
    [category, Object.fromEntries(Object.entries(rows).filter(([, record]) => record.ClueTier && record.ClueType))]));
  const definitions = { chunks: {}, sections: {}, codeItems: {}, challenges };
  // Without display metadata the same records compile to the previous bare labels.
  // Compare every identity tuple, not a representative sample or just the count.
  const bare = structuredClone(definitions);
  for (const rows of Object.values(bare.challenges)) for (const record of Object.values(rows)) {
    delete record.ClueTier; delete record.ClueType;
  }
  const before = createTaskEngine(bare).catalogue.filter(row => row.kind === 'task');
  const after = createTaskEngine(definitions).catalogue.filter(row => row.kind === 'task');
  const identity = ({ label, ...row }) => row;
  assert.equal(after.length, 1538);
  assert.deepEqual(after.map(identity), before.map(identity));
  const frozenIds = new Map(authoredTasks.map(([id, category, rawLabel]) => [`${category}\0${rawLabel}`, id]));
  assert.deepEqual(after.map(({ id, category, rawLabel }) => [category, rawLabel, id]),
    before.map(({ category, rawLabel }) => [category, rawLabel, frozenIds.get(`${category}\0${rawLabel}`)]));
  const counts = {};
  for (const row of after) {
    const record = challenges[row.category][row.rawLabel];
    assert.equal(row.id, taskId(row.category, row.rawLabel, record));
    assert.notEqual(row.label, plainLabel(row.rawLabel));
    if (record.ClueType === 'Map') assert.equal(row.label, `${record.ClueTier[0].toUpperCase()}${record.ClueTier.slice(1)} map clue step`);
    else assert.ok(row.label.endsWith(`: ${plainLabel(row.rawLabel)}`), 'old location text remains searchable');
    counts[record.ClueType] = (counts[record.ClueType] ?? 0) + 1;
  }
  assert.deepEqual(counts, { Scan: 630, Compass: 512, Coordinates: 69, Anagram: 54, Map: 24, Cryptic: 88, 'Skill riddle': 27, Emote: 61, Simple: 73 });
});
