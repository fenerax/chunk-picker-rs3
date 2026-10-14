import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGroupState, validateState, exportBackup, importBackup, importLegacyMaps, applyCommand, applyValidatedCommand } from '../app/core/state.mjs';
import { MAX_STICKERS_PER_CHUNK, resolveMemberStickers } from '../app/core/map-markers.mjs';
import { openStore } from '../app/storage/store.mjs';

const star = { type: 'star', color: '#AB12cd', text: 'Gather <ore> & keep notes' };
const heart = { type: 'heart', color: '#ff00ff', text: 'Home' };
const now = () => '2026-10-08T12:00:00.000Z';
const world = { chunks: new Map(['100', '101'].map(id => [id, { id }])), surface: new Set(['100', '101']) };
const group = () => createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'bbb' }, { id: 'reed', name: 'Reed', sourceMapId: 'aaa' }]);
const command = (type, extra = {}) => ({ type, memberId: 'actor1', chunkId: '100', ...extra });
const apply = (state, payload) => applyCommand(state, payload, { world, now, expectedRevision: state.revision });
const list = state => resolveMemberStickers(state, state.members[0])['100'] ?? [];

test('old singleton/null saves normalize without mutating input and preserve stable identity and removal', () => {
  const old = group(); old.members[0].stickers = { 100: star, 101: null };
  const bytes = JSON.stringify(old), migrated = validateState(old);
  assert.equal(JSON.stringify(old), bytes);
  assert.deepEqual(migrated.members[0].stickers, { 100: [{ id: 'legacy-sticker-100', ...star }], 101: [] });
  assert.deepEqual(validateState(migrated), migrated);
  assert.deepEqual(importBackup(JSON.stringify(exportBackup(migrated))), migrated);
  assert.deepEqual(resolveMemberStickers(old, old.members[0]), migrated.members[0].stickers);
});

test('retained original marker metadata is decoded, isolated, and preserved while edits materialize only their chunk', () => {
  const old = importLegacyMaps({ maps: { bbb: { chunks: { unlocked: [], stickered: { '*fb*_100': 'star' }, stickeredColors: { '*fb*_100': '-_-23AB12cd' }, stickeredNotes: { '*fb*_100': 'Keep-_-20ore' } } },
    aaa: { chunks: { unlocked: [], stickered: { '*fb*_100': 'heart' } } } } }, { members: [{ id: 'actor1', name: 'Player', mapId: 'bbb' }, { id: 'reed', name: 'Reed', mapId: 'aaa' }] }).state;
  assert.deepEqual(list(old), [{ id: 'legacy-sticker-100', type: 'star', color: '#AB12cd', text: 'Keep ore' }]);
  assert.equal(resolveMemberStickers(old, old.members[1])['100'][0].type, 'heart');
  const added = apply(old, command('add-sticker', { sticker: heart }));
  assert.deepEqual(list(added), [...list(old), { id: 'sticker-1', ...heart }]);
  const updated = apply(added, command('update-sticker', { stickerId: 'legacy-sticker-100', sticker: star }));
  const removed = apply(updated, command('remove-sticker', { stickerId: 'legacy-sticker-100' }));
  const cleared = apply(removed, command('remove-sticker', { stickerId: 'sticker-1' }));
  assert.deepEqual(cleared.members[0].stickers['100'], []);
  assert.deepEqual(list(importBackup(exportBackup(cleared))), []);
  assert.deepEqual(cleared.legacy, old.legacy);
  assert.deepEqual(cleared.members[1], old.members[1]);
  assert.deepEqual(apply(cleared, { type: 'undo' }).members, removed.members);
  let reversed = cleared;
  for (let i = 0; i < 4; i++) reversed = apply(reversed, { type: 'undo' });
  assert.deepEqual(reversed.members, old.members);
  assert.deepEqual(list(reversed), list(old));
});

test('add/update/remove/clear keep order and identity with sparse undo and backup round trips', () => {
  const original = group(), first = apply(original, command('add-sticker', { sticker: star }));
  assert.equal(first.history[0].command.stickerId, 'sticker-1');
  const second = apply(first, command('add-sticker', { sticker: star }));
  const third = apply(second, command('update-sticker', { stickerId: 'sticker-1', sticker: heart }));
  assert.deepEqual(list(third), [{ id: 'sticker-1', ...heart }, { id: 'sticker-2', ...star }]);
  const removed = apply(third, command('remove-sticker', { stickerId: 'sticker-1' }));
  assert.deepEqual(list(removed), [{ id: 'sticker-2', ...star }]);
  const cleared = apply(removed, command('clear-stickers'));
  assert.deepEqual(cleared.members[0].stickers['100'], []);
  let reversed = importBackup(exportBackup(cleared));
  for (const expected of [removed, third, second, first, original]) {
    reversed = apply(reversed, { type: 'undo' });
    assert.deepEqual(reversed.members, expected.members);
  }
  const again = apply(reversed, command('add-sticker', { sticker: heart }));
  assert.equal(list(again)[0].id, 'sticker-11');
  assert.deepEqual(first.members[0].stickers['100'], [{ id: 'sticker-1', ...star }]);
});

