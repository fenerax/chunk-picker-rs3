import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { applyEquipmentCorrections, equipmentCorrections, equipmentIdentities, equipmentWeights } from '../app/data/equipment-corrections.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const change = (field, before, after) => ({ field, before, after });
const correction = (name, changes) => ({ name, changes });
const definitions = equipment => ({ equipment, chunks: { '12341': { Spawn: Object.fromEntries(Object.keys(equipment).map(name => [name, 1])) } },
  challenges: {}, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
const state = () => {
  const result = createGroupState([{ id: 'a', name: 'A' }]);
  result.members[0].unlocked = ['12341'];
  result.rules['content.f2p'] = false;
  return result;
};

test('reviewed scalar classes preserve authored labels, speed convention, gates and picker identities', () => {
  const raw = definitions({ Gear: { slot: 'head', tier: 30, armour: 10, prayer: 1, melee_damage: 2, ranged_damage: 3,
    magic_damage: 4, necromancy_damage: 5, accuracy: 100, auto_damage: 20, lp: 0, attack_range: 1, speed: 3,
    requirements: { Defence: 1 }, formatted_name: 'gear#default', charges: 500, has_passive: true } });
  const fields = { slot: 'neck', tier: 40, armour: 11, prayer: 2, melee_damage: 3, ranged_damage: 4,
    magic_damage: 5, necromancy_damage: 6, accuracy: 200, auto_damage: 30, lp: 100, attack_range: 2 };
  const changes = Object.entries(fields).map(([field, after]) => change(field, raw.equipment.Gear[field], after));
  changes.push(change('members', null, false), change('attack_speed_ticks', null, 4));
  const saved = JSON.stringify(raw), identity = equipmentTaskIdentity('Gear', raw.equipment.Gear);
  const after = applyEquipmentCorrections(raw, { corrections: [correction('Gear', changes)], strict: true });
  assert.deepEqual(Object.fromEntries(Object.keys(fields).map(field => [field, after.equipment.Gear[field]])), fields);
  assert.equal(after.equipment.Gear.members, false);
  assert.equal(after.equipment.Gear.attack_speed_ticks, 4);
  assert.equal(after.equipment.Gear.speed, 3);
  assert.deepEqual(equipmentTaskIdentity('Gear', after.equipment.Gear), identity);
  assert.equal(after.equipment.Gear.charges, 500);
  assert.equal(after.equipment.Gear.has_passive, true);
  assert.equal(JSON.stringify(raw), saved);
  assert.equal(applyEquipmentCorrections(after, { corrections: [correction('Gear', changes)], strict: true }), after);
});

test('requirement leaf additions affect reachable equipability without deleting other gates', () => {
  const raw = definitions({ Gear: { slot: 'neck', requirements: { Prayer: 1 }, tier: 1 } });
  const changes = [correction('Gear', [change('requirements.Defence', null, 50)])];
  const after = applyEquipmentCorrections(raw, { corrections: changes });
  assert.deepEqual(after.equipment.Gear.requirements, { Prayer: 1, Defence: 50 });
  assert.equal(createTaskEngine(raw, { equipmentCorrections: false }).evaluate(state(), 'a').equipment.length, 1);
  assert.equal(createTaskEngine(after, { equipmentCorrections: false }).evaluate(state(), 'a').equipment.length, 0);
});

test('verified membership gates F2P equipment while explicit free trial equipment stays eligible', () => {
  const raw = definitions({ Members: { slot: 'feet', requirements: {} }, Trial: { slot: 'main hand weapon', requirements: { Necromancy: 1 } } });
  const after = applyEquipmentCorrections(raw, { corrections: [correction('Members', [change('members', null, true)]), correction('Trial', [change('members', null, false)])] });
  const saved = state(); saved.rules['content.f2p'] = true;
  assert.deepEqual(createTaskEngine(after, { equipmentCorrections: false }).evaluate(saved, 'a').equipment.map(row => row.name), ['Trial']);
  saved.rules['content.f2p'] = false;
  assert.equal(createTaskEngine(after, { equipmentCorrections: false }).evaluate(saved, 'a').equipment.length, 2);
});

test('record drift fails atomically and unsafe or uncalibrated fields are rejected', () => {
  const raw = definitions({ Gear: { tier: 31, armour: 10 } });
  const rows = [correction('Gear', [change('armour', 10, 11), change('tier', 30, 40)])];
  assert.equal(applyEquipmentCorrections(raw, { corrections: rows }), raw);
  assert.throws(() => applyEquipmentCorrections(raw, { corrections: rows, strict: true }), /drift/);
  assert.throws(() => applyEquipmentCorrections(raw, { corrections: [correction('Missing', [change('tier', 1, 2)])], strict: true }), /Missing/);
  for (const [field, after] of [['__proto__.polluted', 1], ['requirements.constructor', 2], ['ability_damage', 4], ['speed', 4], ['members', 'true'], ['armour', Infinity]]) {
    assert.throws(() => applyEquipmentCorrections(raw, { corrections: [correction('Gear', [change(field, null, after)])] }), /Unsafe|Unsupported/);
  }
});

test('worn weight is the specialist ranking input and inventory weight remains a separate fact', () => {
  const raw = definitions({ Boots: { slot: 'feet', class: 'none', requirements: {} }, Heavy: { slot: 'feet', class: 'none', requirements: {} } });
  const weights = [{ name: 'Boots', weight: -4.535, wornWeight: -4.535, inventoryWeight: 0.34 }, { name: 'Heavy', weight: 2, wornWeight: 2, inventoryWeight: 2 }];
  const after = applyEquipmentCorrections(raw, { weights });
  const saved = state(); saved.taskRules = { 'Show Best in Slot Weight Tasks': true };
  const result = createTaskEngine(after, { equipmentCorrections: false }).evaluate(saved, 'a');
  const gear = evaluateEquipment(result, saved, 'a', after);
  assert.equal(gear.specialist.weight.recommendations[0].equipment.name, 'Boots');
  assert.equal(after.equipment.Boots.inventoryWeight, 0.34);
  assert.equal(after.equipment.Boots.weight, -4.535);
  assert.equal(applyEquipmentCorrections(after, { weights, strict: true }), after);
  assert.equal(raw.equipment.Boots.weight, undefined);
});

test('weight imports retain custom weights, validate numbers and reject a same-name custom identity', () => {
  const raw = definitions({ Gear: { slot: 'feet', weight: 1 } });
  const weights = [{ name: 'Gear', weight: 2 }];
  assert.equal(applyEquipmentCorrections(raw, { weights }), raw);
  assert.throws(() => applyEquipmentCorrections(raw, { weights, strict: true }), /drift/);
  assert.throws(() => applyEquipmentCorrections(raw, { weights: [{ name: 'Gear', weight: '2' }] }), /Invalid/);
  const original = { slot: 'feet' }, custom = definitions({ Gear: { ...original, authored: true } });
  const row = { name: 'Gear', weight: 2, equipmentBeforeSha256: hash(original) };
  assert.equal(applyEquipmentCorrections(custom, { weights: [row] }), custom);
  assert.throws(() => applyEquipmentCorrections(custom, { weights: [row], strict: true }), /identity drift/);
});

test('cache IDs are provenance and a verified identity cannot attach to a different same-name row', () => {
  const raw = definitions({ Gear: { slot: 'head', requirements: {} } });
  const rows = [{ name: 'Gear', cacheId: 99, variant: 'worn', wiki: { revisionId: 123 }, beforeRecordSha256: hash(raw.equipment.Gear) }];
  const before = equipmentTaskIdentity('Gear', raw.equipment.Gear);
  const after = applyEquipmentCorrections(raw, { identities: rows, strict: true });
  assert.equal(after.equipment.Gear.cacheIdentity.id, 99);
  assert.deepEqual(equipmentTaskIdentity('Gear', after.equipment.Gear), before);
  assert.equal(applyEquipmentCorrections(after, { identities: rows, strict: true }), after);
  const custom = definitions({ Gear: { slot: 'neck', requirements: {} } });
  assert.equal(applyEquipmentCorrections(custom, { identities: rows }), custom);
  assert.throws(() => applyEquipmentCorrections(custom, { identities: rows, strict: true }), /identity drift/);
});

test('reviewed record fingerprints prevent otherwise matching corrections on customized same-name gear', () => {
  const original = { slot: 'head', armour: 10, requirements: {} };
  const custom = definitions({ Gear: { ...original, has_passive: true } });
  const row = { name: 'Gear', cacheId: 99, variant: 'default', beforeRecordSha256: hash(original), changes: [change('armour', 10, 20)] };
  assert.equal(applyEquipmentCorrections(custom, { corrections: [row] }), custom);
  assert.throws(() => applyEquipmentCorrections(custom, { corrections: [row], strict: true }), /identity drift/);
  const raw = definitions({ Gear: original });
  const after = applyEquipmentCorrections(raw, { corrections: [row], strict: true });
  const transported = JSON.parse(JSON.stringify(after));
  assert.equal(applyEquipmentCorrections(transported, { corrections: [row], strict: true }), transported);
});

test('explicit unknown weights can be filled without losing the reviewed null precondition after serialization', () => {
  const raw = definitions({ Gear: { slot: 'feet', weight: null } });
  const weights = [{ name: 'Gear', weight: 0, before: null, beforePresent: true, equipmentBeforeSha256: hash(raw.equipment.Gear) }];
  const after = applyEquipmentCorrections(raw, { weights, strict: true });
  assert.equal(after.equipment.Gear.weight, 0);
  const transported = JSON.parse(JSON.stringify(after));
  assert.equal(applyEquipmentCorrections(transported, { weights, strict: true }), transported);
});

test('all versioned corrections apply strictly, preserve task identities and bind dual-source provenance', () => {
  const raw = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const bundle = JSON.parse(readFileSync(new URL('../app/data/equipment-corrections.2026-10-08.v1.json', import.meta.url)));
  const after = applyEquipmentCorrections(raw, { strict: true });
  assert.equal(applyEquipmentCorrections(JSON.parse(JSON.stringify(after)), { strict: true }).equipment['Rune platebody'].cacheIdentity.id, 45543);
  assert.equal(applyEquipmentCorrections(after, { strict: true }), after);
  for (const source of bundle.evidence) assert.equal(sha256RepositoryText(readFileSync(new URL(`../${source.path}`, import.meta.url))), source.sha256);
  assert.equal(equipmentIdentities.filter(row => row.name === 'Rune platebody')[0].cacheId, 45543);
  assert.equal(equipmentIdentities.some(row => row.name === "Dharok's platebody"), false);
  assert.equal(bundle.counts.uniqueVerified + bundle.counts.uniqueUnresolved, 2474);
  for (const entry of equipmentCorrections) {
    assert.deepEqual(equipmentTaskIdentity(entry.name, after.equipment[entry.name]), equipmentTaskIdentity(entry.name, raw.equipment[entry.name]));
    for (const change of entry.changes) {
      assert.equal(change.cache.id, entry.cacheId);
      assert.deepEqual(change.cache.value, change.wiki.value);
      assert.equal(change.wiki.revisionId, entry.wiki.revisionId);
      assert.match(change.wiki.url, /runescape\.wiki\/.+(?:PermanentLink\/|oldid=)\d+/);
      assert.equal(change.field.split('.').reduce((record, key) => record[key], after.equipment[entry.name]), change.after);
    }
  }
  for (const row of equipmentWeights) assert.equal(after.equipment[row.name].weight, row.weight);
});

test('worker uses corrected definitions for Current BiS and generated equipment task scores', async t => {
  const retained = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const name = 'Amulet of fury (t)';
  const data = definitions({ [name]: retained.equipment[name], Rival: { slot: 'neck', class: 'melee', tier: 80, melee_damage: 38, armour: 0, requirements: {} } });
  const world = buildWorld(data);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions: data, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  assert.equal((await once(worker, 'message'))[0].type, 'ready');
  const pending = once(worker, 'message');
  worker.postMessage({ id: 1, type: 'evaluate', state: state(), memberId: 'a' });
  const response = (await pending)[0];
  assert.equal(response.error, undefined);
  const neck = response.result.currentBiS.obtainable.recommendations.find(row => row.style === 'Melee' && row.slot === 'neck');
  assert.equal(neck.equipment.name, name);
  assert.equal(neck.equipment.data.melee_damage, 39.1);
  assert.ok(response.result.tasks.some(row => row.equipmentName === name));
  assert.equal(data.equipment[name].melee_damage, 37.3);
});
