import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { importBackup as loadLiveBackup } from './fixtures/rollback-main/state.mjs';
import { createPlatformApiClient } from '../app/integrations/platform-api.mjs';
import { previewRuneMetrics, createQuestMapping } from '../app/integrations/runemetrics.mjs';
import { platformResponse } from './helpers/platform-api-fixtures.mjs';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';

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
  assert.equal(loaded.provenance.questPointProgress[state.members[0].id].current, 17);
  assert.equal(loaded.provenance.questPointProgress[state.members[0].id].source, 'platform-api');
  assert.equal(loaded.history.at(-1).command.source, 'platform-api');
  assert.equal(loaded.provenance.progressQuestPoints.days[0][2][0], 17);
  assert.equal(store.getCalculationState().provenance.questPointProgress[state.members[0].id].current, 17);
  const fingerprint = createTaskReuseFingerprint(), calculation = store.getCalculationState();
  const otherPoints = structuredClone(calculation);
  otherPoints.provenance.questPointProgress[state.members[0].id].current = 18;
  assert.notEqual(fingerprint(calculation), fingerprint(otherPoints), 'Readiness cache keys include authoritative QP');

  // Prove that this fixture really exercises the two rollback rejection paths.
  const unknownMember = structuredClone(durable);
  unknownMember.state.members[0].questPointProgress = loaded.provenance.questPointProgress[state.members[0].id];
  assert.throws(() => loadLiveBackup(unknownMember), /Unknown member field: questPointProgress/);
  const unknownSource = structuredClone(durable);
  unknownSource.state.members[0].runeMetricsSync.source = 'platform-api';
  assert.throws(() => loadLiveBackup(unknownSource), /source must be runemetrics, official-api or hiscores/);

  const undone = applyCommand(loaded, { type: 'undo' }, { now: () => '2026-11-04T12:01:00Z' });
  assert.equal(undone.provenance.questPointProgress[state.members[0].id], undefined);
  assert.deepEqual(loadLiveBackup({ ...durable, state: undone }), undone);
});
