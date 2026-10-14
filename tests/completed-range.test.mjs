import test from 'node:test';
import assert from 'node:assert/strict';
import { completedRangeOptions, normalizeCompletedRange, selectCompletedRange } from '../app/web/completed-range.mjs';

const rows = (...dates) => dates.map((latestAt, index) => ({ task: { id: String(index) }, latestAt }));

test('range options and normalization expose the supported choices', () => {
  assert.deepEqual(completedRangeOptions, [
    { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
    { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: 'custom', label: 'Custom' },
  ]);
  for (const value of ['all', 'today', '7', '30', 'custom']) assert.equal(normalizeCompletedRange(value), value);
  assert.equal(normalizeCompletedRange('yesterday'), 'all');
});

test('all time preserves order and counts missing and invalid dates', () => {
  const input = rows(null, 'bad-date', '2026-03-01T12:00:00-04:00');
  const before = [...input];
  const selected = selectCompletedRange(input);
  assert.deepEqual(selected.rows, input);
  assert.equal(selected.label, 'All time');
  assert.equal(selected.error, null);
  assert.equal(selected.unknownDates, 2);
  assert.deepEqual(input, before);
});

test('Today and rolling ranges use inclusive local calendar days and local midnight', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Halifax';
    const input = rows('2026-03-02T03:59:59Z', '2026-03-02T04:00:00Z', '2026-03-08T04:59:59Z', '2026-03-09T03:59:59Z');
    const now = new Date('2026-03-08T16:00:00-03:00');
    assert.deepEqual(selectCompletedRange(input, { range: 'today', now }).rows, [input[2]]);
    assert.deepEqual(selectCompletedRange(input, { range: '7', now }).rows, [input[1], input[2]]);
    assert.deepEqual(selectCompletedRange(input, { range: '30', now }).rows, [input[0], input[1], input[2]]);
    assert.equal(selectCompletedRange(input, { range: 'today', now }).label, 'today');
    assert.equal(selectCompletedRange(input, { range: '7', now }).label, 'last 7 days');
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('custom bounds include both days, allow partial bounds, and validate dates strictly', () => {
  const input = rows(null, '2026-02-27T12:00:00Z', '2026-02-28T12:00:00Z', '2026-03-01T12:00:00Z', '2026-03-02T12:00:00Z');
  const both = selectCompletedRange(input, { range: 'custom', from: '2026-02-28', to: '2026-03-01' });
  assert.deepEqual(both.rows, [input[2], input[3]]);
  assert.equal(both.label, '2026-02-28 to 2026-03-01');
  assert.deepEqual(selectCompletedRange(input, { range: 'custom', from: '2026-03-01' }).rows, [input[3], input[4]]);
  assert.equal(selectCompletedRange(input, { range: 'custom', from: '2026-03-01' }).label, 'from 2026-03-01');
  assert.deepEqual(selectCompletedRange(input, { range: 'custom', to: '2026-02-28' }).rows, [input[1], input[2]]);
  assert.equal(selectCompletedRange(input, { range: 'custom', to: '2026-02-28' }).label, 'through 2026-02-28');
  assert.deepEqual(selectCompletedRange(input, { range: 'custom' }), {
    rows: [], label: 'custom range', error: 'Choose a From or To date.', unknownDates: 1,
  });
  assert.equal(selectCompletedRange(input, { range: 'custom', from: '2026-02-30' }).error, 'Choose a valid From and To date.');
  assert.equal(selectCompletedRange(input, { range: 'custom', from: '03/01/2026' }).error, 'Choose a valid From and To date.');
  assert.equal(selectCompletedRange(input, { range: 'custom', from: '2026-03-02', to: '2026-03-01' }).error, 'From must be on or before To.');
});

test('shared rows use their authoritative latestAt and output order without mutation', () => {
  const shared = { task: { id: 'shared' }, latestAt: '2026-04-04T23:59:00Z', completions: [
    { memberId: 'actor1', at: '2026-04-02T12:00:00Z' }, { memberId: 'reed', at: '2026-04-04T23:59:00Z' },
  ] };
  const unknown = { task: { id: 'unknown' }, latestAt: null };
  const input = [unknown, shared], before = structuredClone(input);
  const selected = selectCompletedRange(input, { range: 'custom', from: '2026-04-04', to: '2026-04-04' });
  assert.deepEqual(selected.rows, [shared]);
  assert.deepEqual(input, before);
});

test('rolling calendar days survive a daylight saving transition', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Halifax';
    const now = new Date('2026-03-09T12:00:00-03:00');
    const input = rows('2026-03-02T12:00:00-04:00', '2026-03-03T12:00:00-04:00', '2026-03-08T01:30:00-04:00', '2026-03-09T12:00:00-03:00');
    const selected = selectCompletedRange(input, { range: '7', now });
    assert.deepEqual(selected.rows, [input[1], input[2], input[3]]);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('last 30 days includes day 29 and excludes day 30, tomorrow and undated rows', () => {
  const now = new Date(2026, 9, 12, 15);
  const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
  const input = rows(at(12 - 30), at(12 - 29, 0), at(12, 23), at(13), null);
  assert.deepEqual(selectCompletedRange(input, { range: '30', now }).rows, [input[1], input[2]]);
});
