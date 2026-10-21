import { datasetSourceEvidence } from './helpers/dataset-source-evidence.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadOriginalData, originalDataSelection } from '../app/data/original-data.mjs';
import { compareOriginalData, auditLocalOverrides } from '../scripts/compare-original-data.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';
import { applyRetainedTaskCorrections, retainedTaskCorrections, retainedEntryCorrections,
  retainedWordingCorrections } from '../app/data/retained-task-corrections.mjs';
import { applyMetadataCorrections, metadataCorrections } from '../app/data/metadata-corrections.mjs';
import { applyEquipmentCorrections, equipmentCorrections, equipmentWeights,
  equipmentIdentities } from '../app/data/equipment-corrections.mjs';
import { applySkillguideCombatCorrections, skillguideCombatCorrections } from '../app/data/skillguide-combat-corrections.mjs';
import { applySkillGuideTasks, skillGuideCatalogue, SKILL_GUIDE_TASKS_RULE,
  SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guides.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { ICON_BUNDLES, createIconCatalogue } from '../app/data/icons.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url));
const selectedInputs = loadOriginalData();
const at = (record, field) => field.split('.').reduce((value, key) => value?.[key], record);

test('original-data comparison reports exact task additions, removals and nested field changes without mutating inputs', () => {
  const before = { challenges: { Mining: {
    Keep: { Level: 1 }, Remove: { Level: 2 }, Change: { Level: 3, Skills: { Attack: 4 } },
  } }, chunks: { '12342': { Nickname: 'Old' } } };
  const after = { challenges: { Mining: {
    Keep: { Level: 1 }, Add: { Level: 5 }, Change: { Level: 6, Skills: { Attack: 7 } },
  } }, chunks: { '12342': { Nickname: 'New' } } };
  const snapshot = structuredClone({ before, after });
  const result = compareOriginalData(before, after, { Keep: 't_1' }, { Keep: 't_1' });
  const mining = result.categories.find(row => row.key === 'tasks');
  assert.ok(mining);
  assert.deepEqual(mining.added.map(row => row.key), [JSON.stringify(['Mining', 'Add'])]);
  assert.deepEqual(mining.removed.map(row => row.key), [JSON.stringify(['Mining', 'Remove'])]);
  assert.deepEqual(mining.changed.map(row => row.key), [JSON.stringify(['Mining', 'Change'])]);
  assert.deepEqual(mining.changed[0].before, before.challenges.Mining.Change);
  assert.deepEqual(mining.changed[0].after, after.challenges.Mining.Change);
  assert.ok(mining.changed[0].fields.includes('/Level'));
  assert.ok(mining.changed[0].fields.includes('/Skills/Attack'));
  const chunks = result.categories.find(row => row.key === 'chunks');
  assert.ok(chunks.changed.some(row => row.key === '12342'));
  assert.deepEqual({ before, after }, snapshot);
});

test('identical originals produce no invented changes', () => {
  const data = { challenges: { Mining: { Mine: { Level: 1 } } }, chunks: {} };
  const result = compareOriginalData(data, structuredClone(data), { Mine: 't_1' }, { Mine: 't_1' });
  assert.deepEqual(result.totals, { added: 0, removed: 0, changed: 0 });
  for (const row of [...result.categories, ...result.otherSections]) {
    assert.equal(row.added.length + row.removed.length + row.changed.length, 0);
  }
});

test('selected runtime originals retain validated historical source identities and usable world topology', async () => {
  const { definitionBytes, taskBytes, selection } = await selectedInputs;
  assert.deepEqual(selection, originalDataSelection);
  assert.equal(sha256RepositoryText(definitionBytes), selection.definitions.sha256);
  assert.equal(sha256RepositoryText(taskBytes), selection.taskMap.sha256);
  assert.deepEqual(definitionBytes, await read(selection.definitions.path));
  assert.deepEqual(taskBytes, await read(selection.taskMap.path));
  // Historical research remains bound to these immutable inputs even after a future selection changes.
  assert.equal(sha256RepositoryText(await read('rs3-chunkpicker-chunkinfo-export.json')),
    '9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553');
  assert.equal(sha256RepositoryText(await read('reference/original-picker/tasksMap.json')),
    '721c8a9671566b8bef3b4985bc13a1248c54400b9304cd9ecc88b3184cdd780c');
  const definitions = JSON.parse(definitionBytes);
  const world = buildWorld(definitions, { dataset: selectedDataset });
  assert.ok(world.chunks.has('12342'));
  assert.ok(world.areas.has('Zanaris'));
  assert.ok(world.chunks.has('13883'), 'the reviewed missing coast survives source selection');
  assert.equal(JSON.parse(taskBytes)['currentNextIndex'] > 0, true);
});

test('dated selection records its public captures, report and captured generator identities', async () => {
  const { selection } = await selectedInputs;
  assert.match(selection.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  const report = JSON.parse(await read(selection.provenance.report));
  assert.deepEqual(report.capture, selection.provenance.source);
  assert.deepEqual(report.adoption, selection.adoption);
  assert.deepEqual(report.audit.protectedFiles, selection.protectedFiles);
  assert.equal(report.capture.captures.length, 2);
  for (const capture of report.capture.captures) {
    assert.equal(capture.url, `https://source-chunk.github.io/chunk-picker-rs3/${capture.name}`);
    assert.match(capture.sha256, /^[a-f0-9]{64}$/);
  }
  for (const input of selection.provenance.generators) {
    assert.equal(input.sha256, sha256RepositoryText(await read(datasetSourceEvidence(input.path))), input.path);
  }
});

test('selected definitions preserve every reviewed retained, metadata, equipment and guide correction', async () => {
  const raw = JSON.parse((await selectedInputs).definitionBytes);
  const rawSnapshot = JSON.stringify(raw);
  const retained = applyRetainedTaskCorrections(raw, { strict: true });
  for (const bundle of [retainedTaskCorrections, retainedEntryCorrections, retainedWordingCorrections]) {
    for (const correction of bundle.corrections) {
      const row = retained.challenges[correction.category][correction.label];
      for (const change of correction.changes) assert.deepEqual(at(row, change.field), change.after, correction.label);
      assert.equal(permanentTaskId(correction.category, correction.label, row), correction.id);
    }
  }
  assert.equal(applyRetainedTaskCorrections(retained, { strict: true }), retained);
  const metadata = applyMetadataCorrections(raw, { strict: true });
  for (const correction of metadataCorrections) for (const change of correction.changes) {
    const actual = at(metadata.challenges[correction.category][correction.label], change.field);
    if (change.afterPresent === false || change.after === null && change.afterPresent !== true) assert.equal(actual, undefined);
    else assert.deepEqual(actual, change.after, `${correction.label}: ${change.field}`);
  }
  const equipment = applyEquipmentCorrections(raw, { strict: true });
  for (const correction of equipmentCorrections) for (const change of correction.changes) {
    assert.deepEqual(at(equipment.equipment[correction.name], change.field), change.after, `${correction.name}: ${change.field}`);
  }
  for (const row of equipmentWeights) {
    assert.equal(equipment.equipment[row.name].weight, row.weight, row.name);
    for (const field of ['inventoryWeight', 'wornWeight']) if (typeof row[field] === 'number') {
      assert.equal(equipment.equipment[row.name][field], row[field], `${row.name}: ${field}`);
    }
  }
  for (const row of equipmentIdentities) assert.equal(equipment.equipment[row.name].cacheIdentity.id, row.cacheId, row.name);
  assert.equal(applyEquipmentCorrections(equipment, { strict: true }), equipment);
  const combat = applySkillguideCombatCorrections(raw, { strict: true });
  for (const correction of skillguideCombatCorrections) for (const change of correction.changes) {
    assert.equal(combat.challenges[correction.skill][correction.label][change.field], change.after, correction.label);
  }
  const guides = applySkillGuideTasks(raw);
  for (const task of skillGuideCatalogue.generatedTasks) {
    assert.deepEqual(guides.challenges[task.category][task.label], task.record);
  }
  assert.equal(applySkillGuideTasks(guides), guides);
  const engine = createTaskEngine(raw, { dataset: selectedDataset });
  assert.ok(engine.catalogue.some(row => row.id === 'rs3:task:0003c5'));
  assert.ok(!engine.catalogue.some(row => row.id === skillGuideCatalogue.generatedTasks[0].record.PickerId));
  const registry = createRuleRegistry();
  for (const id of [SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE]) {
    assert.equal(registry.definitions.find(rule => rule.id === id)?.default, false);
  }
  assert.equal(JSON.stringify(raw), rawSnapshot);
});

test('unchanged-source audit has no conflicts and retains immutable icon bundles', async () => {
  const raw = JSON.parse((await selectedInputs).definitionBytes);
  const report = await auditLocalOverrides(raw, structuredClone(raw));
  assert.deepEqual(report.conflicts, []);
  assert.ok(report.checks.length > 0);
  assert.ok(report.protectedFiles.length > 0);
  for (const row of report.protectedFiles) {
    assert.equal(row.sha256, sha256RepositoryText(await read(row.path)), row.path);
  }
  const iconHashes = {
    'skill-icons.2026-10-08.v1.json': '827c5f8e345134d12c20be7f1ab3f28f9183a3e8b551160b1e5883b7cf09bff3',
    'item-icons.2026-10-08.v1.json': '367125a3c08e8b47d6df65a4014b944b6df6f0d2ae40ae9b53932e5705bb1652',
    'item-icons.2026-10-09.v1.json': '14897ed3532fcc60d1087860995055ede140505037942128b48731751b76ad87',
    'item-icons.2026-10-12.v1.json': 'c906eecab2f5e274879d8f28e69f24de95ed3e48df5c74b207fe0c94844d1b9f',
  };
  assert.deepEqual(ICON_BUNDLES.map(row => row.manifest).sort(), Object.keys(iconHashes).sort());
  const manifests = await Promise.all(ICON_BUNDLES.map(async bundle => {
    const bytes = await read(`app/data/${bundle.manifest}`);
    assert.equal(sha256RepositoryText(bytes), iconHashes[bundle.manifest], bundle.manifest);
    return JSON.parse(bytes);
  }));
  const icons = createIconCatalogue(manifests);
  assert.ok(icons.lookup('skill', 'Mining'));
  assert.ok(icons.lookup('item', 'Bronze platebody'));
});

test('audit detects a changed corrected target and a collision with a generated guide task', async () => {
  const before = JSON.parse((await selectedInputs).definitionBytes);
  const after = structuredClone(before);
  const correction = retainedTaskCorrections.corrections[0];
  after.challenges[correction.category][correction.label].Level = 55;
  const task = skillGuideCatalogue.generatedTasks[0];
  after.challenges[task.category][task.label] = { Level: 1, Description: 'Different upstream objective' };
  const report = await auditLocalOverrides(before, after);
  assert.ok(report.conflicts.some(row => row.target.includes(correction.label)), 'changed retained correction is reported');
  assert.ok(report.conflicts.some(row => row.target.includes(task.label)), 'generated task label collision is reported');
});

test('audit blocks upstream explicit task and entity identity introductions', async () => {
  const before = JSON.parse((await selectedInputs).definitionBytes);
  const after = structuredClone(before);
  const [label] = Object.entries(before.challenges.Mining).find(([, row]) => !Object.hasOwn(row, 'PickerId'));
  const [equipmentName] = Object.entries(before.equipment).find(([, row]) => !Object.hasOwn(row, 'PickerEntityId'));
  after.challenges.Mining[label].PickerId = 'rs3:task:upstream-new-token';
  after.equipment[equipmentName].PickerEntityId = 'rs3:entity:upstream-new-token';
  const report = await auditLocalOverrides(before, after);
  const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
  for (const target of [`/challenges/Mining/${pointer(label)}/PickerId`, `/equipment/${pointer(equipmentName)}/PickerEntityId`]) {
    assert.ok(report.conflicts.some(row => row.kind === 'Authored identity seam' && row.target === target), target);
  }
  assert.equal(Object.hasOwn(before.challenges.Mining[label], 'PickerId'), false);
  assert.equal(Object.hasOwn(before.equipment[equipmentName], 'PickerEntityId'), false);
});
