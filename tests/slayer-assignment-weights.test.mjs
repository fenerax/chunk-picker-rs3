import test from 'node:test';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { masterGateFixture } from './fixtures/slayer-master-gates.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { prepareTaskDefinitions } from '../app/dataset-pipeline.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import overlay from '../app/data/reference-corrections.2026-10-31.v1.mjs';

// Checked against the cached Slayer_assignment master tables on 2026-10-31.
const weights = [
  ['Mazchna/Achtryn', 'Sanguine crawlers', 15, 'Mazchna'],
  ['Sumona', 'Profane Scabarites', 15, 'Sumona'],
  ['Kuradal', 'Profane Scabarites', 10, 'Kuradal'],
  ['Morvran', 'Profane Scabarites', 12, 'Morvran'],
  ['Laniakea', 'Profane Scabarites', 12, 'Laniakea'],
  ['Laniakea', 'Undead', 4, 'Laniakea'],
];

test('six reviewed assignment weights apply through the core correction overlay without editing archived data', () => {
  const raw = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const original = JSON.stringify(raw.slayerMasterTasks);
  const effective = applyDefinitionOverlays(raw, [overlay]);
  const prepared = prepareTaskDefinitions(raw, selectedDataset);
  for (const [master, assignment, weight, wiki] of weights) {
    assert.equal(effective.slayerMasterTasks[master][assignment].Weight, weight);
    assert.equal(prepared.slayerMasterTasks[master][assignment].Weight, weight);
    const patch = overlay.patches.find(patch => patch.path.join('/') === `slayerMasterTasks/${master}/${assignment}/Weight`);
    assert.equal(patch.wiki.url, `https://runescape.wiki/w/Slayer_assignment/${wiki}`);
    assert.deepEqual({ ...effective.slayerMasterTasks[master][assignment], Weight: raw.slayerMasterTasks[master][assignment].Weight }, raw.slayerMasterTasks[master][assignment]);
  }
  assert.equal(JSON.stringify(raw.slayerMasterTasks), original);
  assert.equal(applyDefinitionOverlays(effective, [overlay]), effective);
});


test('public full definitions reject a Combat-30 master below its threshold and admit it exactly', () => {
  const definitions = prepareTaskDefinitions(JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url))), selectedDataset);
  definitions.chunks['10001'] = { NPC: { Vannaka: 1 }, Monster: { Spider: 1 } };
  const engine = createTaskEngine(definitions);
  for (const combat of [29, 30, 31]) {
    const { state } = masterGateFixture({ combat, slayer: 1 });
    const result = engine.evaluate(state, 'a');
    const master = buildActivityInfo(result, state, 'a', definitions).slayer.masters.find(master => master.name === 'Vannaka');
    assert.equal(master.reachable, true);
    assert.equal(master.tasks.some(task => task.currentUnlocked && task.currentStatus === 'doable'), combat >= 30);
    assert.equal(master.currentAccess.status, combat < 30 ? 'unavailable' : 'available');
    if (combat < 30) {
      assert.equal(master.warnings.current.poolWeight, undefined);
      assert.match(master.warnings.current.line, /unavailable.*Combat 30/);
    } else assert.ok(master.warnings.current.poolWeight > 0);
  }
});
