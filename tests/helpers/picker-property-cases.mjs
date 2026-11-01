// Small public witnesses for the explicit exceptions to the positive oracle.
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../../app/tasks/presentation.mjs';
import { engineOptions } from './picker-properties.mjs';

export const state = () => ({ rules: { 'content.f2p': false }, taskRules: { 'Show Nonskill Tasks': true },
  members: [{ id: 'a', unlocked: ['100'], completedTasks: [], passiveLevels: { Mining: 2, Crafting: 1 } }] });
export function pair(definitions, before, change) {
  const engine = createTaskEngine(definitions, engineOptions), after = structuredClone(before);
  change(after);
  const evaluate = saved => {
    const result = engine.evaluate(saved, 'a');
    return { result, pool: selectPresentedTasks(result, saved, 'a', definitions).tasks };
  };
  return { before: evaluate(before), after: evaluate(after) };
}
export const preferred = () => ({ chunks: { 100: {}, 101: {} }, challenges: { Extra: {
  Low: { Set: 'X09 preference', Priority: 2 }, High: { Set: 'X09 preference', Priority: 1, Chunks: ['101'] },
} } });
export const skillGoals = () => ({ chunks: { 100: {} }, challenges: { Mining: { Low: { Level: 2 }, High: { Level: 10 } } } });
export function processing(bySkill = false) {
  return { chunks: { 100: { Spawn: { 'X09 input': 1 } }, 101: {} }, challenges: {
    Crafting: {
      High: { Level: 20, Items: ['X09 input'], Output: 'X09 high output', Primary: true },
      Low: { Level: 1, Items: ['X09 input'], Output: 'X09 low output', Primary: true,
        ...(bySkill ? { Requirements: { Mining: 10 } } : { Chunks: ['101'] }) },
    }, Extra: { Consumer: { Items: ['X09 high output'] } },
  } };
}
export const completedRoot = () => ({ chunks: { 100: {}, 101: {} }, challenges: { Extra: {
  Historic: { PickerId: 'rs3:task:x09-historic', Chunks: ['101'] },
} } });
export const diary = () => ({ chunks: { 100: {}, 101: {} }, challenges: { Diary: {
  Child: { BaseQuest: 'X09 family', Chunks: ['100'] },
  Parent: { BaseQuest: 'X09 family', Tasks: { Child: 'Diary' }, Chunks: ['101'] },
} } });
export const restrictedSource = () => ({ chunks: { 100: {}, 101: { Spawn: { 'X09 output': 1 } } }, challenges: {
  Crafting: { Producer: { Level: 1, Output: 'X09 output', NoXp: true } },
  Extra: { Consumer: { Items: ['X09 output'], AllowedSources: ['Producer'] } },
} });
export const row = (evaluation, label) => evaluation.result.tasks.find(task => task.label === label);
