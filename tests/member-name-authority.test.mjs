// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberNameChanges, authorizeMemberNames } from '../app/storage/member-name-authority.mjs';

test('name changes use existing RuneScape normalization and exact member IDs', () => {
  const state = names => ({ members: names.map(([id, runescapeName]) => ({ id, runescapeName })) });
  const before = state([['a', 'First_Name'], ['b', 'Partner']]);
  assert.deepEqual(memberNameChanges(before, state([['a', ' first name '], ['b', 'Other']])),
    [{ memberId: 'a', normalized: false }, { memberId: 'b', normalized: true }]);
  assert.deepEqual(memberNameChanges(before, before), []);
  assert.deepEqual(memberNameChanges(before, state([['a', undefined], ['new', 'New']])), [{ memberId: 'a', normalized: true }]);
});

test('administration and historical attribution grant no authority over another member name', () => {
  const changes = [{ memberId: 'a' }];
  for (const actor of [{ kind: 'master' }, { kind: 'invite', memberId: 'b' }, { kind: 'invite' }]) {
    assert.throws(() => authorizeMemberNames(changes, actor), error => error.status === 403 && /login controlling this character/.test(error.message));
  }
  assert.doesNotThrow(() => authorizeMemberNames(changes, { kind: 'invite', memberId: 'a' }));
  assert.doesNotThrow(() => authorizeMemberNames(changes, undefined));
});
