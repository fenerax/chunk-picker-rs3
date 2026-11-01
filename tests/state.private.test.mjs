import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, validateState, validateOwnedState, exportBackup, importBackup, previewRestore,
  applyCommand, applyValidatedCommand, importLegacyMaps, preferenceDefinitions, validatePreference } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool, taskCompletion } from '../app/core/rules.mjs';
import { originalSettings, authoredSettingDefinitions } from '../app/data/settings.mjs';
import { deathSettingDefinitions } from '../app/core/death-settings.mjs';
import { gatheringSettingDefinitions } from '../app/core/gathering-settings.mjs';
import { playerControlSkills, resolvePlayerControls } from '../app/core/player-controls.mjs';
import { stickerDefinitions, resolveMemberStickers, resolveStartingChunk } from '../app/core/map-markers.mjs';
import { resolveTaskAlternatives } from '../app/core/task-alternatives.mjs';
import { applyRuleProfile } from '../app/core/planning.mjs';

const owners = [{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }];
const clock = () => '2026-10-07T12:00:00.000Z';
function state() {
  const result = createGroupState(owners);
  result.members[0].unlocked = ['100'];
  result.members[1].unlocked = ['200'];
  result.tasks = [{ id: 'quest:cooks-assistant', label: "Cook's Assistant", category: 'quest' }];
  return result;
}
function world(ids = ['100', '101', '102', '200', '300']) {
  return { chunks: new Map(ids.map(id => [id, { id, name: `Chunk ${id}` }])),
    neighbors: new Map([['100', ids.filter(id => id === '101' || id === '102')]]),
    walkable: new Set(ids), f2p: new Set(ids) };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('task-rule commands reject malformed known values before time/history changes and preserve unknown rules', () => {
  const original = freeze(state()), options = { now: () => { throw Error('No timestamp on rejection'); } };
  for (const ruleId of ['Rare Drop Amount', 'rareDropNum', 'rareDropThreshold', 'Secondary Primary Amount', 'secondaryPrimaryNum']) {
    for (const value of ['banana', null, true, '', '-1', '2/1', '1/-16', '1/', 'Infinity']) {
      assert.throws(() => applyCommand(original, { type: 'set-task-rule', memberId: 'player1', ruleId, value }, options), /task rule.*(?:probability|denominator)/i);
    }
  }
  for (const ruleId of ['Rare Drop', 'Secondary Primary', 'Rare Drop Inclusive', 'Secondary Primary Inclusive', 'Skills', 'Quests']) {
    for (const value of ['true', 'false', 1, 0, null]) assert.throws(() => applyCommand(original, { type: 'set-task-rule', memberId: 'player1', ruleId, value }, options), /boolean/);
  }
  for (const value of ['banana', '1/16', 0, -1, 1.5]) assert.throws(() => applyCommand(original, { type: 'set-task-rule', memberId: 'player1', ruleId: 'Kill X Amount', value }, options), /positive safe integer/);
  for (const value of ['16', 16, '1/16', 1 / 16, '0', 0, '1/0']) {
    const changed = applyCommand(original, { type: 'set-task-rule', memberId: 'player1', ruleId: 'Rare Drop Amount', value }, { now: clock });
    assert.equal(changed.members[0].taskRules['Rare Drop Amount'], value);
  }
  assert.equal(applyCommand(original, { type: 'set-task-rule', memberId: 'player1', ruleId: 'custom.unknown', value: 'banana' }, { now: clock }).members[0].taskRules['custom.unknown'], 'banana');
  assert.deepEqual(original, state());
});

test('task-rule profile application rejects malformed values atomically', () => {
  const original = freeze(state());
  for (const taskRules of [{ 'Rare Drop Amount': 'banana' }, { 'Secondary Primary': 'true' }, { secondaryPrimaryNum: '1/-16' }]) {
    const profile = { format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: { 'content.f2p': false }, taskRules };
    for (const incoming of [profile, JSON.stringify(profile)]) assert.throws(() => applyRuleProfile(original, incoming, 'player1', { now: clock }), /task rule/i);
    assert.throws(() => applyCommand(original, { type: 'set-profile', memberId: 'player1', rules: profile.rules, taskRules }, { now: clock }), /task rule/i);
  }
  assert.deepEqual(original, state());
});

test('load and restore preserve malformed task rules with stable review diagnostics', () => {
  const original = state(); original.members[0].taskRules = { 'Rare Drop Amount': 'banana', 'Secondary Primary': 'true', 'custom.unknown': 'banana' };
  const saved = JSON.stringify(original), loaded = validateState(freeze(original));
  assert.deepEqual(loaded.members[0].taskRules, original.members[0].taskRules);
  const diagnostics = loaded.provenance.taskRuleDiagnostics;
  assert.deepEqual(diagnostics.map(item => item.ruleId), ['Rare Drop Amount', 'Secondary Primary']);
  assert(diagnostics.every(item => item.code === 'invalid-task-rule' && item.memberId === 'player1' && item.detail.includes('preserved')));
  assert.deepEqual(validateState(loaded), loaded);
  assert.deepEqual(importBackup(exportBackup(loaded)), loaded);
  assert(previewRestore(state(), original).warnings.some(warning => warning.includes('Rare Drop Amount') && warning.includes('preserved')));
  const repaired = applyCommand(loaded, { type: 'set-task-rule', memberId: 'player1', ruleId: 'Rare Drop Amount', value: '16' }, { now: clock });
  assert.deepEqual(repaired.provenance.taskRuleDiagnostics.map(item => item.ruleId), ['Secondary Primary']);
  const undone = applyCommand(repaired, { type: 'undo' }, { now: clock });
  assert.equal(undone.members[0].taskRules['Rare Drop Amount'], 'banana');
  assert.deepEqual(undone.provenance.taskRuleDiagnostics, diagnostics);
  assert.equal(JSON.stringify(original), saved);
});

test('legacy rule import preserves malformed cutoffs and surfaces review warnings', () => {
  const document = { maps: { qxa: { chunks: { unlocked: ['100'] }, rules: { 'Rare Drop Amount': 'banana', secondaryPrimaryNum: '1/-16' } } } };
  const imported = importLegacyMaps(freeze(document), { members: [{ ...owners[0], mapId: 'qxa' }] });
  assert.deepEqual(imported.state.legacy.maps.qxa.rules, document.maps.qxa.rules);
  assert.equal(imported.state.provenance.taskRuleDiagnostics.length, 2);
  assert(imported.warnings.some(warning => warning.includes('Rare Drop Amount') && warning.includes('preserved')));
});

test('new groups have explicit ownership defaults and independent arrays', () => {
  const input = structuredClone(owners);
  const result = createGroupState(input);
  assert.deepEqual(result, { schemaVersion: 1, revision: 0, rules: {},
    members: owners.map(owner => ({ ...owner, runescapeName: owner.id === 'player1' ? 'exampleGIMab' : 'twosamplegim', sourceMapId: null, unlocked: [], selected: [],
      pendingRoll: [], blacklisted: [], completedTasks: [], obtainedEquipment: [], teleports: [] })), tasks: [], history: [], provenance: { ancientEffigiesMigratedMembers: owners.map(owner => owner.id) } });
  result.members[0].selected.push('12341');
  assert.deepEqual(result.members[1].selected, []);
  assert.deepEqual(input, owners);
});

test('canonical monotonic history survives restore gaps and cannot collide with the next event', () => {
  const original = state();
  original.revision = 5;
  original.history = [{ id: 'revision-1', revision: 1, type: 'set-rule', at: clock() },
    { id: 'revision-4', revision: 4, type: 'set-rule', at: clock() }];
  const restored = importBackup(exportBackup(original));
  const changed = applyCommand(restored, { type: 'set-rule', ruleId: 'content.f2p', value: false }, { now: clock });
  assert.equal(changed.history.at(-1).id, 'revision-6');
  const invalidMutations = [
    value => { value.history[0].id = 'revision-6'; },
    value => { value.history[1].id = 'alternate'; },
    value => { value.history[1].revision = 1; value.history[1].id = 'revision-1'; },
    value => { value.history.reverse(); },
    value => { value.history[1].revision = 6; value.history[1].id = 'revision-6'; },
  ];
  for (const mutate of invalidMutations) {
    const invalid = structuredClone(original);
    mutate(invalid);
    assert.throws(() => validateState(invalid), /History|history/);
  }
});

test('Roll2 offers locked choices then a deliberate choice unlocks one and restores the other candidate', () => {
  const original = state();
  original.members[0].selected = ['101', '102'];
  const pending = applyCommand(freeze(original), { type: 'roll', memberId: 'player1', count: 2 }, { world: world(), random: () => 0, now: clock });
  assert.deepEqual(pending.members[0].unlocked, ['100']);
  assert.deepEqual(pending.members[0].selected, []);
  assert.deepEqual(pending.members[0].pendingRoll, ['101', '102']);
  assert.throws(() => applyCommand(pending, { type: 'roll', memberId: 'player1', count: 1 }, { world: world() }), /pending roll/);
  assert.throws(() => applyCommand(pending, { type: 'unlock-selection', memberId: 'player1', chunkId: '300' }), /pending roll choice/);
  const chosen = applyCommand(freeze(pending), { type: 'unlock-selection', memberId: 'player1', chunkId: '102' }, { world: world(), expectedRevision: 1, now: clock });
  assert.deepEqual(chosen.members[0].unlocked, ['100', '102']);
  assert.deepEqual(chosen.members[0].selected, ['101']);
  assert.deepEqual(chosen.members[0].pendingRoll, []);
  assert.equal(chosen.history[1].id, 'revision-2');
  assert.deepEqual(pending.members[0].pendingRoll, ['101', '102']);
});

test('available personal teleport adds a locked roll destination without changing ownership', () => {
  const original = freeze(state());
  const teleport = { id: 'destination', label: 'Destination', destination: '300', available: true, consumable: false };
  const changed = applyCommand(original, { type: 'set-teleport', memberId: 'player1', teleport }, { now: clock });
  assert.deepEqual(changed.members[0].unlocked, original.members[0].unlocked);
  const travelWorld = { ...world(), sectionTopology: new Map([...world().chunks.keys()].map(id => [id, new Map([['0', []]])])) };
  assert.ok(!evaluateRollPool(travelWorld, changed, 'player1').eligible.some(candidate => candidate.id === '300'), 'No personal return yet');
  const withHome = applyCommand(changed, { type: 'set-teleport', memberId: 'player1', teleport: { id: 'return', label: 'Personal home', destination: '100', available: true, consumable: false } }, { now: clock });
  assert.ok(evaluateRollPool(travelWorld, withHome, 'player1').eligible.some(candidate => candidate.id === '300'));
  assert.ok(!evaluateRollPool(world(), changed, 'player2').eligible.some(candidate => candidate.id === '300'));
  teleport.available = false;
  assert.equal(changed.members[0].teleports[0].available, true);
  assert.throws(() => applyCommand(original, { type: 'set-teleport', memberId: 'player1', teleport: { ...teleport, available: 1 } }), /boolean/);
  assert.deepEqual(original.members[0].teleports, []);
});

test('manual roll progression adds only filtered gray neighbors and preserves existing selected candidates', () => {
  const original = state(); original.rules['roll.neighborMode'] = 'manual'; original.members[0].selected = ['101'];
  const map = world(['100', '101', '102', '103', '104', '105', '106', '200']);
  map.neighbors.set('101', ['100', '102', '103', '104', '105', '106', '200', '999']);
  map.walkable.delete('103'); map.f2p.delete('104'); map.surface = new Set([...map.chunks.keys()].filter(id => id !== '105'));
  original.members[0].blacklisted = ['106'];
  const changed = applyCommand(freeze(original), { type: 'roll', memberId: 'player1', count: 1 }, { world: map, random: () => 0, now: clock });
  assert.deepEqual(changed.members[0].selected, ['102', '200']);
  const relaxed = structuredClone(original); relaxed.rules['roll.walkable'] = false; relaxed.rules['content.f2p'] = false;
  const widened = applyCommand(relaxed, { type: 'roll', memberId: 'player1', count: 1 }, { world: map, random: () => 0, now: clock });
  assert.deepEqual(widened.members[0].selected, ['102', '103', '104', '200']);
  const pending = structuredClone(original); pending.members[0].selected = []; pending.members[0].pendingRoll = ['101', '102'];
  const chosen = applyCommand(pending, { type: 'unlock-selection', memberId: 'player1', chunkId: '101' }, { world: map, now: clock });
  assert.deepEqual(chosen.members[0].selected, ['102', '200']);
});

test('random start ignores selected pool, honors ownership/blacklist/walkable/F2P/surface and adds no neighbors', () => {
  const original = state(); original.rules['roll.neighborMode'] = 'manual'; original.members[0].selected = ['102']; original.members[0].blacklisted = ['101'];
  const map = world(['100', '101', '102', '103', '104', '105', '200']);
  map.walkable.delete('103'); map.f2p.delete('104'); map.surface = new Set(['100', '101', '102', '103', '104', '200']); map.neighbors.set('102', ['105']);
  map.sectionTopology = new Map([['102', new Map([['1', []], ['2', []]])]]);
  const changed = applyCommand(original, { type: 'random-start', memberId: 'player1' }, { world: map, random: () => 0, now: clock });
  assert.deepEqual(changed.members[0].unlocked, ['100', '102']); assert.deepEqual(changed.members[0].selected, []);
  assert.deepEqual(changed.history[0].command.rolled, ['102']);
  assert.deepEqual(changed.members[0].sectionOverrides, { '102-1': true });
  const blocked = structuredClone(original); blocked.members[0].blacklisted.push('102', '200');
  assert.throws(() => applyCommand(blocked, { type: 'random-start', memberId: 'player1' }, { world: map, random: () => { throw Error('No draw'); } }), /Roll count/);
});

test('corrupt undo snapshots or markers cannot be restored or applied', () => {
  const valid = applyCommand(state(), { type: 'set-rule', ruleId: 'content.f2p', value: false }, { now: clock });
  for (const mutate of [
    state => { state.history[0].undo.rules = { bad: true }; },
    state => { state.history[0].undo.members = [{ id: 'intruder' }]; },
    state => { state.history[0].undo.legacy = {}; },
    state => { state.history[0].undoneRevision = 2; },
  ]) {
    const bad = structuredClone(valid); mutate(bad);
    assert.throws(() => validateState(bad)); assert.throws(() => applyCommand(bad, { type: 'undo' }, { now: clock }));
  }
});

test('set-profile replaces group/personal rule maps atomically and rejects unknown command fields', () => {
  const original = state(); original.rules = { 'content.f2p': false }; original.members[0].taskRules = { Skills: true };
  const options = { now: clock };
  const changed = applyCommand(original, { type: 'set-profile', memberId: 'player1', rules: { 'tasks.completion': 'all' }, taskRules: { Skills: false } }, options);
  assert.equal(changed.revision, 1); assert.equal(changed.history.length, 1);
  assert.deepEqual(changed.rules, { 'tasks.completion': 'all' });
  assert.deepEqual(changed.members[0].taskRules, { Skills: false });
  assert.deepEqual(applyCommand(changed, { type: 'undo' }, options).members, original.members);
  assert.throws(() => applyCommand(original, { type: 'set-profile', rules: {}, taskRules: {} }, options), /memberId/);
  assert.throws(() => applyCommand(original, { type: 'set-profile', memberId: 'player1', rules: { 'content.f2p': true }, taskRules: { Skills: [] } }, options), /primitive/);
  assert.throws(() => applyCommand(original, { type: 'set-profile', rules: {}, extra: true }, options), /Unknown command/);
  assert.deepEqual(original.rules, { 'content.f2p': false });
});

test('sparse undo restores every member command and optional dictionary existence exactly', () => {
  const teleport = { id: 'home', label: 'Home', destination: '300', available: true, consumable: false };
  const taskId = state().tasks[0].id;
  const cases = [
    [{ type: 'set-teleport', memberId: 'player1', teleport }],
    [{ type: 'set-teleport', memberId: 'player1', teleport: { ...teleport, available: false } }, member => { member.teleports = [teleport]; }],
    [{ type: 'delete-teleport', memberId: 'player1', teleportId: 'home' }, member => { member.teleports = [teleport]; }],
    [{ type: 'set-chunk', memberId: 'player1', chunkId: '101', status: 'selected' }],
    [{ type: 'set-chunk', memberId: 'player1', chunkId: '101', status: 'locked' }, member => { member.selected = ['101']; }],
    [{ type: 'complete-task', memberId: 'player1', taskId, completed: true }],
    [{ type: 'complete-task', memberId: 'player1', taskId, completed: false }, member => { member.completedTasks = [taskId]; }],
    [{ type: 'roll', memberId: 'player1', count: 1 }, member => { member.selected = ['101']; }],
    [{ type: 'roll', memberId: 'player1', count: 2 }, member => { member.selected = ['101', '102']; }],
    [{ type: 'unlock-selection', memberId: 'player1', chunkId: '101' }, member => { member.pendingRoll = ['101', '102']; }],
    [{ type: 'cancel-roll', memberId: 'player1' }, member => { member.pendingRoll = ['101', '102']; }],
    [{ type: 'unlock-both', memberId: 'player1' }, member => { member.pendingRoll = ['101', '102']; }],
    [{ type: 'random-start', memberId: 'player1' }],
    [{ type: 'random-start', memberId: 'player1', count: 2 }],
    [{ type: 'unpick', memberId: 'player1' }],
    [{ type: 'set-note', memberId: 'player1', chunkId: '101', note: 'Bring hammer' }],
    [{ type: 'set-note', memberId: 'player1', chunkId: '101', note: '' }, member => { member.notes = { '101': 'Keep hammer', '102': 'Untouched' }; }],
    [{ type: 'set-task-status', memberId: 'player1', taskId, challengeCompleted: true }],
    [{ type: 'set-task-status', memberId: 'player1', taskId, favorite: false, note: 'New note' }, member => { member.taskStatus = { [taskId]: { favorite: true, challengeCompleted: true } }; }],
    [{ type: 'set-task-rule', memberId: 'player1', ruleId: 'Skills', value: true }],
    [{ type: 'reset-task-rule', memberId: 'player1', ruleId: 'Skills' }, member => { member.taskRules = { Skills: true }; }],
    [{ type: 'set-task-alternative', memberId: 'player1', category: 'quest', group: 'Starter route', taskId }],
    [{ type: 'set-task-alternative', memberId: 'player1', category: 'quest', group: 'Starter route', taskId: null }, member => { member.taskAlternatives = { quest: { 'Starter route': taskId } }; }],
    [{ type: 'set-primary-override', memberId: 'player1', skill: 'Mining', enabled: false }],
    [{ type: 'set-primary-override', memberId: 'player1', skill: 'Mining', enabled: null }, member => { member.primaryOverrides = { Mining: true }; }],
    [{ type: 'set-skill-levels', memberId: 'player1', skill: 'Mining', passiveLevel: 10, maxLevel: 40 }],
    [{ type: 'set-skill-levels', memberId: 'player1', skill: 'Mining', passiveLevel: null }, member => { member.passiveLevels = { Mining: 10 }; }],
    [{ type: 'set-slayer-lock', memberId: 'player1', lock: { level: 50, monster: 'Manually Locked', boss: 'None' } }],
    [{ type: 'set-slayer-lock', memberId: 'player1', lock: null }, member => { member.slayerLock = { level: 50 }; }],
    [{ type: 'set-sticker', memberId: 'player1', chunkId: '101', sticker: { type: 'star', color: '#ABCDEF', text: 'Later' } }],
    [{ type: 'set-sticker', memberId: 'player1', chunkId: '101', sticker: null }, member => { member.stickers = { '101': { type: 'star', color: '#ABCDEF', text: 'Later' } }; }],
    [{ type: 'set-starting-chunk', memberId: 'player1', chunkId: '101' }],
    [{ type: 'set-starting-chunk', memberId: 'player1', chunkId: null }, member => { member.preferences = { startingChunk: '101' }; }],
    [{ type: 'set-preference', memberId: 'player1', preferenceId: 'theme', value: 'dark' }],
    [{ type: 'set-preference', memberId: 'player1', preferenceId: 'hideChecked', value: false }, member => { member.preferences = {}; }],
    [{ type: 'set-preference', memberId: 'player1', preferenceId: 'ids', value: true }, member => { member.preferences = { theme: 'terminal', ids: false }; }],
    [{ type: 'set-section', memberId: 'player1', sectionId: '101-1', accessible: false }],
    [{ type: 'set-section', memberId: 'player1', sectionId: '101-1', accessible: null }, member => { member.sectionOverrides = { '101-1': true }; }],
    [{ type: 'set-area', memberId: 'player1', areaId: 'Mine', accessible: true }],
    [{ type: 'set-area', memberId: 'player1', areaId: 'Mine', accessible: null }, member => { member.areaOverrides = { Mine: false }; }],
    [{ type: 'set-source-backlog', memberId: 'player1', kind: 'objects', name: 'Furnace', backlogged: true }],
    [{ type: 'set-source-backlog', memberId: 'player1', kind: 'objects', name: 'Furnace', backlogged: false }, member => { member.sourceBacklogs = { items: { Hammer: false }, objects: { Furnace: true, Anvil: false } }; }],
    [{ type: 'set-profile', memberId: 'player1', rules: {}, taskRules: {} }],
    [{ type: 'set-profile', memberId: 'player1', rules: { 'content.f2p': false }, taskRules: { Skills: false } }, member => { member.taskRules = { Skills: true, Other: 'keep until profile replacement' }; }],
  ];
  for (const [command, prepare] of cases) {
    const original = state(); prepare?.(original.members[0]);
    const options = { world: world(), random: () => 0, now: clock };
    options.world.sectionTopology = new Map([['101', new Map([['1', []]])]]);
    const changed = applyCommand(freeze(original), command, options);
    assert.deepEqual(applyValidatedCommand(freeze(validateState(original)), command, options), changed, `Private boundary: ${command.type}`);
    assert.equal(changed.history[0].undo.members, undefined, command.type);
    assert.ok(changed.history[0].undo.memberChanges, command.type);
    const restored = applyCommand(importBackup(exportBackup(changed)), { type: 'undo' }, options);
    assert.deepEqual(restored.members, validateState(original).members, command.type);
    assert.deepEqual(restored.rules, original.rules, command.type);
    assert.deepEqual(restored.tasks, original.tasks, command.type);
    assert.equal(restored.revision, 2);
  }
});

test('every scalar original setting, death setting and authored setting has typed personal preference persistence without seeded defaults', () => {
  assert.deepEqual(preferenceDefinitions.map(definition => definition.id), [...Object.keys(originalSettings).filter(id => id !== 'chunkNeighboursOptions'), ...deathSettingDefinitions.map(definition => definition.id), 'miningPickaxe', 'miningAttention', 'woodcuttingHatchet', 'gatheringMode', 'gatheringOreBox', 'gatheringWoodBox', ...gatheringSettingDefinitions.map(definition => definition.id), 'topBarHidden', ...authoredSettingDefinitions.map(definition => definition.id), 'setupGuide']);
  let current = state();
  for (const definition of preferenceDefinitions) {
    assert.equal(validatePreference(definition.id, definition.default), definition.default);
    current = applyCommand(freeze(current), { type: 'set-preference', memberId: 'player1', preferenceId: definition.id, value: definition.default }, { now: clock });
  }
  assert.deepEqual(current.members[0].preferences, Object.fromEntries(preferenceDefinitions.map(definition => [definition.id, definition.default])));
  assert.equal(current.members[1].preferences, undefined);
  assert.deepEqual(importBackup(exportBackup(current)), current);
  assert.equal(state().members[0].preferences, undefined);
});

test('sparse and full preference undo histories reject invalid keys and values before restore', () => {
  const original = state(); original.members[0].preferences = { theme: 'dark' };
  const changed = applyCommand(original, { type: 'set-preference', memberId: 'player1', preferenceId: 'theme', value: 'winter' }, { now: clock });
  const mutations = [
    value => { value.history[0].undo.memberChanges[0].changes[0].path = ['preferences', 'unknown']; },
    value => { value.history[0].undo.memberChanges[0].changes[0].path = ['preferences', '__proto__']; },
    value => { value.history[0].undo.memberChanges[0].changes[0].before.value = 'sepia'; },
    value => { value.history[0].undo.memberChanges[0].changes[0].after.value = true; },
    value => { value.members[0].preferences.theme = 'light'; },
    value => { value.history[0].undo = { members: [structuredClone(original.members[0])] }; value.history[0].undo.members[0].preferences = { ids: 1 }; },
  ];
  for (const mutate of mutations) {
    const corrupt = structuredClone(changed); mutate(corrupt); const before = structuredClone(corrupt);
    assert.throws(() => validateState(corrupt));
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: corrupt }));
    assert.throws(() => applyCommand(corrupt, { type: 'undo' }, { now: clock }));
    assert.deepEqual(corrupt, before);
  }
});

