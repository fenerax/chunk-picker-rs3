import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authoredTasks, authoredEntities } from '../app/data/identity-registry.mjs';
import { permanentTaskId, legacyTaskId, entityId, generatedGoalId, buildIdentityIndex, resolveIdentity, lookupPermanentId, isPermanentId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('private permanent identity checks keep boolean results and exclude independent namespaces', () => {
  assert.equal(isPermanentId('rs3:task:synthetic-permanent'), true);
  for (const id of [undefined, '', 'synthetic', 'custom:open-f2p:journal', 'rs3:open-f2p:activity:synthetic:1']) {
    assert.equal(isPermanentId(id), false);
  }
});

test('every retained ordinary task, collection goal and equipment entity has permanent subjects', async () => {
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const ids = new Set();
  for (const [category, tasks] of Object.entries(definitions.challenges)) for (const label of Object.keys(tasks)) {
    const id = permanentTaskId(category, label);
    assert.match(id, /^rs3:task:[0-9a-f]{6}$/); assert.ok(!ids.has(id)); ids.add(id);
  }
  assert.equal(ids.size, 20375);
  for (const name of Object.keys(definitions.equipment)) assert.match(entityId('item', name), /^rs3:entity:[0-9a-f]{6}$/);
  const goals = createCollectionEngine(definitions).catalogue;
  assert.equal(goals.length, 124526);
  assert.ok(goals.every(goal => !goal.id.includes('unregistered')));
  for (const goal of [...goals, ...buildEquipmentCatalogue(definitions)]) assert.equal(resolveIdentity(legacyTaskId(goal.category, goal.rawLabel)).id, goal.id);
  assert.equal(authoredTasks.length, 20375); assert.ok(authoredEntities.length > 19000);
});

test('authored PickerId separates ordinary identity from category and label', () => {
  const id = 'rs3:task:test-quest';
  assert.equal(permanentTaskId('Quest', 'Typo', { PickerId: id }), id);
  assert.equal(permanentTaskId('Activity', 'Correct label', { PickerId: id }), id);
  assert.equal(permanentTaskId('Synthetic', 'Unregistered'), legacyTaskId('Synthetic', 'Unregistered'));
  assert.equal(resolveIdentity(legacyTaskId('Synthetic', 'Unregistered')).status, 'unresolved');
});

test('historical collection aliases resolve independently of rates and quantities', () => {
  const source = entityId('monster', 'Cow'), item = entityId('item', 'Bones');
  const every = generatedGoalId('every-drop', source, item), all = generatedGoalId('all-droptables', source, item);
  for (const rate of ['1/10', '1/20', 'Always', 'Unknown', '1/9,999']) {
    assert.equal(resolveIdentity(legacyTaskId('Extra', `Cow: ~|Bones|~ (${rate})`)).id, every);
    for (const quantity of ['1', '20', '1-500', '2 (noted)']) assert.equal(resolveIdentity(legacyTaskId('Extra', `Cow: ~|Bones|~ (${quantity}) (${rate})`)).id, all);
  }
  assert.equal(resolveIdentity(legacyTaskId('Extra', 'Missing creature: ~|Bones|~ (1/20)')).status, 'unresolved');
});

test('history conflicts retain all decoders and category qualified aliases', () => {
  const id = 'rs3:task:rename-test';
  const old = legacyTaskId('Old category', 'Old label');
  const index = buildIdentityIndex([{ id, category: 'New category', label: 'New label', rawLabel: 'New label', aliases: [old, 'Old label'] }], {
    history: { mappings: { 'Old label': 't_1' }, tombstones: { 'Old label': 't_1' }, conflicts: [{ label: 'Old label', ids: ['t_1', 't_2'] }] },
  });
  assert.equal(index.resolve(old, { category: 'Old category' }).id, id);
  assert.equal(index.resolve('t_1', { category: 'Old category' }).id, id);
  assert.equal(index.resolve('t_2').id, id);
  const snapshot = index.snapshot([id]);
  assert.equal(snapshot.aliases[old], id); assert.equal(snapshot.aliases.t_2, id);
});

test('semantic aliases are recorded in the compact snapshot and survive serialization', () => {
  const alias = legacyTaskId('Extra', 'Cow: ~|Bones|~ (999) (1/777)');
  const index = buildIdentityIndex([]), resolution = index.resolve(alias);
  assert.equal(resolution.status, 'resolved');
  const snapshot = JSON.parse(JSON.stringify(index.snapshot([resolution.id])));
  assert.equal(snapshot.aliases[alias], resolution.id);
  assert.equal(resolveIdentity(alias, snapshot).id, resolution.id);
  assert.ok(index.lookup(resolution.id).aliases.includes(alias));
  assert.equal(lookupPermanentId(resolution.id).kind, 'collection');
});

test('dangling saved aliases are preserved and remain unresolved', () => {
  const aliases = { 'retired-id': 'rs3:task:missing-entry' };
  const index = buildIdentityIndex([], { savedRegistry: { schemaVersion: 1, entries: {}, aliases, unresolved: [] } });
  assert.equal(index.resolve('retired-id').status, 'unresolved');
  assert.deepEqual(index.snapshot([]).aliases, aliases);
});

test('registry maintenance mints once and records explicit renames without discarding rows', async () => {
  const parent = resolve(root, '.local', 'identity-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, 'registry-'));
  assert.ok(resolve(directory).startsWith(`${parent}${sep}`));
  const definitionsPath = resolve(directory, 'definitions.json'), registryPath = resolve(directory, 'registry.mjs');
  const run = extra => {
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/update-identities.mjs'), '--definitions', definitionsPath, '--registry', registryPath, '--seed-only', ...extra], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  try {
    await writeFile(definitionsPath, JSON.stringify({ challenges: { Quest: { 'Old label': {} } }, equipment: { Sword: {} } }));
    run([]);
    const first = await import(`${pathToFileURL(registryPath)}?first`), id = first.authoredTasks[0][0], entity = first.authoredEntities[0][0];
    await writeFile(definitionsPath, JSON.stringify({ challenges: { Activity: { 'New label': {} } }, equipment: { Blade: {} } }));
    run(['--rename-task', id, 'Activity', 'New label', '--rename-entity', entity, 'item', 'Blade']);
    const second = await import(`${pathToFileURL(registryPath)}?second`);
    assert.equal(second.authoredTasks.length, 1); assert.equal(second.authoredTasks[0][0], id);
    assert.deepEqual(second.authoredTasks[0][3], [['Quest', 'Old label']]);
    assert.equal(second.authoredEntities.length, 1); assert.equal(second.authoredEntities[0][0], entity);
    assert.ok(second.authoredEntities[0][3].includes('Sword'));
    await writeFile(definitionsPath, JSON.stringify({ challenges: {}, equipment: {} })); run([]);
    const third = await import(`${pathToFileURL(registryPath)}?third`);
    assert.equal(third.authoredTasks[0][0], id); assert.equal(third.authoredEntities[0][0], entity);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
