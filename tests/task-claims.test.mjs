import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir, rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, exportBackup, importBackup, getUndoEligibility } from '../app/core/state.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { lookupPermanentId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { openStore } from '../app/storage/store.mjs';

const now = () => '2026-10-12T12:00:00.000Z';
const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const claim = (taskId = 'custom:first', memberId = 'actor1', extra = {}) => ({ type: 'claim-task', memberId, taskId, ...extra });
function initial() {
  const state = createGroupState(owners);
  state.tasks = ['first', 'second', 'family'].map(id => ({ id: `custom:${id}`, label: id, category: 'Extra' }));
  return state;
}
const run = (state, command, options = {}) => applyCommand(state, command, { now, expectedRevision: state.revision, ...options });

test('claims are shared coordination with trusted labels, attribution, backups and play projection', () => {
  const original = initial(), actor = { kind: 'invite', label: 'Reed', inviteId: 'invite-reed', memberId: 'reed' };
  const state = run(original, claim('custom:first', 'reed'), { actor });
  assert.deepEqual(state.taskClaims, { 'custom:first': { memberId: 'reed', at: now() } });
  assert.deepEqual(state.members, original.members);
  assert.deepEqual(state.tasks, original.tasks);
  assert.equal(state.history[0].command.taskLabel, 'first');
  assert.deepEqual(state.history[0].actor, actor);
  assert.deepEqual(importBackup(exportBackup(state)), state);
  const play = projectPlayState(state);
  assert.deepEqual(play.taskClaims, state.taskClaims);
  assert(play.tasks.some(task => task.id === 'custom:first'));
});

test('claim and release commands reject invalid IDs, owners, payload metadata and unsafe keys atomically', () => {
  const state = initial(), before = structuredClone(state);
  for (const command of [claim('missing'), claim('custom:first', 'missing'), claim('constructor'), claim('custom:first', 'actor1', { at: now() }), claim('custom:first', 'actor1', { taskLabel: 'forged' }), claim('custom:first', 'actor1', { previousMemberId: 'reed' }), claim('custom:first', 'actor1', { takeover: 'yes' })]) {
    assert.throws(() => run(state, command, { now: () => { throw Error('Rejected before timestamp'); } }));
  }
  assert.deepEqual(state, before);
  const claimed = run(state, claim());
  assert.throws(() => run(claimed, claim()), /already claimed/);
  assert.throws(() => run(claimed, { type: 'clear-task-claim', taskId: 'custom:first', memberId: 'reed' }), /claiming member/);
  assert.throws(() => run(state, { type: 'clear-task-claim', taskId: 'custom:first', memberId: 'actor1' }), /no claim/);
});

test('takeover requires explicit confirmation and Undo restores preceding owner', () => {
  const first = run(initial(), claim());
  assert.throws(() => run(first, claim('custom:first', 'reed')), /confirm takeover/);
  const taken = run(first, claim('custom:first', 'reed', { takeover: true }));
  assert.equal(taken.history.at(-1).command.previousMemberId, 'actor1');
  assert.equal(taken.taskClaims['custom:first'].memberId, 'reed');
  assert.deepEqual(run(taken, { type: 'undo' }).taskClaims, first.taskClaims);
});

test('release is reversible and first-claim Undo restores optional dictionary absence', () => {
  const original = initial(), first = run(original, claim());
  assert.equal(Object.hasOwn(run(first, { type: 'undo' }), 'taskClaims'), false);
  const released = run(first, { type: 'clear-task-claim', memberId: 'actor1', taskId: 'custom:first' });
  assert.deepEqual(released.taskClaims, {});
  assert.deepEqual(run(released, { type: 'undo' }).taskClaims, first.taskClaims);
});

