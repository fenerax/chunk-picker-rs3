import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyCommand, createGroupState, importBackup, exportBackup } from '../app/core/state.mjs';
// Fast hybrid check: three pinned files import 22 live app modules, five of
// which changed after the pin. Only frozen-release-rollback.test runs the
// actual frozen dependency graph.
import { importBackup as loadLiveBackup, applyCommand as applyLiveCommand, exportBackup as exportLiveBackup } from './fixtures/rollback-main/state.mjs';
import { createPlatformApiClient } from '../app/integrations/platform-api.mjs';
import { previewRuneMetrics, createQuestMapping } from './helpers/legacy-runemetrics.mjs';
import { platformResponse } from './helpers/platform-api-fixtures.mjs';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';
import { openStore } from '../app/storage/store.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('fast hybrid check: a Platform-synced durable save loads and Undoes', async t => {
  blockUnmockedFetch(t);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'platform-rollback-'));
  let store;
  t.after(async () => { await store?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const state = createGroupState([{ id: 'synthetic-member', name: 'Synthetic player', runescapeName: 'FixtureActor' }]);
  const task = { id: 'synthetic-quest', category: 'Quest', label: 'Broken Home' };
  state.tasks = [task];
  const mapping = createQuestMapping({ challenges: { Quest: { 'Broken Home': { QuestPoints: 1 } } } });
  // Mapping normally uses catalogue identities; this tiny fixture owns its ID.
  for (const rows of mapping.values()) for (const row of rows) row.taskId = task.id;
  const client = createPlatformApiClient({ fetchImpl: async url => platformResponse(url), clock: () => Date.parse('2026-11-04T12:00:00Z') });
  t.after(() => client.close());
  const { command } = previewRuneMetrics(state, state.members[0].id, await client.snapshot(state.members[0]), mapping);
  assert.equal(command.source, 'platform-api');
  assert.ok(command.skills.length > 0 && command.quests.length > 0);
  store = await openStore({ dataDir, initialState: state, now: () => '2026-11-04T12:00:00Z', progressQuestPoints: new Map([[task.id, 1]]), retention: false });
  await store.command(command, 0);
  const durable = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  const loaded = loadLiveBackup(durable);
  assert.deepEqual(loaded, store.getState());
  assert.equal(loaded.members[0].questPointProgress, undefined);
  assert.equal(loaded.members[0].runeMetricsSync.source, 'official-api');
  assert.ok(Object.values(loaded.members[0].skillProgress).every(row => row.source === 'official-api'));
  assert.ok(Object.values(loaded.members[0].questProgress).every(row => row.source === 'official-api'));
  assert.equal(loaded.provenance?.questPointProgress, undefined);
  assert.equal(loaded.provenance?.progressQuestPoints, undefined);
  assert.equal(loaded.provenance?.progressCompletionBaseline, undefined);
  assert.equal(loaded.history.at(-1).command.source, 'platform-api');
  assert.equal(Object.hasOwn(loaded.history.at(-1).command, 'questPoints'), false);
  assert.equal(loaded.history.at(-1).questPointChange, undefined);
  assert.equal(loaded.progressSnapshots.days[0].length, 4);
  assert.equal(loaded.progressSnapshots.days[0][2][0][2], 1, 'Timeline keeps main completion estimates');

  // Prove that the hybrid validator rejects an incompatible saved source.
  const unknownSource = structuredClone(durable);
  unknownSource.state.members[0].runeMetricsSync.source = 'platform-api';
  assert.throws(() => loadLiveBackup(unknownSource), /source must be runemetrics, official-api or hiscores/);

  const undone = applyLiveCommand(loaded, { type: 'undo' }, { now: () => '2026-11-04T12:01:00Z' });
  assert.deepEqual(undone.members, state.members, 'Main undo removes Platform skill and quest observations');
  const rolledForward = importBackup(exportLiveBackup(undone));
  assert.deepEqual(rolledForward, undone, 'Main undo remains loadable on this branch');
  assert.deepEqual(loadLiveBackup(exportBackup(rolledForward)), undone);
});

