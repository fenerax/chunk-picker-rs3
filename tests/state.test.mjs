import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, validateState, validateOwnedState, exportBackup, importBackup, previewRestore,
  applyCommand, applyValidatedCommand, importLegacyMaps, preferenceDefinitions, validatePreference } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool, taskCompletion } from '../app/core/rules.mjs';
import { originalSettings, authoredSettingDefinitions } from '../app/data/settings.mjs';
import { deathSettingDefinitions } from '../app/core/death-settings.mjs';
import { playerControlSkills, resolvePlayerControls } from '../app/core/player-controls.mjs';
import { stickerDefinitions, resolveMemberStickers, resolveStartingChunk } from '../app/core/map-markers.mjs';
import { resolveTaskAlternatives } from '../app/core/task-alternatives.mjs';
import { applyRuleProfile } from '../app/core/planning.mjs';

const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const clock = () => '2026-10-07T12:00:00.000Z';
test('owned storage validation keeps full JSON and schema checks without copying private state', () => {
  const privateState = createGroupState(owners), expected = validateState(privateState);
  assert.equal(validateOwnedState(privateState), privateState);
  assert.deepEqual(privateState, expected);
  for (const invalid of [NaN, undefined, () => {}, Symbol('invalid'), new Map()]) {
    const malformed = createGroupState(owners);
    malformed.provenance = { invalid };
    assert.throws(() => validateOwnedState(malformed), /JSON|symbol|plain/);
  }
  const circular = createGroupState(owners);
  circular.provenance = { circular };
  assert.throws(() => validateOwnedState(circular), /circular/);
  const absent = createGroupState(owners);
  absent.members[0].completedTasks = ['missing'];
  assert.throws(() => validateOwnedState(absent), /absent task/);
});
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





test('unlock-selection rejects unknown restored pending choices without changing preserved state', () => {
  const original = state(); original.members[0].pendingRoll = ['999'];
  const restored = importBackup(exportBackup(freeze(original))), saved = JSON.stringify(restored);
  assert.throws(() => applyCommand(restored, { type: 'unlock-selection', memberId: 'actor1', chunkId: '999' }, { world: world(['100']), now: clock }), /999.*known.*world/);
  assert.equal(JSON.stringify(restored), saved);
  assert.deepEqual(restored.members[0].pendingRoll, ['999']);
});

test('unlock-both validates every pending choice before accepting either one', () => {
  const original = state(); original.members[0].pendingRoll = ['101', '999'];
  const restored = importBackup(exportBackup(freeze(original))), saved = JSON.stringify(restored);
  assert.throws(() => applyCommand(restored, { type: 'unlock-both', memberId: 'actor1' }, { world: world(), now: clock }), /999.*known.*world/);
  assert.equal(JSON.stringify(restored), saved);
  assert.deepEqual(restored.members[0].pendingRoll, ['101', '999']);
});

test('pending choices require a world and surface bounds while random-start choices retain section seeding', () => {
  const original = state(); original.members[0].pendingRoll = ['101', '102'];
  for (const command of [{ type: 'unlock-selection', memberId: 'actor1', chunkId: '101' }, { type: 'unlock-both', memberId: 'actor1' }]) {
    assert.throws(() => applyCommand(original, command, { now: clock }), /world is required/);
    const map = world(); map.surface = new Set(['100', '200']);
    assert.throws(() => applyCommand(original, command, { world: map, now: clock }), /known surface world/);
  }
  const map = world(['100', '101', '102', '200']); map.sectionTopology = new Map([['101', new Map([['1', []]])], ['102', new Map([['1', []]])]]);
  const pending = applyCommand(state(), { type: 'random-start', memberId: 'actor1', count: 2 }, { world: map, random: () => 0, now: clock });
  map.chunks.delete('101');
  for (const command of [{ type: 'unlock-selection', memberId: 'actor1', chunkId: '101' }, { type: 'unlock-both', memberId: 'actor1' }]) {
    assert.throws(() => applyCommand(pending, command, { world: map, now: clock }), /101.*known.*world/);
  }
});


test('backup round trip preserves nested raw gameplay, ownership and personal completions', () => {
  const original = state();
  original.members[0].selected = ['101'];
  original.members[1].completedTasks = ['quest:cooks-assistant'];
  original.legacy = { maps: { bbb: { chunkinfo: { '12341-1': {
    notes: 'Investigate cave entrance', checked: { 'colliding-old-task-id': true },
    backlog: [{ category: 'quest', label: 'Keep exact old record', done: false }], nested: [null, 0, false, ''] } },
    chunks: { stickeredNotes: { '12341': 'Bring a hammer' } } } } };
  original.provenance = { capturedAt: '2026-10-06', source: 'synthetic' };
  const envelope = exportBackup(freeze(original));
  const restored = importBackup(JSON.stringify(envelope));
  assert.deepEqual(restored, original);
  restored.legacy.maps.bbb.chunkinfo['12341-1'].notes = 'Changed';
  assert.equal(original.legacy.maps.bbb.chunkinfo['12341-1'].notes, 'Investigate cave entrance');
  envelope.state.members[0].unlocked.push('999');
  assert.deepEqual(original.members[0].unlocked, ['100']);
});

test('validation rejects corrupt restores before accepting a partial state', () => {
  const mutations = [
    result => { result.schemaVersion = 2; },
    result => { result.revision = -1; },
    result => { result.members.push(structuredClone(result.members[0])); },
    result => { result.tasks.push(structuredClone(result.tasks[0])); },
    result => { result.members[0].unlocked.push('100'); },
    result => { result.members[0].selected.push('100'); },
    result => { result.members[0].pendingRoll = ['101', '102', '300']; },
    result => { result.members[0].selected = ['101']; result.members[0].pendingRoll = ['101']; },
    result => { result.members[0].selected.push('12341-1'); },
    result => { result.members[0].blacklisted.push(12341); },
    result => { result.members[0].unlocked.push(' 101'); },
    result => { result.members[0].unlocked.push('00101'); },
    result => { result.members[0].unlocked.push('0'); },
    result => { result.members[0].unlocked.push('9007199254740992'); },
    result => { result.members[0].completedTasks.push('unknown'); },
    result => { result.rules['unknown.rule'] = true; },
    result => { result.rules['content.f2p'] = 'yes'; },
    result => { result.members[0].teleports.push({ id: 'home', label: 'Home', destination: '101', available: 'yes', consumable: false }); },
    result => { result.members[0].teleports.push({ id: 'home', label: 'Home', destination: '101-1', available: true, consumable: false }); },
    result => { result.rules = []; },
    result => { result.legacy = { bad: undefined }; },
    result => { result.legacy = { bad: NaN }; },
    result => { result.legacy = result; },
    result => { result.unknownRoot = true; },
  ];
  for (const mutate of mutations) {
    const original = state();
    const invalid = structuredClone(original);
    mutate(invalid);
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: invalid }));
    assert.deepEqual(original, state());
  }
  assert.throws(() => importBackup('{broken'), /JSON/);
  assert.throws(() => importBackup({ format: 'wrong', schemaVersion: 1, state: state() }), /format/);
  assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 99, state: state() }), /version/);
});

test('custom registry rules validate commands and backups through the same seam', () => {
  const registry = createRuleRegistry([{ id: 'house.example', label: 'Example', type: 'boolean', default: false }]);
  const changed = applyCommand(state(), { type: 'set-rule', ruleId: 'house.example', value: true }, { registry, now: clock });
  assert.equal(changed.rules['house.example'], true);
  assert.deepEqual(importBackup(exportBackup(changed, registry), registry), changed);
  assert.throws(() => exportBackup(changed), /Unknown rule/);
});

test('commands reject unknown typo or sensitive fields before writes, clock or random draws', () => {
  const original = freeze(state());
  const commands = [
    { type: 'set-rule', ruleId: 'content.f2p', value: false, password: 'private' },
    { type: 'set-teleport', memberId: 'actor1', teleport: { id: 'home', label: 'Home', destination: '300', available: true, consumable: false }, typo: true },
    { type: 'complete-task', memberId: 'actor1', taskId: 'quest:cooks-assistant', completed: true, token: 'private' },
    { type: 'roll', memberId: 'actor1', count: 1, rolled: ['300'] },
    { type: 'unlock-selection', memberId: 'actor1', chunkId: '101', credential: 'private' },
  ];
  const options = { world: world(), now: () => { throw new Error('Clock must not be read'); },
    random: () => { throw new Error('Random must not be drawn'); } };
  for (const command of commands) assert.throws(() => applyCommand(original, command, options), /Unknown command field/);
  assert.deepEqual(original, state());
});


test('restore preview names per-member additions/removals plus changed rules and tasks', () => {
  const before = state();
  before.members[0].selected = ['101'];
  before.members[0].blacklisted = ['300'];
  const after = structuredClone(before);
  after.members[0].unlocked = ['102'];
  after.members[0].selected = [];
  after.members[0].pendingRoll = ['101'];
  after.members[0].blacklisted = ['200'];
  after.members.splice(1, 1);
  after.members.push(createGroupState([{ id: 'third', name: 'Third' }]).members[0]);
  after.rules['access.shared'] = false;
  after.tasks[0].label = 'Changed label';
  after.tasks.push({ id: 'skill:mining', label: 'Mining', category: 'skill' });
  const preview = previewRestore(freeze(before), exportBackup(after));
  assert.deepEqual(preview.members[0].unlocked, { added: ['102'], removed: ['100'] });
  assert.deepEqual(preview.members[0].selected, { added: [], removed: ['101'] });
  assert.deepEqual(preview.members[0].pendingRoll, { added: ['101'], removed: [] });
  assert.deepEqual(preview.members[0].blacklisted, { added: ['200'], removed: ['300'] });
  assert.equal(preview.members.find(member => member.id === 'reed').status, 'removed');
  assert.equal(preview.members.find(member => member.id === 'third').status, 'added');
  assert.deepEqual(preview.rules.changed, [{ ruleId: 'access.shared', before: true, after: false }]);
  assert.equal(preview.tasks.added[0].id, 'skill:mining');
  assert.equal(preview.tasks.changed[0].id, 'quest:cooks-assistant');
});

test('stale revisions and unsuccessful Roll2 leave state and history unchanged', () => {
  const original = freeze(state());
  const options = { world: world(['100', '101', '200']), expectedRevision: 0, now: clock,
    random: () => { throw new Error('No random draw should be attempted'); } };
  assert.throws(() => applyCommand(original, { type: 'roll', memberId: 'actor1', count: 2 }, options), /Roll count/);
  assert.throws(() => applyCommand(original, { type: 'roll', memberId: 'actor1', count: 1 }, { ...options, expectedRevision: 5 }), /Revision conflict/);
  for (const expectedRevision of [null, -1, '0', 0.5, NaN, Infinity]) {
    assert.throws(() => applyCommand(original, { type: 'roll', memberId: 'actor1', count: 1 }, { ...options, expectedRevision }), /expectedRevision/);
  }
  assert.deepEqual(original, state());
});

