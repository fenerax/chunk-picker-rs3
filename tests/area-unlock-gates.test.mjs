import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { DATASET_DEFINITION_OVERLAYS } from '../app/dataset-inputs.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';

const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const raw = json('rs3-chunkpicker-chunkinfo-export.json');
const definitions = applyDefinitionOverlays(raw, DATASET_DEFINITION_OVERLAYS.map(json));
const step = number => `~|The Prisoner of Glouphrie|~ ${number}`;
const state = unlocked => ({ rules: { 'content.f2p': false }, members: [{ id: 'm', unlocked, completedTasks: [] }] });

// Every chunk and area a task needs, following its Tasks prerequisites.
function requiredLocations(category, name, seen = new Set()) {
  const key = `${category}\u0000${name}`;
  if (seen.has(key)) return new Set();
  seen.add(key);
  const record = definitions.challenges[category]?.[name] ?? {};
  const locations = new Set(record.Chunks ?? []);
  for (const [task, taskCategory] of Object.entries(record.Tasks ?? {})) {
    for (const location of requiredLocations(taskCategory, task, seen)) locations.add(location);
  }
  return locations;
}

test('The Prisoner of Glouphrie areas open only at the quest steps that enter them', () => {
  assert.deepEqual(raw.challenges.Nonskill['Caverns under Arandar'], { UnlocksArea: true }, 'fixture still shows the original gap');
  // The dead-tree chunk 9522 used to open both areas with no requirement.
  const index = buildAccessIndex(definitions), unlocked = ['9778', '9777', '9522', '9521'];
  const closed = calculateAccess(index, state(unlocked), 'm');
  assert.equal(closed.areas.has('Caverns under Arandar'), false);
  assert.equal(closed.areas.has('Arposandra'), false);
  const caverns = calculateAccess(index, state(unlocked), 'm', { validTasks: new Set([`Quest\u0000${step(2)}`,
    'Nonskill\u0000Caverns under Arandar']) });
  assert.equal(caverns.areas.has('Caverns under Arandar'), true);
  assert.equal(caverns.areas.has('Arposandra'), false);
  const city = calculateAccess(index, state(unlocked), 'm', { validTasks: new Set([`Quest\u0000${step(2)}`, `Quest\u0000${step(6)}`,
    'Nonskill\u0000Caverns under Arandar', 'Nonskill\u0000Arposandra']) });
  assert.equal(city.areas.has('Arposandra'), true);
  // The quest seals the backstage area afterwards: no repeatable sources stay behind.
  for (const monster of ['Terrorbird', 'Tortoise']) assert.equal(city.monsters.has(monster), false, monster);
  assert.equal(city.objects.has('Fremennik Furnace'), false);
});

test('no area gate needs a task that itself requires that area', () => {
  const loops = [];
  for (const [area, record] of Object.entries(definitions.challenges.Nonskill)) {
    if (!record.UnlocksArea) continue;
    for (const [task, category] of Object.entries(record.Tasks ?? {})) {
      if (requiredLocations(category, task).has(area)) loops.push(`${area} <- ${category}/${task}`);
    }
  }
  assert.deepEqual(loops, []);
});
