import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadSnapshot } from '../app/storage/read-snapshot.mjs';

test('read snapshots copy only visited fields and share unchanged frozen copies across revisions', () => {
  const copied = [], snapshot = createReadSnapshot(value => { copied.push(value); return structuredClone(value); });
  const members = [{ id: 'synthetic-member', notes: { '100': 'Before' } }], tasks = [{ id: 'synthetic-task', nested: ['Original'] }];
  const retained = { largeUnvisited: 'Synthetic retained evidence' };
  const first = snapshot({ revision: 0, members, tasks, retained });
  assert.deepEqual(copied, []);
  assert.equal(first.members[0].notes['100'], 'Before');
  assert.deepEqual(copied, [members]);
  assert.throws(() => { first.members[0].notes['100'] = 'External'; }, TypeError);
  assert.throws(() => { Object.defineProperty(first, 'members', { value: [] }); }, TypeError);
  const firstTasks = first.tasks;
  const second = snapshot({ revision: 1, members: [{ ...members[0], notes: { '100': 'After' } }], tasks, retained });
  assert.equal(second.tasks, firstTasks);
  assert.throws(() => { second.tasks[0].nested.push('External'); }, TypeError);
  assert.deepEqual(copied, [members, tasks]);
  assert.equal(second.members[0].notes['100'], 'After');
  assert.equal(first.members[0].notes['100'], 'Before');
  assert.ok(!copied.includes(retained));
});
