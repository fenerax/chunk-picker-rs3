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

test('F2P has no clue locations and filters verified member target sources', () => {
  const layers = build();
  assert.equal(layers.clues.size, 0);
  assert.match(layers.clueNote, /Clue scrolls are members-only/);
  assert.deepEqual([...layers.slayer], [['12341', [{ label: 'Cows: Cow' }]]]);
});
test('members get tier markers and category sources, with duplicate sections merged', () => {
  const layers = build({ state: { ...state, rules: { 'content.f2p': false } } });
  assert.equal(layers.clues.get('12342')[0].tier, 'hard');
  assert.equal(layers.slayer.get('12341').length, 2);
  assert.equal(layers.clues.has('Cave'), false);
  assert.match(layers.slayerNote, /caves and buildings aren’t shown/);
});
test('personal locks, explicit null and legacy fallback remain distinct', () => {
  assert.equal(build({ memberId: 'b' }).slayer.size, 0);
  const legacy = { rules: { 'content.f2p': false }, members: [{ id: 'a', sourceMapId: 'x' }], legacy: { maps: { x: { chunkinfo: { slayerLocked: { level: 4, monster: 'Cows' } } } } } };
  assert.equal(build({ state: legacy }).slayerLabel, 'Cows');
  legacy.members[0].slayerLock = null;
  assert.equal(build({ state: legacy }).slayer.size, 0);
});
test('Reaper mapping and unknown saved targets have honest output', () => {
  const layers = build({ state: { rules: { 'content.f2p': false }, members: [{ id: 'a', slayerLock: { level: 8, boss: 'Boss', monster: 'Unknown' } }] } });
  assert.equal(layers.slayer.get('12342')[0].label, 'Boss: Big boss');
  assert.match(layers.slayerNote, /No monsters are recorded for this saved task/);
});
test('legacy Reaper targets decode original picker text before matching assignments', () => {
  const data = { chunks: { '12342': { Monster: { "K'ril Tsutsaroth": true } } },
    codeItems: { reaperTasks: { "K'ril Tsutsaroth": { "K'ril Tsutsaroth": true } } } };
  const legacy = { rules: { 'content.f2p': false }, members: [{ id: 'a', sourceMapId: 'x' }],
    legacy: { maps: { x: { chunkinfo: { slayerLocked: { level: 8, boss: 'K-_-2Hril Tsutsaroth' } } } } } };
  const layers = build({ definitions: data, state: legacy });
  assert.equal(layers.slayerLabel, "K'ril Tsutsaroth");
  assert.equal(layers.slayer.get('12342')[0].label, "K'ril Tsutsaroth: K'ril Tsutsaroth");
});
test('unknown F2P identity stays recorded with uncertainty and without changing saved data', () => {
  const before = JSON.stringify(state);
  const layers = build({ world: { ...world, monsterMembership: new Map() } });
  assert.equal(layers.slayer.size, 1);
  assert.match(layers.slayerNote, /Some monster membership is unverified/);
  assert.equal(JSON.stringify(state), before);
});
test('projection removes unrelated chunk fields and preserves explicit section membership', () => {
  const source = { codeItems: definitions.codeItems, chunks: { '12341': { Nickname: 'Hidden label', Quest: { Secret: 'step' }, 'Not F2P': false,
    Sections: { '1': { Monster: { Cow: 1 }, Object: { Tree: 9 }, NPC: { Person: 1 }, 'Not F2P': true } } },
    '12342': { Monster: { Chicken: 2 }, Object: { Tree: 1 } }, Cave: { Monster: { Cow: 3 } } } };
  const before = JSON.stringify(source), projected = projectMapLayerData(source);
  assert.deepEqual(projected.chunks, { '12341': { 'Not F2P': false, Sections: { '1': { 'Not F2P': true, Monster: { Cow: 1 } } } }, '12342': { Monster: { Chicken: 2 } } });
  projected.chunks['12341'].Sections['1'].Monster.Cow = 4;
  assert.equal(JSON.stringify(source), before);
  const layers = build({ definitions: projectMapLayerData(source) });
  assert.equal(layers.slayer.has('12341'), false);
});

test('hash variants retain verified base restrictions unless an exact reviewed row overrides them', () => {
  const data = { chunks: { '12341': { Monster: { 'Target#variant': true } } }, codeItems: { slayerTasks: { Targets: { Target: true } } },
    monsterMembership: { Target: { members: true, status: 'verified-infobox' } } };
  const locked = { ...state, members: [{ id: 'a', slayerLock: { monster: 'Targets' } }] };
  assert.equal(build({ definitions: data, state: locked }).slayer.size, 0);
  data.monsterMembership['Target#variant'] = { members: false, status: 'verified-row' };
  assert.equal(build({ definitions: data, state: locked }).slayer.size, 1);
});

test('recorded regions outside the displayed surface are excluded from both layer counts', () => {
  const layers = build({ world: { ...world, surface: new Set(['12342']) }, state: { ...state, rules: { 'content.f2p': false } } });
  assert.deepEqual([...layers.clues.keys()], ['12342']);
  assert.equal(layers.slayer.size, 0);
});
