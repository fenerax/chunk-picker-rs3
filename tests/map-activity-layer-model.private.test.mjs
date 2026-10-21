import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapActivityLayers } from '../app/web/map-activity-layer-model.mjs';
import { projectMapLayerData } from '../app/map-layer-data.mjs';

const definitions = { clues: { easy: { '12341': true, 'Cave': true }, hard: { '12342-1': true } },
  codeItems: { slayerTasks: { Cows: { Cow: true, 'Cow calf': true } }, reaperTasks: { Boss: { 'Big boss': true } } },
  chunks: { '12341': { Sections: { '1': { Monster: { Cow: 2, 'Cow calf': 1 } }, '2': { Monster: { Cow: 1 } } } },
    '12342': { Sections: { '1': { Monster: { 'Big boss': 1 } } } }, Cave: { Sections: { '1': { Monster: { Cow: 1 } } } } } };
const world = { chunks: new Map([['12341', {}], ['12342', {}]]), f2p: new Set(['12341']),
  monsterMembership: new Map([['Cow', { members: false, status: 'verified-infobox' }], ['Cow calf', { members: true, status: 'verified-infobox' }]]) };
const state = { rules: { 'content.f2p': true }, members: [{ id: 'a', slayerLock: { level: 1, monster: 'Cows' } }, { id: 'b', slayerLock: null }] };
const build = (extra = {}) => buildMapActivityLayers({ definitions, world, state, memberId: 'a', ...extra });

test('server projection supplies compact exact membership without changing definitions', () => {
  const projected = projectMapLayerData(definitions);
  assert.notEqual(projected.chunks, definitions.chunks);
  assert.equal(Object.hasOwn(projected.chunks, 'Cave'), false);
  assert.deepEqual(Object.keys(projected.chunks['12341']), ['Sections']);
  assert.deepEqual(Object.keys(projected.chunks['12341'].Sections['1']), ['Monster']);
  assert.deepEqual(Object.keys(projected.codeItems), ['slayerTasks', 'reaperTasks']);
  assert.equal(projected.monsterMembership.Cow.members, null);
  assert.deepEqual(Object.keys(projected.monsterMembership.Cow), ['members', 'status']);
  assert.equal(Object.hasOwn(definitions, 'monsterMembership'), false);
  const layers = build({ definitions: projected, world: { ...world, monsterMembership: undefined } });
  assert.equal(layers.slayer.size, 1);
  assert.match(layers.slayerNote, /Some monster membership is unverified/);
});

