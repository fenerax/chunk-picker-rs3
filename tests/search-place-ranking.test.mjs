import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSearchChunks } from '../app/web/screen-search-data.mjs';

test('place search puts the exact place before surface partial matches and interiors', () => {
  const index = [
    { id: 'interior', name: 'Pig Pit Riverside', search: 'interior pig pit riverside' },
    { id: 'other', name: 'Riverside Forest', search: 'other riverside forest' },
    { id: 'town', name: 'Riverside', search: 'town riverside' },
    { id: 'note', name: 'Hill', search: 'note hill' },
  ];
  const notes = new Map([['note', [{ search: 'riverside supplies' }]]]);
  const areas = new Set(['interior']);
  assert.deepEqual(matchingSearchChunks(index, notes, ' Riverside ', areas).map(row => row.id), ['town', 'other', 'note', 'interior']);
  assert.deepEqual(matchingSearchChunks(index, notes, 'interior', areas).map(row => row.id), ['interior']);
  assert.equal(index[0].id, 'interior');
});

test('empty, single-character, accented, exact and missing queries preserve complete stable order', () => {
  const index = Object.freeze([
    { id: 'inside', name: 'Café annex', search: 'inside café annex' },
    { id: 'plain', name: 'Cabin', search: 'plain cabin' },
    { id: 'café', name: 'Hill', search: 'café hill' },
    { id: 'exact', name: 'Café', search: 'exact café' },
    { id: 'notes', name: 'Lake', search: 'notes lake' },
    { id: 'tie', name: 'Café', search: 'tie café' },
  ].map(Object.freeze));
  const notes = new Map([['notes', [{ search: 'café supplies' }, { search: 'café again' }]]]);
  const areas = new Set(['inside']);
  for (const [query, expected] of [
    ['', ['plain', 'café', 'exact', 'notes', 'tie', 'inside']],
    ['c', ['plain', 'café', 'exact', 'notes', 'tie', 'inside']],
    ['É', ['café', 'exact', 'notes', 'tie', 'inside']],
    [' Café ', ['café', 'exact', 'tie', 'notes', 'inside']],
    ['cafe', []],
    ['not present', []],
  ]) assert.deepEqual(matchingSearchChunks(index, notes, query, areas).map(row => row.id), expected, query);
  assert.equal(index[0].id, 'inside', 'ranking does not reorder the cached index');
});
