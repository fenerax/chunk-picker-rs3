import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld, findTaskIdCollisions } from '../app/data/world.mjs';
import { importLegacyMaps, exportBackup, importBackup } from '../app/core/state.mjs';
import { evaluateRollPool } from '../app/core/rules.mjs';

test('the actual reference schema keeps named areas and allocation metadata intact', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const tasks = JSON.parse(await readFile(new URL('../reference/original-picker/tasksMap.json', import.meta.url), 'utf8'));
  const world = buildWorld(definitions, { dataset: selectedDataset });
  const terrainOnly = [...world.chunks.values()].filter(record => record.terrainOnly).length;
  assert.equal(terrainOnly, 456, 'cache regions include exact labels and blocked terrain without invented reference resources');
  for (const id of ['8750', '10538', '10557', '18488', '18999']) {
    assert.equal(definitions.chunks[id], undefined);
    assert.equal(world.chunks.get(id).terrainOnly, true);
    assert.equal(world.walkable.has(id), false, 'a map label or blocked artwork is not entry evidence');
  }
  assert.equal(world.chunks.size + world.areas.size, Object.keys(definitions.chunks).length + 1 + terrainOnly,
    'the authored overlay restores 13883 and the cache extends surface coverage');
  assert.equal(definitions.chunks['13883'], undefined);
  assert.ok(world.chunks.has('13883'));
  assert.ok(world.areas.has('Zanaris'));
  assert.ok(world.chunks.has('12342'));
  assert.ok(world.issues.some(issue => issue.code === 'missing-chunk'));
  const collisions = findTaskIdCollisions(tasks);
  assert.ok(collisions.some(collision => collision.id === 't_120947'));
  assert.ok(collisions.every(collision => collision.labels.length > 1));
  // Synthetic gameplay shaped like real exports; no account fixture is required for portable tests.
  const document = { maps: { demo: { chunks: { unlocked: { '12342': '12342' }, selected: { '12850': 1 } },
    rules: { Token: true }, chunkNotes: { '12342': 'Keep this note' }, userTasks: { example: { label: 'Custom requirement' } } } } };
  const { state } = importLegacyMaps(document, { members: [{ id: 'example', name: 'Example', mapId: 'demo' }] });
  assert.deepEqual(importBackup(exportBackup(state)), state);
  assert.deepEqual(state.legacy.maps.demo, document.maps.demo);
  const before = structuredClone(state);
  const pool = evaluateRollPool(world, state, 'example');
  assert.ok(pool.eligible.some(candidate => candidate.id === '12850'));
  assert.deepEqual(state, before);
});
