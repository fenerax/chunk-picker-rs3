import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGroupState, importLegacyMaps } from '../app/core/state.mjs';
import { computeRollStats, selectRollStatsEvent } from '../app/core/roll-stats.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const owners = [{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }];
const ids = ['100', '101', '102', '103', '104', '200'];
const world = { chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])),
  neighbors: new Map([['100', ['101', '102']]]), walkable: new Set(ids), f2p: new Set(ids) };
function initial() { return createGroupState(owners); }
function command(state, value, daysAgo = 0) {
  return applyCommand(state, value, { world, random: () => 0, now: () => new Date(NOW - daysAgo * DAY).toISOString() });
}
function unlock(state, chunkId, daysAgo, memberId = 'player1') {
  return command(state, { type: 'set-chunk', memberId, chunkId, status: 'unlocked' }, daysAgo);
}
function stats(state, options = {}) { return computeRollStats(state, { now: NOW, ...options }); }
function legacyState(qxa, qxb = { chunks: { unlocked: [] } }) {
  return importLegacyMaps({ maps: { qxa, qxb } }, {
    members: owners.map((owner, index) => ({ ...owner, mapId: index ? 'qxb' : 'qxa' })),
    capturedAt: new Date(NOW).toISOString(),
  }).state;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('sync additions and map replacements cannot borrow stale retained original roll dates', () => {
  const imported = legacyState({ chunks: { unlocked: ['100'] }, chunkOrder: { [NOW - 10 * DAY]: 100 } });
  const locked = command(imported, { type: 'set-chunk', memberId: 'player1', chunkId: '100', status: 'locked' }, 2);
  const sync = { type: 'sync-original', capturedAt: new Date(NOW - DAY).toISOString(), sourceHash: `sha256:${'0'.repeat(64)}`,
    members: [{ memberId: 'player1', sourceMapId: 'qxa', groups: ['chunks'], unlocked: ['100'] }] };
  assert.equal(stats(command(locked, sync, 1)).members[0].unknownDateCount, 1);
  const replacement = { ...imported.members[0], notes: { '100': 'Restored map note' } };
  const replaced = command(imported, { type: 'replace-member', memberId: 'player1', member: replacement }, 1);
  assert.equal(stats(replaced).members[0].unknownDateCount, 1);
  assert.equal(stats(command(replaced, { type: 'undo' }, 0)).members[0].unlocks[0].type, 'imported-roll');
  const missingBaseline = structuredClone(imported); missingBaseline.members[0].unlocked = [];
  assert.equal(stats(command(missingBaseline, sync, 1)).members[0].unknownDateCount, 1);
});

test('map replacements and sync additions stay undated; undo replacement recovers prior evidence', () => {
  const unlocked = unlock(initial(), '100', 10);
  const member = structuredClone(unlocked.members[0]); member.unlocked.push('101');
  const replaced = command(unlocked, { type: 'replace-member', memberId: 'player1', member, source: 'backup' }, 2);
  assert.deepEqual([stats(replaced).members[0].datedUnlocked, stats(replaced).members[0].unknownDateCount], [0, 2]);
  const restored = command(replaced, { type: 'undo' }, 1);
  assert.equal(stats(restored).members[0].unlocks[0].revision, 1);
  const syncBase = structuredClone(unlocked); syncBase.members[0].sourceMapId = 'qxa';
  const sync = { type: 'sync-original', capturedAt: new Date(NOW - DAY).toISOString(), sourceHash: `sha256:${'0'.repeat(64)}`,
    members: [{ memberId: 'player1', sourceMapId: 'qxa', groups: ['chunks'], unlocked: ['100', '101'] }] };
  const synced = command(syncBase, sync, 1);
  assert.deepEqual([stats(synced).members[0].datedUnlocked, stats(synced).members[0].unknownDateCount], [1, 1]);
  const equalSync = command(synced, sync, 0);
  assert.equal(stats(equalSync).members[0].unlocks[0].revision, 1);
  assert.equal(stats(equalSync).members[0].unknownDateCount, 1);
});

