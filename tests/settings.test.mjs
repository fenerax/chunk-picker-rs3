import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as metadata from '../app/data/settings.mjs';

test('task-rule cutoff validation accepts consumed rates and denominators while rejecting malformed probabilities', () => {
  for (const [value, expected] of [[16, 1 / 16], ['16', 1 / 16], ['1/16', 1 / 16], [1 / 16, 16], ['0.0625', 16], ['2.5', .4], ['0.5', 2], ['1/16/2', 1 / 32], ['~1/16', 1 / 16], ['Always', 1], [1, 1]]) {
    const parts = metadata.taskRuleCutoff(value).split('/').map(Number);
    assert.equal(parts.slice(1).reduce((value, denominator) => value / denominator, parts[0]), expected);
    for (const id of Object.keys(metadata.taskRuleCutoffDefaults)) assert.equal(metadata.taskRuleValueError(id, value), null);
  }
  for (const value of [0, '0', '1/0']) assert.equal(metadata.taskRuleCutoff(value), '1/0');
  for (const value of ['banana', '', ' ', null, undefined, false, -1, '-1', '1/-16', '0/16', '2/1', '1/', '/16', '1//16', '1/0/2', '0x10', NaN, Infinity, '1e999', '1e-999']) {
    assert.equal(metadata.taskRuleCutoff(value), null, String(value));
    assert.match(metadata.taskRuleValueError('Rare Drop Amount', value), /probability.*denominator/);
  }
});

test('known task toggles are boolean, kill counts are positive integers and unknown rules remain declarative', () => {
  for (const { id, type } of metadata.taskRuleDefinitions) if (type === 'boolean') {
    for (const value of [true, false]) assert.equal(metadata.taskRuleValueError(id, value), null, id);
    for (const value of ['true', 'false', 0, 1, null]) assert.match(metadata.taskRuleValueError(id, value), /boolean/, id);
  }
  for (const value of [1, '16', '1e3', Number.MAX_SAFE_INTEGER]) assert.equal(metadata.taskRuleValueError('Kill X Amount', value), null);
  for (const value of [0, -1, 'banana', '1/16', true, Number.MAX_SAFE_INTEGER + 1]) assert.match(metadata.taskRuleValueError('Kill X Amount', value), /positive safe integer/);
  assert.equal(metadata.taskRuleValueError('custom.unknown', 'banana'), null);
  assert.deepEqual(metadata.taskRuleDiagnostics({ 'custom.unknown': 'banana' }), []);
});

// These exports transcribe upstream declarations at commit 98a3bdc. The copied
// upstream sources are no longer kept, so their checked transcription is pinned.
const transcribedExports = ['originalSettings', 'originalSettingDescriptions', 'originalSettingStructure',
  'originalRuleDefaults', 'originalRuleDescriptions', 'originalRuleStructure', 'originalRulePresets',
  'originalRuleSubDefaults', 'originalTaskGeneratingRules', 'originalSettingConflicts', 'originalWorkerInputNames'];

test('settings and rule metadata keep the transcription checked against the retained sources', () => {
  const digest = createHash('sha256').update(JSON.stringify(transcribedExports.map(name => metadata[name]))).digest('hex');
  assert.equal(digest, 'd0799f0d2530e088b6fc416ad19503d37c535e0706a84a7f40d2fffa00a73905');
  assert.equal(metadata.settingDefinitions.length, 27);
  assert.equal(Object.keys(metadata.originalRuleDefaults).length, 136);
  assert.equal(metadata.taskRuleDefinitions.filter(rule => rule.id !== 'Future Slayer unlocks').length, 156);
  assert.equal(metadata.taskRuleDefinitions.find(rule => rule.id === 'Future Slayer unlocks').default, false);
  assert.equal(metadata.originalWorkerInputNames.length, 53);
  assert.equal(metadata.taskRuleBehavior('Normal Farming').status, 'implemented-scope');
});

test('catalogue includes nested controls and preserves missing original defaults as inheritance', () => {
  const ids = new Set(metadata.taskRuleDefinitions.map(rule => rule.id));
  for (const structure of [metadata.originalSettingStructure, metadata.originalRuleStructure]) {
    const settings = structure === metadata.originalSettingStructure;
    for (const entries of Object.values(structure)) for (const [id, children] of Object.entries(entries)) {
      assert.ok(settings ? metadata.settingDefinitions.some(setting => setting.id === id) : ids.has(id));
      for (const child of Array.isArray(children) ? children : []) assert.ok(settings ? metadata.settingDefinitions.some(setting => setting.id === child) : ids.has(child));
    }
  }
  assert.deepEqual(Object.fromEntries(metadata.neighborSettingDefinitions.map(setting => [setting.id, setting.default])), metadata.originalSettings.chunkNeighboursOptions);
  const lamp = metadata.taskRuleDefinitions.find(rule => rule.id === 'XP Lamps');
  assert.equal(lamp.originalDefaultKnown, false);
  assert.equal(Object.hasOwn(lamp, 'default'), false);
  assert.equal(metadata.settingDefinitions.find(setting => setting.id === 'defaultChunkinfo').parent, 'info');
  assert.ok(Object.isFrozen(metadata.originalSettings.chunkNeighboursOptions));
  assert.throws(() => { metadata.originalSettings.chunkNeighboursOptions.neighbors = false; }, TypeError);
});

test('coverage does not misrepresent retained or tag-gated rules as full upstream parity', () => {
  for (const id of ['Kill X', 'Kill X Amount', 'Kill X Boss', 'Every Drop', 'Every Drop Thieving', 'Every Drop Implings', 'Every Drop BGH', 'All Droptables', 'All Droptables Nest', 'All Shops']) {
    assert.equal(metadata.taskRuleBehavior(id).status, 'implemented-scope', id);
  }
  assert.equal(metadata.taskRuleBehavior('Skiller').status, 'partial');
  for (const id of ['Wield Crafted Items Override', 'Secondary MTA']) assert.equal(metadata.taskRuleBehavior(id).status, 'not-implemented', id);
  assert.equal(metadata.taskRuleBehavior('F2P').status, 'partial');
  assert.equal(metadata.taskRuleBehavior('Show Best in Slot Defensive Tasks').status, 'implemented-scope');
  for (const id of ['BIS Skilling', 'Boosting']) {
    assert.equal(metadata.taskRuleBehavior(id).status, 'partial', id);
  }
  for (const id of ['Achievement', 'Show Diary Tasks', 'Show Diary Tasks Any']) {
    assert.equal(metadata.taskRuleBehavior(id).status, 'implemented-scope', id);
  }
  assert.equal(metadata.taskRuleBehavior('Cleaning herbs').status, 'retained-only');
  assert.equal(metadata.taskRuleBehavior('Show Best in Slot Weight Tasks').status, 'partial');
  assert.equal(metadata.taskRuleBehavior('BIS Skilling Relics').status, 'partial');
  assert.equal(metadata.taskRuleBehavior('PvM Relics').status, 'partial');
  assert.equal(metadata.taskRuleBehavior('Skillcape').status, 'category-gate');
  assert.equal(metadata.taskRuleBehavior('Quest Skill Reqs').status, 'retained-only');
  assert.equal(metadata.taskRuleBehavior('Show Best in Slot 1H and 2H').status, 'implemented-scope');
});
