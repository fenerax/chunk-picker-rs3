import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { metadataCorrections } from '../app/data/metadata-corrections.mjs';
import { previewEquipmentCorrections, formatPreview } from '../scripts/preview-equipment-corrections.mjs';

const worktree = fileURLToPath(new URL('../', import.meta.url));
const member = (id = 'a') => ({ id, name: id, unlocked: ['12341'],
  passiveLevels: { Attack: 70, Defence: 60, Ranged: 70 },
  taskRules: { 'Show Best in Slot Defensive Tasks': true, 'Show Best in Slot Weight Tasks': true } });
const weapon = (tier, slot = '2h weapon', klass = 'melee') => ({ slot, class: klass, tier,
  ability_damage: tier * 10, accuracy: tier * 20, speed: 3, requirements: { [klass === 'ranged' ? 'Ranged' : 'Attack']: 10 } });
const correction = (name, field, before, after) => ({ name, cacheId: 1, variant: 'synthetic',
  wiki: 'https://example.invalid/synthetic-evidence', changes: [{ field, before, after }] });
const weight = (name, value) => ({ name, weight: value, wornWeight: value, inventoryWeight: value,
  cacheIds: [1], wiki: 'https://example.invalid/synthetic-evidence' });
function definitions(equipment) {
  return { chunks: { '12341': { Spawn: Object.fromEntries(Object.keys(equipment).map(name => [name, 1])) }, '12342': {} },
    sections: {}, walkableChunksF2P: ['12341', '12342'], challenges: {}, codeItems: {}, equipment };
}
function fixture() {
  const data = definitions({
    'Synthetic greatsword': weapon(40),
    'Synthetic mainhand': weapon(45, 'main hand weapon'),
    'Synthetic offhand': weapon(45, 'off-hand weapon'),
    'Synthetic tall bow': weapon(70, '2h weapon', 'ranged'),
    'Synthetic short bow': weapon(60, '2h weapon', 'ranged'),
    'Synthetic tall arrow': { slot: 'ammo', class: 'ranged', tier: 20, ability_damage: 200 },
    'Synthetic short arrow': { slot: 'ammo', class: 'ranged', tier: 60, ability_damage: 600 },
    'Swift gloves': { slot: 'hands', class: 'melee', melee_damage: 5, armour: 1 },
    'Solid gloves': { slot: 'hands', class: 'melee', melee_damage: 4, armour: 2 },
    'Swift boots': { slot: 'feet', class: 'melee', melee_damage: 3, armour: 1 },
    'Tank boots': { slot: 'feet', class: 'melee', melee_damage: 1, armour: 2 },
    'Heavy cape': { slot: 'back', class: 'all', armour: 5 },
    'Feather token': { slot: 'pocket', class: 'all' },
    'Gate helmet': { slot: 'head', class: 'melee', melee_damage: 9, requirements: { Defence: 80 } },
  });
  data.codeItems.ammoTools = {
    'Synthetic tall arrow': { 'Synthetic tall bow': true },
    'Synthetic short arrow': { 'Synthetic short bow': true },
  };
  const state = createGroupState([member(), { ...member('b'), passiveLevels: { Attack: 70, Defence: 20, Ranged: 70 } }]);
  state.tasks = Object.entries(data.equipment).map(([name, record]) => {
    const { id, category, label } = equipmentTaskIdentity(name, record);
    return { id, category, label };
  });
  state.members[0].completedTasks = state.tasks.map(row => row.id);
  state.members[1].taskStatus = Object.fromEntries(state.tasks.map(row => [row.id, { challengeCompleted: true }]));
  const corrections = [
    correction('Synthetic mainhand', 'tier', 45, 20),
    correction('Synthetic offhand', 'tier', 45, 20),
    correction('Synthetic tall arrow', 'tier', 20, 70),
    correction('Swift gloves', 'melee_damage', 5, 3),
    correction('Tank boots', 'armour', 2, 0),
    correction('Gate helmet', 'requirements.Defence', 80, 40),
  ];
  const weights = [weight('Heavy cape', 2), weight('Feather token', -4), weight('Swift boots', 2), weight('Tank boots', 1)];
  return { state, definitions: data, corrections, weights, engineOptions: { reviewedOverlays: false, cacheWalking: false } };
}
const findMember = (report, id = 'a') => report.members.find(row => row.id === id);
const slot = (view, style, name) => view.slots.find(row => row.style === style && row.slot === name);
const loadout = (view, style) => view.loadouts.find(row => row.style === style);
const task = (memberReport, name) => memberReport.tasks.find(row => row.name === name);
const change = (taskReport, field) => taskReport.availability.find(row => row.field === field);

