import test from 'node:test';
import assert from 'node:assert/strict';
import { taskItemNames, taskItemIcon, taskIcon, taskCategoryIcon } from '../app/tasks/task-icons.mjs';
import { projectPlayTask } from '../app/play-view.mjs';

test('shared task artwork prefers exact inventory, then skills, then local categories', () => {
  const lookups = { itemIcon: name => name === 'Rune platebody' ? '/inventory.png' : null,
    skillIcon: name => name === 'Smithing' || name === 'Slayer' ? '/skill.png' : null };
  assert.equal(taskIcon({ category: 'Smithing', item: 'Rune platebody' }, lookups), '/inventory.png');
  assert.equal(taskIcon({ category: 'Smithing', label: 'Smelt unknown metal' }, lookups), '/skill.png');
  assert.equal(taskIcon({ category: 'Slayer', label: 'Get an assignment' }, lookups), '/skill.png');
  assert.equal(taskIcon({ category: 'Defense' }, { skillIcon: name => name === 'Defense' ? '/defence.png' : null }), '/defence.png');
  for (const [category, artwork] of [['Quest', 'quest'], ['Achievement', 'achievements'], ['Diary', 'achievements'], ['Activity', 'minigame'], ['Clue', 'clue']]) {
    const url = `/assets/SVG/rs3/${artwork}-rs3.svg`;
    assert.equal(taskIcon({ category, label: 'Complete a step about ~|Unknown NPC|~' }, lookups), url);
    assert.equal(taskCategoryIcon(category), url);
  }
  for (const task of [{ category: 'Extra', item: 'Missing item' }, { category: 'BiS', label: 'Obtain a Missing item' }, { category: 'BiS', equipmentName: 'Unknown (tier 99)' }, { category: 'Unknown' }]) assert.equal(taskIcon(task, lookups), null);
  assert.equal(taskIcon({ category: 'Extra', label: 'Obtain slayer points' }, lookups), '/assets/SVG/rs3/minigame-rs3.svg');
  assert.equal(taskCategoryIcon('Slayer'), '/assets/SVG/rs3/slayer-rs3.svg');
  for (const category of ['constructor', '__proto__', '../../other']) assert.equal(taskCategoryIcon(category), null);
});

test('the compact task response retains an explicit item for icon lookup', () => {
  const row = projectPlayTask({ id: 'fixture', label: 'Equipment goal', item: 'Team-1 cape', category: 'BiS', status: 'available' });
  assert.equal(taskItemIcon(row, name => name === 'Team-1 cape' ? '/cape.png' : null), '/cape.png');
});

test('task icon candidates preserve tier and team identities in every supported row shape', () => {
  for (let number = 1; number <= 50; number++) {
    const name = `Team-${number} cape`;
    for (const task of [{ equipmentName: name }, { rawLabel: `Obtain a ${name}` }, { label: `Obtain a ${name}` }, { rawLabel: `Wear a ~|${name.toLowerCase()}|~` }]) {
      assert.equal(taskItemIcon(task, value => value.toLowerCase() === name.toLowerCase() ? '/cape.png' : null), '/cape.png');
    }
  }
  assert.deepEqual(taskItemNames({ label: 'Obtain a Skull lantern (tier 10)' }), ['Skull lantern (tier 10)']);
  assert.deepEqual(taskItemNames({ rawLabel: 'Obtain ~|Deathwarden gloves (tier 90)|~' }), ['Deathwarden gloves (tier 90)']);
});

test('task icon candidates prioritize explicit equipment, search all complete markers and keep unknowns unresolved', () => {
  const task = { equipmentName: 'Weapon (tier 20)', item: 'Reward', rawLabel: 'At ~|Quest#Step|~ make ~|Weapon (tier 10)|~', label: 'Obtain a Weapon (tier 20)' };
  assert.deepEqual(taskItemNames(task), ['Weapon (tier 20)', 'Reward', 'Quest', 'Weapon (tier 10)']);
  assert.equal(taskItemIcon(task, name => ({ 'Weapon (tier 20)': '/20.png', 'Weapon (tier 10)': '/10.png' })[name]), '/20.png');
  assert.equal(taskItemIcon(task, name => name === 'Weapon (tier 10)' ? '/10.png' : null), '/10.png');
  assert.equal(taskItemIcon({ label: 'Obtain a Weapon (tier 99)' }, name => name === 'Weapon' ? '/wrong.png' : null), null);
  assert.deepEqual(taskItemNames({ rawLabel: 'Incomplete ~|Weapon', label: 'Complete quest about Weapon' }), []);
  assert.deepEqual(taskItemNames({ equipmentName: ' Rune\u00a0platebody ', label: 'Obtain a rune platebody' }), ['Rune platebody']);
  assert.deepEqual(taskItemNames(), []);
});
