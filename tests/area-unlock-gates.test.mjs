import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { DATASET_DEFINITION_OVERLAYS } from '../app/dataset-inputs.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

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

test('owning the Nature grotto connecting chunk does not waive its quest gate', () => {
  const index = buildAccessIndex(definitions), player = state(['13620']);
  player.members[0].sectionOverrides = { '13620-2': true };
  const closed = calculateAccess(index, player, 'm');
  assert(closed.bases.has('13620'));
  assert(closed.sections.has('13620-2'));
  assert(closed.possibleAreas.has('Nature grotto'));
  assert.equal(closed.areas.has('Nature grotto'), false);
  assert(closed.diagnostics.some(row => row.code === 'area-task-required' && row.location === 'Nature grotto'));
  const opened = calculateAccess(index, player, 'm', { validTasks: new Set([
    'Quest\u0000~|Nature Spirit|~ 5', 'Nonskill\u0000Nature grotto',
  ]) });
  assert(opened.areas.has('Nature grotto'));
});

for (const area of ['Cairn Island Dungeon', 'Hall of Memories', 'Pyramid Plunder', 'Invention Guild']) {
  test(`${area} skill gate is enforced by task evaluation before area admission`, () => {
    const record = definitions.challenges.Nonskill[area];
    const engine = createTaskEngine({ chunks: { 100: {}, [area]: { Connect: { 100: true } } },
      challenges: { Nonskill: { [area]: record } } });
    const atLevel = levels => {
      const player = state(['100']);
      player.members[0].passiveLevels = levels;
      return engine.evaluate(player, 'm');
    };
    for (const skill of Object.keys(record.Skills)) {
      const below = atLevel({ ...record.Skills, [skill]: record.Skills[skill] - 1 });
      assert.equal(below.access.areas.includes(area), false, `${skill} below requirement`);
      const gate = below.tasks.find(row => row.category === 'Nonskill' && row.rawLabel === area);
      assert.equal(gate.status, 'blocked');
      assert(gate.blockers.some(row => row.kind === 'training'));
    }
    assert(atLevel(record.Skills).access.areas.includes(area));
  });
}

test('early quest entry does not expose the lower catacombs monsters or Grand Tree ores', () => {
  const index = buildAccessIndex(definitions), player = state(['12849', '9782']);
  player.members[0].sectionOverrides = { '9782-1': true };
  const validTasks = new Set(['Nonskill\u0000Lumbridge Catacombs', 'Nonskill\u0000Grand Tree Mine']);
  const during = calculateAccess(index, player, 'm', { validTasks });
  assert(during.areas.has('Lumbridge Catacombs'));
  assert(during.areas.has('Grand Tree Mine'));
  for (const name of Object.keys(raw.chunks['Lumbridge Catacombs'].Monster)) {
    assert.equal(during.locations.get(`Monster:${name}`)?.includes('Lumbridge Catacombs') ?? false, false, name);
  }
  for (const name of ['Mithril rock', 'Adamantite rock', 'Runite rock']) {
    assert.equal(during.locations.get(`Object:${name}`)?.includes('Grand Tree Mine') ?? false, false, name);
  }
  validTasks.add('Quest\u0000~|The Blood Pact|~ Complete the quest');
  validTasks.add('Quest\u0000~|The Grand Tree|~ Complete the quest');
  const after = calculateAccess(index, player, 'm', { validTasks });
  assert(after.locations.get('Monster:Dragith Nurn').includes('Lumbridge Catacombs'));
  assert(after.locations.get('Object:Runite rock').includes('Grand Tree Mine'));
});

test('quest-instance sources are removed only from their listed locations', () => {
  assert.deepEqual(definitions.chunks["Dreamer's Cave"].Object, {});
  assert.deepEqual(definitions.chunks["Dreamer's Cave"].NPC, {});
  assert.deepEqual(definitions.chunks["Sigmund's base"].Object, {});
  assert.deepEqual(definitions.chunks["Sigmund's base"].NPC, {});
  assert.deepEqual(definitions.chunks['Temple Knight training ground'].Object, {});
  assert.deepEqual(definitions.chunks['Temple Knight training ground'].NPC, raw.chunks['Temple Knight training ground'].NPC);
  assert.deepEqual(definitions.chunks["Nomad's temple"].Object, {});
  assert.deepEqual(definitions.chunks["Nomad's temple"].Monster, {});
  assert.deepEqual(definitions.chunks["Nomad's temple"].NPC, raw.chunks["Nomad's temple"].NPC);
});