test('reports ordinary slot changes and coupled hand/ammunition replacements for each member without mutation or timing noise', () => {
  const input = fixture(), original = JSON.stringify(input);
  const report = previewEquipmentCorrections(input);
  for (const memberReport of report.members) {
    const view = memberReport.currentBiS.obtainable;
    assert.equal(slot(view, 'Melee', 'hands').before[0].name, 'Swift gloves');
    assert.equal(slot(view, 'Melee', 'hands').after[0].name, 'Solid gloves');
    const melee = loadout(view, 'Melee');
    assert.equal(melee.before.best.mode, 'dual-wield');
    assert.deepEqual(melee.before.best.items, ['Synthetic mainhand', 'Synthetic offhand']);
    assert.equal(melee.after.best.mode, 'two-handed');
    assert.deepEqual(melee.after.best.items, ['Synthetic greatsword']);
    assert.equal(slot(view, 'Melee', 'off-hand weapon').after.length, 0);
    const ranged = loadout(view, 'Ranged');
    assert.deepEqual(ranged.before.best.items, ['Synthetic short bow', 'Synthetic short arrow']);
    assert.deepEqual(ranged.after.best.items, ['Synthetic tall bow', 'Synthetic tall arrow']);
    assert.equal(slot(view, 'Ranged', 'ammo').before[0].name, 'Synthetic short arrow');
    assert.equal(slot(view, 'Ranged', 'ammo').after[0].name, 'Synthetic tall arrow');
    assert.ok(memberReport.changedTaskCount > 0);
  }
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(report), JSON.stringify(previewEquipmentCorrections(input)));
  assert.doesNotMatch(JSON.stringify(report), /elapsedMs|metrics|performance/);
  assert.match(formatPreview(report), /Synthetic tall arrow/);
});

test('reports tank and newly enabled weight recommendations, coverage, scores and generated task presence', () => {
  const report = previewEquipmentCorrections(fixture()), memberReport = findMember(report);
  const specialists = memberReport.currentBiS.obtainable.specialist;
  const tank = slot(specialists.tank, 'Melee Tank', 'feet');
  assert.equal(tank.before[0].name, 'Tank boots');
  assert.equal(tank.after[0].name, 'Swift boots');
  const cape = slot(specialists.weight, 'Weight Reducing', 'pocket');
  assert.deepEqual(cape.before, []);
  assert.equal(cape.after[0].name, 'Feather token');
  assert.deepEqual(cape.after[0].score, [4]);
  const coverage = specialists.weight.changes.find(row => row.field === 'coverage');
  assert.equal(coverage.before.supported, false);
  assert.equal(coverage.after.supported, true);
  assert.equal(coverage.after.declaredWeightRecords, 4);
  const feather = task(memberReport, 'Feather token');
  assert.equal(feather.presence, undefined);
  assert.deepEqual(feather.status, { before: 'blocked', after: 'available' });
  assert.ok(change(feather, 'equipmentGoals').after.includes('Weight Reducing BiS pocket'));
  assert.ok(change(feather, 'scores').after.some(row => row.style === 'Weight Reducing' && row.score[0] === 4));
  const gloves = task(memberReport, 'Swift gloves');
  assert.ok(change(gloves, 'scores'));
  assert.equal(gloves.id, equipmentTaskIdentity('Swift gloves').id);
  assert.match(formatPreview(report), /weight specialist/);
});

test('reports corrected equip requirements and per-member eligibility rather than inferring a character level', () => {
  const input = fixture(), report = previewEquipmentCorrections(input);
  const helmet = task(findMember(report), 'Gate helmet');
  assert.equal(helmet.presence, undefined);
  assert.deepEqual(helmet.status, { before: 'blocked', after: 'available' });
  assert.deepEqual(helmet.metadata.find(row => row.field === 'requirements'), {
    field: 'requirements', before: { Defence: 80 }, after: { Defence: 40 },
  });
  assert.deepEqual(change(helmet, 'equipRequirements').after,
    [{ skill: 'Defence', level: 40, derivedLevel: 60, primaryTraining: false }]);
  assert.equal(change(helmet, 'status').after, 'available');
  assert.deepEqual(task(findMember(report, 'b'), 'Gate helmet').status, { before: 'blocked', after: 'blocked' });
  assert.equal(slot(findMember(report, 'b').currentBiS.obtainable, 'Melee', 'head'), undefined);
  assert.equal(input.state.members[0].passiveLevels.Defence, 60);
});

