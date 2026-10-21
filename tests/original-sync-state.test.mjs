import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyValidatedCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';

const capturedAt = '2026-10-07T17:00:00.000Z', appliedAt = '2026-10-07T18:00:00.000Z';
const sourceHash = `sha256:${'a'.repeat(64)}`;
const now = () => appliedAt;
function group() {
  const state = createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2', sourceMapId: 'qxb' }]);
  Object.assign(state.members[0], { unlocked: ['100'], selected: ['101'], pendingRoll: ['102'], blacklisted: ['103'] });
  Object.assign(state.members[1], { unlocked: ['200'], selected: ['201'], pendingRoll: [], blacklisted: [] });
  return state;
}
function target(extra = {}) { return { memberId: 'player1', sourceMapId: 'qxa', groups: ['chunks'], unlocked: ['104'], ...extra }; }
function batch(members = [target()], extra = {}) { return { type: 'sync-original', capturedAt, sourceHash, members, ...extra }; }
function apply(state, command, options = {}) { return applyCommand(state, command, { expectedRevision: state.revision, now, ...options }); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('Original chunk-only sync replaces the exact set and preserves other groups and partner', () => {
  const state = freeze(group()), result = apply(state, batch());
  assert.deepEqual(result.members[0].unlocked, ['104']);
  for (const field of ['selected', 'pendingRoll', 'blacklisted']) assert.deepEqual(result.members[0][field], state.members[0][field]);
  assert.deepEqual(result.members[1], state.members[1]);
  assert.deepEqual(result.members[0].originalPickerSync, { sourceMapId: 'qxa', capturedAt, appliedAt, sourceHash, groups: ['chunks'] });
  assert.equal(result.revision, 1); assert.equal(result.history.length, 1);
  assert.equal(result.history[0].type, 'sync-original');
  assert.equal(result.history[0].at, result.members[0].originalPickerSync.appliedAt);
  assert.deepEqual(group(), state);
});

test('Original selections, blacklist and pending choices replace exactly in source order', () => {
  const state = group(), result = apply(state, batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['selections', 'blacklist', 'pendingRoll'],
    selected: ['107', '106'], blacklisted: [], pendingRoll: ['109', '108'] }]));
  assert.deepEqual(result.members[0].unlocked, ['100']);
  assert.deepEqual(result.members[0].selected, ['107', '106']);
  assert.deepEqual(result.members[0].blacklisted, []);
  assert.deepEqual(result.members[0].pendingRoll, ['109', '108']);
});

test('one sync and sparse undo restore all changed members, shared F2P, and provenance absence', () => {
  const state = group(); state.rules['content.f2p'] = true;
  const members = [target({ groups: ['chunks', 'rules'], unlocked: [], taskRules: { F2P: false, Boss: false } }),
    { memberId: 'player2', sourceMapId: 'QXB', groups: ['chunks', 'rules'], unlocked: ['204'], taskRules: { F2P: false } }];
  const result = apply(state, batch(members));
  assert.equal(result.rules['content.f2p'], false);
  assert.equal(result.members[1].originalPickerSync.sourceMapId, 'qxb');
  assert.equal(result.history[0].undo.memberChanges.length, 2);
  assert.equal(result.history[0].undo.members, undefined);
  const undone = apply(importBackup(exportBackup(result)), { type: 'undo' });
  assert.deepEqual(undone.members, state.members);
  assert.deepEqual(undone.rules, state.rules);
  assert.equal(undone.revision, 2);
  assert.deepEqual(importBackup(exportBackup(undone)), undone);
});

test('later sync provenance replaces freshness and undo restores the preceding sync', () => {
  const first = apply(group(), batch()), second = apply(first, batch([target({ unlocked: ['105'] })], { capturedAt: '2026-10-07T17:30:00Z', sourceHash: `sha256:${'b'.repeat(64)}` }));
  const undone = apply(second, { type: 'undo' });
  assert.deepEqual(undone.members, first.members);
  assert.deepEqual(apply(undone, { type: 'undo' }).members, group().members);
});

