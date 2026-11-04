import test from 'node:test';
import assert from 'node:assert/strict';
import { cgroupSpareMemory } from '../scripts/perf/memory-admission.mjs';
import { pruneCalculatorState } from '../scripts/perf/calculator-input.mjs';
import { applyCommand, createGroupState, hasRandomStartChoices } from '../app/core/state.mjs';

test('memory admission uses host available memory for unlimited cgroups', async () => {
  for (const gib of [3, 6]) {
    const files = new Map([
      ['/sys/fs/cgroup/memory.max', 'max\n'],
      ['/proc/meminfo', `MemTotal:       16777216 kB\nMemAvailable:   ${gib * 1024 ** 2} kB\n`],
    ]);
    const spare = await cgroupSpareMemory(async file => {
      assert.ok(files.has(file), 'unlimited cgroups do not need memory.current');
      return files.get(file);
    });
    assert.equal(spare, gib * 1024 ** 3);
    assert.equal(spare >= 4 * 1024 ** 3, gib >= 4);
    assert.equal(spare >= 5 * 1024 ** 3, gib >= 5);
  }
});

test('memory admission subtracts current usage from a finite cgroup limit', async () => {
  const files = new Map([
    ['/sys/fs/cgroup/memory.max', `${8 * 1024 ** 3}\n`],
    ['/sys/fs/cgroup/memory.current', `${2 * 1024 ** 3}\n`],
  ]);
  assert.equal(await cgroupSpareMemory(async file => {
    assert.ok(files.has(file), 'finite cgroups use their own remaining memory');
    return files.get(file);
  }), 6 * 1024 ** 3);
});

test('calculator pruning retains ordinary pending-offer history so cancellation preserves selected', () => {
  const memberId = String(1), ids = ['100', '101', '102'];
  const original = createGroupState([{ id: memberId, name: 'Synthetic member', unlocked: ['100'] }]);
  original.rules['roll.neighborMode'] = 'frontier';
  const world = {
    chunks: new Map(ids.map(id => [id, { id }])),
    neighbors: new Map(ids.map(id => [id, ids.filter(other => other !== id)])),
    walkable: new Set(ids), f2p: new Set(ids), surface: new Set(ids),
  };
  const options = { world, random: () => 0, now: new Date(Date.UTC(2030, 0, 1)) };
  const pending = applyCommand(original, { type: 'roll', memberId, count: 2 }, options);
  assert.equal(pending.members[0].pendingRoll.length, 2);
  assert.equal(hasRandomStartChoices(pending, pending.members[0]), false);
  assert.deepEqual(pending.history.at(-1).command.handSelected, []);
  const pruned = pruneCalculatorState(pending);
  assert.deepEqual(pruned.history, pending.history);
  const cancelled = applyCommand(pruned, { type: 'cancel-roll', memberId }, options);
  assert.deepEqual(cancelled.members[0].selected, original.members[0].selected);
  assert.deepEqual(cancelled.members[0].pendingRoll, []);
  assert.deepEqual(pruneCalculatorState(cancelled).history, []);
});
