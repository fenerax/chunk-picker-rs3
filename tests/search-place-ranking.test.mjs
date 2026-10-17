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
