import test from 'node:test';
import assert from 'node:assert/strict';
import { skillGoals } from '../app/web/helper-model.mjs';
import { renderGoals } from '../app/web/helper-goals.mjs';

const member = id => ({ id, completedTasks: [], taskStatus: {} });
const custom = (id, level, extra = {}) => ({ id: `custom:${id}`, label: id, skill: 'Mining', category: 'Mining', level, ...extra });
const result = tasks => ({ memberId: 'player1', format: 'play-v1', tasks, presentation: { tasks } });
const mining = rows => rows.find(row => row.skill === 'Mining');
const state = tasks => ({ tasks, members: [member('player1'), member('player2')], rules: {} });

test('custom goals honor explicit levels while preserving ordinary F2P trial limits', () => {
  const saved = state([custom('trial', 50, { skill: 'Slayer', category: 'Slayer' }), custom('bad', 121), custom('zero', 0)]);
  const loaded = result([{ id: 'ordinary', category: 'Slayer', level: 50, status: 'available' }]);
  const rows = skillGoals(saved.members[0], loaded, saved);
  assert.equal(rows.find(row => row.skill === 'Slayer').goalCount, 1);
  assert.equal(mining(rows).goalCount, 0);
});

