import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

// Like Daemonheim: a personal west entrance names a numeric interior alias,
// while the interior's retained backlink names the partner's east chunk.
function fixture(personalEntrance = true) {
  const definitions = {
    chunks: {
      '12850': { Connect: personalEntrance ? { '59': true } : {} },
      '12851': { Connect: { '59': true }, Object: { 'East bench': true } },
      '59': { Name: 'Shared dungeon' },
      'Shared dungeon': { Connect: { '12851': true }, Monster: { Imp: 1 }, Spawn: { 'Dungeon token': 1 } },
    },
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850'] } },
    walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
    challenges: {
      Extra: {
        Dungeon: { Chunks: ['Shared dungeon'] },
        Rat: { Monsters: ['Imp'] },
        Token: { Items: ['Dungeon token'] },
        East: { Objects: ['East bench'] },
      },
      Crafting: { Make: { Items: ['Dungeon token'], Output: 'Dungeon badge' } },
      Diary: { Badge: { Tasks: { Make: 'Crafting' } } },
    }, codeItems: {}, drops: {}, shopItems: {},
  };
  const state = createGroupState([
    { id: 'actor1', name: 'Player', unlocked: ['12850'] },
    { id: 'reed', name: 'Reed', unlocked: ['12851'] },
  ]);
  return { state, engine: createTaskEngine(definitions) };
}

test('a personal interior entrance survives a partner-only surface backlink, for either player', () => {
  const { state, engine } = fixture();
  for (const shared of [true, false]) for (const memberId of ['actor1', 'reed']) {
    const result = engine.evaluate({ ...state, rules: { ...state.rules, 'access.shared': shared } }, memberId);
    assert.ok(result.obligationAccess.areas.includes('Shared dungeon'));
    assert.deepEqual(result.obligationAccess.entranceSources['Shared dungeon'], [memberId === 'actor1' ? '12850' : '12851']);
    for (const [category, label] of [['Extra', 'Dungeon'], ['Extra', 'Rat'], ['Extra', 'Token'], ['Crafting', 'Make'], ['Diary', 'Badge']]) {
      const row = result.tasks.find(t => t.id === taskId(category, label));
      assert.equal(row.obligation, true, `${memberId}: ${label} has a personal entrance/source`);
      assert.equal(row.status, 'available');
    }
    assert.equal(result.tasks.find(t => t.id === taskId('Extra', 'East')).obligation, memberId === 'reed');
  }
});

test('a partner-only interior supplies activities and items without creating personal tasks', () => {
  const { state, engine } = fixture(false);
  const before = structuredClone(state), result = engine.evaluate(state, 'actor1');
  assert.ok(result.access.areas.includes('Shared dungeon'));
  assert.ok(!result.obligationAccess.areas.includes('Shared dungeon'));
  assert.ok(result.items.some(item => item.name === 'Dungeon badge'));
  for (const row of result.tasks) assert.equal(row.obligation, false, row.label);
  assert.deepEqual(state, before);
});