test('restore rejects persisted platform-api provenance without writing any store files', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'platform-restore-rejection-'));
  let store;
  t.after(async () => { await store?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const state = createGroupState([{ id: 'synthetic-member', name: 'Synthetic player', runescapeName: 'FixtureActor' }]);
  const quest = { id: 'synthetic-quest', category: 'Quest', label: 'Synthetic quest' };
  state.tasks = [quest];
  const command = { type: 'apply-runemetrics', source: 'platform-api', memberId: state.members[0].id,
    runescapeName: 'FixtureActor', fetchedAt: '2026-11-04T12:00:00Z',
    skills: [{ skill: 'Attack', level: 7, xp: 700 }], quests: [{ taskId: quest.id, title: quest.label }] };
  const synced = applyCommand(state, command);
  // A second sync gives sparse undo both before and after provenance to validate.
  const updated = applyCommand(synced, { ...command, fetchedAt: '2026-11-04T12:01:00Z' });
  store = await openStore({ dataDir, initialState: updated, retention: false });
  const backup = await store.backup();
  assert.deepEqual(loadLiveBackup(backup), updated, 'command.source remains rollback-compatible');
  const snapshot = async () => {
    const files = (await readdir(dataDir, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name)).sort();
    return Promise.all(files.map(async file => [file, await readFile(file)]));
  };
  const filesBefore = await snapshot();
  let notifications = 0;
  store.subscribe(() => notifications++);
  for (const field of ['skillProgress', 'questProgress', 'runeMetricsSync']) {
    for (const location of ['member', 'undo-before', 'undo-after', 'undo-snapshot']) {
      await t.test(`${field} in ${location}`, async () => {
        const invalid = structuredClone(backup);
        let observation;
        if (location === 'member' || location === 'undo-snapshot') {
          const member = location === 'member' ? invalid.state.members[0] : structuredClone(synced.members[0]);
          observation = field === 'runeMetricsSync' ? member[field] : Object.values(member[field])[0];
          if (location === 'undo-snapshot') invalid.state.history.at(-1).undo = { members: [member] };
        } else {
          const patch = invalid.state.history.at(-1).undo.memberChanges[0].changes.find(row => row.path[0] === field && row.kind === 'value');
          observation = patch[location === 'undo-before' ? 'before' : 'after'].value;
        }
        observation.source = 'platform-api';
        const error = /source must be runemetrics, official-api or hiscores/;
        assert.throws(() => loadLiveBackup(invalid), error);
        assert.throws(() => importBackup(invalid), error);
        await assert.rejects(store.replace(invalid, updated.revision), error);
        assert.deepEqual(store.getState(), updated);
        assert.deepEqual(await snapshot(), filesBefore, 'failed restore writes no files');
        assert.equal(notifications, 0);
      });
    }
  }
});

// Keep the three pinned files mechanically tied to git show. Their 22 live
// imports make this a fast hybrid check, not an exact frozen-runtime test.
const LIVE_RELEASE_SHA = '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e';
test('fast hybrid fixture files match their pinned sources at 06e15939', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const sha = LIVE_RELEASE_SHA;
  execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
  for (const name of ['state', 'game-progress', 'progress-snapshots']) {
    const fixture = (await readFile(new URL(`./fixtures/rollback-main/${name}.mjs`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const source = execFileSync('git', ['show', `${sha}:app/core/${name}.mjs`], { cwd, encoding: 'utf8' });
    const relocated = source.replace(/(from ['"])(\.[^'"]+)(['"])/g, (match, before, target, after) => {
      if (['./game-progress.mjs', './progress-snapshots.mjs'].includes(target)) return match;
      return before + (target.startsWith('./') ? '../../../app/core/' + target.slice(2) : '../../../app/' + target.slice(3)) + after;
    });
    assert.equal(fixture, `// Fast hybrid check: source pinned to ${sha}; imports use live app modules.\n// Five of 22 live imports changed after the pin; this is not a frozen runtime.\n${relocated}`);
  }
});