test('older guarded claim Undo preserves unrelated claims and personal edits', () => {
  let state = run(initial(), claim());
  state = run(state, claim('custom:second', 'reed'));
  state = run(state, { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:second', favorite: true });
  assert.equal(getUndoEligibility(state, 1).canUndo, true);
  const undone = applyValidatedCommand(state, { type: 'undo', undoRevision: 1 }, { now });
  assert.deepEqual(Object.keys(undone.taskClaims), ['custom:second']);
  assert.equal(undone.members[0].taskStatus['custom:second'].favorite, true);
  assert.deepEqual(validateState(undone), undone);
});

test('a later takeover blocks older claim Undo while the latest takeover can undo', () => {
  const state = run(run(initial(), claim()), claim('custom:first', 'reed', { takeover: true }));
  assert.equal(getUndoEligibility(state, 1).canUndo, false);
  assert.equal(getUndoEligibility(state, 2).canUndo, true);
});

test('older release Undo cannot revive dibs after newer completion or availability changes', () => {
  const released = run(run(initial(), claim()), { type: 'clear-task-claim', taskId: 'custom:first', memberId: 'actor1' });
  for (const command of [
    { type: 'complete-task', memberId: 'reed', taskId: 'custom:first', completed: true },
    { type: 'set-task-status', memberId: 'reed', taskId: 'custom:first', challengeCompleted: true },
    { type: 'set-task-status', memberId: 'reed', taskId: 'custom:first', backlogged: true },
    { type: 'set-task-rule', memberId: 'reed', ruleId: 'Quests', value: false },
    { type: 'set-rule', ruleId: 'access.shared', value: false },
  ]) {
    const changed = run(released, command), before = structuredClone(changed);
    assert.equal(getUndoEligibility(changed, 2).canUndo, false);
    assert.match(getUndoEligibility(changed, 2).reason, /newer task or map change/);
    assert.throws(() => run(changed, { type: 'undo', undoRevision: 2 }), /newer task or map change/);
    assert.deepEqual(changed, before);
  }
});

test('older release Undo stays available across unrelated dibs, preferences, notes and pins', () => {
  let state = run(run(initial(), claim()), { type: 'clear-task-claim', taskId: 'custom:first', memberId: 'actor1' });
  for (const command of [
    claim('custom:second', 'reed'),
    { type: 'set-preference', memberId: 'reed', preferenceId: 'hideChecked', value: true },
    { type: 'set-note', memberId: 'reed', chunkId: '12341', note: 'A map note' },
    { type: 'set-task-status', memberId: 'reed', taskId: 'custom:second', favorite: true, note: 'A task note' },
  ]) state = run(state, command, { world: { chunks: new Map([['12341', { id: '12341' }]]) } });
  assert.equal(getUndoEligibility(state, 2).canUndo, true);
  const restored = run(state, { type: 'undo', undoRevision: 2 });
  assert.deepEqual(Object.keys(restored.taskClaims).sort(), ['custom:first', 'custom:second']);
  assert.equal(restored.members[1].notes['12341'], 'A map note');
  assert.equal(restored.members[1].taskStatus['custom:second'].favorite, true);
});

test('Undo of the newer completion allows release Undo again', () => {
  let state = run(run(initial(), claim()), { type: 'clear-task-claim', taskId: 'custom:first', memberId: 'actor1' });
  state = run(state, { type: 'complete-task', memberId: 'reed', taskId: 'custom:first', completed: true });
  state = run(state, { type: 'undo' });
  assert.equal(getUndoEligibility(state, 2).canUndo, true);
  const restored = run(state, { type: 'undo', undoRevision: 2 });
  assert.equal(restored.taskClaims['custom:first'].memberId, 'actor1');
  assert.deepEqual(restored.members[1].completedTasks, []);
});

test('[regression] latest completion Undo restores gameplay and leaves automatically cleared claims absent', () => {
  const first = run(initial(), claim());
  const done = run(first, { type: 'set-task-status', memberId: 'reed', taskId: 'custom:first', challengeCompleted: true });
  assert.deepEqual(done.taskClaims, {});
  assert.equal(done.history.length, 2);
  assert(done.history[1].undo.taskClaimChanges);
  assert.deepEqual(run(done, { type: 'undo' }).taskClaims, {});
  assert.throws(() => run(done, claim()), /Completed/);
});

test('[regression] completion families clear the sibling from trusted catalogue without cached facts', () => {
  const taskCatalogue = new Map([['custom:first', { id: 'custom:first', label: 'first', category: 'Extra', completionIds: ['custom:first', 'custom:family'] }]]);
  const first = run(initial(), claim());
  const done = run(first, { type: 'complete-task', memberId: 'reed', taskId: 'custom:family', completed: true }, { taskCatalogue });
  assert.deepEqual(done.taskClaims, {});
  assert.deepEqual(done.members[0].completedTasks, []);
  assert.deepEqual(done.members[1].completedTasks, ['custom:family']);
  assert.deepEqual(run(done, { type: 'undo' }).taskClaims, {});
  assert.throws(() => run(done, claim(), { taskCatalogue }), /Completed/);
});

test('[regression] older completion Undo restores gameplay after an independent task change and keeps dibs cleared', () => {
  let state = run(initial(), claim());
  state = run(state, { type: 'complete-task', memberId: 'reed', taskId: 'custom:first', completed: true });
  state = run(state, { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:second', challengeCompleted: true });
  assert.equal(getUndoEligibility(state, 2).canUndo, true);
  const restored = applyValidatedCommand(state, { type: 'undo', undoRevision: 2 }, { now });
  assert.deepEqual(restored.members[1].completedTasks, []);
  assert.equal(restored.members[0].taskStatus['custom:second'].challengeCompleted, true);
  assert.deepEqual(restored.taskClaims, {});
  assert.equal(restored.history[0].undo, undefined);
  assert.deepEqual(validateState(restored), restored);
});

test('gameplay Undo preserves a later independent claim and its own guarded inverse', () => {
  const original = initial(); original.rules['tasks.completion'] = 'personal';
  let state = run(original, claim());
  state = run(state, { type: 'complete-task', memberId: 'actor1', taskId: 'custom:first', completed: true });
  state = run(state, claim('custom:first', 'reed'));
  const restored = run(state, { type: 'undo', undoRevision: 2 });
  assert.deepEqual(restored.members[0].completedTasks, []);
  assert.equal(restored.taskClaims['custom:first'].memberId, 'reed');
  assert.equal(restored.history[2].undo.taskClaimChanges.changes.length, 1);
  assert.deepEqual(run(restored, { type: 'undo', undoRevision: 3 }).taskClaims, {});
});



test('[regression] unrelated saves cannot clear a family claim using cached task facts', () => {
  const first = run(initial(), claim());
  const taskCatalogue = new Map([['custom:first', { id: 'custom:first', label: 'first', category: 'Extra', completionIds: ['custom:first', 'custom:family'] }]]);
  const completed = run(first, { type: 'complete-task', memberId: 'reed', taskId: 'custom:family', completed: true });
  assert.deepEqual(completed.taskClaims, first.taskClaims);
  const display = run(completed, { type: 'set-preference', memberId: 'actor1', preferenceId: 'hideChecked', value: true });
  assert.deepEqual(display.taskClaims, first.taskClaims);
  assert.equal(display.history.at(-1).undo.taskClaimChanges, undefined);
  const unrelated = run(display, { type: 'complete-task', memberId: 'reed', taskId: 'custom:second', completed: true }, { taskCatalogue });
  assert.deepEqual(unrelated.taskClaims, first.taskClaims);
  assert.equal(unrelated.history.at(-1).undo.taskClaimChanges, undefined);
});

test('saved family evidence survives backup without a running catalogue', () => {
  const original = initial();
  original.tasks[0].completionIds = ['custom:first', 'custom:family'];
  const claimed = importBackup(exportBackup(run(original, claim())));
  const completed = run(claimed, { type: 'set-task-status', memberId: 'reed', taskId: 'custom:family', challengeCompleted: true });
  assert.deepEqual(completed.taskClaims, {});
  assert.deepEqual(run(completed, { type: 'undo' }).taskClaims, {});
});

test('[regression] potential collection catalogue exposes stable source families before evaluation', () => {
  const collection = createCollectionEngine({ drops: { Goblin: { Bones: { '1': 'Always' } }, Rat: { Bones: { '1': 'Always' } } } });
  const every = collection.catalogue.filter(row => row.objectiveKind === 'every-drop');
  assert.equal(every.length, 2);
  const family = every.map(row => row.id).sort();
  for (const row of every) {
    assert.deepEqual([...row.completionIds].sort(), family);
    assert(Object.isFrozen(row.completionIds));
  }
  const original = createGroupState(owners);
  original.tasks = every.map(({ id, label, category }) => ({ id, label, category }));
  const taskCatalogue = new Map(collection.catalogue.map(row => [row.id, row]));
  const claimed = run(original, claim(every[0].id));
  const done = run(claimed, { type: 'complete-task', memberId: 'reed', taskId: every[1].id, completed: true }, { taskCatalogue });
  assert.deepEqual(done.taskClaims, {});
  assert(done.tasks.every(row => row.completionIds === undefined));
  assert.deepEqual(run(done, { type: 'undo' }).taskClaims, {});
  assert.throws(() => run(done, claim(every[0].id), { taskCatalogue }), /Completed/);
});

test('a saved completion sibling provides family evidence when the claimed row has none', () => {
  const original = initial();
  original.tasks[2].completionIds = ['custom:first', 'custom:family'];
  const claimed = run(original, claim());
  const done = run(claimed, { type: 'complete-task', memberId: 'reed', taskId: 'custom:family', completed: true });
  assert.deepEqual(done.taskClaims, {});
  assert.throws(() => run(done, claim()), /Completed/);
});

test('all completion policy retains claims until every member finishes', () => {
  const original = initial(); original.rules['tasks.completion'] = 'all';
  const claimed = run(original, claim());
  const partial = run(claimed, { type: 'complete-task', memberId: 'reed', taskId: 'custom:first', completed: true });
  assert.deepEqual(partial.taskClaims, claimed.taskClaims);
  const done = run(partial, { type: 'complete-task', memberId: 'actor1', taskId: 'custom:first', completed: true });
  assert.deepEqual(done.taskClaims, {});
});

test('backlogging owners leaves availability cleanup to background reconciliation', () => {
  const claimed = run(initial(), claim());
  const partial = run(claimed, { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:first', backlogged: true });
  const hidden = run(partial, { type: 'set-task-status', memberId: 'reed', taskId: 'custom:first', backlogged: true });
  assert.deepEqual(hidden.taskClaims, claimed.taskClaims);
  assert.equal(hidden.history.at(-1).undo.taskClaimChanges, undefined);
});


test('restore rejects malformed claims and corrupt sparse claim inverse guards', () => {
  const claimed = run(initial(), claim());
  for (const value of [{ memberId: 'absent', at: now() }, { memberId: 'actor1', at: 'yesterday' }, { memberId: 'actor1', at: now(), note: 'extra' }]) {
    const invalid = structuredClone(claimed); invalid.taskClaims['custom:first'] = value;
    assert.throws(() => validateState(invalid));
  }
  const stale = structuredClone(claimed); stale.taskClaims['custom:first'].memberId = 'reed';
  assert.throws(() => validateState(stale), /Stale undo/);
  const unsafe = structuredClone(claimed);
  unsafe.history[0].undo.taskClaimChanges.changes[0].id = '__proto__';
  assert.throws(() => validateState(unsafe), /unsafe/);
});

async function isolatedStore(t, options = {}) {
  const root = path.resolve('.local/task-claim-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'store-'));
  const store = await openStore({ dataDir, initialState: initial(), now, ...options });
  t.after(async () => {
    await store.close();
    assert.equal(path.dirname(path.resolve(dataDir)), root);
    await rm(dataDir, { recursive: true, force: true });
  });
  return { store, dataDir };
}

test('concurrent claims use the existing authoritative revision conflict boundary', async t => {
  const { store } = await isolatedStore(t);
  const results = await Promise.allSettled([store.command(claim(), 0), store.command(claim('custom:first', 'reed'), 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal(store.getTaskClaimSnapshot().revision, 1);
  assert.equal(Object.keys(store.getTaskClaimSnapshot().taskClaims).length, 1);
});

test('inactive cleanup owns a revision, cancels inverse leaves, and adds no History event', async t => {
  const { store } = await isolatedStore(t);
  await store.command(claim('custom:second', 'reed'), 0);
  await store.command(claim(), 1);
  assert.equal(await store.reconcileTaskClaims(['custom:first', 'custom:second'], 2), null);
  const pruned = await store.reconcileTaskClaims([], 2);
  assert.deepEqual(pruned.taskClaims, {});
  assert.equal(pruned.revision, 3);
  assert.equal(pruned.history.length, 2);
  assert.equal(pruned.history[0].undo, undefined);
  assert.equal(pruned.history[1].undo, undefined);
  assert.equal(await store.reconcileTaskClaims([], 3), null);
  await assert.rejects(store.reconcileTaskClaims([], 2), { code: 'REVISION_CONFLICT' });
  assert.equal(store.getUndoEligibility().canUndo, false);
});

test('[regression] restart cleanup never grafts claims into a prior gameplay or preference inverse', async t => {
  const { store, dataDir } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.command({ type: 'set-task-rule', memberId: 'actor1', ruleId: 'Quests', value: false }, 1);
  await store.command({ type: 'set-preference', memberId: 'reed', preferenceId: 'hideChecked', value: true }, 2);
  await store.close();
  const reopened = await openStore({ dataDir, now });
  try {
    const cleaned = await reopened.reconcileTaskClaims([], 3);
    assert.equal(cleaned.history[1].undo.taskClaimChanges, undefined);
    assert.equal(cleaned.history[2].undo.taskClaimChanges, undefined);
    assert.equal(cleaned.history.length, 3);
    const withoutPreference = await reopened.command({ type: 'undo' }, 4);
    assert.deepEqual(withoutPreference.taskClaims, {});
    assert.equal(withoutPreference.members[0].taskRules.Quests, false);
    const restored = await reopened.command({ type: 'undo' }, 5);
    assert.deepEqual(restored.taskClaims, {});
    assert.equal(Object.hasOwn(restored.members[0], 'taskRules'), false);
    assert.deepEqual(validateState(restored), restored);
  } finally { await reopened.close(); }
});

test('cleanup cancels inactive claim chains while preserving independent personal and claim Undo', async t => {
  const { store } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.command({ type: 'set-task-rule', memberId: 'actor1', ruleId: 'Quests', value: false }, 1);
  await store.command({ type: 'clear-task-claim', memberId: 'actor1', taskId: 'custom:first' }, 2);
  await store.command(claim('custom:first', 'reed'), 3);
  await store.command(claim('custom:second', 'reed'), 4);
  await store.command({ type: 'set-preference', memberId: 'reed', preferenceId: 'hideChecked', value: true }, 5);
  const cleaned = await store.reconcileTaskClaims(['custom:second'], 6);
  for (const index of [0, 2, 3]) assert.equal(cleaned.history[index].undo, undefined);
  assert.equal(cleaned.history[1].undo.taskClaimChanges, undefined);
  assert.equal(cleaned.history[5].undo.taskClaimChanges, undefined);
  const withoutPreference = await store.command({ type: 'undo' }, 7);
  assert.deepEqual(Object.keys(withoutPreference.taskClaims), ['custom:second']);
  const withoutB = await store.command({ type: 'undo' }, 8);
  assert.deepEqual(withoutB.taskClaims, {});
  const restored = await store.command({ type: 'undo' }, 9);
  assert.deepEqual(restored.taskClaims, {});
  assert.equal(Object.hasOwn(restored.members[0], 'taskRules'), false);
  assert.equal(store.getUndoEligibility().canUndo, false);
  assert.deepEqual(validateState(restored), restored);
});

test('cleanup cancels inactive takeovers without changing the gameplay inverse', async t => {
  const { store } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.command({ type: 'set-task-rule', memberId: 'actor1', ruleId: 'Quests', value: false }, 1);
  await store.command(claim('custom:first', 'reed', { takeover: true }), 2);
  const cleaned = await store.reconcileTaskClaims([], 3);
  assert.equal(cleaned.history[2].undo, undefined);
  assert.equal(cleaned.history[1].undo.taskClaimChanges, undefined);
  const restored = await store.command({ type: 'undo' }, 4);
  assert.deepEqual(restored.taskClaims, {});
  assert.equal(Object.hasOwn(restored.members[0], 'taskRules'), false);
  assert.deepEqual(validateState(restored), restored);
});

test('cleanup after Undo retains valid target-marker pairs while cancelling outstanding claim leaves', async t => {
  const { store } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.command({ type: 'clear-task-claim', taskId: 'custom:first', memberId: 'actor1' }, 1);
  await store.command({ type: 'undo' }, 2);
  const pruned = await store.reconcileTaskClaims([], 3);
  assert.deepEqual(pruned.taskClaims, {});
  assert.equal(pruned.history.length, 3);
  assert.equal(pruned.history[0].undo, undefined);
  assert.equal(store.getUndoEligibility().canUndo, false);
  assert.deepEqual(validateState(store.getState()), store.getState());
});

test('[regression] archive cleanup preserves full backup replay and unrelated Undo after restart', async t => {
  const { store, dataDir } = await isolatedStore(t, { retention: { historyEntries: 1, backupDays: 90 } });
  await store.command(claim(), 0);
  await store.command({ type: 'set-task-status', taskId: 'custom:second', memberId: 'actor1', note: 'first edit' }, 1);
  await store.command({ type: 'set-task-rule', ruleId: 'Quests', memberId: 'actor1', value: false }, 2);
  assert(store.getInfo().retention.historyArchives > 0);
  await store.reconcileTaskClaims([], 3);
  const full = (await store.backup()).state;
  assert.equal(full.history.length, 3);
  assert.equal(full.history[0].undo, undefined);
  assert.equal(full.history[2].undo.taskClaimChanges, undefined);
  assert.deepEqual(importBackup(exportBackup(full)), full);
  await store.close();
  const reopened = await openStore({ dataDir, now, retention: { historyEntries: 1, backupDays: 90 } });
  try {
    const restored = await reopened.command({ type: 'undo' }, 4);
    assert.deepEqual(restored.taskClaims, {});
    assert.equal(Object.hasOwn(restored.members[0], 'taskRules'), false);
    assert.deepEqual(importBackup(await reopened.backup()).taskClaims, {});
  } finally { await reopened.close(); }
});

test('[regression] cold store completion removes a catalogue sibling claim in the completing save', async t => {
  const taskCatalogue = new Map([['custom:first', { id: 'custom:first', label: 'first', category: 'Extra', completionIds: ['custom:first', 'custom:family'] }]]);
  const { store, dataDir } = await isolatedStore(t, { taskCatalogue });
  await store.command(claim(), 0);
  await store.close();
  const reopened = await openStore({ dataDir, now, taskCatalogue });
  try {
    const done = await reopened.command({ type: 'complete-task', memberId: 'reed', taskId: 'custom:family', completed: true }, 1);
    assert.deepEqual(done.taskClaims, {});
    assert.equal(done.revision, 2);
    assert.equal(done.history.length, 2);
    assert.deepEqual(done.history[1].undo.taskClaimChanges.changes.map(change => change.id), ['custom:first']);
    assert.equal(await reopened.reconcileTaskClaims([], 2), null);
    assert.deepEqual((await reopened.command({ type: 'undo' }, 2)).taskClaims, {});
  } finally { await reopened.close(); }
});

test('[regression] Undo that re-completes a task clears later claims in the same save', () => {
  const completed = run(initial(), { type: 'complete-task', memberId: 'actor1', taskId: 'custom:first', completed: true });
  const unchecked = run(completed, { type: 'complete-task', memberId: 'actor1', taskId: 'custom:first', completed: false });
  const claimed = run(unchecked, claim('custom:first', 'reed'));
  const restored = run(claimed, { type: 'undo', undoRevision: 2 });
  assert.deepEqual(restored.members[0].completedTasks, ['custom:first']);
  assert.deepEqual(restored.taskClaims, {});
  assert.deepEqual(validateState(restored), restored);
});



test('[regression] cleanup reads no archives, keeps durable sidecars shared, and skips backup retention', async t => {
  let preparationCalls = 0;
  const state = initial(); state.provenance = { evidence: 'retained'.repeat(50_000) };
  const { store, dataDir } = await isolatedStore(t, { initialState: state, retention: { historyEntries: 1, backupDays: 90 },
    prepareState: state => { preparationCalls++; return state; } });
  await store.command(claim(), 0);
  await store.command({ type: 'set-task-status', memberId: 'actor1', taskId: 'custom:second', note: 'edited' }, 1);
  await store.command({ type: 'set-task-rule', memberId: 'actor1', ruleId: 'Quests', value: false }, 2);
  const before = store.getState(), preparations = preparationCalls;
  const backups = (await readdir(path.join(dataDir, 'backups'))).sort();
  const staticFields = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).storage.fields;
  const staticFiles = (await readdir(path.join(dataDir, 'static'))).sort();
  const historyDir = path.join(dataDir, 'history'), suspended = path.join(dataDir, 'history-suspended');
  await rename(historyDir, suspended);
  try {
    const cleaned = await store.reconcileTaskClaims([], 3);
    assert.equal(cleaned.revision, 4);
    assert.equal(preparationCalls, preparations);
    assert.deepEqual((await readdir(path.join(dataDir, 'backups'))).sort(), backups);
    assert.deepEqual(store.getState().provenance.historyArchive, before.provenance.historyArchive);
    const persisted = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.equal(persisted.coordination.invalidatedUndo['custom:first'], 3);
    assert.equal(persisted.coordination.lastNonClaimRevision, 3);
    assert.deepEqual(persisted.storage.fields, staticFields);
    assert.deepEqual((await readdir(path.join(dataDir, 'static'))).sort(), staticFiles);
  } finally { await rename(suspended, historyDir); }
  assert.equal((await store.backup()).state.history[0].undo, undefined);
});

test('[regression] claim-only conflict proof covers every intervening revision across cleanup and restart', async t => {
  const { store, dataDir } = await isolatedStore(t);
  const conflict = async (owner, revision, flag) => assert.rejects(owner.command(claim('custom:family'), revision),
    error => error.code === 'REVISION_CONFLICT' && error.claimOnlyChanges === flag);
  await store.command(claim(), 0);
  await store.command(claim('custom:second', 'reed'), 1);
  await store.reconcileTaskClaims(['custom:second'], 2);
  await conflict(store, 0, true);
  await store.command({ type: 'set-preference', memberId: 'actor1', preferenceId: 'hideChecked', value: true }, 3);
  await store.command({ type: 'clear-task-claim', memberId: 'reed', taskId: 'custom:second' }, 4);
  await conflict(store, 3, false);
  await conflict(store, 4, true);
  await store.close();
  const reopened = await openStore({ dataDir, now });
  try {
    await conflict(reopened, 3, false);
    await conflict(reopened, 4, true);
    await reopened.command({ type: 'undo', undoRevision: 5 }, 5);
    await conflict(reopened, 4, true);
    await reopened.replace(await reopened.backup(), 6);
    await conflict(reopened, 6, false);
  } finally { await reopened.close(); }
});

test('[regression] archived release Undo cannot revive a claim after cleanup and restart', async t => {
  const { store, dataDir } = await isolatedStore(t, { retention: { historyEntries: 1, backupDays: 90 } });
  await store.command(claim(), 0);
  await store.command({ type: 'clear-task-claim', memberId: 'actor1', taskId: 'custom:first' }, 1);
  await store.command(claim('custom:first', 'reed'), 2);
  await store.command({ type: 'set-task-status', memberId: 'actor1', taskId: 'custom:second', note: 'one' }, 3);
  await store.command({ type: 'set-task-status', memberId: 'actor1', taskId: 'custom:second', note: 'two' }, 4);
  assert(!store.getHistory().history.some(event => event.revision === 2));
  await store.reconcileTaskClaims([], 5);
  await store.close();
  const reopened = await openStore({ dataDir, now, retention: { historyEntries: 1, backupDays: 90 } });
  try {
    await assert.rejects(reopened.command({ type: 'undo', undoRevision: 2 }, 6), /not reversible/);
    assert.deepEqual(reopened.getTaskClaimSnapshot().taskClaims, {});
    const full = (await reopened.backup()).state;
    assert.equal(full.history.find(event => event.revision === 2).undo, undefined);
    assert.deepEqual(importBackup(exportBackup(full)), full);
  } finally { await reopened.close(); }
});

test('[regression] assigned actors cannot Undo another player claim in archived history', async t => {
  const { store } = await isolatedStore(t, { retention: { historyEntries: 1, backupDays: 90 } });
  await store.command(claim(), 0);
  await store.command({ type: 'clear-task-claim', memberId: 'actor1', taskId: 'custom:first' }, 1);
  await store.command({ type: 'set-task-status', memberId: 'reed', taskId: 'custom:second', note: 'one' }, 2);
  await store.command({ type: 'set-task-status', memberId: 'reed', taskId: 'custom:second', note: 'two' }, 3);
  assert(!store.getHistory().history.some(event => event.revision === 2));
  const actor = { kind: 'invite', label: 'Reed', inviteId: 'reed-invite', memberId: 'reed' };
  await assert.rejects(store.command({ type: 'undo', undoRevision: 2 }, 4, { actor }), error => error.status === 403);
  assert.deepEqual(store.getTaskClaimSnapshot().taskClaims, {});
  assert.equal(store.getTaskClaimSnapshot().revision, 4);
});

test('[regression] Undo removing a new claim preserves the preceding release Undo chain', async t => {
  const { store, dataDir } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.command({ type: 'clear-task-claim', memberId: 'actor1', taskId: 'custom:first' }, 1);
  await store.command(claim('custom:first', 'reed'), 2);
  await store.command({ type: 'undo', undoRevision: 3 }, 3);
  await store.close();
  const reopened = await openStore({ dataDir, now });
  try {
    const restored = await reopened.command({ type: 'undo', undoRevision: 2 }, 4);
    assert.equal(restored.taskClaims['custom:first'].memberId, 'actor1');
  } finally { await reopened.close(); }
});

test('[regression] legacy files prove claim-only changes only after their loaded revision', async t => {
  const { store, dataDir } = await isolatedStore(t);
  await store.command(claim(), 0);
  await store.close();
  const file = path.join(dataDir, 'state.json'), document = JSON.parse(await readFile(file, 'utf8'));
  delete document.coordination;
  await writeFile(file, `${JSON.stringify(document)}\n`);
  const reopened = await openStore({ dataDir, now });
  const conflict = async (revision, claimOnlyChanges) => assert.rejects(reopened.command(claim('custom:family'), revision),
    error => error.code === 'REVISION_CONFLICT' && error.claimOnlyChanges === claimOnlyChanges);
  try {
    await conflict(0, false);
    await reopened.command(claim('custom:second', 'reed'), 1);
    await conflict(0, false);
    await conflict(1, true);
  } finally { await reopened.close(); }
});

test('durable claims and play snapshots survive reopening while worker snapshots omit them', async t => {
  const { store, dataDir } = await isolatedStore(t);
  const before = store.getCalculationSnapshot(), key = before.taskInputKey;
  await store.command(claim(), 0);
  const after = store.getCalculationSnapshot();
  assert.equal(after.inputKey, before.inputKey);
  assert.equal(after.taskInputKey, key);
  assert.equal(Object.hasOwn(after.state, 'taskClaims'), false);
  assert.equal(Object.hasOwn(JSON.parse(Buffer.from(after.stateJSON).toString()), 'taskClaims'), false);
  const small = store.getTaskClaimSnapshot(); small.taskClaims['custom:first'].memberId = 'reed';
  assert.equal(store.getTaskClaimSnapshot().taskClaims['custom:first'].memberId, 'actor1');
  const saved = (await store.backup()).state;
  await store.close();
  const reopened = await openStore({ dataDir, now });
  try { assert.deepEqual(reopened.getState(), saved); }
  finally { await reopened.close(); }
});

test('task claim facts use an isolated sparse state without History or private evidence', async t => {
  const state = initial();
  state.legacy = { maps: { retained: { raw: 'private imported map' } } };
  state.provenance = { retained: 'private evidence' };
  const { store } = await isolatedStore(t, { initialState: state });
  await store.command(claim(), 0);
  const facts = store.getTaskClaimState();
  assert.deepEqual(Object.keys(facts).sort(), ['schemaVersion', 'revision', 'rules', 'members', 'tasks', 'identityRegistry', 'taskClaims'].sort());
  assert.equal(facts.history, undefined);
  assert.equal(facts.legacy, undefined);
  assert.equal(facts.provenance, undefined);
  assert.equal(facts.revision, 1);
  assert.equal(facts.taskClaims['custom:first'].memberId, 'actor1');
  facts.members[0].name = 'Changed';
  facts.rules['access.shared'] = false;
  facts.tasks[0].label = 'Changed';
  facts.taskClaims['custom:first'].memberId = 'reed';
  facts.identityRegistry.entries.changed = { category: 'Extra' };
  const original = store.getTaskClaimState();
  assert.equal(original.members[0].name, 'Player');
  assert.equal(original.rules['access.shared'], undefined);
  assert.equal(original.tasks[0].label, 'first');
  assert.equal(original.taskClaims['custom:first'].memberId, 'actor1');
  assert.equal(original.identityRegistry.entries.changed, undefined);
});
