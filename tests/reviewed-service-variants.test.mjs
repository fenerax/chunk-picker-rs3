import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedServiceVariant } from '../app/data/reviewed-service-variants.mjs';
test('a reviewed fish deposit matches only its complete physical identity', () => {
  const match = { id: 'fixture:one', chunkId: '1', objectId: 42, classKey: 'facility:deposit-box', x: 5, y: 6 };
  const rows = [{ match, service: { kind: 'deposit', members: false, depositCapability: 'fish-only' } }];
  assert.deepEqual(reviewedServiceVariant(match, rows), rows[0].service);
  assert.equal(reviewedServiceVariant({ ...match, id: 'other' }, rows), null);
  for (const change of [{ chunkId: '2' }, { objectId: 43 }, { classKey: 'facility:bank-booth' }, { x: 7 }]) assert.throws(() => reviewedServiceVariant({ ...match, ...change }, rows), /drift/);
  assert.throws(() => reviewedServiceVariant(match, [{ match, service: { kind: 'bank', depositCapability: 'fish-only' } }]), /capability/);
});
