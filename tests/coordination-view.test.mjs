import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationView } from '../app/server.mjs';

const actor = { kind: 'invite', inviteId: 'reed-link', label: 'Reed', memberId: 'reed' };
const identity = { ...actor, actor };
const event = (revision, by = actor, fields = {}) => ({ revision, at: '2026-10-10T12:00:00.000Z', type: 'set-note', actor: by,
  command: { type: 'set-note', memberId: 'reed', chunkId: '100', note: 'Remember this' }, hasUndo: true, ...fields });

function fixture(records, eligibility = {}) {
  const previews = [];
  const latest = records.findLast(row => row.hasUndo && row.type !== 'undo' && row.undoneRevision === undefined);
  const store = {
    getRecentHistory: limit => records.slice(-limit),
    getHistoryEvent: revision => records.find(row => row.revision === revision),
    getInfo: () => ({ revision: records.at(-1)?.revision ?? 0 }),
    getState() { throw new Error('Coordination must not hydrate a full save'); },
    getHistory() { throw new Error('Coordination must not clone undo snapshots'); },
    command() { throw new Error('Coordination must not write gameplay'); },
    getUndoEligibility(revision = latest?.revision) {
      previews.push(revision);
      return revision === undefined ? { canUndo: false, reason: 'There is no change to undo.' }
        : { canUndo: true, reason: null, undoRevision: revision, ...eligibility[revision] };
    },
  };
  return { store, previews };
}

test('coordination returns only 100 public records and previews latest and own exactly once', () => {
  const rows = Array.from({ length: 120 }, (_, index) => event(index + 1, { ...actor, inviteId: 'partner', memberId: 'actor1', label: 'Player' }));
  rows[0] = event(1);
  const f = fixture(rows), result = coordinationView(f.store, identity);
  assert.equal(result.stateRevision, 120);
  assert.equal(result.history.length, 100);
  assert.equal(result.history[0].revision, 21);
  assert.equal(result.latestUndo.event.revision, 120);
  assert.equal(result.ownUndo.event.revision, 1, 'own latest can be older than the public notice window');
  assert.deepEqual(f.previews, [120, 1]);
  assert.ok(result.history.every(row => !Object.hasOwn(row, 'hasUndo') && !Object.hasOwn(row, 'undo')));
  assert.ok(!Object.hasOwn(result.ownUndo.event, 'hasUndo'));
});

test('many own changes cannot crowd a partner change out of catch-up metadata', () => {
  const partner = { kind: 'master', label: 'Player' };
  const rows = [event(1, partner), ...Array.from({ length: 110 }, (_, index) => event(index + 2))];
  const result = coordinationView(fixture(rows).store, identity);
  assert.deepEqual(result.history.map(row => row.revision), [1]);
});

test('same-label different invites are distinct while linked-player invitations share ownership', () => {
  const other = { kind: 'invite', inviteId: 'other-link', label: 'Reed' };
  assert.equal(coordinationView(fixture([event(1, other)]).store, identity).ownUndo, null);
  const newest = event(3, { kind: 'master', label: 'Player' });
  const result = coordinationView(fixture([event(1, actor), event(2, { ...other, memberId: 'reed' }), newest]).store, identity);
  assert.equal(result.ownUndo.event.revision, 2);
});

test('same invitation owns its old unlinked events across sessions and player attribution changes', () => {
  const old = { kind: 'invite', inviteId: 'reed-link', label: 'Earlier label' };
  const result = coordinationView(fixture([event(1, old), event(2, { kind: 'master', label: 'Player' })]).store, identity);
  assert.equal(result.ownUndo.event.revision, 1);
});

test('blocked newest own event stays visible with its reason instead of skipping to an older one', () => {
  const rows = [event(1), event(2, actor, { type: 'replace-member' }), event(3, { kind: 'master', label: 'Player' })];
  const result = coordinationView(fixture(rows, { 2: { canUndo: false, reason: 'A later change depends on this map.' } }).store, identity);
  assert.equal(result.ownUndo.event.revision, 2);
  assert.equal(result.ownUndo.canUndo, false);
  assert.equal(result.ownUndo.reason, 'A later change depends on this map.');
});

test('already undone and non-reversible own events do not replace the active own target', () => {
  const rows = [event(1), event(2, actor, { undoneRevision: 3 }), event(3, actor, { type: 'undo', hasUndo: false }),
    event(4, actor, { type: 'catalogue-refresh', hasUndo: false }), event(5, { kind: 'master', label: 'Player' })];
  assert.equal(coordinationView(fixture(rows).store, identity).ownUndo.event.revision, 1);
});

test('global latest owned by viewer needs one button and empty history needs none', () => {
  const own = fixture([event(1)]), result = coordinationView(own.store, identity);
  assert.equal(result.latestUndo.canUndo, true);
  assert.equal(result.ownUndo, null);
  assert.deepEqual(own.previews, [1]);
  const empty = coordinationView(fixture([]).store, identity);
  assert.equal(empty.latestUndo.canUndo, false);
  assert.equal(empty.latestUndo.event, null);
  assert.equal(empty.ownUndo, null);
});

test('master attribution matches master access; unlinked legacy attribution can use the label', () => {
  const rows = [event(1, { kind: 'master', label: 'Player' }), event(2, { label: 'Reed' }), event(3, { kind: 'invite', inviteId: 'partner', label: 'Partner' })];
  assert.equal(coordinationView(fixture(rows).store, { kind: 'master', label: 'Player', memberId: null }).ownUndo.event.revision, 1);
  assert.equal(coordinationView(fixture(rows).store, identity).ownUndo.event.revision, 2);
});

test('a coordination read exposes the committed revision without changing a stale caller state', () => {
  const rows = [event(3)], before = structuredClone(rows), f = fixture(rows);
  const caller = { revision: 2 };
  const result = coordinationView(f.store, identity);
  assert.equal(result.stateRevision, 3);
  assert.equal(caller.revision, 2);
  assert.deepEqual(rows, before);
});
