// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { createDependencyMemo } from '../app/tasks/dependency-memo.mjs';

test('serialized dependency observations invalidate absent and present inputs and preserve counters', () => {
  let values = { objects: new Set(), levels: 1 }, runs = 0;
  let memo = createDependencyMemo();
  const counters = { dependencyChecks: 0 };
  const bind = () => {
    memo.root('access', () => values);
    return memo.wrap('access', values);
  };
  let access = bind();
  const check = () => memo.check('fixture:true', () => {
    runs++; counters.dependencyChecks += 2;
    return [{ kind: access.objects.has('Furnace') ? 'available' : 'missing', level: access.levels }];
  }, counters);
  assert.equal(check()[0].kind, 'missing');
  const bytes = serialize(memo.export());
  memo = createDependencyMemo(deserialize(bytes)); access = bind();
  const row = check(); row[0].kind = 'mutated by caller';
  assert.equal(check()[0].kind, 'missing');
  assert.equal(runs, 1);
  values.objects.add('Furnace');
  assert.equal(check()[0].kind, 'available');
  values.objects.delete('Furnace');
  assert.equal(check()[0].kind, 'missing');
  values.levels = 2;
  assert.equal(check()[0].level, 2);
  assert.equal(counters.dependencyChecks, 12);
});

test('source dependencies retain undefined fields, collection order and explicit mutation invalidation', () => {
  let values = new Map([['Bar', [{ primary: undefined }]]]), runs = 0;
  const memo = createDependencyMemo(), counters = { dependencyChecks: 0 };
  memo.root('sources', () => values);
  const sources = memo.wrap('sources', values);
  const check = () => memo.check('fixture:false', () => {
    runs++;
    return [Object.hasOwn(sources.get('Bar')[0], 'primary')];
  }, counters);
  assert.deepEqual(check(), [true]);
  values.set('Bar', [{}]);
  assert.deepEqual(check(), [false]);
  const list = values.get('Bar'); list[0].primary = true; memo.invalidate(list);
  assert.deepEqual(check(), [true]);
  assert.equal(runs, 3);
});

test('consumer predicates track admission instead of unrelated source provenance', () => {
  let supply = { admitted: false, location: 'fixture-a' }, runs = 0;
  const memo = createDependencyMemo(), counters = { dependencyChecks: 0 };
  memo.root('item', () => supply.admitted);
  const check = () => memo.check('fixture:false', () => {
    runs++;
    return [memo.predicate('item', [], () => supply.admitted)];
  }, counters);
  assert.deepEqual(check(), [false]);
  supply = { admitted: false, location: 'fixture-b' };
  assert.deepEqual(check(), [false]);
  assert.equal(runs, 1);
  supply.admitted = true;
  assert.deepEqual(check(), [true]);
  assert.equal(runs, 2);
});
