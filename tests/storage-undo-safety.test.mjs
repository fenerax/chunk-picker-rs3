import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { playerControlSkills } from '../app/core/player-controls.mjs';
const observedSkill = playerControlSkills[0];
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildXpChoiceCatalogue } from '../app/core/xp-choices.mjs';

const protectedUndos = [
  [{ type: 'claim-task', taskId: 'custom:task' }, 'You can only undo task claims made by your signed-in player.'],
  [{ type: 'clear-task-claim', taskId: 'custom:task' }, 'You can only undo task claims made by your signed-in player.'],
  [{ type: 'tick-active-tasks', taskIds: ['custom:task'] }, 'You can only undo your own ticked tasks.'],
  [{ type: 'set-obtained-equipment', equipmentName: 'Synthetic pickaxe', obtained: true }, 'You can only undo obtained equipment records for your signed-in player.'],
  [{ type: 'set-xp-choices', taskId: 'custom:reward', choices: ['Mining'] }, 'You can only undo XP choices for your signed-in player.'],
  [{ type: 'set-transport-facts', facts: { currencies: { coins: 100 } } }, 'You can only undo travel facts for your signed-in player.'],
  [{ type: 'set-finish-line-custom', itemId: 'finish:goal', completed: true }, 'You can only undo finish line ticks for your signed-in player.'],
];
const inviteActor = memberId => ({ kind: 'invite', label: memberId ?? 'Unassigned', inviteId: `invite-${memberId ?? 'unassigned'}`, ...(memberId ? { memberId } : {}) });

for (const [command, message] of protectedUndos) for (const archived of [false, true]) for (const undoer of ['owner', 'master', 'admin invite']) {
  test(`${command.type} Undo checks the owner in ${archived ? 'archived' : 'recent'} History and allows ${undoer}`, async t => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-undo-owner-'));
    const initialState = createGroupState([{ id: 'owner', name: 'Owner' }, { id: 'other', name: 'Other' }]);
    initialState.tasks = [{ id: 'custom:task', label: 'Synthetic task', category: 'Custom' }];
    const reward = { id: 'custom:reward', label: 'Reward', category: 'Quest' };
    initialState.tasks.push(reward);
    const xpChoiceCatalogue = buildXpChoiceCatalogue({ challenges: { Quest: { Reward: { XpReward: { Any: 100 } } } } }, [reward]);
    const world = { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
    const store = await openStore({ dataDir, initialState, world, xpChoiceCatalogue, retention: { backupDays: 90, historyEntries: 1 } });
    t.after(async () => { await store.close(); await rm(dataDir, { recursive: true }); });
    const save = command => store.command(command, store.getInfo().revision, { actor: inviteActor('owner') });
    if (command.type === 'clear-task-claim') await save({ type: 'claim-task', memberId: 'owner', taskId: 'custom:task' });
    if (command.type === 'set-finish-line-custom') await save({ type: 'add-finish-line-custom', itemId: 'finish:goal', text: 'Synthetic goal' });
    const before = store.getState();
    const changed = await save({ ...command, memberId: 'owner' });
    const undo = { type: 'undo', undoRevision: changed.revision };
    if (archived) {
      for (let index = 0; index < 4; index++) await save({ type: 'set-journal', memberId: 'other', note: `Later ${index}` });
      assert.ok(store.getInfo().retention.historyArchives > 0);
      assert.equal(store.getHistoryEvent(changed.revision), undefined, 'The target really left resident History');
    } else assert.equal(store.getHistoryEvent(changed.revision).type, command.type);
    let baseline = store.getState(), revision = baseline.revision;
    let broadcasts = 0;
    store.subscribe(() => broadcasts++);
    await assert.rejects(store.command(undo, revision, { actor: inviteActor('other') }), { status: 403, message });
    await assert.rejects(store.commandSerialized(undo, revision, { actor: inviteActor('other') }), { status: 403, message });
    if (!archived) await assert.rejects(store.commandSerialized({ type: 'undo' }, revision, { actor: inviteActor('other') }), { status: 403, message });
    if (!['claim-task', 'clear-task-claim'].includes(command.type)) {
      await assert.rejects(store.command(undo, revision, { actor: inviteActor() }), { status: 403, message });
    } else {
      // Admin invites assigned to a player retain the existing claim rule.
      await assert.rejects(store.command(undo, revision, { actor: inviteActor('other'), admin: true }), { status: 403, message });
    }
    assert.deepEqual(store.getState(), baseline, 'Refusals leave gameplay and History unchanged');
    assert.equal(broadcasts, 0);
    const access = undoer === 'owner' ? { actor: inviteActor('owner') }
      : undoer === 'master' ? { actor: { kind: 'master', label: 'Administrator' } }
        : { actor: inviteActor(['claim-task', 'clear-task-claim'].includes(command.type) ? undefined : 'other'), admin: true };
    if (archived && command.type === 'set-finish-line-custom') {
      // Finish line inverses already require later reversible edits to be
      // undone first. Authorization must not relax that independent guard.
      await assert.rejects(store.command(undo, revision, access), /Older undo is supported only for guarded personal changes/);
      for (let index = 0; index < 4; index++) await store.command({ type: 'undo' }, store.getInfo().revision);
      baseline = store.getState(); revision = baseline.revision;
    }
    await store.commandSerialized(archived ? undo : { type: 'undo' }, revision, access);
    const restored = store.getState();
    assert.deepEqual(restored.members[0], before.members[0]);
    assert.deepEqual(restored.taskClaims ?? {}, before.taskClaims ?? {});
    assert.deepEqual(restored.finishLine, before.finishLine);
    assert.deepEqual(restored.members[1], baseline.members[1], 'Selected Undo preserves unrelated changes');
    assert.equal(restored.revision, revision + 1);
    assert.equal((await store.readHistoryEvent(changed.revision)).event.undoneRevision, restored.revision);
  });
}