test('restore preview explicitly warns when raw preserved gameplay is changed or lost', () => {
  const before = state();
  before.legacy = { maps: { bbb: { chunkinfo: { '100': { notes: 'Keep note', backlog: ['Keep backlog'], checked: true } } },
    aaa: { chunks: { stickeredNotes: { '200': 'Keep another note' } } } } };
  const after = structuredClone(before);
  delete after.legacy.maps.aaa;
  delete after.legacy.maps.bbb.chunkinfo['100'].backlog;
  after.legacy.maps.bbb.chunkinfo['100'].notes = 'Changed note';
  const preview = previewRestore(before, after);
  assert.equal(preview.legacy.changed, true);
  assert.deepEqual(preview.legacy.removedMaps, ['aaa']);
  assert.deepEqual(preview.legacy.changedMaps, ['bbb']);
  assert.deepEqual(preview.legacy.removedPaths, ['legacy.maps.bbb.chunkinfo.100.backlog', 'legacy.maps.aaa']);
  assert.equal(preview.warnings.length, 3);
  const completeLoss = structuredClone(before);
  delete completeLoss.legacy;
  assert.ok(previewRestore(before, completeLoss).warnings.some(warning => warning.includes('removes saved copies of original maps')));
  assert.equal(previewRestore(before, before).warnings.length, 0);
});

test('restore preview includes identity, teleport, completion, provenance and history changes', () => {
  const before = applyCommand(state(), { type: 'complete-task', memberId: 'actor1', taskId: 'quest:cooks-assistant', completed: true }, { now: clock });
  before.members[0].sourceMapId = 'bbb';
  before.members[0].teleports = [{ id: 'home', label: 'Home', destination: '300', available: true, consumable: false },
    { id: 'spare', label: 'Spare', destination: '101', available: false, consumable: false }];
  before.provenance = { evidence: { url: 'synthetic', capturedAt: '2026-10-06' } };
  const after = structuredClone(before);
  after.members[0].name = 'Renamed';
  after.members[0].sourceMapId = 'different-map';
  after.members[0].completedTasks = [];
  after.members[0].teleports[0].available = false;
  after.members[0].teleports.splice(1, 1);
  after.members[0].teleports.push({ id: 'new', label: 'New', destination: '102', available: true, consumable: false });
  delete after.provenance.evidence.capturedAt;
  after.history = [];
  const preview = previewRestore(freeze(before), after);
  assert.equal(preview.members[0].identity.changed, true);
  assert.deepEqual(preview.members[0].identity.name, { before: 'Player', after: 'Renamed' });
  assert.deepEqual(preview.members[0].identity.sourceMapId, { before: 'bbb', after: 'different-map' });
  assert.deepEqual(preview.members[0].completedTasks.removed, ['quest:cooks-assistant']);
  assert.equal(preview.members[0].teleports.added[0].id, 'new');
  assert.equal(preview.members[0].teleports.removed[0].id, 'spare');
  assert.equal(preview.members[0].teleports.changed[0].id, 'home');
  assert.deepEqual(preview.provenance.removedPaths, ['provenance.evidence.capturedAt']);
  assert.deepEqual(preview.history.removed, ['revision-1']);
  for (const fragment of ['original map owner', 'personal task completions', 'saved teleports', 'provenance.evidence.capturedAt', 'History entries']) {
    assert.ok(preview.warnings.some(warning => warning.includes(fragment)));
  }
});

test('Roll1 unlocks immediately, removes saved selection and creates a stable history event', () => {
  const original = state();
  original.members[0].selected = ['101'];
  const changed = applyCommand(freeze(original), { type: 'roll', memberId: 'actor1', count: 1 }, { world: world(), random: () => 0, now: clock });
  assert.deepEqual(changed.members[0].unlocked, ['100', '101']);
  assert.deepEqual(changed.members[0].selected, []);
  assert.deepEqual(changed.members[0].pendingRoll, []);
  assert.deepEqual(changed.members[1], original.members[1]);
  assert.equal(changed.revision, 1);
  assert.deepEqual(changed.history[0], { id: 'revision-1', revision: 1, type: 'roll', at: clock(),
    command: { type: 'roll', memberId: 'actor1', count: 1, rolled: ['101'] }, undo: { memberChanges: [{ id: 'actor1', changes: [
      { path: ['unlocked'], kind: 'value', before: { exists: true, value: ['100'] }, after: { exists: true, value: ['100', '101'] } },
      { path: ['selected'], kind: 'value', before: { exists: true, value: ['101'] }, after: { exists: true, value: [] } },
    ] }] } });
  assert.deepEqual(original.members[0].unlocked, ['100']);
});


test('task completion is personal while group satisfaction remains computed', () => {
  const original = freeze(state());
  const complete = applyCommand(original, { type: 'complete-task', memberId: 'actor1', taskId: 'quest:cooks-assistant', completed: true }, { now: clock });
  assert.deepEqual(complete.members[0].completedTasks, ['quest:cooks-assistant']);
  assert.deepEqual(complete.members[1].completedTasks, []);
  assert.deepEqual(taskCompletion(complete, 'quest:cooks-assistant', 'reed'), {
    personal: false, group: true, completedBy: ['actor1'], requiredBy: ['actor1', 'reed'] });
  const undo = applyCommand(complete, { type: 'complete-task', memberId: 'actor1', taskId: 'quest:cooks-assistant', completed: false }, { now: clock });
  assert.deepEqual(undo.members[0].completedTasks, []);
  assert.throws(() => applyCommand(original, { type: 'complete-task', memberId: 'actor1', taskId: 'unknown', completed: true }), /Unknown task/);
  assert.deepEqual(original.members[0].completedTasks, []);
});


test('legacy importer preserves whitelisted gameplay without credentials or ambiguous completion migration', () => {
  const gameplay = { rules: { oldF2p: false }, chunkOrder: ['100', '101'], settings: { nested: { notes: 'Keep this', password: 'private' } },
    chunkinfo: { '100': { checked: { duplicate_task_id: true }, backlog: ['Do not drop'], notes: 'Need a hammer',
      credentials: { password: 'private' }, pin: 'private', pinCode: 'private', loginPin: 'private', accessToken: 'private' } },
    chunks: { unlocked: { '100': '100' }, selected: { '101': 4 }, potential: { '102': 1 }, blacklisted: { '300': true },
      stickeredNotes: { '100': 'Preserve sticker' } }, activeSubTabs: ['quests'], topbarSelection: 'tasks', manualPrimary: true,
    recentFancyRollTime: 123, password: 'private', arbitraryPrivateDocument: { private: true } };
  const fixture = freeze({ maps: { bbb: gameplay, aaa: { chunks: { unlocked: { '200': '200' }, selected: {} } } }, token: 'private' });
  const { state: imported, warnings } = importLegacyMaps(fixture, { members: owners.map((owner, index) => ({ ...owner, mapId: index ? 'aaa' : 'bbb' })), capturedAt: '2026-10-06' });
  assert.deepEqual(imported.members[0].unlocked, ['100']);
  assert.deepEqual(imported.members[0].selected, ['101']);
  assert.deepEqual(imported.members[0].pendingRoll, ['102']);
  assert.deepEqual(imported.members[0].blacklisted, ['300']);
  assert.equal(imported.members[0].sourceMapId, 'bbb');
  assert.deepEqual(imported.members.map(member => member.completedTasks), [[], []]);
  assert.deepEqual(imported.tasks, []);
  assert.deepEqual(imported.rules, {});
  assert.deepEqual(imported.legacy.maps.bbb.chunkinfo['100'], { checked: { duplicate_task_id: true }, backlog: ['Do not drop'], notes: 'Need a hammer' });
  assert.equal(imported.legacy.maps.bbb.chunks.stickeredNotes['100'], 'Preserve sticker');
  assert.deepEqual(imported.legacy.maps.bbb.settings, { nested: { notes: 'Keep this' } });
  assert.ok(!Object.hasOwn(imported.legacy.maps.bbb, 'arbitraryPrivateDocument'));
  assert.ok(warnings.some(warning => warning.includes('not added to personal')));
  assert.ok(warnings.some(warning => warning.includes('Excluded private account information')));
  assert.ok(warnings.some(warning => warning.includes('only one pending roll choice')));
  assert.deepEqual(importBackup(JSON.stringify(exportBackup(imported))), imported);
  assert.equal(fixture.maps.bbb.settings.nested.password, 'private');
});

test('legacy import requires explicit valid ownership and retains subsection records outside base topology', () => {
  const document = { maps: { map: { chunks: { unlocked: { '100': '100', '100-1': '100-1' }, selected: {} } } } };
  assert.throws(() => importLegacyMaps(document), /explicit map ownership/);
  assert.throws(() => importLegacyMaps(document, { members: [{ id: 'a', name: 'A', mapId: 'missing' }] }), /map missing/);
  const { state: imported, warnings } = importLegacyMaps(document, { members: [{ id: 'a', name: 'A', mapId: 'map' }] });
  assert.deepEqual(imported.members[0].unlocked, ['100']);
  assert.equal(imported.legacy.maps.map.chunks.unlocked['100-1'], '100-1');
  assert.ok(warnings.some(warning => warning.includes('subsection')));
});

test('legacy preservation includes real gameplay root fields and token labels while excluding exact credential keys', () => {
  const gameplay = {
    chunks: { unlocked: { '100': '100' }, selected: {} },
    rules: { Token: true, 'Dungeoneering token': false },
    recent: [{ Token: { amount: 20 }, 'Dungeoneering token': { checked: true } }],
    recentTime: 123,
    randomLoot: { 'Goblin token': { rolls: [1, 2] }, tokenObject: { token: 'game item', label: 'Token reward' } },
    chunkNotes: { '100': 'Keep token hunting notes' },
    userTasks: { 'Dungeoneering token': { label: 'Collect tokens', backlog: [{ Token: true }] } },
    friends: { aaa: { label: 'Reed' } }, friendsAlt: ['other-map'],
    chunkinfo: { '100': { 'Token': { checked: true }, backlog: { 'Goblin token': { checked: false } } } },
    settings: { password: 'secret-value-1', pin: 'secret-value-2', pin2: 'secret-value-3', pin3: 'secret-value-4',
      apiKey: 'secret-value-5', accessToken: 'secret-value-6', refreshToken: 'secret-value-7', authToken: 'secret-value-8',
      credentials: { token: 'secret-value-9' }, auth: { token: 'secret-value-10' }, theme: 'dark' },
    futureUnknown: { private: 'secret-value-11' },
  };
  const { state: imported, warnings } = importLegacyMaps(freeze({ maps: { map: gameplay } }), { members: [{ id: 'a', name: 'A', mapId: 'map' }] });
  const preserved = imported.legacy.maps.map;
  for (const key of ['rules', 'recent', 'recentTime', 'randomLoot', 'chunkNotes', 'userTasks', 'friends', 'friendsAlt', 'chunkinfo']) {
    assert.deepEqual(preserved[key], gameplay[key]);
  }
  assert.deepEqual(preserved.settings, { theme: 'dark' });
  assert.ok(warnings.some(warning => warning.includes('A’s original map entry futureUnknown') && warning.includes('not kept')));
  assert.ok(warnings.every(warning => !warning.includes('secret-value-')));
  assert.deepEqual(importBackup(JSON.stringify(exportBackup(imported))), imported);
});

