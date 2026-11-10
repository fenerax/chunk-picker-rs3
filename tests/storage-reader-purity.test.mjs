// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { openStore } from '../app/storage/store.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { applyCommand, createGroupState, getUndoEligibility } from '../app/core/state.mjs';
import { prepareOwnedPickerState } from '../app/game-profile.mjs';
import { ownedCommandFixture, ownedNow, ownedPickerId, ownedRegistry, ownedWorld } from '../scripts/perf/owned-command-fixture.mjs';

for (const owned of [false, true]) test(`${owned ? 'owned guard' : 'legacy without a caller hook'}: add, edit, GET coordination, edit commits a reopenable save`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-reader-purity-'));
  let app;
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  const dataset = owned ? selectedDataset : { ...selectedDataset,
    capabilities: { ...selectedDataset.capabilities, independent: false } };
  const { state } = ownedCommandFixture({ taskCount: 2, extraAliases: 1, evidenceCopies: 0 });
  state.provenance.dataset = { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest };
  const options = { dataset, dataDir: path.join(root, 'store'), initialState: state, port: 0,
    ingressRole: 'private', loopbackRole: 'private', signIn: 'off',
    retention: false, predictionPrewarm: false, now: ownedNow,
    definitions: { challenges: {}, chunks: { '12341': {}, '12342': {} },
      walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] }, taskMap: {},
    packsDir: path.join(root, 'packs'), gameDataDir: path.join(root, 'game-data'),
    mapAssetsDir: path.join(root, 'assets'), terrainAssetsDir: path.join(root, 'assets'),
    iconAssetsDir: path.join(root, 'assets'), worldImagesRoot: path.join(root, 'world-images'),
    ...(owned ? { prepareState: prepareOwnedPickerState(dataset, ownedRegistry(), ownedPickerId) } : {}) };
  app = await createServer(options); await app.listen();
  const stateFile = path.join(options.dataDir, 'state.json');
  const request = async (route, body) => {
    const base = `http://127.0.0.1:${app.address().port}`;
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: {
      Authorization: 'Bearer ' + app.store.getAccessToken(), ...(body ? { Origin: base, 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const assertReopens = async () => {
    const bytes = await readFile(stateFile);
    const reader = await openStore({ dataDir: options.dataDir, readOnly: true, now: ownedNow, retention: false });
    try { assert.equal(reader.getInfo().revision, app.store.getInfo().revision); }
    finally { await reader.close(); }
    assert.deepEqual(await readFile(stateFile), bytes);
  };
  const command = async command => {
    await request('/api/command?view=play-v1', { command, expectedRevision: app.store.getInfo().revision });
    await assertReopens();
  };
  const task = { id: 'custom:synthetic-reader', category: 'Custom', label: 'Original synthetic task' };
  await command({ type: 'add-task', task });
  await command({ type: 'update-task', taskId: task.id, task: { label: 'First synthetic edit' } });
  const beforeRead = app.store.getState(), bytesBeforeRead = await readFile(stateFile);
  await request('/api/coordination');
  await assertReopens();
  const afterRead = app.store.getState();
  assert.deepEqual(await readFile(stateFile), bytesBeforeRead);
  await command({ type: 'update-task', taskId: task.id, task: { label: 'Second synthetic edit' } });
  assert.deepEqual(afterRead, beforeRead, 'Coordination must preserve gameplay, History and the shared catalogue');
  for (const route of ['/api/state?view=play-v1', '/api/coordination', '/api/history']) {
    const before = app.store.getState();
    await request(route); await assertReopens();
    app.store.getProgress();
    assert.deepEqual(app.store.getState(), before, route);
  }
  const committed = app.store.getState();
  await app.close();
  app = await createServer(options);
  assert.deepEqual(app.store.getState(), committed);
  assert.equal(app.store.getInfo().revision, 3);
});

function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
test('every Undo inverse family previews frozen gameplay and History without writes', () => {
  const task = { id: 'custom:synthetic-purity', category: 'Custom', label: 'Synthetic task' };
  const initial = () => {
    const state = createGroupState([{ id: 'synthetic-a', name: 'Synthetic A', unlocked: ['12341'] }]);
    state.tasks = [task];
    return state;
  };
  const options = { world: ownedWorld, now: ownedNow };
  const scenarios = [
    [{ type: 'update-task', taskId: task.id, task: { label: 'Edited synthetic task', memberIds: ['synthetic-a'] } }],
    [{ type: 'delete-task', taskId: task.id }],
    [{ type: 'add-task', task: { id: 'custom:synthetic-add', category: 'Custom', label: 'Added synthetic task' } }],
    [{ type: 'set-note', memberId: 'synthetic-a', chunkId: '12341', note: 'Synthetic note' }],
    [{ type: 'set-rule', ruleId: 'access.shared', value: false }],
    [{ type: 'claim-task', memberId: 'synthetic-a', taskId: task.id }],
    [{ type: 'claim-task', memberId: 'synthetic-a', taskId: task.id },
      { type: 'clear-task-claim', memberId: 'synthetic-a', taskId: task.id }],
    [{ type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: true, note: 'Synthetic review' }],
    [{ type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: true, note: '' },
      { type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: false, note: '' }],
    [{ type: 'add-finish-line-custom', itemId: 'finish:synthetic', text: 'Synthetic finish item' }],
    [{ type: 'add-finish-line-custom', itemId: 'finish:synthetic', text: 'Synthetic finish item' },
      { type: 'delete-finish-line-custom', itemId: 'finish:synthetic' }],
    [{ type: 'add-group-goal', goalId: 'group-goal:synthetic', text: 'Synthetic goal', completion: 'players' }],
    [{ type: 'add-group-goal', goalId: 'group-goal:synthetic', text: 'Synthetic goal', completion: 'players' },
      { type: 'remove-group-goal', goalId: 'group-goal:synthetic' }],
    [{ type: 'add-sticker', memberId: 'synthetic-a', chunkId: '12341',
      sticker: { type: 'star', color: '#123456', text: 'Synthetic' } }],
  ];
  for (const commands of scenarios) {
    let state = initial();
    for (const command of commands) state = applyCommand(state, command, options);
    const before = structuredClone(state);
    assert.deepEqual(getUndoEligibility(freeze(state)), { canUndo: true, reason: null, undoRevision: state.revision }, commands.at(-1).type);
    assert.deepEqual(state, before, commands.at(-1).type);
    // A second read exercises the task-index cache after previewing the inverse.
    assert.equal(getUndoEligibility(state).canUndo, true, commands.at(-1).type);
  }
});

test('a failed Undo preview also preserves the shared catalogue and its cached index', () => {
  const task = { id: 'custom:synthetic-failed-preview', category: 'Custom', label: 'Original synthetic task' };
  let state = createGroupState([{ id: 'synthetic-a', name: 'Synthetic A' }]);
  state.tasks = [task];
  state = applyCommand(state, { type: 'update-task', taskId: task.id, task: { label: 'Edited synthetic task' } }, { now: ownedNow });
  // An invalid reference makes the preview fail after it has applied the
  // catalogue inverse to its private projection. No disk save uses this input.
  state.members[0].completedTasks = ['custom:synthetic-absent'];
  const before = structuredClone(state);
  for (const read of [() => getUndoEligibility(state), () => getUndoEligibility(freeze(state))]) {
    assert.deepEqual(read(), { canUndo: false, reason: 'Undo references absent task: custom:synthetic-absent' });
    assert.deepEqual(state, before);
  }
});