test('compares personally recorded obtainable gear independently of group challenge checkmarks and excludes unrecorded ammo', () => {
  const input = fixture(), report = previewEquipmentCorrections(input);
  const recorded = findMember(report).currentBiS.personallyRecordedObtainable;
  assert.deepEqual(loadout(recorded, 'Ranged').after.best.items, ['Synthetic tall bow', 'Synthetic tall arrow']);
  assert.equal(slot(recorded, 'Weight Reducing', 'pocket').after[0].name, 'Feather token');
  assert.deepEqual(findMember(report, 'b').currentBiS.personallyRecordedObtainable.slots, []);
  assert.deepEqual(findMember(report, 'b').currentBiS.personallyRecordedObtainable.loadouts, []);
  assert.deepEqual(findMember(report).currentBiS.recordedObtained, []);
  input.state.members[0].completedTasks = input.state.members[0].completedTasks
    .filter(id => id !== equipmentTaskIdentity('Synthetic tall arrow').id);
  const noArrow = previewEquipmentCorrections(input);
  assert.equal(loadout(findMember(noArrow).currentBiS.personallyRecordedObtainable, 'Ranged'), undefined);
  assert.deepEqual(loadout(findMember(noArrow).currentBiS.obtainable, 'Ranged').after.best.items,
    ['Synthetic tall bow', 'Synthetic tall arrow']);
  assert.match(report.scope, /current possession and equipped slots remain unconfirmed/);
});

test('reports changed scores and retained maintenance when a slot winner stays the same', () => {
  const data = definitions({ 'Stable sword': { ...weapon(50), charges: 100 } });
  const state = createGroupState([member()]);
  const report = previewEquipmentCorrections({ state, definitions: data, engineOptions: { reviewedOverlays: false, cacheWalking: false }, corrections: [
    correction('Stable sword', 'tier', 50, 45),
  ] });
  const view = findMember(report).currentBiS.obtainable, melee = loadout(view, 'Melee');
  assert.equal(melee.before.best.mainHand, melee.after.best.mainHand);
  assert.notEqual(melee.before.best.score, melee.after.best.score);
  assert.equal(slot(view, 'Melee', '2h weapon').before[0].maintenance, 100);
  assert.equal(slot(view, 'Melee', '2h weapon').after[0].maintenance, 100);
  assert.ok(change(task(findMember(report), 'Stable sword'), 'scores'));
});

test('empty custom overlays give explicit zero changes and weight-only inputs stay isolated', () => {
  const input = fixture();
  const empty = previewEquipmentCorrections({ ...input, corrections: [], weights: [] });
  assert.deepEqual(empty.equipmentMetadata, []);
  for (const memberReport of empty.members) {
    assert.equal(memberReport.changedTaskCount, 0);
    assert.deepEqual(memberReport.tasks, []);
    assert.deepEqual(memberReport.currentBiS.obtainable.slots, []);
    assert.deepEqual(memberReport.currentBiS.obtainable.loadouts, []);
    assert.deepEqual(memberReport.currentBiS.obtainable.specialist.weight.changes, []);
  }
  assert.match(formatPreview(empty), /0 changed slots, 0 changed coupled loadouts/);
  const { corrections: _corrections, ...weightOnly } = input;
  const report = previewEquipmentCorrections(weightOnly);
  assert.equal(loadout(findMember(report).currentBiS.obtainable, 'Melee'), undefined);
  assert.ok(slot(findMember(report).currentBiS.obtainable, 'Weight Reducing', 'back'));
  const { weights: _weights, ...correctionOnly } = input;
  const corrected = previewEquipmentCorrections(correctionOnly);
  assert.equal(slot(findMember(corrected).currentBiS.obtainable, 'Weight Reducing', 'back'), undefined);
});

