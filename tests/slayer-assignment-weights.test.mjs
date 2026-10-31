import test from 'node:test';
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