test('chunk editing moves personal status, honors surface bounds and locks preserved unknown legacy IDs', () => {
  const original = state();
  const map = world(); map.surface = new Set(['100', '101', '102', '200']);
  const options = { world: map, now: clock };
  let edited = applyCommand(freeze(original), { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'selected' }, options);
  edited = applyCommand(edited, { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'blacklisted' }, options);
  assert.deepEqual(edited.members[0].selected, []); assert.deepEqual(edited.members[0].blacklisted, ['101']);
  edited = applyCommand(edited, { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'unlocked' }, options);
  assert.deepEqual(edited.members[0].blacklisted, []); assert.deepEqual(edited.members[0].unlocked, ['100', '101']);
  assert.deepEqual(edited.members[1], original.members[1]);
  assert.throws(() => applyCommand(edited, { type: 'set-chunk', memberId: 'actor1', chunkId: '300', status: 'selected' }, options), /surface/);
  assert.throws(() => applyCommand(edited, { type: 'set-chunk', memberId: 'actor1', chunkId: '999', status: 'locked' }, options), /surface/);
  const legacy = state(); legacy.members[0].selected = ['999'];
  assert.deepEqual(applyCommand(legacy, { type: 'set-chunk', memberId: 'actor1', chunkId: '999', status: 'locked' }, options).members[0].selected, []);
  assert.deepEqual(original, state());
});

test('pending choices are protected, cancellation restores candidates, and unlock both is atomic', () => {
  const original = state(); original.members[0].selected = ['101', '102'];
  const options = { world: world(), random: () => 0, now: clock };
  const pending = applyCommand(original, { type: 'roll', memberId: 'actor1', count: 2 }, options);
  assert.throws(() => applyCommand(pending, { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'locked' }, options), /pending roll/);
  const cancelled = applyCommand(pending, { type: 'cancel-roll', memberId: 'actor1' }, options);
  assert.deepEqual(cancelled.members[0].selected, ['101', '102']); assert.deepEqual(cancelled.members[0].pendingRoll, []);
  const both = applyCommand(pending, { type: 'unlock-both', memberId: 'actor1' }, options);
  assert.deepEqual(both.members[0].unlocked, ['100', '101', '102']); assert.deepEqual(both.members[0].pendingRoll, []);
  assert.deepEqual(pending.members[0].unlocked, ['100']);
  assert.throws(() => applyCommand(cancelled, { type: 'unlock-both', memberId: 'actor1' }, options), /two pending/);
});



