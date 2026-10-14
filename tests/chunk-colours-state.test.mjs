import test from 'node:test';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { buildProgressModel } from '../app/core/progress-timeline.mjs';
import assert from 'node:assert/strict';
import { CHUNK_COLOURS, MAX_CHUNK_COLOUR_NAME_LENGTH, resolveMemberChunkColours, resolveMemberChunkColourNames } from '../app/core/chunk-colours.mjs';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, importLegacyMaps, exportBackup, importBackup, previewRestore, taskClaimInvalidatingEvent } from '../app/core/state.mjs';

const now = () => '2026-10-13T12:00:00.000Z';
const world = { chunks: new Map(['100', '101'].map(id => [id, { id }])), surface: new Set(['100', '101']) };
const group = () => createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'bbb' }, { id: 'reed', name: 'Reed', sourceMapId: 'aaa' }]);
const tint = (colour, extra = {}) => ({ type: 'set-chunk-colour', memberId: 'actor1', chunkId: '100', colour, ...extra });
const rename = (colour, name, extra = {}) => ({ type: 'rename-chunk-colour', memberId: 'actor1', colour, name, ...extra });
const apply = (state, command) => applyCommand(state, command, { world, now, expectedRevision: state.revision });
const colours = state => resolveMemberChunkColours(state, state.members[0]);

test('colour saves and Undo leave task calculations and prepared unlocks reusable', () => {
  const original = group(), fingerprint = createGameplayFingerprint(), reuse = createTaskReuseFingerprint();
  const key = fingerprint(original), reuseKey = reuse(original);
  let state = apply(original, tint('red')); state = apply(state, rename('red', 'Next'));
  assert.equal(fingerprint(state), key); assert.equal(reuse(state), reuseKey);
  state = apply(state, { type: 'undo' });
  assert.equal(fingerprint(state), key); assert.equal(reuse(state), reuseKey);
});

test('unchanged annotation commands do not create a gap in progress history', () => {
  let state = apply(group(), tint('red')); state = apply(state, tint('red'));
  state = apply(state, rename('red', 'Next')); state = apply(state, rename('red', 'Next'));
  assert.equal(state.history.at(-1).undo, undefined);
  assert.equal(buildProgressModel(state).history.boundary, null);
});

test('four fixed colour slots have independent short personal labels', () => {
  assert.deepEqual(CHUNK_COLOURS.map(colour => colour.id), ['red', 'yellow', 'green', 'blue']);
  let state = group();
  for (const { id } of CHUNK_COLOURS) state = apply(state, rename(id, `Route ${id}`));
  assert.equal(state.revision, 4);
  assert.equal(resolveMemberChunkColourNames(state, state.members[0]).red, 'Route red');
  assert.equal(resolveMemberChunkColourNames(state, state.members[1]).red, 'Red');
  assert.deepEqual(state.members[0].unlocked, []);
  assert.equal(taskClaimInvalidatingEvent(state.history[0]), false);
});

test('tint, rename, replace and clear are immutable, isolated, sparse and undoable after backup reload', () => {
  const original = group(), bytes = JSON.stringify(original);
  const red = apply(original, tint('red'));
  const named = apply(red, rename('red', '<Home> & ore'));
  const blue = apply(named, tint('blue'));
  const cleared = apply(blue, tint(null));
  assert.equal(JSON.stringify(original), bytes);
  assert.deepEqual(colours(red), { 100: ['red'] });
  assert.deepEqual(colours(cleared), { 100: [] });
  assert.deepEqual(cleared.members[1], original.members[1]);
  for (const state of [red, named, blue, cleared]) {
    assert.equal(state.history.at(-1).undo.members, undefined);
    assert.equal(state.history.at(-1).undo.memberChanges[0].id, 'actor1');
    assert.equal(taskClaimInvalidatingEvent(state.history.at(-1)), false);
    assert.deepEqual(state.rules, original.rules);
    assert.deepEqual(state.members[0].unlocked, original.members[0].unlocked);
    assert.deepEqual(state.members[0].selected, original.members[0].selected);
  }
  let restored = importBackup(exportBackup(cleared));
  for (const expected of [blue, named, red, original]) {
    restored = apply(restored, { type: 'undo' });
    assert.deepEqual(restored.members, expected.members);
  }
  assert.equal(restored.revision, 8);
  assert.equal(Object.hasOwn(restored.members[0], 'chunkColours'), false);
  assert.equal(Object.hasOwn(restored.members[0], 'chunkColourNames'), false);
});

