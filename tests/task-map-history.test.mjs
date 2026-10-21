import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import taskMapGenerator from '../scripts/updateTasksMap.js';
import { migrateGameplay, stableTaskId } from '../app/tasks/migration.mjs';

const { generateTaskNames, regenerateTaskMap, run } = taskMapGenerator;
const root = fileURLToPath(new URL('../', import.meta.url));

test('regeneration retains removed decoders and tombstones independently of the current catalogue', () => {
  const taskMap = { Removed: 't_100', Retained: 't_10', currentNextIndex: 2 };
  const input = structuredClone(taskMap);
  const first = regenerateTaskMap({ taskNames: ['Retained', 'New', 'New'], taskMap });
  assert.deepEqual(taskMap, input);
  assert.deepEqual(first.current, { Retained: 't_10', New: 't_101', currentNextIndex: 102 });
  assert.deepEqual(first.history.mappings, { Removed: 't_100', Retained: 't_10', New: 't_101' });
  assert.deepEqual(first.history.tombstones, { Removed: 't_100' });
  const second = regenerateTaskMap({ taskNames: ['Removed', 'Later'], taskMap: first.current, history: first.history });
  assert.equal(second.current.Removed, 't_100', 'resurrected labels reuse their historical decoder');
  assert.equal(second.current.Later, 't_102', 'removed codes are never recycled');
  assert.deepEqual(second.history.tombstones, { Retained: 't_10', New: 't_101' });
  assert.deepEqual(regenerateTaskMap({ taskNames: ['Removed', 'Later'], taskMap: second.current, history: second.history }), second);
});

test('historical reassignment preserves every label/code association and validates its ledger', () => {
  const history = { schemaVersion: 1, currentNextIndex: 5, mappings: { Label: 't_4' }, tombstones: {}, conflicts: [] };
  const taskMap = { Label: 't_20', currentNextIndex: 5 };
  const before = structuredClone({ history, taskMap });
  const result = regenerateTaskMap({ taskNames: ['Label', 'Next'], taskMap, history });
  assert.deepEqual({ history, taskMap }, before);
  assert.equal(result.current.Label, 't_20');
  assert.equal(result.history.mappings.Label, 't_4');
  assert.deepEqual(result.history.conflicts, [{ label: 'Label', ids: ['t_20', 't_4'] }]);
  assert.equal(result.current.Next, 't_21');
  assert.throws(() => regenerateTaskMap({ taskNames: [], history: { schemaVersion: 2 } }), /schema/);
  assert.throws(() => regenerateTaskMap({ taskNames: [], history: { mappings: { Lost: null } } }), /mapping/);
});

test('the default authored ledger preserves all 35 reused legacy codes in the retained reference', async () => {
  const seed = JSON.parse(await readFile(new URL('../reference/original-picker/tasksMap.json', import.meta.url), 'utf8'));
  const history = JSON.parse(await readFile(new URL('../app/data/legacy-task-history.json', import.meta.url), 'utf8'));
  const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const result = regenerateTaskMap({ taskNames: generateTaskNames(definitions), taskMap: seed, history });
  const decoder = new Map();
  for (const [label, id] of Object.entries(seed)) {
    if (label === 'currentNextIndex') continue;
    assert.equal(result.history.mappings[label], id);
    assert.equal(result.current[label], id);
    const labels = decoder.get(id) ?? [];
    labels.push(label);
    decoder.set(id, labels);
  }
  assert.equal([...decoder.values()].filter(labels => labels.length > 1).length, 35);
  assert.equal(Object.keys(result.history.mappings).length, 92638);
  assert.equal(Object.keys(result.history.tombstones).length, 0);
});

test('file regeneration keeps the seed intact while historical labels survive repeated updates', async t => {
  const temporaryRoot = path.join(root, 'tests', '.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, 'task-map-'));
  assert.ok(path.resolve(temporary).startsWith(path.resolve(temporaryRoot) + path.sep));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const options = Object.fromEntries(['definitionsFile', 'seedFile', 'currentFile', 'historyFile']
    .map(key => [key, path.join(temporary, `${key}.json`)]));
  const seed = JSON.stringify({ Old: 't_50', currentNextIndex: 10 });
  await writeFile(options.seedFile, seed);
  await writeFile(options.definitionsFile, JSON.stringify({ challenges: { Quest: { Renamed: {} } } }));
  const first = run(options);
  assert.equal(first.current.Renamed, 't_51');
  assert.deepEqual(first.history.tombstones, { Old: 't_50' });
  assert.equal(await readFile(options.seedFile, 'utf8'), seed);
  await writeFile(options.definitionsFile, JSON.stringify({ challenges: { Quest: { Again: {} } } }));
  const second = run(options);
  assert.equal(second.current.Again, 't_52');
  assert.deepEqual(second.history.tombstones, { Old: 't_50', Renamed: 't_51' });
  assert.deepEqual(JSON.parse(await readFile(options.historyFile, 'utf8')), second.history);
  assert.deepEqual(run(options), second);
  assert.equal(await readFile(options.seedFile, 'utf8'), seed);
  assert.throws(() => run({ ...options, currentFile: options.seedFile }), /read-only/);
});

test('a removed legacy t_* decoder still imports in its category after regeneration', () => {
  const flower = 'Construct ~|stacked ceramic flower pots (level 16)|~';
  const elder = 'Fletch an ~|elder stock|~';
  const regenerated = regenerateTaskMap({ taskNames: [elder], taskMap: {
    [flower]: 't_120947', [elder]: 't_120947', currentNextIndex: 122895,
  } });
  assert.equal(regenerated.current[flower], undefined);
  assert.equal(regenerated.history.tombstones[flower], 't_120947');
  const originalMap = { chunkinfo: { completedChallenges: {
    Construction: { t_120947: true }, Fletching: { t_120947: true },
  } } };
  const input = { schemaVersion: 1, revision: 0, rules: {}, tasks: [], history: [],
    members: [{ id: 'player1', name: 'Player 1', sourceMapId: 'old', unlocked: [], selected: [],
      pendingRoll: [], blacklisted: [], completedTasks: [], teleports: [] }],
    legacy: { maps: { old: originalMap } } };
  const before = structuredClone(input);
  const result = migrateGameplay(input, { definitions: { challenges: {
    Construction: { [flower]: {} }, Fletching: { [elder]: {} },
  } }, taskMap: regenerated.current, taskMapHistory: regenerated.history });
  assert.deepEqual(input, before);
  assert.equal(result.state.members[0].taskStatus[stableTaskId('Construction', flower)].challengeCompleted, true);
  assert.equal(result.state.members[0].taskStatus[stableTaskId('Fletching', elder)].challengeCompleted, true);
  assert.deepEqual(result.report.unresolved, []);
  assert.equal(result.report.identities.lostRecords, 0);
  assert.deepEqual(result.state.legacy.maps.old, originalMap);
});