test('unchanged common task metadata and travel options never appear as equipment differences', () => {
  const input = fixture();
  // Include a real task correction target in an otherwise synthetic dataset:
  // it must be applied equally to both sides rather than becoming a delta.
  const reference = metadataCorrections.find(row => row.changes.every(change => !change.field.includes('.')));
  input.definitions.challenges[reference.category] = { [reference.label]: Object.fromEntries(reference.changes
    .filter(change => change.before !== null).map(change => [change.field, change.before])) };
  const report = previewEquipmentCorrections({ ...input, corrections: [], weights: [],
    engineOptions: { reviewedOverlays: false, cacheWalking: false, cacheResources: false, lodestones: [{ name: 'Home', chunkId: '12341', f2p: true }] } });
  for (const memberReport of report.members) {
    assert.deepEqual(memberReport.tasks, []);
    assert.deepEqual(memberReport.currentBiS.changes, []);
  }
});

test('accepts versioned corrections and weights artifacts as explicit isolated inputs', () => {
  const input = fixture();
  const report = previewEquipmentCorrections({ ...input,
    corrections: { schemaVersion: 1, corrections: input.corrections },
    weights: { schemaVersion: 1, records: Object.fromEntries(input.weights.map(({ name, ...row }) => [name, row])) } });
  assert.deepEqual(report, previewEquipmentCorrections(input));
});

test('reports hidden equipment duty goal and score changes while the Current BiS display switch is off', () => {
  const input = fixture();
  input.state.members[0].taskRules['Show Best in Slot Tasks'] = false;
  const original = JSON.stringify(input);
  const report = previewEquipmentCorrections(input), memberReport = findMember(report);
  assert.deepEqual(memberReport.currentBiS.obtainable.slots, []);
  assert.deepEqual(memberReport.currentBiS.obtainable.loadouts, []);
  const gloves = task(memberReport, 'Swift gloves');
  assert.deepEqual(change(gloves, 'obligationSelected'), { field: 'obligationSelected', before: true, after: false });
  assert.ok(change(gloves, 'scores').before.some(row => row.style === 'Melee'));
  assert.ok(change(task(memberReport, 'Solid gloves'), 'scores').after.some(row => row.style === 'Melee'));
  const helmet = task(memberReport, 'Gate helmet');
  assert.deepEqual(helmet.status, { before: 'blocked', after: 'available' });
  assert.deepEqual(change(helmet, 'hidden'), { field: 'hidden', before: false, after: true });
  assert.match(change(helmet, 'hiddenReasons').after[0], /Show Best in Slot Tasks/);
  assert.equal(change(helmet, 'selected'), undefined);
  assert.equal(change(helmet, 'obligationSelected').after, true);
  assert.equal(JSON.stringify(input), original);
});

test('retains saved unavailable equipment as blocked with own-source obligations while unsaved equipment uses presence changes', () => {
  const equipment = { 'Saved sword': { ...weapon(50), requirements: { Attack: 80 } },
    'Unsaved helmet': { slot: 'head', class: 'melee', melee_damage: 4, requirements: { Defence: 80 } } };
  const state = createGroupState([member(), { ...member('b'), unlocked: ['12342'] }]);
  state.rules['access.shared'] = false;
  const identity = equipmentTaskIdentity('Saved sword');
  state.tasks = [{ id: identity.id, category: identity.category, label: identity.label }];
  for (const memberRow of state.members) memberRow.taskStatus = { [identity.id]: { note: 'Synthetic saved task' } };
  const input = { state, definitions: definitions(equipment), engineOptions: { reviewedOverlays: false, cacheWalking: false }, corrections: [
    correction('Saved sword', 'requirements.Attack', 80, 40), correction('Unsaved helmet', 'requirements.Defence', 80, 40),
  ] };
  const original = JSON.stringify(input), report = previewEquipmentCorrections(input);
  const saved = task(findMember(report), 'Saved sword');
  assert.equal(saved.presence, undefined);
  assert.deepEqual(saved.status, { before: 'blocked', after: 'available' });
  assert.equal(change(saved, 'obligation'), undefined);
  assert.ok(change(saved, 'blockers').before.some(row => row.kind === 'access' && /member’s own map/.test(row.detail)));
  const outside = task(findMember(report, 'b'), 'Saved sword');
  assert.deepEqual(outside.status, { before: 'blocked', after: 'blocked' });
  assert.deepEqual(outside.availability, []);
  assert.equal(findMember(report, 'b').checkedTaskCount, 1);
  assert.deepEqual(task(findMember(report), 'Unsaved helmet').presence, { before: false, after: true });
  assert.equal(task(findMember(report, 'b'), 'Unsaved helmet'), undefined);
  assert.equal(JSON.stringify(input), original);
});

