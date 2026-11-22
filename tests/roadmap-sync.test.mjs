import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedIssueNumbers, syncRoadmap } from '../scripts/sync-roadmap.mjs';

const fixture = () => ({
  schemaVersion: 1,
  updated: '2026-11-20',
  statuses: { working: 'In progress', next: 'Up next', done: 'Done' },
  sizes: { S: 'Small', M: 'Medium' },
  themes: [
    {
      id: 'ops',
      title: 'Speed',
      blurb: 'Fast unlocks.',
      items: [
        { id: 'G1', title: 'Fast unlocks', what: 'w', why: 'y', size: 'M', status: 'working', issues: [285, 296] },
        { id: 'H9', title: 'How routes', what: 'w', why: 'y', size: 'M', status: 'working', issues: [286] },
        { id: 'D1', title: 'Shipped thing', what: 'w', why: 'y', size: 'S', status: 'done', done: '2026-11-10', issues: [200] },
        { id: 'U1', title: 'Unlinked thing', what: 'w', why: 'y', size: 'S', status: 'next' },
      ],
    },
  ],
});

test('linkedIssueNumbers returns sorted unique positive issue numbers', () => {
  assert.deepEqual(linkedIssueNumbers(fixture()), [200, 285, 286, 296]);
});

test('syncRoadmap marks an item done only when every linked issue is closed', () => {
  const partial = syncRoadmap(fixture(), {
    today: '2026-11-21',
    issuesByNumber: {
      285: { number: 285, state: 'closed', closedAt: '2026-11-21T10:00:00Z' },
      296: { number: 296, state: 'open', closedAt: null },
      286: { number: 286, state: 'closed', closedAt: '2026-11-21T12:00:00Z' },
      200: { number: 200, state: 'closed', closedAt: '2026-11-10T09:00:00Z' },
    },
  });
  assert.equal(partial.changed, true);
  assert.deepEqual(partial.changes, [{ id: 'H9', from: 'working', to: 'done', done: '2026-11-21' }]);
  const items = partial.roadmap.themes[0].items;
  assert.equal(items[0].status, 'working', 'G1 stays open while #296 is still open');
  assert.equal(items[1].status, 'done');
  assert.equal(items[1].done, '2026-11-21');
  assert.equal(partial.roadmap.updated, '2026-11-21');

  const bothClosed = syncRoadmap(fixture(), {
    today: '2026-11-22',
    issuesByNumber: {
      285: { number: 285, state: 'closed', closedAt: '2026-11-19T10:00:00Z' },
      296: { number: 296, state: 'closed', closedAt: '2026-11-21T18:00:00Z' },
    },
  });
  assert.equal(bothClosed.roadmap.themes[0].items[0].status, 'done');
  assert.equal(bothClosed.roadmap.themes[0].items[0].done, '2026-11-21', 'Uses the latest closed date across linked issues');
});

test('syncRoadmap reopens a done item when a linked issue reopens and leaves unchanged state untouched', () => {
  const input = fixture();
  const reopened = syncRoadmap(input, {
    today: '2026-11-21',
    issuesByNumber: {
      200: { number: 200, state: 'open', closedAt: null },
    },
  });
  assert.equal(reopened.changed, true);
  assert.deepEqual(reopened.changes, [{ id: 'D1', from: 'done', to: 'working' }]);
  assert.equal(reopened.roadmap.themes[0].items[2].status, 'working');
  assert.equal('done' in reopened.roadmap.themes[0].items[2], false);
  assert.equal(input.themes[0].items[2].status, 'done', 'Does not mutate input roadmap');

  const noop = syncRoadmap(input, {
    today: '2026-11-25',
    issuesByNumber: {
      285: { number: 285, state: 'open', closedAt: null },
      296: { number: 296, state: 'open', closedAt: null },
      286: { number: 286, state: 'open', closedAt: null },
      200: { number: 200, state: 'closed', closedAt: '2026-11-10T09:00:00Z' },
    },
  });
  assert.equal(noop.changed, false);
  assert.equal(noop.roadmap.updated, '2026-11-20', 'Unchanged roadmap keeps its previous updated date');
});
