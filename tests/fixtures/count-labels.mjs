// Public, engine-reachable count fixtures; never read a gameplay save or pack.
import { createGroupState } from '../../app/core/state.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';

export function countLabelFixture(kind = 'progress') {
  if (!['progress', 'backlog', 'paging'].includes(kind)) throw Error('Unknown count fixture');
  const count = kind === 'progress' ? 4 : kind === 'backlog' ? 1 : 72;
  const definitions = {
    chunks: { '12850': {}, '12851': {}, '12852': {} },
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850'] }, '12852': { '0': [] } },
    walkableChunks: ['12850', '12851', '12852'], walkableChunksF2P: ['12850', '12851', '12852'],
    challenges: { Extra: Object.fromEntries(Array.from({ length: count }, (_, i) => [`Count goal ${String(i).padStart(2, '0')}`, { Chunks: ['12850'] }])) },
  };
  const tasks = createTaskEngine(definitions, {}).catalogue.filter(task => task.label.startsWith('Count goal '));
  const state = createGroupState([{ id: 'player1', name: 'Explorer One', unlocked: ['12850'], selected: ['12851'] }, { id: 'player2', name: 'Explorer Two', unlocked: ['12850'], selected: ['12851'] }]);
  state.revision = 19; state.rules['roll.neighborMode'] = 'manual';
  state.tasks = tasks.map(({ id, label, category }) => ({ id, label, category }));
  for (const [index, member] of state.members.entries()) {
    member.preferences = { hideChecked: false, numTasksPercent: true, rollWarning: true, randomStartAlways: false, cinematicRoll: false, newTasks: false };
    member.taskStatus = kind === 'progress' ? { [tasks[0].id]: { challengeCompleted: true } }
      : Object.fromEntries(tasks.map(task => [task.id, { backlogged: true, backlogReason: index ? 'Wait for supplies' : 'Later' }]));
  }
  return { definitions, state, tasks };
}