test('legacy display hiding applies before migration and authored unset rules apply after migration', () => {
  const input = fixture();
  input.state.members[0].sourceMapId = 'synthetic';
  input.state.legacy = { maps: { synthetic: { rules: { 'Show Best in Slot Tasks': false } } } };
  const hidden = previewEquipmentCorrections(input);
  assert.deepEqual(findMember(hidden).currentBiS.obtainable.loadouts, []);
  assert.ok(task(findMember(hidden), 'Synthetic greatsword'));
  input.state.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'synthetic' }] };
  const migrated = previewEquipmentCorrections(input);
  assert.ok(loadout(findMember(migrated).currentBiS.obtainable, 'Melee'));
});

async function directory(t) {
  const dir = await mkdtemp(path.join(worktree, '.equipment-preview-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function hashes(dir) {
  const result = {};
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    try { result[name] = createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex'); }
    catch (error) { if (!['EISDIR', 'EPERM'].includes(error.code)) throw error; }
  }
  return result;
}
async function compactFixture(dir, state) {
  const document = exportBackup(state);
  document.storage = { schemaVersion: 1, fields: {} };
  await mkdir(path.join(dir, 'static'));
  for (const field of ['tasks', 'legacy']) {
    const bytes = Buffer.from(JSON.stringify(document.state[field] ?? {}), 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex'), id = `static-${sha256}.json.gz`;
    document.storage.fields[field] = { id, sha256 };
    delete document.state[field];
    await writeFile(path.join(dir, 'static', id), gzipSync(bytes));
  }
  const filename = path.join(dir, 'state.json');
  await writeFile(filename, JSON.stringify(document));
  return filename;
}

test('CLI hydrates a copied compact state/static fixture and produces stable JSON with every file hash unchanged', async t => {
  const dir = await directory(t), input = fixture();
  input.state.legacy = { evidence: 'Small synthetic retained field; Player 1 é' };
  const filename = await compactFixture(dir, input.state);
  const definitionsPath = path.join(dir, 'definitions.json'), correctionsPath = path.join(dir, 'corrections.json'), weightsPath = path.join(dir, 'weights.json');
  await writeFile(definitionsPath, JSON.stringify(input.definitions));
  await writeFile(correctionsPath, JSON.stringify({ schemaVersion: 1, corrections: input.corrections }));
  await writeFile(weightsPath, JSON.stringify({ schemaVersion: 1,
    records: Object.fromEntries(input.weights.map(({ name, ...row }) => [name, row])) }));
  const before = await hashes(dir);
  const args = ['scripts/preview-equipment-corrections.mjs', '--state', filename, '--definitions', definitionsPath,
    '--corrections', correctionsPath, '--weights', weightsPath, '--no-cache-walking', '--synthetic-definitions', '--json'];
  const invoke = flags => spawnSync(process.execPath, flags, { cwd: worktree, encoding: 'utf8', env: { ...process.env, TEMP: dir, TMP: dir } });
  const first = invoke(args), second = invoke(args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  const parsed = JSON.parse(first.stdout);
  assert.deepEqual(parsed, previewEquipmentCorrections(input));
  assert.equal(parsed.members.length, 2);
  assert.ok(parsed.members[0].currentBiS.obtainable.loadouts.length > 0);
  const text = invoke(args.slice(0, -1));
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Personally recorded obtainable Current BiS/);
  assert.match(text.stdout, /Weight Reducing/);
  assert.deepEqual(await hashes(dir), before);
});

test('CLI rejects missing and duplicate arguments and supports help without opening a state store', () => {
  const invoke = args => spawnSync(process.execPath, ['scripts/preview-equipment-corrections.mjs', ...args], { cwd: worktree, encoding: 'utf8' });
  for (const args of [[], ['--state'], ['--unknown'], ['--state', 'fixture.json', '--state', 'other.json'], ['--json', '--json']]) {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
  const help = invoke(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /\[--weights PATH\]/);
});
