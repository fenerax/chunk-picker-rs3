import test from 'node:test';
import assert from 'node:assert/strict';
import { afterOwnedChildrenStop } from '../scripts/perf/owned-cleanup.mjs';

const running = pid => ({ pid, exitCode: null, signalCode: null });

test('failed startup retains scratch if stopping its child fails', async () => {
  let removed = false;
  await assert.rejects(afterOwnedChildrenStop([undefined, running(1)], async () => {
    throw new Error('stop failed');
  }, () => { removed = true; }), /stop failed/);
  assert.equal(removed, false);
});

test('resolved stop must still confirm that the child exited', async () => {
  let removed = false;
  await assert.rejects(afterOwnedChildrenStop([running(1)], async () => {}, () => {
    removed = true;
  }), /has not exited/);
  assert.equal(removed, false);
});

test('restart failure checks its child as well as the stopped cold child', async () => {
  const cold = { ...running(1), exitCode: 0 }, restart = running(2), checked = [];
  let removed = false;
  await assert.rejects(afterOwnedChildrenStop([cold, restart], async child => {
    checked.push(child.pid);
  }, () => { removed = true; }), /has not exited/);
  assert.deepEqual(checked, [1, 2]);
  assert.equal(removed, false);
});

test('confirmed exit permits cleanup once and deduplicates child handles', async () => {
  const child = running(1);
  let stops = 0, removals = 0;
  const result = await afterOwnedChildrenStop([child, child], async owned => {
    stops++;
    owned.signalCode = 'SIGTERM';
  }, () => { removals++; return 'removed'; });
  assert.equal(result, 'removed');
  assert.equal(stops, 1);
  assert.equal(removals, 1);
});

test('cleanup without a spawned child still runs', async () => {
  let removed = false;
  await afterOwnedChildrenStop([undefined], async () => assert.fail('no child'), () => {
    removed = true;
  });
  assert.equal(removed, true);
});