test('Original rules preserve app custom overrides, notes, statuses, death preferences and legacy settings', () => {
  const state = group();
  state.tasks = [{ id: 'custom', label: 'Custom task', category: 'Custom' }];
  Object.assign(state.members[0], { taskRules: { 'Secondary Primary Inclusive': false, 'Custom app rule': 'keep', Boss: true },
    notes: { 100: 'keep my note' }, taskStatus: { custom: { favorite: true, note: 'keep task note' } },
    preferences: { showDeathChunks: false, deathThresholdHours: 20 },
    stickers: { 100: { type: 'heart', color: '#FFFFFF', text: 'home' } }, completedTasks: ['custom'] });
  state.rules['content.f2p'] = false;
  state.legacy = { maps: { qxa: { settings: { theme: 'dark' }, chunkNotes: { 100: 'old note' } } } };
  const result = apply(state, batch([{ memberId: 'player1', sourceMapId: 'QXA', groups: ['rules'], taskRules: { Boss: false, 'Original historical key': null } }]));
  assert.deepEqual(result.members[0].taskRules, { 'Secondary Primary Inclusive': false, 'Custom app rule': 'keep', Boss: false, 'Original historical key': null });
  for (const field of ['notes', 'taskStatus', 'completedTasks', 'preferences', 'stickers', 'unlocked', 'selected', 'blacklisted', 'pendingRoll']) assert.deepEqual(result.members[0][field], validateState(state).members[0][field]);
  assert.deepEqual(result.rules, state.rules); assert.deepEqual(result.legacy, state.legacy);
});

test('cross-group overlap rejects atomically with an actionable selection error', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  const command = batch([target({ unlocked: ['101'] }), { memberId: 'player2', sourceMapId: 'qxb', groups: ['chunks'], unlocked: ['204'] }]);
  assert.throws(() => apply(state, command, { now: () => { throw Error('Must validate before requesting time'); } }), /Select the chunks, selections and pendingRoll groups together/);
  assert.equal(JSON.stringify(state), before);
  const result = apply(state, batch([target({ groups: ['chunks', 'selections', 'pendingRoll'], unlocked: ['101'], selected: [], pendingRoll: [] })]));
  assert.deepEqual(result.members[0].unlocked, ['101']);
});

test('Original sync rejects stale revisions and mismatched or absent member bindings', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  assert.throws(() => apply(state, batch(), { expectedRevision: 1 }), /Revision conflict/);
  assert.throws(() => apply(state, batch([target({ sourceMapId: 'qxb' })])), /current sourceMapId binding/);
  const unbound = group(); unbound.members[0].sourceMapId = null;
  assert.throws(() => apply(unbound, batch()), /current sourceMapId binding/);
  assert.throws(() => apply(state, batch([target({ memberId: 'absent' })])), /Unknown member/);
  assert.equal(JSON.stringify(state), before);
});

test('Original sync validates timestamps, source hash, unique groups and members, and exact group targets', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  const invalid = [
    batch([], {}), batch([target(), target()]), batch([target({ sourceMapId: 'arbitrary' })]),
    ...['bad', '2026-02-30T17:00:00Z', '2026-10-07'].map(value => batch([target()], { capturedAt: value })),
    ...['abc', `sha256:${'g'.repeat(64)}`, `sha256:${'a'.repeat(63)}`].map(value => batch([target()], { sourceHash: value })),
    batch([target({ groups: [] })]), batch([target({ groups: ['chunks', 'chunks'] })]), batch([target({ groups: ['notes'] })]),
    batch([target({ unlocked: ['104', '104'] })]), batch([target({ unlocked: [104] })]), batch([target({ unlocked: ['0'] })]),
    batch([target({ blacklisted: [] })]), batch([target({ unlocked: undefined })]),
    batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['pendingRoll'], pendingRoll: ['104', '105', '106'] }]),
    batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['rules'], taskRules: { Boss: 'false' } }]),
    batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['rules'], taskRules: { custom: {} } }]),
  ];
  const options = { now: () => { throw Error('Rejected command must not request time'); } };
  for (const command of invalid) assert.throws(() => apply(state, command, options), TypeError);
  assert.equal(JSON.stringify(state), before);
});

test('Original shared F2P disagreement rejects all members before time or history changes', () => {
  const state = freeze(group());
  const command = batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['rules'], taskRules: { F2P: true } },
    { memberId: 'player2', sourceMapId: 'qxb', groups: ['rules'], taskRules: { F2P: false } }]);
  assert.throws(() => apply(state, command, { now: () => { throw Error('No time on rejection'); } }), /F2P is shared and affects both players/);
  assert.deepEqual(state, group());
});

