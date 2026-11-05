import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGroupState, importBackup, exportBackup } from '../app/core/state.mjs';
import { importBackup as loadLiveBackup, applyCommand as applyLiveCommand, exportBackup as exportLiveBackup } from './fixtures/rollback-main/state.mjs';
import { createPlatformApiClient } from '../app/integrations/platform-api.mjs';
import { previewRuneMetrics, createQuestMapping } from '../app/integrations/runemetrics.mjs';
import { platformResponse } from './helpers/platform-api-fixtures.mjs';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';
import { openStore } from '../app/storage/store.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('a Platform-synced durable save loads with the frozen live-release loader', async t => {
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

  // Prove that the real main validator rejects an incompatible saved source.
  const unknownSource = structuredClone(durable);
  unknownSource.state.members[0].runeMetricsSync.source = 'platform-api';
  assert.throws(() => loadLiveBackup(unknownSource), /source must be runemetrics, official-api or hiscores/);

  const undone = applyLiveCommand(loaded, { type: 'undo' }, { now: () => '2026-11-04T12:01:00Z' });
  assert.deepEqual(undone.members, state.members, 'Main undo removes Platform skill and quest observations');
  const rolledForward = importBackup(exportLiveBackup(undone));
  assert.deepEqual(rolledForward, undone, 'Main undo remains loadable on this branch');
  assert.deepEqual(loadLiveBackup(exportBackup(rolledForward)), undone);
});

// Keep the release exports mechanically tied to git show, never hand copies.
test('rollback fixtures are exports of origin/main loader and validation at 06e1593', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const sha = execFileSync('git', ['rev-parse', 'origin/main'], { cwd, encoding: 'utf8' }).trim();
  assert.equal(sha, '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e');
  for (const name of ['state', 'game-progress', 'progress-snapshots']) {
    const source = execFileSync('git', ['show', `origin/main:app/core/${name}.mjs`], { cwd, encoding: 'utf8' });
    const relocated = source.replace(/(from ['"])(\.[^'"]+)(['"])/g, (match, before, target, after) => {
      if (['./game-progress.mjs', './progress-snapshots.mjs'].includes(target)) return match;
      return before + (target.startsWith('./') ? '../../../app/core/' + target.slice(2) : '../../../app/' + target.slice(3)) + after;
    });
    const fixture = await readFile(new URL(`./fixtures/rollback-main/${name}.mjs`, import.meta.url), 'utf8');
    assert.equal(fixture.replace(/\r\n/g, '\n'), `// Frozen from live release ${sha}.\n// Only import paths are relocated; validation behavior must remain unchanged.\n${relocated}`);
  }
});
