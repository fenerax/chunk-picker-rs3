import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMapTaskLocations } from '../app/tasks/map-task-locations.mjs';

const definitions = {
  chunks: {
    '12342': { Sections: { '1': { Object: { Anvil: 1 } } } },
    '9000': { Name: 'Dorgesh-Kaan' },
    'Dorgesh-Kaan': {},
    'Puro-Puro': {},
  },
  taskUnlocks: {},
  codeItems: {},
};
const world = {
  chunks: new Map([['12342', { name: 'Surface' }], ['9000', { name: 'Dorgesh-Kaan' }]]),
  areas: new Map([['Puro-Puro', { name: 'Puro-Puro' }]]),
};
const task = (id, record = {}, extras = {}) => ({ id, label: id, category: 'Extra', record, status: 'available', ...extras });

test('projects only available default-presented and custom tasks to unique surface chunks', () => {
  const sectionTask = task('section-task', { Chunks: ['12342-1'], Objects: ['Anvil'] }, {
    sources: [{ location: '12342-1', name: 'Anvil' }],
  });
  const aliasTask = task('alias-task', { Chunks: ['Dorgesh-Kaan'] });
  const namedInteriorTask = task('named-interior', { Chunks: ['Puro-Puro'] });
  const custom = task('custom:mine', { Chunks: ['12342'] });
  const customBlocked = task('custom:blocked', { Chunks: ['12342'] }, { status: 'blocked' });
  const result = {
    tasks: [sectionTask, aliasTask, namedInteriorTask, custom, customBlocked,
      task('not-presented', { Chunks: ['12342'] })],
    presentation: { tasks: ['section-task', { id: 'alias-task' }, 'named-interior'] },
  };

  assert.deepEqual(projectMapTaskLocations(definitions, result, world), {
    'section-task': ['12342'],
    'alias-task': ['9000'],
    'named-interior': [],
    'custom:mine': ['12342'],
  });
});

test('excludes hidden, non-obligatory, NeverShow and blocked presentation rows', () => {
  const result = {
    tasks: [
      task('hidden', { Chunks: ['12342'] }, { hidden: true }),
      task('optional', { Chunks: ['12342'] }, { obligation: false }),
      task('never', { Chunks: ['12342'] }, { record: { NeverShow: true } }),
      task('blocked', { Chunks: ['12342'] }, { status: 'blocked' }),
    ],
    presentation: { tasks: ['hidden', 'optional', 'never', 'blocked'] },
  };
  assert.deepEqual(projectMapTaskLocations(definitions, result, world), {});
});

test('returns an empty projection when there are no presented or available custom candidates', () => {
  assert.deepEqual(projectMapTaskLocations(definitions, { tasks: [task('hidden:catalogue', { Chunks: ['12342'] })], presentation: { tasks: [] } }, world), {});
  assert.deepEqual(projectMapTaskLocations(definitions, { tasks: [], presentation: { tasks: ['missing'] } }, world), {});
});