test('six-item cap includes inherited markers; replacement-all remains compatible with singleton and null commands', () => {
  let state = group();
  state.legacy = { maps: { bbb: { chunks: { stickered: { 100: 'star' } } } } };
  for (let i = 1; i < MAX_STICKERS_PER_CHUNK; i++) state = apply(state, command('add-sticker', { sticker: star }));
  assert.equal(list(state).length, 6);
  const before = JSON.stringify(state);
  assert.throws(() => apply(state, command('add-sticker', { sticker: heart })), /at most 6/);
  assert.equal(JSON.stringify(state), before);
  const editedAtCap = apply(state, command('update-sticker', { stickerId: 'legacy-sticker-100', sticker: heart }));
  assert.equal(list(editedAtCap).length, 6);
  assert.deepEqual(list(editedAtCap)[0], { id: 'legacy-sticker-100', ...heart });
  const replaced = apply(state, command('set-sticker', { sticker: heart }));
  assert.deepEqual(list(replaced), [{ id: 'sticker-6', ...heart }]);
  const cleared = apply(replaced, command('set-sticker', { sticker: null }));
  assert.deepEqual(list(cleared), []);
  assert.deepEqual(apply(cleared, { type: 'undo' }).members, replaced.members);
  assert.deepEqual(apply(replaced, { type: 'undo' }).members, state.members);
});

test('imported IDs cannot collide with server IDs and stale revisions cannot add a sticker', () => {
  const state = group(); state.members[0].stickers = { 100: [{ id: 'sticker-1', ...star }] };
  const added = apply(state, command('add-sticker', { sticker: heart }));
  assert.deepEqual(list(added).map(sticker => sticker.id), ['sticker-1', 'sticker-1-1']);
  assert.equal(added.history[0].command.stickerId, 'sticker-1-1');
  assert.throws(() => applyCommand(added, command('add-sticker', { sticker: heart }), { world, expectedRevision: 0, now }), /Revision conflict/);
  const view = resolveMemberStickers(added, added.members[0]);
  view['100'].reverse(); view['100'][0].text = 'Changed read-only view';
  assert.deepEqual(list(added), [{ id: 'sticker-1', ...star }, { id: 'sticker-1-1', ...heart }]);
});

test('bad sticker commands fail before timestamps and preserve the state', () => {
  const state = apply(group(), command('add-sticker', { sticker: star })), bytes = JSON.stringify(state);
  const rejectOptions = { world, now: () => { throw Error('Must validate before timestamp'); } };
  const invalid = [
    command('add-sticker', { sticker: null }), command('update-sticker', { stickerId: 'sticker-1', sticker: null }),
    command('add-sticker', { sticker: { id: 'caller-id', ...star } }), command('add-sticker', { stickerId: 'caller-id', sticker: star }),
    command('add-sticker', { sticker: { ...star, color: 'red' } }), command('add-sticker', { sticker: { ...star, text: 3 } }),
    command('add-sticker', { sticker: { ...star, type: 'missing' } }), command('add-sticker', { sticker: [star] }),
    command('update-sticker', { stickerId: 'missing', sticker: star }), command('remove-sticker', { stickerId: 'missing' }),
    command('remove-sticker', { stickerId: '' }), command('remove-sticker', { stickerId: {} }), command('remove-sticker', { stickerId: '../escape' }),
    command('clear-stickers', { stickerId: 'sticker-1' }), command('clear-stickers', { memberId: 'absent' }),
    command('clear-stickers', { chunkId: '999' }), command('clear-stickers', { chunkId: '100-1' }),
  ];
  for (const payload of invalid) assert.throws(() => applyCommand(state, payload, rejectOptions), TypeError, JSON.stringify(payload));
  assert.equal(JSON.stringify(state), bytes);
});

test('schema rejects list corruption and invalid history guards before backup import', () => {
  const state = apply(group(), command('add-sticker', { sticker: star }));
  for (const bad of [
    [null], [{ ...star }], [{ id: '', ...star }], [{ id: 'unsafe/id', ...star }], [{ id: 'valid', ...star, extra: true }],
    [{ id: 'same', ...star }, { id: 'same', ...heart }], Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, ...star })),
  ]) {
    const corrupt = structuredClone(state); corrupt.members[0].stickers['100'] = bad;
    assert.throws(() => validateState(corrupt), TypeError);
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: corrupt }), TypeError);
  }
  const stale = structuredClone(state); stale.members[0].stickers['100'][0].text = 'Out-of-band edit';
  assert.throws(() => validateState(stale), /Stale undo/);
});

