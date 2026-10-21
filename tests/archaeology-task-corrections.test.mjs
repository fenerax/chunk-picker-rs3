import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyArchaeologyTaskCorrections, archaeologyTaskCorrections } from '../app/data/archaeology-task-corrections.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildArchaeologyPreview } from '../scripts/preview-archaeology.mjs';

const label = 'Excavate a ~|triskelion|~ material cache';
function definitions() {
  return { chunks: { '7495': { Object: { 'Material cache (triskelion)': 1 } } }, sections: {},
    walkableChunks: ['7495'], walkableChunksF2P: ['7495'],
    challenges: { Archaeology: { [label]: { Level: 58, Objects: ['Material cache (triskelion)'], Primary: true } } } };
}

test('opt-in task correction changes only the exact corroborated old level, without input mutation', () => {
  const data = definitions(), original = JSON.stringify(data);
  assert.equal(applyArchaeologyTaskCorrections(data, { enabled: false }), data);
  const corrected = applyArchaeologyTaskCorrections(data, { enabled: true });
  assert.equal(corrected.challenges.Archaeology[label].Level, 52);
  assert.equal(JSON.stringify(data), original);
  assert.equal(applyArchaeologyTaskCorrections(corrected, { enabled: true }), corrected);
  for (const change of [record => { record.Level = 60; }, record => { record.Objects = ['Other source']; }]) {
    const custom = definitions(); change(custom.challenges.Archaeology[label]);
    assert.equal(applyArchaeologyTaskCorrections(custom, { enabled: true }), custom);
  }
  assert.equal(archaeologyTaskCorrections.enabledByDefault, false);
  const real = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  assert.equal(real.challenges.Archaeology[label].Level, 58);
  assert.equal(applyArchaeologyTaskCorrections(real, { enabled: true }).challenges.Archaeology[label].Level, 52);
});

test('task-engine option controls the level and availability while preserving task IDs', () => {
  const data = definitions(), options = { cacheWalking: false, cacheResources: false, metadataCorrections: false, reviewedOverlays: false };
  const before = createTaskEngine(data, { ...options, cacheArchaeology: false });
  const after = createTaskEngine(data, { ...options, cacheArchaeology: true });
  assert.equal(before.catalogue[0].id, after.catalogue[0].id);
  assert.equal(before.catalogue[0].level, 58); assert.equal(after.catalogue[0].level, 52);
  const state = createGroupState([{ id: 'fixture', name: 'Synthetic member', unlocked: ['7495'],
    passiveLevels: { Archaeology: 55 }, maxLevels: { Archaeology: 55 } }]);
  state.rules['content.f2p'] = false;
  assert.equal(before.evaluate(state, 'fixture').tasks[0].status, 'blocked');
  assert.equal(after.evaluate(state, 'fixture').tasks[0].status, 'available');
  const report = buildArchaeologyPreview(data, state, options);
  assert.equal(report.members[0].counts.taskMetadataChanges, 1);
  assert.equal(report.members[0].counts.availabilityGains, 1);
  assert.deepEqual(report.members[0].tasks[0].metadataChanges, [{ field: 'level', before: 58, after: 52 }]);
});