test('notes, custom tasks, task statuses/rules and section overrides preserve independent member records and backups', () => {
  let current = state();
  const options = { world: world(), now: clock };
  const commands = [
    { type: 'set-note', memberId: 'actor1', chunkId: '101', note: 'Bring a hammer' },
    { type: 'add-task', task: { id: 'custom:hammer', label: 'Obtain hammer', category: 'custom' } },
    { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:hammer', favorite: true, backlogged: true, note: 'Bank first', challengeCompleted: true },
    { type: 'set-task-rule', memberId: 'actor1', ruleId: 'custom.requirement', value: 'group' },
    { type: 'set-section', memberId: 'actor1', sectionId: '101-0', accessible: true },
  ];
  for (const command of commands) current = applyCommand(current, command, options);
  assert.deepEqual(current.members[0].notes, { '101': 'Bring a hammer' });
  assert.deepEqual(current.members[0].taskStatus['custom:hammer'], { favorite: true, backlogged: true, note: 'Bank first', challengeCompleted: true });
  assert.deepEqual(current.members[0].completedTasks, []);
  assert.deepEqual(current.members[0].taskRules, { 'custom.requirement': 'group' });
  assert.deepEqual(current.members[0].sectionOverrides, { '101-0': true });
  assert.equal(current.members[1].notes, undefined);
  assert.deepEqual(importBackup(exportBackup(current)), current);
  current = applyCommand(current, { type: 'set-section', memberId: 'actor1', sectionId: '101-0', accessible: null }, options);
  assert.deepEqual(current.members[0].sectionOverrides, {});
  const badCommands = [
    { type: 'add-task', task: { id: 'broken', label: 'Broken', category: 'custom', extra: true } },
    { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:hammer' },
    { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:hammer', favorite: 1 },
    { type: 'set-task-rule', memberId: 'actor1', ruleId: 'bad', value: {} },
    { type: 'set-section', memberId: 'actor1', sectionId: '101-01', accessible: true },
    { type: 'set-section', memberId: 'actor1', sectionId: '101-1', accessible: 'yes' },
    { type: 'set-note', memberId: 'actor1', chunkId: '101', note: false },
  ];
  for (const command of badCommands) assert.throws(() => applyCommand(current, command, options));
});

test('teleport deletion is personal and reverses through undo', () => {
  const original = state(); original.members[0].teleports = [{ id: 'home', label: 'Home', destination: '300', available: true, consumable: false }];
  const deleted = applyCommand(original, { type: 'delete-teleport', memberId: 'actor1', teleportId: 'home' }, { now: clock });
  assert.deepEqual(deleted.members[0].teleports, []);
  assert.deepEqual(applyCommand(deleted, { type: 'undo' }, { now: clock }).members, original.members);
  assert.throws(() => applyCommand(deleted, { type: 'delete-teleport', memberId: 'actor1', teleportId: 'home' }), /Unknown teleport/);
});

test('undo walks backward across its own markers, restores exact optional fields, and keeps revision/history monotonic', () => {
  const original = state(); original.legacy = { maps: { map: { huge: 'Do not copy into events' } } };
  original.members[0].selected = ['101'];
  const options = { world: world(), random: () => 0, now: clock };
  const commands = [
    { type: 'add-task', task: { id: 'custom:new', label: 'Custom', category: 'custom' } },
    { type: 'set-task-status', memberId: 'actor1', taskId: 'custom:new', favorite: true },
    { type: 'complete-task', memberId: 'actor1', taskId: 'custom:new', completed: true },
    { type: 'roll', memberId: 'actor1', count: 1 },
    { type: 'set-rule', ruleId: 'access.shared', value: false },
  ];
  let current = original;
  for (const command of commands) current = applyCommand(current, command, options);
  assert.ok(current.history.every(event => !JSON.stringify(event.undo).includes('Do not copy')));
  for (let index = 0; index < commands.length; index++) current = applyCommand(current, { type: 'undo' }, options);
  assert.deepEqual(current.members, original.members); assert.deepEqual(current.rules, original.rules); assert.deepEqual(current.tasks, original.tasks);
  assert.equal(current.revision, 10); assert.equal(current.history.length, 10);
  assert.deepEqual(current.history.slice(0, 5).map(event => event.undoneRevision), [10, 9, 8, 7, 6]);
  assert.deepEqual(importBackup(exportBackup(current)), current);
  assert.throws(() => applyCommand(current, { type: 'undo' }, options), /No reversible/);
  assert.deepEqual(original.revision, 0);
});


test('restore previews expose losses in notes, challenge statuses, task rules and section overrides', () => {
  const before = state();
  before.members[0].notes = { '101': 'Do not lose' };
  before.members[0].taskStatus = { 'quest:cooks-assistant': { challengeCompleted: true, favorite: true } };
  before.members[0].taskRules = { requirement: 'group' };
  before.members[0].sectionOverrides = { '100-1': true };
  const after = structuredClone(before);
  delete after.members[0].notes;
  after.members[0].taskStatus['quest:cooks-assistant'].challengeCompleted = false;
  after.members[0].taskRules.requirement = 'personal';
  after.members[0].sectionOverrides['100-1'] = false;
  const preview = previewRestore(before, after);
  assert.deepEqual(preview.members[0].notes.removed, ['101']);
  assert.deepEqual(preview.members[0].taskStatus.changed, ['quest:cooks-assistant']);
  assert.deepEqual(preview.members[0].taskRules.changed, ['requirement']);
  assert.deepEqual(preview.members[0].sectionOverrides.changed, ['100-1']);
  for (const field of ['notes', 'task checks and backlog choices', 'task rules', 'section access choices']) assert.ok(preview.warnings.some(warning => warning.includes(field)));
});

test('legacy neighbor mode migration requires matching explicit member settings', () => {
  const options = { neighbors: true, walkableRollable: false, autoWalkableRollable: false };
  const document = { maps: { bbb: { chunks: { unlocked: { '100': true } }, settings: { chunkNeighboursOptions: options } }, aaa: { chunks: { unlocked: { '200': true } }, settings: { chunkNeighboursOptions: { ...options } } } } };
  const ownersWithMaps = owners.map((owner, index) => ({ ...owner, mapId: index ? 'aaa' : 'bbb' }));
  const imported = importLegacyMaps(document, { members: ownersWithMaps });
  assert.deepEqual(imported.state.rules, { 'roll.neighborMode': 'manual', 'roll.adjacent': true, 'roll.walkable': false, 'roll.clearSelected': false });
  document.maps.aaa.settings.chunkNeighboursOptions.autoWalkableRollable = true;
  const mixed = importLegacyMaps(document, { members: ownersWithMaps });
  assert.deepEqual(mixed.state.rules, {}); assert.ok(mixed.warnings.some(warning => warning.includes('differ between')));
  document.maps.bbb.settings.chunkNeighboursOptions.autoWalkableRollable = true;
  assert.equal(importLegacyMaps(document, { members: ownersWithMaps }).state.rules['roll.neighborMode'], 'accessible');
});

test('legacy neighbor remove setting migrates only when both member maps agree', () => {
  const options = { neighbors: true, walkableRollable: true, autoWalkableRollable: false, remove: true };
  const document = { maps: Object.fromEntries(['bbb', 'aaa'].map(mapId => [mapId, { chunks: {}, settings: { chunkNeighboursOptions: { ...options } } }])) };
  const ownersWithMaps = owners.map((owner, index) => ({ ...owner, mapId: index ? 'aaa' : 'bbb' }));
  const before = structuredClone(document);
  const imported = importLegacyMaps(freeze(document), { members: ownersWithMaps });
  assert.equal(imported.state.rules['roll.clearSelected'], true);
  assert.equal(imported.state.legacy.maps.bbb.settings.chunkNeighboursOptions.remove, true);
  assert.deepEqual(importBackup(exportBackup(imported.state)), imported.state);
  assert.deepEqual(document, before);
  const mixed = structuredClone(document); mixed.maps.aaa.settings.chunkNeighboursOptions.remove = false;
  const reviewed = importLegacyMaps(mixed, { members: ownersWithMaps });
  assert.deepEqual(reviewed.state.rules, {});
  assert.ok(reviewed.warnings.some(warning => warning.includes('differ between') && warning.includes('selected candidates are cleared')));
  delete mixed.maps.aaa.settings.chunkNeighboursOptions.remove;
  assert.deepEqual(importLegacyMaps(mixed, { members: ownersWithMaps }).state.rules, {});
  mixed.maps.bbb.settings.chunkNeighboursOptions.remove = false;
  assert.equal(importLegacyMaps(mixed, { members: ownersWithMaps }).state.rules['roll.clearSelected'], false);
  mixed.maps.aaa.settings.chunkNeighboursOptions.remove = 'true';
  assert.deepEqual(importLegacyMaps(mixed, { members: ownersWithMaps }).state.rules, {}, 'Invalid imported flags must not silently become a boolean rule');
});


test('source backlogs retain explicit false overrides, personal ownership, undo and backup round trips', () => {
  const original = state(); original.legacy = { maps: { map: { chunkinfo: { backloggedSources: { objects: { Furnace: true } } } } } };
  const before = structuredClone(original);
  const kinds = ['objects', 'npcs', 'monsters', 'shops', 'spawns', 'items'];
  let current = original;
  for (const kind of kinds) current = applyCommand(current, { type: 'set-source-backlog', memberId: 'actor1', kind, name: 'Furnace', backlogged: true }, { now: clock });
  const unmasked = applyCommand(current, { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: 'Furnace', backlogged: false }, { now: clock });
  assert.equal(unmasked.members[0].sourceBacklogs.objects.Furnace, false);
  assert.equal(unmasked.members[0].sourceBacklogs.items.Furnace, true);
  assert.equal(unmasked.members[1].sourceBacklogs, undefined);
  assert.deepEqual(importBackup(exportBackup(unmasked)), unmasked);
  const undone = applyCommand(unmasked, { type: 'undo' }, { now: clock });
  assert.deepEqual(undone.members, current.members);
  assert.equal(undone.members[0].sourceBacklogs.objects.Furnace, true);
  assert.deepEqual(original, before);
  assert.deepEqual(unmasked.legacy, original.legacy);
});

test('area overrides retain true/false, clear with null, and undo restores absence exactly', () => {
  const original = state();
  const entered = applyCommand(original, { type: 'set-area', memberId: 'actor1', areaId: 'Dwarven Mine', accessible: true }, { now: clock });
  const blocked = applyCommand(entered, { type: 'set-area', memberId: 'actor1', areaId: 'Dwarven Mine', accessible: false }, { now: clock });
  assert.deepEqual(blocked.members[0].areaOverrides, { 'Dwarven Mine': false });
  const cleared = applyCommand(blocked, { type: 'set-area', memberId: 'actor1', areaId: 'Dwarven Mine', accessible: null }, { now: clock });
  assert.deepEqual(cleared.members[0].areaOverrides, {});
  assert.deepEqual(applyCommand(cleared, { type: 'undo' }, { now: clock }).members, blocked.members);
  assert.deepEqual(applyCommand(entered, { type: 'undo' }, { now: clock }).members, original.members);
  assert.deepEqual(importBackup(exportBackup(blocked)), blocked);
});

test('source/area commands and restored shapes reject invalid kinds, flags, names and extra fields', () => {
  const original = state();
  const commands = [
    { type: 'set-source-backlog', memberId: 'actor1', kind: 'Objects', name: 'Tree', backlogged: true },
    { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: '', backlogged: true },
    { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: 'Tree', backlogged: null },
    { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: 'Tree', backlogged: false, extra: true },
    { type: 'set-area', memberId: 'actor1', areaId: '', accessible: true },
    { type: 'set-area', memberId: 'actor1', areaId: 'Mine', accessible: 'true' },
  ];
  for (const command of commands) assert.throws(() => applyCommand(original, command, { now: () => { throw Error('Clock must not run'); } }));
  for (const mutate of [
    state => { state.members[0].sourceBacklogs = { invalid: { Tree: true } }; },
    state => { state.members[0].sourceBacklogs = { objects: { Tree: 1 } }; },
    state => { state.members[0].sourceBacklogs = { objects: { ' ': true } }; },
    state => { state.members[0].sourceBacklogs = { objects: [] }; },
    state => { state.members[0].areaOverrides = { Mine: null }; },
  ]) {
    const bad = structuredClone(original); mutate(bad); assert.throws(() => validateState(bad));
  }
  assert.deepEqual(original, state());
});

test('member-only undo keeps old completion and status task references from historical catalogue records', () => {
  const original = state();
  const task = original.tasks[0];
  original.members[0].completedTasks = [task.id];
  original.members[0].taskStatus = { [task.id]: { challengeCompleted: true, favorite: true } };
  const changed = applyCommand(original, { type: 'set-note', memberId: 'actor1', chunkId: '101', note: 'Later note' }, { world: world(), now: clock });
  // Explicitly exercise backups written by the older full-snapshot format.
  changed.history[0].undo = { members: [structuredClone(original.members[0])] };
  // A later restored catalogue can remove a task while older undo snapshots
  // retain references. Either preserved undo catalogues or add-task records
  // provide the historical metadata needed to validate those snapshots.
  for (const historical of [
    { type: 'catalogue-restore', undo: { tasks: [task] } },
    { type: 'add-task', command: { type: 'add-task', task } },
  ]) {
    const restored = structuredClone(changed);
    restored.tasks = []; restored.members[0].completedTasks = []; delete restored.members[0].taskStatus;
    restored.revision = 2;
    restored.history.push({ id: 'revision-2', revision: 2, at: clock(), ...historical });
    const before = structuredClone(restored);
    assert.deepEqual(validateState(restored), before);
    assert.deepEqual(restored, before);
    if (historical.undo) {
      const catalogue = applyCommand(restored, { type: 'undo' }, { now: clock });
      const member = applyCommand(catalogue, { type: 'undo' }, { now: clock });
      assert.deepEqual(member.members[0].completedTasks, [task.id]);
      assert.deepEqual(member.members[0].taskStatus, original.members[0].taskStatus);
    }
  }
});

test('minimal undo validation rejects unknown task refs and malformed unreferenced historical task metadata', () => {
  const base = applyCommand(state(), { type: 'set-note', memberId: 'actor1', chunkId: '101', note: 'Later note' }, { world: world(), now: clock });
  base.history[0].undo = { members: [structuredClone(state().members[0])] };
  const mutations = [
    value => { value.history[0].undo.members[0].completedTasks = ['missing']; },
    value => { value.history[0].undo.members[0].taskStatus = { missing: { favorite: true } }; },
    value => { value.history[0].undo.tasks = [{ id: 'unused', label: 'Unused' }]; },
    value => { value.history[0].command = { type: 'add-task', task: { id: 'unused', label: 'Unused', category: 'custom', extra: true } }; },
    value => { value.history[0].command = { type: 'add-task', task: { id: 'unused', label: '', category: 'custom' } }; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(base); mutate(invalid);
    const before = structuredClone(invalid);
    assert.throws(() => validateState(invalid));
    assert.deepEqual(invalid, before);
  }
});

test('large catalogues with member-only undo history round trip without reducing catalogue or history', () => {
  const current = state();
  current.tasks.push(...Array.from({ length: 2000 }, (_, index) => ({ id: `generated:${index}`, label: `Task ${index}`, category: 'custom' })));
  const snapshot = structuredClone(current.members[0]);
  snapshot.completedTasks = ['generated:17']; snapshot.taskStatus = { 'generated:23': { favorite: true } };
  current.revision = 20;
  current.history = Array.from({ length: 20 }, (_, index) => ({ id: `revision-${index + 1}`, revision: index + 1, type: 'set-note', at: clock(), undo: { members: [structuredClone(snapshot)] } }));
  const before = structuredClone(current);
  assert.deepEqual(importBackup(exportBackup(current)), before);
  assert.equal(current.tasks.length, 2001); assert.equal(current.history.length, 20);
  assert.deepEqual(current, before);
});


test('sparse dictionaries record only changed entries and literal names with punctuation', () => {
  const original = state();
  original.tasks.push({ id: 'custom:untouched', label: 'Untouched', category: 'custom' });
  original.members[0].taskStatus = { [original.tasks[0].id]: { challengeCompleted: false, note: 'Keep' }, 'custom:untouched': { favorite: true } };
  const checked = applyCommand(original, { type: 'set-task-status', memberId: 'actor1', taskId: original.tasks[0].id, challengeCompleted: true }, { now: clock });
  const delta = checked.history[0].undo.memberChanges[0];
  assert.equal(delta.changes.length, 1);
  assert.deepEqual(delta.changes[0].path, ['taskStatus', original.tasks[0].id]);
  assert.ok(!JSON.stringify(delta).includes('custom:untouched'));
  const backlogged = applyCommand(checked, { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: 'Furnace.mine[0]', backlogged: false }, { now: clock });
  assert.deepEqual(backlogged.history[1].undo.memberChanges[0].changes.map(patch => patch.path), [
    ['sourceBacklogs'], ['sourceBacklogs', 'objects'], ['sourceBacklogs', 'objects', 'Furnace.mine[0]'],
  ]);
  assert.deepEqual(applyCommand(backlogged, { type: 'undo' }, { now: clock }).members, checked.members);
});

test('sparse catalogue undo retains only new rows and restores catalogue ordering', () => {
  const original = state();
  original.tasks.push(...Array.from({ length: 2000 }, (_, index) => ({ id: `generated:${index}`, label: `Task ${index}`, category: 'custom' })));
  const added = applyCommand(original, { type: 'add-task', task: { id: 'custom:new', label: 'New', category: 'custom' } }, { now: clock });
  assert.equal(added.history[0].undo.tasks, undefined);
  assert.deepEqual(added.history[0].undo.taskChanges, [{ id: 'custom:new', before: { exists: false }, after: { exists: true, value: added.tasks.at(-1), index: 2001 } }]);
  assert.ok(Buffer.byteLength(JSON.stringify(added.history[0].undo)) < 300);
  const removed = applyCommand(added, { type: 'undo' }, { now: clock });
  assert.deepEqual(removed.tasks, original.tasks);
  const changed = structuredClone(original);
  changed.tasks[0] = { ...changed.tasks[0], label: 'Renamed' };
  const deleted = changed.tasks.splice(2, 1)[0];
  changed.revision = 1;
  changed.history = [{ id: 'revision-1', revision: 1, type: 'catalogue-edit', at: clock(), undo: { taskChanges: [
    { id: original.tasks[0].id, before: { exists: true, value: original.tasks[0], index: 0 }, after: { exists: true, value: changed.tasks[0], index: 0 } },
    { id: deleted.id, before: { exists: true, value: deleted, index: 2 }, after: { exists: false } },
  ] } }];
  assert.deepEqual(applyCommand(changed, { type: 'undo' }, { now: clock }).tasks, original.tasks);
});

test('large sparse catalogue deltas restore mixed rows without repeated catalogue scans or insertion shifts', () => {
  const count = 6000, original = createGroupState(owners);
  const preceding = Array.from({ length: count }, (_, index) => ({ id: `synthetic-delta:${index}`, label: `Before ${index}`, category: 'custom' }));
  original.tasks = preceding.filter((_, index) => index % 3 !== 0).map((row, index) => ({ ...row, label: index % 2 === 0 ? `${row.label} renamed` : row.label }));
  original.tasks.push(...Array.from({ length: 1000 }, (_, index) => ({ id: `synthetic-delta:new:${index}`, label: `Added ${index}`, category: 'custom' })));
  const after = new Map(original.tasks.map((value, index) => [value.id, { exists: true, value, index }]));
  const changes = preceding.flatMap((value, index) => {
    const current = after.get(value.id) ?? { exists: false };
    return !current.exists || current.value.label !== value.label
      ? [{ id: value.id, before: { exists: true, value, index }, after: current }] : [];
  });
  for (const row of original.tasks.slice(-1000)) changes.push({ id: row.id, before: { exists: false }, after: after.get(row.id) });
  original.revision = 1;
  original.history = JSON.parse(JSON.stringify([{ id: 'revision-1', revision: 1, type: 'catalogue-refresh', at: clock(), undo: { taskChanges: changes } }]));
  const snapshot = structuredClone(original), findIndex = Array.prototype.findIndex, splice = Array.prototype.splice;
  let catalogueVisits = 0, shiftedRows = 0;
  const catalogue = rows => rows[0]?.id?.startsWith('synthetic-delta:');
  Array.prototype.findIndex = function (predicate, thisArg) {
    if (!catalogue(this)) return findIndex.call(this, predicate, thisArg);
    return findIndex.call(this, (value, index, rows) => {
      assert(++catalogueVisits <= count * 4, 'Sparse replay repeatedly scans the entire catalogue');
      return predicate.call(thisArg, value, index, rows);
    });
  };
  Array.prototype.splice = function (...args) {
    if (catalogue(this)) {
      shiftedRows += this.length - args[0];
      assert(shiftedRows <= count * 4, 'Sparse replay repeatedly shifts the remaining catalogue');
    }
    return splice.apply(this, args);
  };
  try {
    const changed = applyCommand(freeze(original), { type: 'set-preference', memberId: 'actor1', preferenceId: 'completedTaskColor', value: '#abcdef' }, { now: clock });
    const noteUndone = applyCommand(changed, { type: 'undo' }, { now: clock });
    const catalogueUndone = applyCommand(noteUndone, { type: 'undo' }, { now: clock });
    assert.deepEqual(catalogueUndone.tasks, preceding);
    assert.notEqual(catalogueUndone.tasks[0], catalogueUndone.history[0].undo.taskChanges[0].before.value, 'Restored rows must remain isolated from historical guards');
    assert.deepEqual(original, snapshot, 'Command validation and undo must leave input history and rows unchanged');
  } finally {
    Array.prototype.findIndex = findIndex;
    Array.prototype.splice = splice;
  }
  const stale = structuredClone(snapshot);
  stale.tasks[0].label = 'Changed after the delta';
  assert.throws(() => validateState(stale), /Stale undo: task catalogue has changed/);
  const outside = structuredClone(snapshot);
  outside.history[0].undo.taskChanges[0].before.index = count * 3;
  assert.throws(() => validateState(outside), /outside its bounds/);
});

test('private validated commands match the public boundary across aliases, registration, clears and undo', () => {
  const goal = { id: 'rs3:task:synthetic-trusted-goal', label: 'Trusted goal', category: 'custom', rawLabel: 'Trusted goal', aliases: ['synthetic-old-goal'], kind: 'task' };
  let ordinary = state();
  ordinary.identityRegistry = { schemaVersion: 1, entries: { [goal.id]: goal }, aliases: { 'synthetic-old-goal': goal.id }, unresolved: [] };
  ordinary.legacy = { maps: { historical: { rules: { 'Rare Drop Amount': 'preserved invalid cutoff' } } } };
  ordinary.provenance = { archives: [{ exact: 'Unchanged historical evidence' }] };
  ordinary.members[0].taskRules = { 'Rare Drop Amount': 'banana' };
  ordinary = validateState(ordinary);
  let privateState = structuredClone(ordinary);
  const options = { now: clock, world: world(), taskCatalogue: new Map([[goal.id, goal]]) };
  const commands = [
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'completedTaskColor', value: '#abcdef' },
    { type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Checked route' },
    { type: 'set-chunk', memberId: 'actor1', chunkId: '101', status: 'selected' },
    { type: 'set-task-status', memberId: 'actor1', taskId: 'synthetic-old-goal', favorite: true, note: 'Keep me' },
    { type: 'complete-task', memberId: 'actor1', taskId: goal.id, completed: true },
    { type: 'complete-task', memberId: 'actor1', taskId: goal.id, completed: false },
    { type: 'set-task-alternative', memberId: 'actor1', category: 'custom', group: 'route', taskId: goal.id },
    { type: 'set-task-alternative', memberId: 'actor1', category: 'custom', group: 'route', taskId: null },
    { type: 'set-task-rule', memberId: 'actor1', ruleId: 'Rare Drop Amount', value: '16' },
    { type: 'set-task-rule', memberId: 'actor1', ruleId: 'Synthetic unknown rule', value: false },
    { type: 'reset-task-rule', memberId: 'actor1', ruleId: 'Synthetic unknown rule' },
    { type: 'add-task', task: { id: 'custom:trusted-new', label: 'New custom task', category: 'custom' } },
    { type: 'undo' },
  ];
  for (const command of commands) {
    const input = privateState, snapshot = JSON.stringify(input);
    ordinary = applyCommand(ordinary, command, options);
    privateState = applyValidatedCommand(freeze(input), command, options);
    assert.deepEqual(privateState, ordinary, command.type);
    assert.equal(JSON.stringify(input), snapshot, `${command.type} changed its private input`);
    if (command.type !== 'undo') assert.equal(privateState.legacy, input.legacy);
    if (!['set-task-status', 'add-task', 'undo'].includes(command.type)) {
      assert.equal(privateState.tasks, input.tasks);
      assert.equal(privateState.identityRegistry, input.identityRegistry);
    }
  }
  const before = JSON.stringify(privateState);
  for (const command of [
    { type: 'set-task-status', memberId: 'actor1', taskId: goal.id, favorite: 'yes' },
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'unknown', value: true },
    { type: 'add-task', task: { id: 'custom:malformed', label: 'Missing category' } },
    { type: 'set-task-rule', memberId: 'actor1', ruleId: '__proto__', value: true },
    { type: 'set-rule', ruleId: 'content.f2p', value: true, typo: true },
  ]) assert.throws(() => applyValidatedCommand(privateState, command, options), TypeError);
  assert.equal(JSON.stringify(privateState), before);
});

test('private commands leave already validated registry and archival trees unscanned', () => {
  let original = state();
  original.identityRegistry = { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
  original.legacy = { maps: {} };
  original.provenance = { archives: [{ exact: 'Historical evidence' }] };
  original = validateState(original);
  const protectedTrees = new Set([original.identityRegistry.entries, original.identityRegistry.aliases, original.legacy, original.provenance.archives[0]]);
  const entries = Object.entries;
  Object.entries = value => {
    assert(!protectedTrees.has(value), 'Private command traversed unchanged identity or archival evidence');
    return entries(value);
  };
  let changed;
  try { changed = applyValidatedCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'completedTaskColor', value: '#abcdef' }, { now: clock }); }
  finally { Object.entries = entries; }
  assert.equal(changed.identityRegistry, original.identityRegistry);
  assert.equal(changed.legacy, original.legacy);
  assert.equal(changed.provenance.archives, original.provenance.archives);
  assert.equal(changed.provenance, original.provenance);
  assert.deepEqual(changed, applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'completedTaskColor', value: '#abcdef' }, { now: clock }));
});

