import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletedRangePreference, completedRangePreferenceKey } from '../app/web/completed-range-preference.mjs';

test('quick choice persists per browser while custom dates stay in the current review', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const preference = createCompletedRangePreference(storage);
  assert.equal(preference.get(), 'all');
  preference.set('7'); assert.equal(values.get(completedRangePreferenceKey), '7');
  assert.equal(createCompletedRangePreference(storage).get(), '7');
  preference.set('custom'); assert.equal(preference.get(), 'custom');
  assert.equal(createCompletedRangePreference(storage).get(), '7');
  preference.set('unknown'); assert.equal(preference.get(), 'all');
  values.set(completedRangePreferenceKey, 'custom'); assert.equal(createCompletedRangePreference(storage).get(), 'all');
});

test('unavailable or invalid storage keeps quick choices usable without shared state', () => {
  for (const storage of [null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, { getItem: () => '{bad}' }]) {
    const preference = createCompletedRangePreference(storage);
    assert.equal(preference.get(), 'all');
    preference.set('30'); assert.equal(preference.get(), '30');
  }
});