test('random start count2 uses the filtered surface pool on nonempty maps and offers before seeding sections', () => {
  const original = state(); original.rules['roll.neighborMode'] = 'manual';
  original.members[0].selected = ['102', '103']; original.members[0].blacklisted = ['101'];
  const map = world(['100', '101', '102', '103', '104', '105', '106', '200']);
  map.walkable.delete('104'); map.f2p.delete('105'); map.surface = new Set([...map.chunks.keys()].filter(id => id !== '106'));
  map.sectionTopology = new Map(['102', '103'].map(id => [id, new Map([['1', []], ['2', []]])]));
  map.neighbors.set('102', ['106']);
  const options = { world: map, random: () => 0, now: clock };
  const pending = applyCommand(freeze(original), { type: 'random-start', memberId: 'player1', count: 2 }, options);
  assert.deepEqual(pending.members[0].unlocked, ['100']);
  assert.deepEqual(pending.members[0].pendingRoll, ['102', '103']);
  assert.deepEqual(pending.members[0].selected, []);
  assert.equal(pending.members[0].sectionOverrides, undefined);
  assert.deepEqual(pending.members[1], original.members[1]);
  assert.deepEqual(pending.history[0].command.rolled, ['102', '103']);
  assert.throws(() => applyCommand(pending, { type: 'unlock-selection', memberId: 'player1', chunkId: '102' }, { now: clock }), /world is required/);
  assert.throws(() => applyCommand(pending, { type: 'unlock-both', memberId: 'player1' }, { now: clock }), /world is required/);
  assert.deepEqual(applyCommand(importBackup(exportBackup(pending)), { type: 'undo' }, options).members, original.members);
  const noted = applyCommand(pending, { type: 'set-preference', memberId: 'player1', preferenceId: 'theme', value: 'dark' }, options);
  const chosen = applyCommand(noted, { type: 'unlock-selection', memberId: 'player1', chunkId: '102' }, options);
  assert.deepEqual(chosen.members[0].unlocked, ['100', '102']);
  assert.deepEqual(chosen.members[0].selected, ['103']);
  assert.deepEqual(chosen.members[0].sectionOverrides, { '102-1': true });
  assert.deepEqual(applyCommand(importBackup(exportBackup(chosen)), { type: 'undo' }, options).members, noted.members);
  const both = applyCommand(pending, { type: 'unlock-both', memberId: 'player1' }, options);
  assert.deepEqual(both.members[0].unlocked, ['100', '102', '103']);
  assert.deepEqual(both.members[0].sectionOverrides, { '102-1': true, '103-1': true });
  const cancelled = applyCommand(pending, { type: 'cancel-roll', memberId: 'player1' }, options);
  assert.deepEqual(cancelled.members[0], original.members[0]);
  const restoredOffer = applyCommand(cancelled, { type: 'undo' }, options);
  assert.deepEqual(applyCommand(restoredOffer, { type: 'unlock-selection', memberId: 'player1', chunkId: '103' }, options).members[0].sectionOverrides, { '103-1': true });
  const ordinaryOffer = applyCommand(cancelled, { type: 'roll', memberId: 'player1', count: 2 }, options);
  const ordinaryChoice = applyCommand(ordinaryOffer, { type: 'unlock-selection', memberId: 'player1', chunkId: '102' }, options);
  assert.equal(ordinaryChoice.members[0].sectionOverrides, undefined, 'An old random offer must not seed sections for a later ordinary roll');
});

