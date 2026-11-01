import { createGroupState } from '../../app/core/state.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { buildWorld } from '../../app/data/world.mjs';

export const randomStartDefinitions = {
  chunks: {
    '12850': { Sections: { '1': { Object: { 'Synthetic tree': true } }, '2': {} } },
    '12851': { Sections: { '1': { Object: { 'Synthetic rock': true } }, '2': {} } },
  },
  sections: { '12850': { '1': [], '2': [] }, '12851': { '1': [], '2': [] } },
  walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
  challenges: { Extra: {
    'Synthetic tree task': { Objects: ['Synthetic tree'] },
    'Synthetic rock task': { Objects: ['Synthetic rock'] },
  } },
};

export function randomStartFixture() {
  const engine = createTaskEngine(randomStartDefinitions, { cacheWalking: false });
  const world = buildWorld(randomStartDefinitions, { cacheWalking: false });
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic' }]);
  state.rules['roll.neighborMode'] = 'manual';
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  return { engine, world, state };
}