test('store previews and metadata avoid full history snapshots and selected undo survives restart', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-undo-safety-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', runescapeName: 'Fixture One' }, { id: 'reed', name: 'Reed' }]);
  initialState.tasks = Array.from({ length: 512 }, (_, index) => ({ id: `custom:${index}`, label: `Task ${index}`, category: 'custom' }));
  const actor = { kind: 'invite', inviteId: 'actor1-invite', label: 'Player', memberId: 'actor1' };
  const world = { chunks: new Map(['100', '200'].map(id => [id, { id }])), neighbors: new Map(), walkable: new Set(['100', '200']), f2p: new Set(['100', '200']) };
  let store = await openStore({ dataDir, initialState, world });
  t.after(() => store.close());
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Own change' }, 0, { actor });
  await store.command({ type: 'set-note', memberId: 'reed', chunkId: '200', note: 'Keep partner change' }, 1);
  const baseline = store.getState();
  assert.deepEqual(store.getUndoEligibility(1), { canUndo: true, reason: null, undoRevision: 1 });
  assert.equal(store.getUndoEligibility().undoRevision, 2);
  const records = store.getRecentHistory();
  assert.equal(records.length, 2);
  assert.ok(records.every(event => event.hasUndo && !Object.hasOwn(event, 'undo')));
  assert.deepEqual(records[0].actor, actor);
  records[0].command.note = 'External mutation';
  records[0].actor.memberId = 'reed';
  assert.deepEqual(store.getState(), baseline);
  assert.deepEqual(store.getHistoryEvent(1).actor, actor);
  assert.equal(store.getHistoryEvent(99), undefined);
  assert.equal(store.getRecentHistory(1)[0].revision, 2);
  assert.equal(store.getRecentHistory(Number.MAX_SAFE_INTEGER).length, 2);
  assert.throws(() => store.getRecentHistory(0), /positive safe integer/);
  await assert.rejects(() => store.command({ type: 'undo', undoRevision: 1 }, 1, { actor }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(store.getState(), baseline);
  const stringify = JSON.stringify;
  let wholeStateCopies = 0;
  JSON.stringify = function (value, ...args) {
    const candidate = value?.state ?? value;
    if (candidate?.tasks?.length >= 512 && Array.isArray(candidate.members)) wholeStateCopies++;
    return stringify.call(this, value, ...args);
  };
  try { await store.commandSerialized({ type: 'undo', undoRevision: 1 }, 2, { actor, omitUnchanged: true }); }
  finally { JSON.stringify = stringify; }
  assert.equal(wholeStateCopies, 0, 'Retained sparse undo must bypass whole-state history hydration and public command cloning');
  assert.equal(store.getState().members[0].notes, undefined);
  assert.equal(store.getState().members[1].notes['200'], 'Keep partner change');
  assert.equal(store.getUndoEligibility(1).canUndo, false);
  assert.equal(store.getHistoryEvent(3).hasUndo, false);
  await store.close();
  store = await openStore({ dataDir, world });
  assert.equal(store.getUndoEligibility().undoRevision, 2);
  assert.equal(store.getHistoryEvent(1).undoneRevision, 3);
  assert.deepEqual(store.getHistoryEvent(3).actor, actor);
  await store.command({ type: 'undo' }, 3);
  assert.equal(store.getState().members[1].notes, undefined);
  await store.command({ type: 'apply-runemetrics', memberId: 'actor1', runescapeName: 'Fixture One',
    fetchedAt: '2026-10-10T12:00:00.000Z', skills: [{ skill: observedSkill, level: 1, xp: 0 }], quests: [] }, 4, { actor });
  const sync = store.getHistoryEvent(5);
  assert.equal(sync.command.skillCount, 1);
  assert.equal(sync.command.questCount, 0);
  assert.equal(Object.hasOwn(sync.command, 'skills'), false);
  assert.equal(Object.hasOwn(sync.command, 'quests'), false);
  assert.equal(store.getHistory().history.at(-1).command.skills.length, 1, 'Full History retains the original command');
});

test('failed sparse selected undo leaves the source marker and gameplay unchanged before retry', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-undo-rollback-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player', runescapeName: 'Fixture One' }, { id: 'reed', name: 'Reed' }]);
  const world = { chunks: new Map(['100', '200'].map(id => [id, { id }])), neighbors: new Map(), walkable: new Set(['100', '200']), f2p: new Set(['100', '200']) };
  let fail = false;
  const store = await openStore({ dataDir, initialState, world, beforeCommit: () => { if (fail) throw new Error('Interrupted sparse undo'); } });
  t.after(() => store.close());
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Own change' }, 0);
  await store.command({ type: 'set-note', memberId: 'reed', chunkId: '200', note: 'Keep partner change' }, 1);
  const before = store.getState();
  let broadcasts = 0;
  store.subscribe(() => broadcasts++);
  fail = true;
  await assert.rejects(() => store.commandSerialized({ type: 'undo', undoRevision: 1 }, 2), /Interrupted sparse undo/);
  assert.deepEqual(store.getState(), before);
  assert.equal(store.getHistoryEvent(1).undoneRevision, undefined);
  assert.equal(store.getUndoEligibility(1).canUndo, true);
  assert.equal(broadcasts, 0);
  fail = false;
  await store.commandSerialized({ type: 'undo', undoRevision: 1 }, 2);
  assert.equal(store.getHistoryEvent(1).undoneRevision, 3);
  assert.equal(store.getState().members[0].notes, undefined);
  assert.equal(store.getState().members[1].notes['200'], 'Keep partner change');
  assert.equal(broadcasts, 1);
});