test('sparse history rejects malformed paths, unknown references, stale values and catalogue rows without mutation', () => {
  const base = applyCommand(state(), { type: 'set-task-status', memberId: 'actor1', taskId: state().tasks[0].id, challengeCompleted: true }, { now: clock });
  const mutations = [
    value => { value.history[0].undo.memberChanges[0].id = 'missing'; },
    value => { value.history[0].undo.memberChanges[0].changes[1].path[1] = 'missing-task'; },
    value => { value.history[0].undo.memberChanges[0].changes[1].path = ['name']; },
    value => { value.history[0].undo.memberChanges[0].changes[1].path = ['taskRules', '__proto__']; },
    value => { value.history[0].undo.memberChanges[0].changes[1].path = ['taskRules', 'constructor']; },
    value => { value.history[0].undo.memberChanges[0].changes[1].path = ['sourceBacklogs', 'prototype', 'Furnace']; },
    value => { value.history[0].undo.memberChanges[0].changes[1].after.extra = true; },
    value => { value.history[0].undo.memberChanges[0].changes[1].after.value.challengeCompleted = 'true'; },
    value => { value.history[0].undo.memberChanges[0].changes[1].kind = 'script'; },
    value => { value.history[0].undo.memberChanges[0].changes.push(structuredClone(value.history[0].undo.memberChanges[0].changes[1])); },
    value => { value.history[0].undo.memberChanges[0].changes[1].before = { exists: true, value: { favorite: true } }; },
    value => { value.members[0].taskStatus[value.tasks[0].id].challengeCompleted = false; },
    value => { value.history[0].undo.members = [structuredClone(value.members[0])]; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(base); mutate(invalid); const before = structuredClone(invalid);
    assert.throws(() => validateState(invalid));
    assert.throws(() => applyCommand(invalid, { type: 'undo' }, { now: clock }));
    assert.deepEqual(invalid, before);
  }
  const added = applyCommand(state(), { type: 'add-task', task: { id: 'custom:new', label: 'New', category: 'custom' } }, { now: clock });
  for (const mutate of [
    value => { value.history[0].undo.taskChanges[0].after.value.id = 'wrong'; },
    value => { value.history[0].undo.taskChanges[0].after.value.extra = true; },
    value => { value.history[0].undo.taskChanges[0].after.index = -1; },
    value => { value.history[0].undo.taskChanges[0].before = { exists: false, index: 1 }; },
    value => { value.history[0].undo.taskChanges[0].after.index = 999; },
    value => { value.tasks.at(-1).label = 'Changed after delta'; },
    value => { value.tasks.pop(); },
  ]) {
    const invalid = structuredClone(added); mutate(invalid);
    assert.throws(() => validateState(invalid));
  }
  assert.equal(Object.prototype.challengeCompleted, undefined);
});

test('one thousand challenge checks keep complete history and catalogue with small backup growth', () => {
  const original = state();
  original.tasks.push(...Array.from({ length: 23925 }, (_, index) => ({ id: `generated:${index}`, label: `Task ${index}`, category: 'custom' })));
  original.members[0].taskStatus = Object.fromEntries(original.tasks.slice(0, 545).map(task => [task.id, { challengeCompleted: false, favorite: true }]));
  const command = { type: 'set-task-status', memberId: 'actor1', taskId: original.tasks[0].id, challengeCompleted: true };
  const checked = applyCommand(original, command, { now: clock });
  const unchecked = applyCommand(checked, { ...command, challengeCompleted: false }, { now: clock });
  // Repeat the two real, reversible events to model 1000 alternating checks
  // without making the test benchmark quadratic command processing itself.
  const projected = structuredClone(unchecked);
  projected.revision = 1000;
  projected.history = Array.from({ length: 1000 }, (_, index) => ({ ...structuredClone(unchecked.history[index % 2]), id: `revision-${index + 1}`, revision: index + 1 }));
  const bytes = value => Buffer.byteLength(JSON.stringify(value, null, 2));
  const beforeBytes = bytes(exportBackup(original));
  const restored = importBackup(exportBackup(projected));
  assert.equal(restored.history.length, 1000);
  assert.equal(restored.tasks.length, original.tasks.length);
  assert.deepEqual(restored.members, original.members);
  assert.ok(bytes(exportBackup(projected)) - beforeBytes < 2 * 1024 * 1024, '1000 checks should grow the portable backup by less than 2 MiB');
  assert.ok(bytes(exportBackup(projected)) < 32 * 1024 * 1024);
  assert.equal(applyCommand(projected, { type: 'undo' }, { now: clock }).members[0].taskStatus[command.taskId].challengeCompleted, true);
});

test('sparse undo cannot introduce a future-only task into an earlier revision', () => {
  const area = applyCommand(state(), { type: 'set-area', memberId: 'actor1', areaId: 'Cave', accessible: true }, { now: clock });
  const added = applyCommand(area, { type: 'add-task', task: { id: 'future', label: 'Future task', category: 'custom' } }, { now: clock });
  added.history[0].undo.memberChanges[0].changes.push({ path: ['completedTasks'], kind: 'value', before: { exists: true, value: ['future'] }, after: { exists: true, value: [] } });
  assert.throws(() => validateState(added), /historical revision/);
  assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: added }), /historical revision/);
});