test('old sparse singleton/null undo guards migrate together, remain reversible, and reject stale inputs', () => {
  const old = group(); old.revision = 2; old.members[0].stickers = { 100: null };
  old.history = [
    { id: 'revision-1', revision: 1, type: 'set-sticker', at: now(), command: command('set-sticker', { sticker: star }), undo: { memberChanges: [{ id: 'actor1', changes: [
      { path: ['stickers'], kind: 'object', before: { exists: false }, after: { exists: true } },
      { path: ['stickers', '100'], kind: 'value', before: { exists: false }, after: { exists: true, value: star } },
    ] }] } },
    { id: 'revision-2', revision: 2, type: 'set-sticker', at: now(), command: command('set-sticker', { sticker: null }), undo: { memberChanges: [{ id: 'actor1', changes: [
      { path: ['stickers', '100'], kind: 'value', before: { exists: true, value: star }, after: { exists: true, value: null } },
    ] }] } },
  ];
  const migrated = importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: old });
  assert.deepEqual(validateState(migrated), migrated);
  assert.deepEqual(migrated.members[0].stickers['100'], []);
  assert.deepEqual(migrated.history[0].undo.memberChanges[0].changes[1].after.value, [{ id: 'legacy-sticker-100', ...star }]);
  const restored = apply(migrated, { type: 'undo' });
  assert.deepEqual(list(restored), [{ id: 'legacy-sticker-100', ...star }]);
  assert.deepEqual(apply(restored, { type: 'undo' }).members, group().members);
  const stale = JSON.parse(JSON.stringify(old)); stale.history[0].undo.memberChanges[0].changes[1].after.value.text = 'Corrupt';
  assert.throws(() => validateState(stale), /Stale undo/);
});

test('old full member undo snapshots normalize while preserving empty overrides and notes', () => {
  const original = group(); original.members[0].stickers = { 100: star, 101: null }; original.members[0].notes = { 100: 'separate chunk note' };
  const state = group(); state.revision = 1; state.members[0].stickers = { 100: heart };
  state.history = [{ id: 'revision-1', revision: 1, type: 'set-sticker', at: now(), command: command('set-sticker', { sticker: heart }), undo: { members: original.members } }];
  const migrated = importBackup(exportBackup(state));
  assert.deepEqual(apply(migrated, { type: 'undo' }).members, validateState(original).members);
});

test('mixed-format imports cannot turn a representation-only undo into an invalid canonical patch', () => {
  const state = group(); state.revision = 1; state.members[0].stickers = { 100: [] };
  state.history = [{ id: 'revision-1', revision: 1, type: 'clear-stickers', at: now(), undo: { memberChanges: [{ id: 'actor1', changes: [
    { kind: 'value', path: ['stickers', '100'], before: { exists: true, value: null }, after: { exists: true, value: [] } },
  ] }] } }];
  assert.throws(() => validateState(state), /must describe a change after migration/);
});

test('private validated command boundary matches public state for all sticker mutations', () => {
  let state = group();
  for (const payload of [command('add-sticker', { sticker: star }), command('add-sticker', { sticker: heart }),
    command('update-sticker', { stickerId: 'sticker-1', sticker: heart }), command('remove-sticker', { stickerId: 'sticker-2' }), command('clear-stickers'),
    command('set-sticker', { sticker: star }), command('set-sticker', { sticker: null })]) {
    const next = apply(state, payload);
    assert.deepEqual(applyValidatedCommand(state, payload, { world, now, expectedRevision: state.revision }), next);
    state = next;
  }
});

test('durable storage restarts, portable restore and retained backups preserve multiple stickers and empty clears', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-multisticker-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let store = await openStore({ dataDir, initialState: group(), world });
  t.after(() => store.close());
  await store.command(command('add-sticker', { sticker: star }), 0);
  await store.command(command('add-sticker', { sticker: heart }), 1);
  const marked = store.getState(), backup = await store.backup();
  assert.deepEqual(importBackup(backup), marked);
  await store.command(command('clear-stickers'), 2);
  assert.deepEqual(list(store.getState()), []);
  const retained = await store.listBackups();
  assert.equal(retained.length, 3);
  const preceding = await store.readBackup(retained.find(row => row.revision === 2).id);
  assert.deepEqual(list(importBackup(preceding)), list(marked));
  await store.close();
  store = await openStore({ dataDir, world });
  assert.deepEqual(list(store.getState()), []);
  const undoClear = await store.command({ type: 'undo' }, 3);
  assert.deepEqual(list(undoClear), list(marked));
  const restored = await store.replace(backup, 4);
  assert.deepEqual(list(restored), list(marked));
  const edited = await store.command(command('remove-sticker', { stickerId: 'sticker-2' }), restored.revision);
  assert.deepEqual(list(edited), [{ id: 'sticker-1', ...star }]);
  const undone = await store.command({ type: 'undo' }, edited.revision);
  assert.deepEqual(list(undone), list(marked));
});