test('Original provenance is validated in saved members and sparse undo patches', () => {
  const state = apply(group(), batch());
  const mutations = [
    value => { value.members[0].originalPickerSync.sourceMapId = 'unknown'; },
    value => { value.members[0].originalPickerSync.appliedAt = 'bad'; },
    value => { value.members[0].originalPickerSync.groups = ['notes']; },
    value => { value.members[0].originalPickerSync.sourceHash = 'bad'; },
    value => { value.members[0].originalPickerSync.extra = true; },
    value => { value.history[0].undo.memberChanges[0].changes.find(change => change.path[0] === 'originalPickerSync').after.value.capturedAt = 'bad'; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(state); mutate(invalid); assert.throws(() => validateState(invalid), TypeError); }
});

test('validated storage command path matches public application and remains undoable', () => {
  const state = freeze(validateState(group()));
  const command = batch([target({ groups: ['chunks', 'rules'], unlocked: ['105'], taskRules: { F2P: false } })]);
  const result = applyValidatedCommand(state, command, { expectedRevision: 0, now });
  assert.deepEqual(result, apply(state, command));
  assert.deepEqual(validateState(result), result);
  assert.deepEqual(applyValidatedCommand(result, { type: 'undo' }, { expectedRevision: 1, now }).members, state.members);
  assert.throws(() => applyValidatedCommand(state, batch([target({ unlocked: ['101'] })]), { now }), /Select the chunks/);
  assert.deepEqual(state, group());
});

test('Original pending offers do not inherit matching old random-start origins and undo restores origins', () => {
  const state = group(); state.members[0].pendingRoll = []; state.members[0].selected = [];
  state.rules['roll.neighborMode'] = 'manual';
  const ids = ['100', '104', '105', '106', '200'];
  const world = { chunks: new Map(ids.map(id => [id, { id }])), surface: new Set(ids),
    walkable: new Set(ids), f2p: new Set(ids), neighbors: new Map([['104', ['106']]]),
    sectionTopology: new Map(['104', '105'].map(id => [id, new Map([['1', []]])])) };
  const options = { world, random: () => 0 };
  const localOffer = apply(state, { type: 'random-start', memberId: 'player1', count: 2 }, options);
  assert.deepEqual(localOffer.members[0].pendingRoll, ['104', '105']);
  const synced = apply(localOffer, batch([{ memberId: 'player1', sourceMapId: 'qxa', groups: ['pendingRoll'], pendingRoll: ['104', '105'] }]), options);
  for (const command of [{ type: 'unlock-selection', memberId: 'player1', chunkId: '104' }, { type: 'unlock-both', memberId: 'player1' }]) {
    const resolved = apply(synced, command, options);
    assert.equal(resolved.members[0].sectionOverrides, undefined, 'Source pending choices carry no random-start section evidence');
    assert.ok(resolved.members[0].selected.includes('106'), 'Normal source choices add manual neighbors');
    const restoredSynced = apply(resolved, { type: 'undo' }, options);
    assert.deepEqual(restoredSynced.members, synced.members);
    const restoredLocal = apply(restoredSynced, { type: 'undo' }, options);
    assert.deepEqual(restoredLocal.members, localOffer.members);
    const localResolution = apply(restoredLocal, command, options);
    assert.deepEqual(localResolution.members[0].sectionOverrides,
      command.type === 'unlock-both' ? { '104-1': true, '105-1': true } : { '104-1': true });
  }
  const unrelatedSync = apply(localOffer, batch([{ memberId: 'player2', sourceMapId: 'qxb', groups: ['pendingRoll'], pendingRoll: [] }]), options);
  assert.deepEqual(apply(unrelatedSync, { type: 'unlock-selection', memberId: 'player1', chunkId: '104' }, options).members[0].sectionOverrides, { '104-1': true });
  const chunkSync = apply(localOffer, batch([target({ unlocked: ['100'] })]), options);
  assert.deepEqual(apply(chunkSync, { type: 'unlock-selection', memberId: 'player1', chunkId: '104' }, options).members[0].sectionOverrides, { '104-1': true });
});