test('sparse catalogue history cannot give different rows the same historical index', () => {
  const current = state();
  current.tasks.push({ id: 'custom:b', label: 'B', category: 'custom' });
  current.revision = 1;
  current.history = [{ id: 'revision-1', revision: 1, type: 'catalogue-edit', at: clock(), undo: { taskChanges: current.tasks.map((task, index) => ({
    id: task.id, before: { exists: true, value: { ...task, label: `Before ${index}` }, index: 0 }, after: { exists: true, value: task, index },
  })) } }];
  assert.throws(() => validateState(current), /Duplicate undo task index/);
  assert.throws(() => applyCommand(current, { type: 'undo' }, { now: clock }), /Duplicate undo task index/);
  current.history[0].undo.taskChanges[1].before.index = 1;
  current.history[0].undo.taskChanges[1].after.index = 0;
  assert.throws(() => validateState(current), /Duplicate undo task index/);
});


test('preference overrides are personal, sparse and preserve legacy fallbacks through backup and undo', () => {
  const original = state();
  original.legacy = { maps: { bbb: { settings: { theme: 'light', ids: false, completedTaskColor: '#0D8219' } } } };
  original.members[0].sourceMapId = 'bbb';
  original.members[0].preferences = { ids: true };
  const changed = applyCommand(freeze(original), { type: 'set-preference', memberId: 'actor1', preferenceId: 'completedTaskColor', value: '#aBc123' }, { now: clock });
  assert.deepEqual(changed.members[0].preferences, { ids: true, completedTaskColor: '#aBc123' });
  assert.deepEqual(changed.members[1], original.members[1]);
  assert.deepEqual(changed.legacy, original.legacy);
  assert.deepEqual(changed.rules, original.rules);
  assert.deepEqual(changed.history[0].undo.memberChanges[0].changes, [{ path: ['preferences', 'completedTaskColor'], kind: 'value', before: { exists: false }, after: { exists: true, value: '#aBc123' } }]);
  assert.deepEqual(applyCommand(importBackup(exportBackup(changed)), { type: 'undo' }, { now: clock }).members, original.members);
  const imported = importLegacyMaps({ maps: { bbb: { chunks: { unlocked: ['100'] }, settings: { theme: 'dark', ids: true } } } }, { members: [{ ...owners[0], mapId: 'bbb' }], capturedAt: clock() }).state;
  assert.equal(imported.members[0].preferences, undefined);
  assert.deepEqual(imported.legacy.maps.bbb.settings, { theme: 'dark', ids: true });
});

test('unknown, unsafe or wrongly typed preferences reject commands and restores without mutation', () => {
  const original = state();
  const invalid = [
    ['theme', 'sepia'], ['theme', true], ['theme', null],
    ['defaultChunkinfo', 'items'], ['ids', 'true'], ['hideChecked', 1],
    ['completedTaskColor', 'red'], ['defaultStickerColor', '#fff'],
    ['unlockedBorderColor', '#12345678'], ['completedTaskColor', '#12345G'],
    ['startingChunk', 12341], ['startingChunk', null],
    ['chunkNeighboursOptions', { neighbors: true }], ['unknown', false],
    ['__proto__', true], ['constructor', true], ['prototype', true], ['', true],
  ];
  for (const [preferenceId, value] of invalid) {
    assert.throws(() => validatePreference(preferenceId, value), TypeError);
    assert.throws(() => applyCommand(freeze(original), { type: 'set-preference', memberId: 'actor1', preferenceId, value }, { now: () => { throw Error('Clock must not run'); } }), TypeError);
    const corrupt = structuredClone(original);
    corrupt.members[0].preferences = Object.fromEntries([[preferenceId, value]]);
    const before = structuredClone(corrupt);
    assert.throws(() => validateState(corrupt), TypeError);
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: corrupt }), TypeError);
    assert.throws(() => previewRestore(original, corrupt), TypeError);
    assert.deepEqual(corrupt, before);
  }
  for (const preferences of [null, [], true]) {
    const corrupt = structuredClone(original); corrupt.members[0].preferences = preferences;
    assert.throws(() => validateState(corrupt));
  }
  for (const payload of [
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'ids' },
    { type: 'set-preference', memberId: 'missing', preferenceId: 'ids', value: true },
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: true, extra: true },
  ]) assert.throws(() => applyCommand(original, payload, { now: () => { throw Error('Clock must not run'); } }), TypeError);
  assert.deepEqual(original, state());
  assert.equal(Object.prototype.ids, undefined);
});


test('restore previews expose added, changed and removed preference overrides', () => {
  const before = state(); before.members[0].preferences = { theme: 'dark', hideChecked: true };
  const after = structuredClone(before); after.members[0].preferences = { theme: 'light', ids: true };
  const preview = previewRestore(freeze(before), exportBackup(freeze(after)));
  assert.deepEqual(preview.members[0].preferences, { added: ['ids'], removed: ['hideChecked'], changed: ['theme'] });
  assert.ok(preview.warnings.some(warning => warning.includes('settings for Player')));
  assert.deepEqual(preview.members[1].preferences, { added: [], removed: [], changed: [] });
  assert.equal(previewRestore(before, before).warnings.length, 0);
});

test('unpick forfeits only one personal ownership record and preserves game progress and shared co-ownership', () => {
  const original = state();
  original.members[0].unlocked = ['100', '101'];
  original.members[1].unlocked = ['100', '200'];
  original.members[0].selected = ['102'];
  original.members[0].completedTasks = [original.tasks[0].id];
  original.members[0].notes = { '100': 'Keep personal note', '101': 'Keep another note' };
  original.members[0].taskStatus = { [original.tasks[0].id]: { challengeCompleted: true } };
  original.members[0].sectionOverrides = { '100-1': true, '101-1': true };
  original.members[0].preferences = { theme: 'dark' };
  const changed = applyCommand(freeze(original), { type: 'unpick', memberId: 'actor1' }, { random: () => 0, now: clock });
  assert.deepEqual(changed.members[0], { ...original.members[0], unlocked: ['101'], selected: ['102', '100'] });
  assert.deepEqual(changed.members[1], original.members[1]);
  assert.equal(changed.history[0].command.unpicked, '100');
  assert.deepEqual(changed.history[0].undo.memberChanges[0].changes.map(patch => patch.path), [['unlocked'], ['selected']]);
  assert.deepEqual(applyCommand(importBackup(exportBackup(changed)), { type: 'undo' }, { now: clock }).members, original.members);
  const last = applyCommand(original, { type: 'unpick', memberId: 'actor1' }, { random: () => 0.999, now: clock });
  assert.equal(last.history[0].command.unpicked, '101');
});

test('unpick rejects empty ownership, pending choices, unknown owners and invalid randomness atomically', () => {
  for (const prepare of [
    value => { value.members[0].unlocked = []; },
    value => { value.members[0].pendingRoll = ['101', '102']; },
  ]) {
    const original = state(); prepare(original); const before = structuredClone(original);
    assert.throws(() => applyCommand(original, { type: 'unpick', memberId: 'actor1' }, { random: () => { throw Error('Must not draw'); }, now: () => { throw Error('Must not timestamp'); } }), TypeError);
    assert.deepEqual(original, before);
  }
  const original = state();
  assert.throws(() => applyCommand(original, { type: 'unpick', memberId: 'missing' }, { random: () => 0, now: clock }), /Unknown member/);
  assert.throws(() => applyCommand(original, { type: 'unpick', memberId: 'actor1', count: 1 }, { random: () => 0, now: clock }), /Unknown command field/);
  for (const random of [() => 1, () => -1, () => NaN, () => '0', false]) {
    assert.throws(() => applyCommand(original, { type: 'unpick', memberId: 'actor1' }, { random, now: clock }));
    assert.deepEqual(original, state());
  }
});