test('personal primary, passive and maximum controls override preserved legacy declarations and clear to inheritance', () => {
  const original = state(); original.members[0].sourceMapId = 'qxa';
  original.legacy = { maps: { qxa: { manualPrimary: { Mining: true }, chunkinfo: { manualPrimary: { Fishing: true }, passiveSkill: { Mining: '10', Combat: 152 }, maxSkill: { Mining: 40 }, slayerLocked: { level: '60', monster: 'Manually-_-20Locked', boss: 'None' } } } }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'player1', sourceMapId: 'qxa' }] } };
  assert.equal(playerControlSkills.length, 29);
  assert.deepEqual(resolvePlayerControls(freeze(original), original.members[0]), { primaryOverrides: { Mining: true, Fishing: true }, passiveLevels: { Mining: 10 }, maxLevels: { Mining: 40 }, slayerLock: { level: 60, monster: 'Manually Locked', boss: 'None' } });
  let changed = applyCommand(original, { type: 'set-primary-override', memberId: 'player1', skill: 'Mining', enabled: false }, { now: clock });
  changed = applyCommand(changed, { type: 'set-skill-levels', memberId: 'player1', skill: 'Mining', passiveLevel: 20, maxLevel: 99 }, { now: clock });
  changed = applyCommand(changed, { type: 'set-slayer-lock', memberId: 'player1', lock: null }, { now: clock });
  assert.deepEqual(resolvePlayerControls(changed, changed.members[0]), { primaryOverrides: { Mining: false, Fishing: true }, passiveLevels: { Mining: 20 }, maxLevels: { Mining: 99 }, slayerLock: null });
  assert.deepEqual(changed.members[1], original.members[1]); assert.deepEqual(changed.legacy, original.legacy);
  assert.deepEqual(changed.history[2].undo.memberChanges[0].changes, [{ path: ['slayerLock'], kind: 'value', before: { exists: false }, after: { exists: true, value: null } }]);
  const unlocked = applyCommand(importBackup(exportBackup(changed)), { type: 'undo' }, { now: clock });
  assert.deepEqual(resolvePlayerControls(unlocked, unlocked.members[0]).slayerLock, { level: 60, monster: 'Manually Locked', boss: 'None' });
  let cleared = applyCommand(changed, { type: 'set-primary-override', memberId: 'player1', skill: 'Mining', enabled: null }, { now: clock });
  cleared = applyCommand(cleared, { type: 'set-skill-levels', memberId: 'player1', skill: 'Mining', passiveLevel: null, maxLevel: null }, { now: clock });
  assert.deepEqual(resolvePlayerControls(cleared, cleared.members[0]), { primaryOverrides: { Mining: true, Fishing: true }, passiveLevels: { Mining: 10 }, maxLevels: { Mining: 40 }, slayerLock: null });
  const edited = applyCommand(cleared, { type: 'set-slayer-lock', memberId: 'player1', lock: { level: 120, monster: 'None', boss: 'Manually Locked' } }, { now: clock });
  const resolved = resolvePlayerControls(edited, edited.members[0]); resolved.slayerLock.level = 1;
  assert.equal(edited.members[0].slayerLock.level, 120, 'Resolved control objects must not mutate stored declarations');
  assert.deepEqual(importBackup(exportBackup(edited)), edited);
});

test('reset-task-rule removes only a personal override and undo restores inherited-map boundaries', () => {
  const original = state(); original.rules = { 'content.f2p': true }; original.members[0].taskRules = { Skills: false, Quests: true };
  original.members[1].taskRules = { Skills: true };
  const reset = applyCommand(freeze(original), { type: 'reset-task-rule', memberId: 'player1', ruleId: 'Skills' }, { now: clock });
  assert.deepEqual(reset.members[0].taskRules, { Quests: true });
  assert.deepEqual(reset.members[1], original.members[1]); assert.deepEqual(reset.rules, original.rules);
  assert.deepEqual(applyCommand(importBackup(exportBackup(reset)), { type: 'undo' }, { now: clock }).members, original.members);
  assert.equal(applyCommand(state(), { type: 'reset-task-rule', memberId: 'player1', ruleId: 'Skills' }, { now: clock }).members[0].taskRules, undefined);
  for (const ruleId of ['__proto__', 'constructor', 'prototype', '', null]) assert.throws(() => applyCommand(original, { type: 'reset-task-rule', memberId: 'player1', ruleId }, { now: clock }));
});