test('retained original paints resolve every named colour and survive clears, overrides and undo unchanged', () => {
  const legacy = { maps: {
    bbb: { chunks: { unlocked: [], painted: { '*fb*_100': ['Red', 'Orange', 'Pink', 'Black'], '101': ['Purple', 'Blue'], '100-1': ['Green'], bad: ['Yellow'] } } },
    aaa: { chunks: { unlocked: [], painted: { '100': ['Green', 'Yellow'] } } },
  } };
  const original = importLegacyMaps(legacy, { members: [{ id: 'actor1', name: 'Player', mapId: 'bbb' }, { id: 'reed', name: 'Reed', mapId: 'aaa' }] }).state;
  assert.deepEqual(colours(original), { 100: ['red', 'orange', 'pink', 'black'], 101: ['purple', 'blue'] });
  assert.deepEqual(resolveMemberChunkColours(original, original.members[1]), { 100: ['green', 'yellow'] });
  const cleared = apply(original, tint(null));
  assert.deepEqual(colours(importBackup(exportBackup(cleared))), { 100: [], 101: ['purple', 'blue'] });
  const replaced = apply(cleared, tint('yellow'));
  assert.deepEqual(colours(replaced), { 100: ['yellow'], 101: ['purple', 'blue'] });
  assert.deepEqual(replaced.legacy, original.legacy);
  const undone = apply(apply(replaced, { type: 'undo' }), { type: 'undo' });
  assert.deepEqual(undone.members, original.members);
  assert.deepEqual(colours(undone), colours(original));
});

test('stale revisions, unknown destinations, invalid slots and invalid labels fail atomically', () => {
  const original = group(), bytes = JSON.stringify(original);
  assert.throws(() => applyCommand(original, tint('red'), { world, now, expectedRevision: 1 }), /Revision conflict/);
  for (const command of [tint('orange'), tint([]), tint(undefined), tint('red', { chunkId: '999' }), tint('red', { chunkId: '100-1' }), tint('red', { memberId: 'absent' }), tint('red', { name: 'Extra' }),
    rename('orange', 'Ore'), rename(null, 'Ore'), rename('red', ''), rename('red', ' padded '), rename('red', 'two\nlines'), rename('red', 'x'.repeat(MAX_CHUNK_COLOUR_NAME_LENGTH + 1))]) {
    assert.throws(() => apply(original, command), TypeError);
    assert.equal(JSON.stringify(original), bytes);
  }
});

test('state and historical undo colour data are strictly validated', () => {
  for (const [field, value] of [['chunkColours', { '100-1': 'red' }], ['chunkColours', { 100: ['red'] }], ['chunkColours', { 100: 'orange' }], ['chunkColourNames', { orange: 'Ore' }], ['chunkColourNames', { red: 42 }]]) {
    const state = group(); state.members[0][field] = value;
    assert.throws(() => validateState(state), TypeError);
  }
  const saved = apply(group(), tint('red'));
  const corrupt = structuredClone(saved);
  corrupt.history[0].undo.memberChanges[0].changes.find(change => change.path.length === 2).after.value = 'orange';
  assert.throws(() => validateState(corrupt), TypeError);
});

test('older targeted undo can restore one tint while retaining a later independent label or tint', () => {
  const original = group(); original.members[0].chunkColours = {};
  const first = apply(original, tint('red'));
  const named = apply(first, rename('red', 'Home'));
  const second = apply(named, tint('green', { chunkId: '101' }));
  const undone = apply(second, { type: 'undo', undoRevision: 1 });
  assert.deepEqual(colours(undone), { 101: ['green'] });
  assert.equal(undone.members[0].chunkColourNames.red, 'Home');
  assert.deepEqual(importBackup(exportBackup(undone)).members, undone.members);
  // Undoing the first optional container's creation must not discard a later
  // entry in that container. Keep the existing guard for this absent boundary.
  const created = apply(group(), tint('red'));
  const another = apply(created, tint('green', { chunkId: '101' }));
  assert.throws(() => apply(another, { type: 'undo', undoRevision: 1 }), /later command changed the same saved value/);
});

test('fast validated command path matches checked commands and preserves inverse guards', () => {
  let checked = group(), fast = validateState(checked);
  for (const command of [tint('red'), rename('red', 'Ore'), tint('blue'), tint(null), { type: 'undo' }, { type: 'undo' }]) {
    checked = apply(checked, command);
    fast = applyValidatedCommand(fast, command, { world, now, expectedRevision: fast.revision });
    assert.deepEqual(fast, checked);
    assert.deepEqual(validateState(fast), checked);
  }
});

test('restore review exposes changes to colours and their personal labels', () => {
  const original = group(), tinted = apply(apply(original, tint('green')), rename('green', 'Training'));
  const review = previewRestore(tinted, original);
  assert.deepEqual(review.members[0].chunkColours.removed, ['100']);
  assert.deepEqual(review.members[0].chunkColourNames.removed, ['green']);
  assert.ok(review.warnings.some(warning => warning.includes('chunk colours')));
  assert.ok(review.warnings.some(warning => warning.includes('chunk colour names')));
});