test('random start validates counts and pool size before draws and ignores shared task access for ownership', () => {
  const original = state(); const map = world();
  const quiet = { world: map, random: () => { throw Error('Must not draw'); }, now: () => { throw Error('Must not timestamp'); } };
  for (const count of [0, 3, 1.5, null, true, '2']) assert.throws(() => applyCommand(original, { type: 'random-start', memberId: 'actor1', count }, quiet), /count must be 1 or 2/);
  assert.throws(() => applyCommand(original, { type: 'random-start', memberId: 'actor1' }, { now: clock }), /world is required/);
  const blocked = structuredClone(original); blocked.members[0].pendingRoll = ['101', '102'];
  assert.throws(() => applyCommand(blocked, { type: 'random-start', memberId: 'actor1', count: 2 }, quiet), /pending roll/);
  const one = world(['100', '101']);
  assert.throws(() => applyCommand(original, { type: 'random-start', memberId: 'actor1', count: 2 }, { ...quiet, world: one }), /Roll count/);
  const personal = structuredClone(original); personal.rules['access.shared'] = false;
  const pool = world(['100', '200', '300']);
  const widened = applyCommand(personal, { type: 'random-start', memberId: 'actor1', count: 2 }, { world: pool, random: () => 0, now: clock });
  assert.deepEqual(widened.members[0].pendingRoll, ['200', '300']);
  assert.deepEqual(widened.members[1], personal.members[1]);
  const shared = applyCommand(original, { type: 'random-start', memberId: 'actor1' }, { world: pool, random: () => 0, now: clock });
  assert.deepEqual(shared.history[0].command.rolled, ['200']);
  assert.deepEqual(original, state());
});

test('clearSelected clears only the rolling owner after actual unlock and cancellation retains all choices', () => {
  const original = state(); original.rules['roll.clearSelected'] = true;
  original.members[0].selected = ['101', '102', '300']; original.members[1].selected = ['101', '102'];
  const map = world(); map.sectionTopology = new Map(['101', '102', '300'].map(id => [id, new Map([['1', []]])]));
  const options = { world: map, random: () => 0, now: clock };
  for (const type of ['roll', 'random-start']) {
    const one = applyCommand(freeze(original), { type, memberId: 'actor1', count: 1 }, options);
    assert.deepEqual(one.members[0].selected, []);
    assert.deepEqual(one.members[1], original.members[1]);
    assert.deepEqual(applyCommand(importBackup(exportBackup(one)), { type: 'undo' }, options).members, original.members);
    const pending = applyCommand(original, { type, memberId: 'actor1', count: 2 }, options);
    assert.deepEqual(pending.members[0].selected, ['300']);
    const cancelled = applyCommand(pending, { type: 'cancel-roll', memberId: 'actor1' }, options);
    assert.deepEqual(cancelled.members[0].selected, ['300', '101', '102']);
    assert.deepEqual(cancelled.members[1], original.members[1]);
    assert.deepEqual(applyCommand(cancelled, { type: 'undo' }, options).members, pending.members);
    for (const command of [
      { type: 'unlock-selection', memberId: 'actor1', chunkId: '101' },
      { type: 'unlock-both', memberId: 'actor1' },
    ]) {
      const unlocked = applyCommand(pending, command, options);
      assert.deepEqual(unlocked.members[0].selected, []);
      assert.deepEqual(unlocked.members[1], original.members[1]);
      assert.deepEqual(applyCommand(importBackup(exportBackup(unlocked)), { type: 'undo' }, options).members, pending.members);
    }
  }
  const manual = structuredClone(original); manual.rules['roll.neighborMode'] = 'manual';
  map.neighbors.set('101', ['300']);
  assert.deepEqual(applyCommand(manual, { type: 'roll', memberId: 'actor1', count: 1 }, options).members[0].selected, []);
});


test('player-control commands and restores reject unknown skills, invalid levels and untyped Slayer fields atomically', () => {
  const original = state(); const quiet = { now: () => { throw Error('Must not timestamp'); } };
  const invalid = [
    { type: 'set-primary-override', memberId: 'actor1', skill: 'Combat', enabled: true },
    { type: 'set-primary-override', memberId: 'actor1', skill: 'Mining', enabled: 1 },
    { type: 'set-primary-override', memberId: 'actor1', skill: '__proto__', enabled: true },
    { type: 'set-skill-levels', memberId: 'actor1', skill: 'mining', passiveLevel: 10 },
    { type: 'set-skill-levels', memberId: 'actor1', skill: 'Mining' },
    ...[0, 121, 10.5, '10', false].map(passiveLevel => ({ type: 'set-skill-levels', memberId: 'actor1', skill: 'Mining', passiveLevel })),
    { type: 'set-skill-levels', memberId: 'actor1', skill: 'Mining', maxLevel: -1 },
    ...[{}, [], true, { level: 0 }, { level: 60, monster: '' }, { level: 60, boss: false }, { level: 60, combat: 80 }].map(lock => ({ type: 'set-slayer-lock', memberId: 'actor1', lock })),
  ];
  for (const command of invalid) assert.throws(() => applyCommand(freeze(original), command, quiet), TypeError);
  for (const [field, value] of [
    ['primaryOverrides', { Mining: null }], ['primaryOverrides', { Unknown: true }],
    ['passiveLevels', { Mining: '50' }], ['maxLevels', { Mining: 0 }],
    ['slayerLock', { level: 50, arbitrary: true }], ['slayerLock', { level: 50, monster: ' ' }],
  ]) {
    const corrupt = structuredClone(original); corrupt.members[0][field] = value; const before = structuredClone(corrupt);
    assert.throws(() => validateState(corrupt));
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: corrupt }));
    assert.deepEqual(corrupt, before);
  }
  const locked = applyCommand(original, { type: 'set-slayer-lock', memberId: 'actor1', lock: { level: 60 } }, { now: clock });
  locked.history[0].undo.memberChanges[0].changes[0].before = { exists: true, value: { level: '60' } };
  assert.throws(() => validateState(locked));
  const trained = applyCommand(original, { type: 'set-skill-levels', memberId: 'actor1', skill: 'Mining', passiveLevel: 30 }, { now: clock });
  trained.history[0].undo.memberChanges[0].changes.at(-1).path[1] = 'Unknown';
  assert.throws(() => validateState(trained));
  assert.deepEqual(original, state());
});

test('stickers and starting markers inherit decoded legacy data while typed personal clears mask it', () => {
  const original = state(); original.members[0].sourceMapId = 'bbb';
  original.legacy = { maps: { bbb: { settings: { startingChunk: '100' }, chunks: { stickered: { '*fb*_100': 'star', '101': 'unknown' }, stickeredColors: { '*fb*_100': '-_-2FFF0000' }, stickeredNotes: { '*fb*_100': 'Keep-_-20note-_-2Q' } } } } };
  const legacy = { '100': [{ id: 'legacy-sticker-100', type: 'star', color: '#FF0000', text: 'Keep note!' }] };
  assert.deepEqual(resolveMemberStickers(freeze(original), original.members[0]), legacy);
  assert.equal(resolveStartingChunk(original, original.members[0]), '100');
  assert.ok(stickerDefinitions.some(definition => definition.id === 'necromancy' && definition.kind === 'rs3'));
  let changed = applyCommand(original, { type: 'set-sticker', memberId: 'actor1', chunkId: '100', sticker: null }, { world: world(), now: clock });
  assert.deepEqual(resolveMemberStickers(changed, changed.members[0]), { '100': [] });
  changed = applyCommand(changed, { type: 'set-sticker', memberId: 'actor1', chunkId: '101', sticker: { type: 'A', color: '#aB12cD', text: '<b>Literal personal text</b>' } }, { world: world(), now: clock });
  changed = applyCommand(changed, { type: 'set-starting-chunk', memberId: 'actor1', chunkId: '101' }, { world: world(), now: clock });
  assert.equal(resolveStartingChunk(changed, changed.members[0]), '101');
  assert.deepEqual(changed.members[0].unlocked, original.members[0].unlocked, 'Starting markers do not unlock terrain');
  assert.deepEqual(changed.members[1], original.members[1]); assert.deepEqual(changed.legacy, original.legacy);
  const markers = resolveMemberStickers(changed, changed.members[0]); markers['101'][0].text = 'Changed view';
  assert.equal(changed.members[0].stickers['101'][0].text, '<b>Literal personal text</b>');
  const cleared = applyCommand(changed, { type: 'set-starting-chunk', memberId: 'actor1', chunkId: null }, { now: clock });
  assert.equal(resolveStartingChunk(cleared, cleared.members[0]), null);
  assert.deepEqual(applyCommand(importBackup(exportBackup(cleared)), { type: 'undo' }, { now: clock }).members, changed.members);
  const beforeMarker = applyCommand(changed, { type: 'undo' }, { now: clock });
  assert.equal(resolveStartingChunk(beforeMarker, beforeMarker.members[0]), '100');
  const fullyReverted = applyCommand(applyCommand(beforeMarker, { type: 'undo' }, { now: clock }), { type: 'undo' }, { now: clock });
  assert.deepEqual(fullyReverted.members, original.members);
});

test('marker commands and backup histories reject unknown ids, unsafe colors and arbitrary fields', () => {
  const original = state(), options = { world: world(), now: () => { throw Error('Must not timestamp'); } };
  const sticker = { type: 'star', color: '#FFFFFF', text: '' };
  for (const bad of [
    { ...sticker, type: 'arbitrary' }, { ...sticker, type: 'unset' }, { ...sticker, color: 'red' },
    { ...sticker, text: false }, { ...sticker, script: true }, { type: 'star', color: '#FFFFFF' },
  ]) assert.throws(() => applyCommand(original, { type: 'set-sticker', memberId: 'actor1', chunkId: '101', sticker: bad }, options), TypeError);
  for (const chunkId of ['999', '101-1', '0', 101]) {
    assert.throws(() => applyCommand(original, { type: 'set-sticker', memberId: 'actor1', chunkId, sticker }, options));
    assert.throws(() => applyCommand(original, { type: 'set-starting-chunk', memberId: 'actor1', chunkId }, options));
  }
  for (const value of ['somewhere', '00101', '9007199254740992']) assert.throws(() => applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'startingChunk', value }, options));
  assert.throws(() => applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'startingChunk', value: '999' }, options), /surface/);
  const marked = applyCommand(original, { type: 'set-sticker', memberId: 'actor1', chunkId: '101', sticker }, { world: world(), now: clock });
  for (const mutate of [
    value => { value.members[0].stickers['101'][0].type = 'arbitrary'; },
    value => { value.history[0].undo.memberChanges[0].changes.at(-1).after.value[0].color = 'red'; },
    value => { value.history[0].undo.memberChanges[0].changes.at(-1).path[1] = '__proto__'; },
  ]) {
    const corrupt = structuredClone(marked); mutate(corrupt); assert.throws(() => validateState(corrupt));
  }
  assert.deepEqual(original, state());
});


