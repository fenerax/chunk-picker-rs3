import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGroupState, importLegacyMaps } from '../app/core/state.mjs';
import { computeRollStats, selectRollStatsEvent } from '../app/core/roll-stats.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const ids = ['100', '101', '102', '103', '104', '200'];
const world = { chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])),
  neighbors: new Map([['100', ['101', '102']]]), walkable: new Set(ids), f2p: new Set(ids) };
function initial() { return createGroupState(owners); }
function command(state, value, daysAgo = 0) {
  return applyCommand(state, value, { world, random: () => 0, now: () => new Date(NOW - daysAgo * DAY).toISOString() });
}
function unlock(state, chunkId, daysAgo, memberId = 'actor1') {
  return command(state, { type: 'set-chunk', memberId, chunkId, status: 'unlocked' }, daysAgo);
}
function stats(state, options = {}) { return computeRollStats(state, { now: NOW, ...options }); }
function legacyState(bbb, aaa = { chunks: { unlocked: [] } }) {
  return importLegacyMaps({ maps: { bbb, aaa } }, {
    members: owners.map((owner, index) => ({ ...owner, mapId: index ? 'aaa' : 'bbb' })),
    capturedAt: new Date(NOW).toISOString(),
  }).state;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('saved/imported chunks count without invented import dates, selections, or pending choices', () => {
  const { state } = importLegacyMaps({ maps: {
    bbb: { chunks: { unlocked: ['100', '101'], selected: ['102'], potential: ['103', '104'] }, recentTime: NOW },
    aaa: { chunks: { unlocked: ['101', '200'], blacklisted: ['104'] } },
  } }, { members: owners.map((owner, index) => ({ ...owner, mapId: index ? 'aaa' : 'bbb' })), capturedAt: new Date(NOW).toISOString() });
  const before = JSON.stringify(state), result = stats(freeze(state));
  assert.deepEqual(result.members.map(member => [member.totalUnlocked, member.unknownDateCount]), [[2, 2], [2, 2]]);
  assert.equal(result.duo.totalUnlocked, 3);
  assert.equal(result.duo.datedUnlocked, 0);
  assert.equal(result.duo.averageIntervalMs, null);
  assert.equal(result.duo.longestGapMs, null);
  assert.deepEqual(result.duo.timeline, []);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('original timestamp-keyed chunkOrder dates surviving imported chunks once, using their latest recorded roll', () => {
  const old = NOW - 12 * DAY, recent = NOW - 2 * DAY;
  const state = legacyState({ chunks: { unlocked: ['100', '101', '104'], selected: ['102'], potential: ['103'] },
    chunkOrder: { [old]: 100, [old + 5000]: 100, [`*fb*_${recent}`]: '100', [old + DAY]: 101,
      [old + 2 * DAY]: 102, [old + 3 * DAY]: 103, [old + 4 * DAY]: 200 } });
  const before = JSON.stringify(state), result = stats(freeze(state)), actor1 = result.members[0];
  assert.deepEqual([actor1.totalUnlocked, actor1.datedUnlocked, actor1.unknownDateCount], [3, 2, 1]);
  assert.deepEqual(actor1.unlocks, [
    { chunkId: '101', at: new Date(old + DAY).toISOString(), revision: null, type: 'imported-roll' },
    { chunkId: '100', at: new Date(recent).toISOString(), revision: null, type: 'imported-roll' },
  ]);
  assert.equal(actor1.unlocksLast7Days, 1);
  assert.equal(actor1.medianIntervalMs, 9 * DAY);
  assert.deepEqual(actor1.timeline.map(point => point.unlocked), [1, 2]);
  assert.equal(result.duo.totalUnlocked, 3);
  assert.equal(JSON.stringify(state), before);
});

test('original zero/invalid timestamps, zero markers, bad IDs and array order lists never fabricate dates', () => {
  const state = legacyState({ chunks: { unlocked: ['100', '101', '102', '103', '104'] }, chunkOrder: {
    0: 100, invalid: 101, '-10': 102, '1.5': 103, '*fb*_0': 104,
    '9007199254740992': 100, [NOW - DAY]: 0, [NOW - 2 * DAY]: '100-1', [NOW - 3 * DAY]: null,
    [NOW - 4 * DAY]: { chunk: 100 }, [NOW - 5 * DAY]: 100.5,
  } });
  assert.equal(stats(state).members[0].unknownDateCount, 5);
  const array = legacyState({ chunks: { unlocked: ['100', '101'] }, chunkOrder: [100, 101] });
  assert.equal(stats(array).members[0].datedUnlocked, 0);
});

test('imported dates belong to each source map and the duo preserves unknown shared dates', () => {
  const state = legacyState({ chunks: { unlocked: ['100', '101'] }, chunkOrder: { [NOW - 10 * DAY]: 100, [NOW - 8 * DAY]: 101 } },
    { chunks: { unlocked: ['100', '101', '200'] }, chunkOrder: { [NOW - 2 * DAY]: 100, [NOW - DAY]: 200 } });
  const result = stats(state);
  assert.deepEqual(result.members.map(member => [member.totalUnlocked, member.datedUnlocked]), [[2, 2], [3, 2]]);
  assert.equal(result.duo.totalUnlocked, 3);
  assert.equal(result.duo.unknownDateCount, 1);
  assert.deepEqual(result.duo.unlocks.map(unlock => unlock.chunkId), ['100', '200']);
  assert.equal(result.duo.unlocks[0].at, new Date(NOW - 10 * DAY).toISOString());
});

test('native locks, unpicks, re-unlocks and reverted events override imported dates without reviving an old cycle', () => {
  const imported = legacyState({ chunks: { unlocked: ['100'] }, chunkOrder: { [NOW - 10 * DAY]: 100 } });
  assert.equal(stats(unlock(imported, '100', 2)).members[0].unlocks[0].type, 'imported-roll');
  const locked = command(imported, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'locked' }, 2);
  assert.equal(stats(locked).members[0].datedUnlocked, 0);
  const unlocked = unlock(locked, '100', 1);
  assert.deepEqual(stats(unlocked).members[0].unlocks, [{ chunkId: '100', at: new Date(NOW - DAY).toISOString(), revision: 2, type: 'set-chunk' }]);
  const revertUnlock = command(unlocked, { type: 'undo' }, 0);
  assert.equal(stats(revertUnlock).members[0].datedUnlocked, 0);
  const revertLock = command(revertUnlock, { type: 'undo' }, 0);
  assert.equal(stats(revertLock).members[0].unlocks[0].at, new Date(NOW - 10 * DAY).toISOString());
  const unpicked = command(imported, { type: 'unpick', memberId: 'actor1' }, 1);
  assert.equal(stats(unpicked).members[0].datedUnlocked, 0);
  assert.equal(stats(command(unpicked, { type: 'undo' }, 0)).members[0].unlocks[0].type, 'imported-roll');
});


test('whole restore uses incoming original map dates and ignores previous source maps and revisions', () => {
  const previous = legacyState({ chunks: { unlocked: ['100'] }, chunkOrder: { [NOW - 10 * DAY]: 100 } });
  const incoming = legacyState({ chunks: { unlocked: ['101', '104'] }, chunkOrder: { [NOW - 3 * DAY]: 101 } });
  incoming.revision = 5; incoming.history = [{ id: 'revision-5', revision: 5, type: 'restore', at: new Date(NOW - DAY).toISOString() }];
  incoming.provenance = { restore: { incomingRevision: 0, incomingHistory: [], previousHistory: previous.history } };
  const result = stats(incoming, { history: [...previous.history, ...incoming.history] });
  assert.deepEqual(result.members[0].unlocks, [{ chunkId: '101', at: new Date(NOW - 3 * DAY).toISOString(), revision: null, type: 'imported-roll' }]);
  assert.equal(result.members[0].unknownDateCount, 1);
  const relocked = command(incoming, { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'locked' }, 0);
  assert.equal(stats(relocked).members[0].datedUnlocked, 0);
});

test('average, median, longest completed interval and inclusive last-seven-day boundary use dated surviving chunks', () => {
  let state = initial();
  for (const [chunk, ago] of [['100', 12], ['101', 11], ['102', 7], ['103', 1]]) state = unlock(state, chunk, ago);
  const result = stats(state).members[0];
  assert.equal(result.totalUnlocked, 4);
  assert.equal(result.intervalCount, 3);
  assert.equal(result.averageIntervalMs, 11 * DAY / 3);
  assert.equal(result.medianIntervalMs, 4 * DAY);
  assert.equal(result.longestGapMs, 6 * DAY);
  assert.equal(result.unlocksLast7Days, 2);
  assert.deepEqual(result.timeline.map(point => point.unlocked), [1, 2, 3, 4]);
});

test('Roll2 offers and cancellation create no dated unlock; choice uses its own unlock time', () => {
  let state = initial(); state.members[0].unlocked = ['100']; state.members[0].selected = ['101', '102'];
  const offer = command(state, { type: 'roll', memberId: 'actor1', count: 2 }, 10);
  assert.equal(stats(offer).members[0].datedUnlocked, 0);
  const cancelled = command(offer, { type: 'cancel-roll', memberId: 'actor1' }, 9);
  assert.equal(stats(cancelled).members[0].totalUnlocked, 1);
  assert.equal(stats(cancelled).members[0].datedUnlocked, 0);
  const chosen = command(offer, { type: 'unlock-selection', memberId: 'actor1', chunkId: '102' }, 1);
  assert.deepEqual(stats(chosen).members[0].unlocks, [{ chunkId: '102', at: new Date(NOW - DAY).toISOString(), revision: 2, type: 'unlock-selection' }]);
});

test('Roll1, pick-for-me, unlock-both and random starts date actual additions only', () => {
  let state = initial(); state.members[0].unlocked = ['100']; state.members[0].selected = ['101', '102'];
  const single = command(state, { type: 'roll', memberId: 'actor1', count: 1 }, 4);
  assert.equal(stats(single).members[0].datedUnlocked, 1);
  const offer = command(state, { type: 'roll', memberId: 'actor1', count: 2 }, 4);
  const picked = command(offer, { type: 'pick-for-me', memberId: 'actor1' }, 3);
  assert.equal(stats(picked).members[0].unlocks[0].type, 'pick-for-me');
  const both = stats(command(offer, { type: 'unlock-both', memberId: 'actor1' }, 3)).members[0];
  assert.equal(both.datedUnlocked, 2);
  assert.equal(both.medianIntervalMs, 0);
  assert.deepEqual(both.timeline, [{ at: new Date(NOW - 3 * DAY).toISOString(), unlocked: 2 }]);
  const start = command(initial(), { type: 'random-start', memberId: 'actor1' }, 2);
  assert.equal(stats(start).members[0].datedUnlocked, 1);
  const startOffer = command(initial(), { type: 'random-start', memberId: 'actor1', count: 2 }, 2);
  assert.equal(stats(startOffer).members[0].datedUnlocked, 0);
});

test('repeated set-unlocked keeps the established date; lock and re-unlock start a new surviving cycle', () => {
  let state = unlock(initial(), '100', 10);
  state = unlock(state, '100', 8);
  assert.equal(stats(state).members[0].unlocks[0].at, new Date(NOW - 10 * DAY).toISOString());
  state = command(state, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'locked' }, 7);
  assert.equal(stats(state).members[0].datedUnlocked, 0);
  state = unlock(state, '100', 1);
  assert.equal(stats(state).members[0].unlocks[0].revision, 4);
  assert.equal(stats(state).members[0].unlocksLast7Days, 1);
});

test('selected and blacklisted chunks leave totals; unpick and its undo preserve correct date semantics', () => {
  for (const status of ['selected', 'blacklisted']) {
    const state = command(unlock(initial(), '100', 10), { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status }, 2);
    assert.equal(stats(state).duo.totalUnlocked, 0);
  }
  const unlocked = unlock(initial(), '100', 10);
  const unpicked = command(unlocked, { type: 'unpick', memberId: 'actor1' }, 2);
  assert.equal(stats(unpicked).members[0].datedUnlocked, 0);
  const restored = command(unpicked, { type: 'undo' }, 1);
  assert.equal(stats(restored).members[0].unlocks[0].at, new Date(NOW - 10 * DAY).toISOString());
});

test('undo removes unlocks and restores dates after reverting a lock without counting the undo timestamp', () => {
  const unlocked = unlock(initial(), '100', 10);
  assert.equal(stats(command(unlocked, { type: 'undo' }, 1)).members[0].datedUnlocked, 0);
  const locked = command(unlocked, { type: 'set-chunk', memberId: 'actor1', chunkId: '100', status: 'locked' }, 2);
  const restored = command(locked, { type: 'undo' }, 1);
  assert.equal(stats(restored).members[0].unlocks[0].revision, 1);
  assert.equal(stats(restored).members[0].unlocksLast7Days, 0);
});

test('duo uses a union, earliest surviving shared date, and conservative unknown shared dates', () => {
  let state = unlock(initial(), '100', 10);
  state = unlock(state, '100', 1, 'reed');
  state = unlock(state, '101', 2, 'reed');
  const result = stats(state);
  assert.deepEqual(result.members.map(member => member.totalUnlocked), [1, 2]);
  assert.equal(result.duo.totalUnlocked, 2);
  assert.equal(result.duo.unlocks[0].revision, 1);
  assert.equal(result.duo.unlocksLast7Days, 1);
  state.members[0].unlocked.push('101');
  assert.equal(stats(state).duo.unknownDateCount, 1);
  assert.equal(stats(state).duo.unlocksLast7Days, 0);
});


test('legacy full before-snapshots infer after sets without assigning dates to duplicate unlocks', () => {
  const first = unlock(initial(), '100', 10), second = unlock(first, '101', 2);
  second.history[0].undo = { members: [initial().members[0]] };
  second.history[1].undo = { members: [first.members[0]] };
  assert.deepEqual(stats(second).members[0].unlocks.map(unlock => unlock.chunkId), ['100', '101']);
  second.revision = 3;
  second.history.push({ revision: 3, type: 'set-chunk', at: new Date(NOW - DAY).toISOString(),
    command: { memberId: 'actor1', status: 'unlocked' }, undo: { members: [structuredClone(second.members[0])] } });
  assert.equal(stats(second).members[0].datedUnlocked, 2);
  assert.equal(stats(second).members[0].unlocks[0].revision, 1);
});

test('a legacy snapshot covering both players dates additions only for the command player', () => {
  const state = unlock(initial(), '100', 10);
  state.history[0].undo = { members: initial().members };
  // A saved map can contain undated imported additions beyond its retained
  // History. The other player's snapshot is not proof of their unlock time.
  state.members[1].unlocked.push('200');
  assert.deepEqual(stats(state).members.map(member => [member.datedUnlocked, member.unknownDateCount]), [[1, 0], [0, 1]]);
});

test('durable repeated revisions use the latest undo marker and standalone undo targets archived events', () => {
  const unlocked = unlock(initial(), '100', 10), undone = command(unlocked, { type: 'undo' }, 1);
  const history = [...unlocked.history, ...undone.history];
  assert.equal(stats(undone, { history }).duo.datedUnlocked, 0);
  const markerOnly = [...unlocked.history, undone.history[1]];
  assert.equal(stats(undone, { history: markerOnly }).duo.datedUnlocked, 0);
  assert.deepEqual(stats(unlocked, { history: unlocked.history.map(selectRollStatsEvent).filter(Boolean) }), stats(unlocked));
});

test('whole-save restore never revives preceding live dates; retained incoming History dates the restored baseline', () => {
  const previous = unlock(initial(), '100', 10), incoming = unlock(initial(), '101', 3);
  const restored = initial(); restored.members[0].unlocked = ['100', '101']; restored.revision = 2;
  restored.history = [{ revision: 2, type: 'restore', at: new Date(NOW - DAY).toISOString() }];
  assert.equal(stats(restored, { history: [...previous.history, ...restored.history] }).duo.datedUnlocked, 0);
  restored.provenance = { restore: { incomingRevision: 1, incomingHistory: incoming.history, previousHistory: previous.history } };
  const result = stats(restored, { history: [...previous.history, ...restored.history] });
  assert.equal(result.duo.datedUnlocked, 1);
  assert.equal(result.duo.unknownDateCount, 1);
  assert.equal(result.duo.unlocks[0].chunkId, '101');
  assert.equal(result.duo.unlocks[0].at, new Date(NOW - 3 * DAY).toISOString());
});

test('compact projection omits unrelated events and task/import payloads but keeps restore and undo boundaries', () => {
  const state = unlock(initial(), '100', 1), event = structuredClone(state.history[0]);
  event.command.member = { secret: 'discard' }; event.actor = { label: 'discard' };
  event.undo.tasks = [{ id: 'unrelated', label: 'discard' }];
  const projected = selectRollStatsEvent(event), text = JSON.stringify(projected);
  assert.ok(!text.includes('discard'));
  assert.deepEqual(projected.mapChanges[0], { memberId: 'actor1', before: [], after: ['100'] });
  assert.equal(selectRollStatsEvent({ revision: 2, type: 'set-note', command: { note: 'discard' } }), null);
  assert.equal(selectRollStatsEvent({ revision: 2, type: 'set-note', undo: { members: state.members } }), null);
  assert.equal(selectRollStatsEvent({ revision: 2, type: 'undo', command: { undoRevision: 1 } }).command.undoRevision, 1);
  assert.equal(selectRollStatsEvent({ revision: 2, type: 'restore' }).type, 'restore');
});

test('selective undo leaves the other player unlock dated and an equal-set map replacement still resets dates', () => {
  let state = unlock(initial(), '100', 10); state = unlock(state, '101', 2, 'reed');
  state = command(state, { type: 'undo', undoRevision: 1 }, 1);
  assert.deepEqual(stats(state).members.map(member => member.datedUnlocked), [0, 1]);
  state = command(state, { type: 'replace-member', memberId: 'reed', member: state.members[1] }, 0);
  assert.equal(stats(state).members[1].totalUnlocked, 1);
  assert.equal(stats(state).members[1].unknownDateCount, 1);
});

test('complete ISO unlock dates are required; partial strings and impossible calendar dates stay unknown', () => {
  const state = unlock(initial(), '100', 1);
  for (const at of ['123', '2026-10-11', '2026-02-30T12:00:00.000Z', '2026-10-11T24:00:00Z', '2026-10-11T12:00:00']) {
    const history = structuredClone(state.history); history[0].at = at;
    assert.equal(stats(state, { history }).members[0].unknownDateCount, 1, at);
  }
  const history = structuredClone(state.history); history[0].at = '2026-10-11T09:00:00-03:00';
  assert.equal(stats(state, { history }).members[0].unlocks[0].at, '2026-10-11T12:00:00.000Z');
});

test('empty and single-date samples have no interval; even sample median and future recent bounds are explicit', () => {
  const empty = stats(initial()); assert.equal(empty.duo.intervalCount, 0); assert.equal(empty.duo.medianIntervalMs, null);
  let state = unlock(initial(), '100', 9); assert.equal(stats(state).duo.averageIntervalMs, null);
  state = unlock(state, '101', 8); state = unlock(state, '102', 3);
  assert.equal(stats(state).duo.medianIntervalMs, 3 * DAY);
  state = unlock(state, '103', -1);
  assert.equal(stats(state).duo.unlocksLast7Days, 1);
  assert.throws(() => stats(state, { now: 'not a date' }), /valid timestamp/);
});
