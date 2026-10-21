import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from '../app/data/training/methods.f2p.json' with { type: 'json' };
import evidence from '../app/data/training/f2p-expansion.2026-10-13.v1.json' with { type: 'json' };
import { buildTrainingData, combatEntryLevel, combatSkills, expansionMethods } from '../scripts/research/build-training-data.mjs';
import { trainingMethodBlockers } from '../app/tasks/training-planner.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { analyzeAreaCheck } from '../app/tasks/area-check.mjs';
import { createGroupState } from '../app/core/state.mjs';

const byId = new Map(catalogue.methods.map(row => [row.id, row]));
const additions = expansionMethods(catalogue, evidence);

test('combat entry tiers have explicit boundaries and reject unreviewed combat levels', () => {
  for (const [combat, entry] of [[1,1],[9,1],[10,10],[24,10],[25,20],[39,20],[40,30],[59,30],[60,40],[79,40],[80,50],[99,50],[100,60],[105,60]]) {
    assert.equal(combatEntryLevel(combat), entry);
  }
  for (const value of [null, 0, -1, 1.5, NaN]) assert.throws(() => combatEntryLevel(value), RangeError);
  assert.equal(evidence.entryRule.authored, true);
  assert.match(evidence.entryRule.description, /planning recommendations/);
});

test('22 new monsters cover six skills with unknown rates and exact F2P variant evidence', () => {
  const monsters = evidence.monsters.filter(row => !row.existing);
  assert.equal(monsters.length, 22);
  assert.equal(additions.length, 141);
  const sources = new Map(evidence.sources.map(row => [row.id, row]));
  for (const row of evidence.monsters) {
    assert.ok(row.locations.length && row.placements.length && row.cache.length, row.id);
    assert.equal(row.combatLevel, Math.max(...row.variants.filter(variant => variant.members === false).map(variant => variant.combatLevel)), row.id);
    const source = sources.get(row.sourceId);
    assert.ok(source.revision > 0 && source.url.endsWith(`oldid=${source.revision}`), row.id);
    assert.match(source.licence, /RuneScape Wiki contributors.*CC BY-NC-SA/);
    for (const skill of combatSkills) {
      const method = byId.get(`${skill.toLowerCase()}.${row.id}`);
      assert.ok(method, `${skill} ${row.id}`);
      assert.equal(method.level, combatEntryLevel(row.combatLevel));
      assert.equal(method.members, false);
      assert.deepEqual(method.requirements, [{ kind: 'monster', name: row.selector }]);
      if (!row.existing) {
        assert.equal(method.xpPerAction, null);
        assert.equal(method.xpPerHour, null);
        assert.equal(method.rateProfiles, undefined);
        assert.equal(method.economics.gpPerAction, null);
        assert.deepEqual(method.outputs, []);
      }
    }
  }
  for (const [id, facts] of Object.entries(evidence.retainedCombatRates)) {
    for (const [field, value] of Object.entries(facts)) assert.deepEqual(byId.get(id)[field], value, `${id} ${field}`);
  }
  assert.equal(byId.get('attack.hill-giant').level, 20);
  assert.equal(byId.get('attack.hill-giant').xpPerAction, 225);
});

test('Al Kharid and Lumbridge admit their own reviewed combat methods through Area check', () => {
  const definitions = { chunks: {
    '13105': { Monster: { 'Al Kharid warrior': 9, Spider: 3 } },
    '12850': { Monster: { 'Goblin (Lumbridge)': 28, 'Giant spider': 2 } },
  }, walkableChunks: ['13105', '12850'], walkableChunksF2P: ['13105', '12850'], challenges: {}, codeItems: {}, sections: {} };
  const engine = createTaskEngine(definitions);
  const world = { chunks: new Map(Object.entries(definitions.chunks)), surface: new Set(['13105', '12850']) };
  const state = createGroupState([{ id: 'test', name: 'Synthetic', unlocked: [] }]);
  for (const [chunk, expected, absent] of [['13105', ['al-kharid-warrior','spider'], 'goblin-lumbridge'],
    ['12850', ['goblin-lumbridge','giant-spider'], 'al-kharid-warrior']]) {
    const result = analyzeAreaCheck(state, 'test', { chunkIds: [chunk] }, { engine, definitions, world });
    for (const skill of combatSkills) {
      const methods = result.rows.find(row => row.skill === skill).alone.methods;
      for (const id of expected) assert.ok(methods.some(method => method.id === `${skill.toLowerCase()}.${id}` && method.status === 'available'), `${chunk} ${skill} ${id}`);
      assert.ok(!methods.some(method => method.id === `${skill.toLowerCase()}.${absent}`));
      assert.ok(!methods.some(method => method.id === `${skill.toLowerCase()}.cow`));
    }
  }
});

test('new methods fail closed for missing monsters, membership, facilities and supplies', () => {
  const warrior = byId.get('attack.al-kharid-warrior');
  assert.ok(trainingMethodBlockers(warrior, { members: false, access: { npcs: ['Al Kharid warrior'] } }).some(row => row.kind === 'monster'));
  for (const method of additions) {
    assert.ok(trainingMethodBlockers(method, { members: false, access: {}, items: [] }).length, method.id);
    const availability = { members: false, access: { monsters: ['Al Kharid warrior'] } };
    assert.ok(trainingMethodBlockers({ ...method, members: true }, availability).some(row => row.kind === 'membership'), method.id);
  }
  for (const id of ['mind', 'body']) {
    const method = byId.get(`runecrafting.${id}`);
    const title = id[0].toUpperCase() + id.slice(1);
    for (const item of [`${title} talisman`, `${title} tiara`]) {
      assert.deepEqual(trainingMethodBlockers(method, { members: false, access: { areas: [`${title} Rune Temple`] }, items: [item, 'Rune essence'] }), []);
    }
    assert.ok(trainingMethodBlockers(method, { members: false, access: { areas: [`${title} Rune Temple`] }, items: ['Rune essence'] }).length);
  }
  for (const id of ['herring', 'pike', 'salmon', 'tuna', 'swordfish']) {
    const method = byId.get(`cooking.${id}`);
    assert.equal(method.outputs[0].quantity, null, 'burning is not a guaranteed cooked output');
    assert.equal(method.xpPerAction, null);
    assert.equal(method.xpPerHour, null);
  }
});

test('the data merge is reproducible, idempotent and rejects changed reviewed rows', () => {
  assert.deepEqual(buildTrainingData(catalogue, evidence), catalogue);
  const baseline = { ...catalogue, methods: catalogue.methods.filter(method => !additions.some(row => row.id === method.id)),
    sources: catalogue.sources.filter(source => !evidence.sources.some(row => row.id === source.id)) };
  assert.deepEqual(buildTrainingData(baseline, evidence), catalogue);
  const changed = structuredClone(catalogue);
  changed.methods.find(row => row.id === 'attack.hill-giant').level = 99;
  assert.throws(() => buildTrainingData(changed, evidence), /Changed entry level/);
  const conflict = structuredClone(catalogue);
  conflict.methods.find(row => row.id === 'attack.al-kharid-warrior').xpPerHour = 1;
  assert.throws(() => buildTrainingData(conflict, evidence), /Conflicting reviewed record/);
});