test('trusted dynamic catalogues register only the goal being checked and sparse undo removes it exactly', () => {
  const original = state();
  const task = { id: 'dynamic:monster:100', label: 'Collect declared monster drops', category: 'Collection Log' };
  for (const taskCatalogue of [new Map([[task.id, task]]), [task]]) for (const command of [
    { type: 'set-task-status', memberId: 'actor1', taskId: task.id, challengeCompleted: true },
    { type: 'complete-task', memberId: 'actor1', taskId: task.id, completed: true },
  ]) {
    const changed = applyCommand(freeze(original), command, { taskCatalogue, now: clock });
    assert.equal(changed.tasks.length, original.tasks.length + 1);
    assert.deepEqual(changed.tasks.at(-1), task);
    assert.deepEqual(changed.members[1], original.members[1]);
    assert.deepEqual(changed.history[0].undo.taskChanges, [{ id: task.id, before: { exists: false }, after: { exists: true, value: task, index: 1 } }]);
    const reversed = applyCommand(importBackup(exportBackup(changed)), { type: 'undo' }, { now: clock });
    assert.deepEqual(reversed.tasks, original.tasks); assert.deepEqual(reversed.members, original.members);
    const checkedAgain = applyCommand(changed, command, { taskCatalogue, now: clock });
    assert.equal(checkedAgain.tasks.length, changed.tasks.length);
  }
  assert.deepEqual(task, { id: 'dynamic:monster:100', label: 'Collect declared monster drops', category: 'Collection Log' });
});

test('dynamic task metadata must come from an exact validated trusted catalogue entry', () => {
  const original = state(), command = { type: 'set-task-status', memberId: 'actor1', taskId: 'dynamic:new', favorite: true };
  const quiet = { now: () => { throw Error('Must not timestamp'); } };
  for (const taskCatalogue of [undefined, {}, new Map(), [], new Map([['dynamic:new', { id: 'wrong', label: 'Wrong', category: 'custom' }]]), [{ id: 'dynamic:new', label: '', category: 'custom' }], [{ id: 'dynamic:new', label: 'New', category: 'custom', script: true }]]) {
    assert.throws(() => applyCommand(freeze(original), command, { ...quiet, taskCatalogue }), TypeError);
    assert.deepEqual(original, state());
  }
  const task = { id: 'dynamic:new', label: 'New', category: 'custom' }, taskCatalogue = [task];
  assert.throws(() => applyCommand(original, { ...command, task }, { ...quiet, taskCatalogue }), /Unknown command field/);
  assert.throws(() => applyCommand(original, { ...command, favorite: 'yes' }, { ...quiet, taskCatalogue }), TypeError);
  assert.throws(() => applyCommand(original, { type: 'complete-task', memberId: 'actor1', taskId: task.id, completed: 'yes' }, { ...quiet, taskCatalogue }), TypeError);
  assert.deepEqual(original, state());
});

test('restore previews expose lost personal training declarations, Slayer locks and marker overrides', () => {
  const original = state();
  Object.assign(original.members[0], { primaryOverrides: { Mining: true }, passiveLevels: { Mining: 20 }, maxLevels: { Mining: 40 }, slayerLock: { level: 60, monster: 'Manually Locked' }, stickers: { '101': { type: 'star', color: '#FFFFFF', text: 'Keep' } } });
  const replacement = state();
  const preview = previewRestore(freeze(original), exportBackup(freeze(replacement)));
  for (const field of ['primaryOverrides', 'passiveLevels', 'maxLevels']) assert.deepEqual(preview.members[0][field].removed, ['Mining']);
  assert.deepEqual(preview.members[0].stickers.removed, ['101']);
  assert.deepEqual(preview.members[0].slayerLock, { before: { level: 60, monster: 'Manually Locked' }, after: null, changed: true });
  assert.equal(preview.warnings.length, 5);
  assert.equal(previewRestore(original, original).warnings.length, 0);
});

test('personal task alternatives select exact known ids without changing progress, ownership or other groups', () => {
  const original = state(), taskId = original.tasks[0].id;
  original.members[0].taskAlternatives = { quest: { 'Untouched route': null } };
  original.members[1].taskAlternatives = { quest: { 'Starter route': null } };
  const chosen = applyCommand(freeze(original), { type: 'set-task-alternative', memberId: 'actor1', category: 'quest', group: 'Starter route', taskId }, { now: clock });
  assert.deepEqual(chosen.members[0], { ...original.members[0], taskAlternatives: { quest: { 'Untouched route': null, 'Starter route': taskId } } });
  assert.deepEqual(chosen.members[1], original.members[1]); assert.deepEqual(chosen.tasks, original.tasks);
  assert.equal(chosen.members[0].taskStatus, undefined); assert.deepEqual(chosen.members[0].completedTasks, []);
  assert.deepEqual(chosen.history[0].undo.memberChanges[0].changes, [{ path: ['taskAlternatives', 'quest', 'Starter route'], kind: 'value', before: { exists: false }, after: { exists: true, value: taskId } }]);
  assert.deepEqual(applyCommand(importBackup(exportBackup(chosen)), { type: 'undo' }, { now: clock }).members, original.members);
  assert.deepEqual(previewRestore(chosen, original).members[0].taskAlternatives.changed, ['quest']);
  assert.ok(previewRestore(chosen, original).warnings.some(warning => warning.includes('chosen task methods')));
});

test('choosing a derived alternative registers only its minimal trusted metadata and undo restores catalogue and absence', () => {
  const original = state(), task = { id: 'dynamic:bones:rat', label: 'Obtain Bones from Rat', category: 'Extra' };
  const taskCatalogue = new Map([[task.id, task]]);
  const chosen = applyCommand(freeze(original), { type: 'set-task-alternative', memberId: 'actor1', category: 'Extra', group: 'Every Drop Bones', taskId: task.id }, { taskCatalogue, now: clock });
  assert.deepEqual(chosen.members[0].taskAlternatives, { Extra: { 'Every Drop Bones': task.id } });
  assert.deepEqual(chosen.history[0].undo.memberChanges[0].changes.map(patch => patch.path), [['taskAlternatives'], ['taskAlternatives', 'Extra'], ['taskAlternatives', 'Extra', 'Every Drop Bones']]);
  assert.equal(chosen.tasks.length, 2); assert.deepEqual(chosen.tasks.at(-1), task);
  assert.deepEqual(chosen.members[0].completedTasks, []); assert.equal(chosen.members[0].taskStatus, undefined);
  assert.deepEqual(chosen.members[1], original.members[1]);
  const cleared = applyCommand(chosen, { type: 'set-task-alternative', memberId: 'actor1', category: 'Extra', group: 'Every Drop Bones', taskId: null }, { now: clock });
  assert.equal(cleared.members[0].taskAlternatives.Extra['Every Drop Bones'], null);
  const restoredChoice = applyCommand(importBackup(exportBackup(cleared)), { type: 'undo' }, { now: clock });
  assert.deepEqual(restoredChoice.members, chosen.members);
  const restored = applyCommand(restoredChoice, { type: 'undo' }, { now: clock });
  assert.deepEqual(restored.members, original.members); assert.deepEqual(restored.tasks, original.tasks);
});

test('explicit Automatic alternatives mask decoded imported choices after conversion and undo revives exact fallback', () => {
  const original = state(); original.members[0].sourceMapId = 'bbb'; original.members[1].sourceMapId = 'aaa';
  original.legacy = { maps: {
    bbb: { chunkinfo: { altChallenges: { Mining: { '*fb*_60': 'Mine-_-20a-_-20rock' }, Extra: { 'Every-_-20Drop-_-20Bones': 'Obtain-_-20Bones-_-20from-_-20Rat' } } } },
    aaa: { chunkinfo: { altChallenges: { Mining: { '60': 'Reed choice' } } } },
  }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'actor1', sourceMapId: 'bbb' }, { memberId: 'reed', sourceMapId: 'aaa' }] } };
  const inherited = { Mining: { '60': 'Mine a rock' }, Extra: { 'Every Drop Bones': 'Obtain Bones from Rat' } };
  assert.deepEqual(resolveTaskAlternatives(freeze(original), original.members[0]), inherited);
  const automatic = applyCommand(original, { type: 'set-task-alternative', memberId: 'actor1', category: 'Mining', group: '60', taskId: null }, { now: clock });
  assert.deepEqual(resolveTaskAlternatives(automatic, automatic.members[0]), { ...inherited, Mining: { '60': null } });
  assert.deepEqual(resolveTaskAlternatives(automatic, automatic.members[1]), { Mining: { '60': 'Reed choice' } });
  assert.deepEqual(automatic.legacy, original.legacy);
  assert.deepEqual(applyCommand(importBackup(exportBackup(automatic)), { type: 'undo' }, { now: clock }).members, original.members);
  const resolved = resolveTaskAlternatives(original, original.members[0]); resolved.Mining['60'] = 'Changed view';
  assert.deepEqual(resolveTaskAlternatives(original, original.members[0]), inherited);
});

test('alternative commands, state and historical references reject unknown ids, mismatched categories and unsafe groups', () => {
  const original = state(), taskId = original.tasks[0].id;
  const command = { type: 'set-task-alternative', memberId: 'actor1', category: 'quest', group: 'Starter route', taskId };
  const quiet = { now: () => { throw Error('Must not timestamp'); } };
  for (const bad of [
    { ...command, taskId: 'missing' }, { ...command, taskId: "Cook's Assistant" }, { ...command, taskId: false },
    { ...command, taskId: undefined }, { ...command, category: 'Mining' }, { ...command, group: '' },
    { ...command, group: '__proto__' }, { ...command, category: 'constructor' }, { ...command, extra: true },
  ]) assert.throws(() => applyCommand(freeze(original), bad, quiet), TypeError);
  for (const alternatives of [
    null, [], { quest: [] }, { quest: { 'Starter route': 'missing' } },
    { Mining: { '60': taskId } }, { quest: { 'Starter route': false } },
    JSON.parse('{"quest":{"__proto__":null}}'),
  ]) {
    const corrupt = structuredClone(original); corrupt.members[0].taskAlternatives = alternatives;
    assert.throws(() => validateState(corrupt));
    assert.throws(() => importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: corrupt }));
  }
  const chosen = applyCommand(original, command, { now: clock });
  for (const mutate of [
    value => { value.history[0].undo.memberChanges[0].changes.at(-1).after.value = 'missing'; },
    value => { value.history[0].undo.memberChanges[0].changes.at(-1).path[1] = 'Mining'; },
    value => { value.history[0].undo.memberChanges[0].changes.at(-1).path[2] = '__proto__'; },
    value => { value.members[0].taskAlternatives.quest['Starter route'] = null; },
    value => { value.history[0].undo = { members: [structuredClone(value.members[0])] }; value.history[0].undo.members[0].taskAlternatives.quest['Starter route'] = 'missing'; },
  ]) {
    const corrupt = structuredClone(chosen); mutate(corrupt); const before = structuredClone(corrupt);
    assert.throws(() => validateState(corrupt)); assert.throws(() => applyCommand(corrupt, { type: 'undo' }, { now: clock }));
    assert.deepEqual(corrupt, before);
  }
  assert.deepEqual(original, state()); assert.equal(Object.prototype['Starter route'], undefined);
});
