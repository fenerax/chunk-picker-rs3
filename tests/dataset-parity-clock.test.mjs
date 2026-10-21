import test from 'node:test';
import assert from 'node:assert/strict';
import { parityInstant } from '../scripts/lib/dataset-parity-clock.mjs';

// Independent fixtures select their own provider before app modules load.
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { captureProgressSnapshot } = await import('../app/core/progress-timeline.mjs');
const fallback = '2026-10-13T12:00:00.000Z';
const observed = '2026-10-14T16:23:45.678Z';

test('parity clock selects the latest observed instant from raw and enveloped saves without mutation', () => {
  const state = { progressSnapshots: { days: [[1, Date.parse(observed)], [2, Date.parse(fallback)]] } };
  const original = structuredClone(state);
  assert.equal(parityInstant(state), observed);
  assert.equal(parityInstant({ state }), observed);
  assert.deepEqual(state, original);
});

test('parity clock falls back only when observations are absent or empty', () => {
  for (const state of [{}, { progressSnapshots: null }, { progressSnapshots: { days: [] } }]) {
    assert.equal(parityInstant(state), fallback);
    assert.equal(parityInstant({ state }), fallback);
  }
});

test('parity clock rejects malformed observed timestamps instead of falling back or skipping them', () => {
  for (const value of [undefined, null, '2026-10-14T12:00:00.000Z', NaN, Infinity, 0, -1, 1.5,
    Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001]) {
    assert.throws(() => parityInstant({ progressSnapshots: { days: [[1, Date.parse(observed)], [2, value]] } }), /invalid progress snapshot timestamp/);
  }
  assert.throws(() => parityInstant({ progressSnapshots: {} }), /snapshot days/);
  assert.throws(() => parityInstant({ progressSnapshots: { days: [null] } }), /invalid progress snapshot timestamp/);
});

test('reusing the saved observation prevents startup from adding a wrong-day snapshot while preserving every save byte', () => {
  const questPoints = new Map();
  const initial = createGroupState([{ id: 'explorer', name: 'Explorer' }]);
  const state = captureProgressSnapshot(initial, { questPoints, at: observed });
  const originalBytes = JSON.stringify(state);
  const wrongDay = captureProgressSnapshot(state, { questPoints, at: fallback });
  assert.equal(wrongDay.progressSnapshots.days.length, state.progressSnapshots.days.length + 1);
  assert.notEqual(JSON.stringify(wrongDay), originalBytes);
  assert.equal(wrongDay.revision, state.revision);
  const unchanged = captureProgressSnapshot(state, { questPoints, at: parityInstant({ state }) });
  assert.equal(unchanged, state);
  assert.equal(JSON.stringify(unchanged), originalBytes);
  assert.equal(JSON.stringify(state), originalBytes);
});
