// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildOwnedBase } from '../app/storage/owned-base.mjs';
import { createGroupState, validateState, validateOwnedState, applyCommand, applyResidentCommand,
  createResidentState, validateResidentState, materializeResidentState, getUndoEligibility,
  exportBackup, importBackup } from '../app/core/state.mjs';
import { cloneResidentState } from '../app/core/resident-copy.mjs';
import { createIdentityDictionary, editIdentityDictionary, identityValue, identityKeys,
  identityEntries, freezeIdentityTree, materializeIdentities, withIdentityDictionaryCallCountsForTests } from '../app/tasks/identity-dictionary.mjs';
import { resolveIdentity } from '../app/tasks/identity.mjs';
import { resolvePersistedIdentity } from '../app/tasks/fact-projection.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const first = 'rs3:task:synthetic-first', second = 'rs3:task:synthetic-second', generated = 'rs3:goal:synthetic-generated';
const custom = 'custom:synthetic';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.stringify(value);
const options = { now: () => '2026-01-01T00:00:00.000Z', random: () => 0,
  world: { chunks: new Map(['100', '101'].map(id => [id, { id }])) },
  taskCatalogue: new Map([[generated, { id: generated, label: 'Synthetic generated', category: 'Synthetic',
    aliases: ['collision', 'generated-alias'], kind: 'collection' }]]) };
function fixture() {
  const tasks = [{ label: 'Synthetic first', id: first, category: 'Synthetic' },
    { id: second, label: 'Synthetic second', category: 'Synthetic' }];
  const identityRegistry = { schemaVersion: 1, entries: {
    [first]: { label: 'Synthetic first', kind: 'task', category: 'Synthetic', aliases: ['first-alias'] },
    [second]: { label: 'Synthetic second', kind: 'task', category: 'Synthetic', aliases: [] },
    [generated]: { label: 'Synthetic generated', kind: 'collection', category: 'Synthetic', aliases: [] } },
  aliases: { 'first-alias': first, collision: [second, first] }, unresolved: [] };
  const { base } = buildOwnedBase({ dataset: { id: 'synthetic', contractVersion: 1, digest: 'b'.repeat(64) }, tasks, identityRegistry });
  const state = createGroupState([1, 2].map(index => ({ id: `member-${index}`, name: `Synthetic member ${index}` })));
  state.tasks = [tasks[0], { label: 'Synthetic custom', category: 'Custom', id: custom, memberIds: ['member-1', 'member-2'] }, tasks[1]];
  state.identityRegistry = identityRegistry;
  state.legacy = { synthetic: { retained: true } };
  state.provenance = { synthetic: { evidence: ['retained'] } };
  return { base, state: validateState(state) };
}
const commands = [
  { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first, generated] },
  { type: 'set-note', memberId: 'member-2', chunkId: '100', note: 'Synthetic note' },
  { type: 'update-task', taskId: custom, task: { label: 'Synthetic edit one', memberIds: ['member-1', 'member-2'] } },
  { type: 'claim-task', memberId: 'member-1', taskId: custom },
  { type: 'update-task', taskId: custom, task: { label: 'Synthetic edit two', memberIds: ['member-2'] } },
  { type: 'set-task-status', memberId: 'member-2', taskId: custom, favorite: true, note: 'Synthetic coordination' },
  { type: 'set-rule', ruleId: 'access.shared', value: false },
  { type: 'delete-task', taskId: custom },
  { type: 'add-task', task: { id: 'custom:synthetic-added', label: 'Synthetic addition', category: 'Custom' } },
];
const gameplay = state => Object.fromEntries(['members', 'tasks', 'rules', 'taskClaims'].filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]));
function pair() {
  const { base, state } = fixture();
  let flat = state, resident = createResidentState(state, base);
  function equal() {
    const logical = materializeResidentState(resident);
    assert.equal(hash(logical), hash(flat), 'logical-state hash');
    assert.equal(hash(logical.history), hash(flat.history), 'ordered History hash');
    assert.equal(json(logical.tasks), json(flat.tasks), 'ordered row JSON');
    assert.deepEqual(logical, flat);
    assert.equal(hash(validateState(logical)), hash(materializeResidentState(validateResidentState(resident))));
    assert.deepEqual(logical.history.map(event => describeHistoryEvent(event)), flat.history.map(event => describeHistoryEvent(event)));
  }
  function run(command) {
    const old = resident, preimage = json(materializeResidentState(old));
    const eligibility = getUndoEligibility(resident, command.undoRevision);
    assert.deepEqual(eligibility, getUndoEligibility(flat, command.undoRevision));
    flat = applyCommand(flat, command, { ...options, expectedRevision: flat.revision });
    resident = applyResidentCommand(resident, command, { ...options, expectedRevision: resident.revision });
    assert.equal(json(materializeResidentState(old)), preimage, 'command and preview preserve earlier snapshots');
    equal();
    return resident;
  }
  equal();
  return { base, run, equal, get flat() { return flat; }, get resident() { return resident; } };
}

test('commands, Undo and Redo replay preserve logical hashes, History and exact preimages', () => {
  const states = pair();
  for (const command of commands) {
    const before = json(gameplay(states.flat));
    states.run(command);
    const after = json(gameplay(states.flat));
    assert.equal(json(states.resident.history.at(-1).undo), json(states.flat.history.at(-1).undo));
    states.run({ type: 'undo' });
    assert.equal(json(gameplay(states.flat)), before, `exact Undo preimage: ${command.type}`);
    // Redo uses the original command, as an ordinary new command/revision.
    states.run(command);
    assert.equal(json(gameplay(states.flat)), after, `Redo gameplay: ${command.type}`);
  }
  for (let index = commands.length; index > 0; index--) states.run({ type: 'undo' });
  assert.equal(json(states.flat.tasks), json(fixture().state.tasks));
  for (const command of commands) states.run(command);
});

test('two groups share frozen base rows and dictionaries, but never edits or alias arrays', () => {
  const { base, state } = fixture(), one = createResidentState(state, base), two = createResidentState(state, base);
  const before = json(materializeResidentState(two));
  assert.notEqual(one.tasks, two.tasks);
  assert.equal(one.tasks[0], base.tasks[0]);
  assert.equal(one.identityRegistry.entries, two.identityRegistry.entries);
  assert.equal(identityValue(one.identityRegistry.aliases, 'collision'), base.identityRegistry.aliases.collision);
  const changed = applyResidentCommand(one, commands[0], options);
  assert.equal(changed.tasks[0], base.tasks[0]);
  assert.equal(identityValue(changed.identityRegistry.entries, first), base.identityRegistry.entries[first]);
  assert.notEqual(identityValue(changed.identityRegistry.entries, generated), base.identityRegistry.entries[generated]);
  assert.deepEqual(identityValue(changed.identityRegistry.aliases, 'collision'), [second, first, generated]);
  assert.deepEqual(base.identityRegistry.aliases.collision, [second, first]);
  assert.equal(json(materializeResidentState(two)), before);
  assert.equal(json(materializeResidentState(one)), before);
  assert.throws(() => { one.tasks[0].label = 'Mutation'; }, TypeError);
  assert.throws(() => { one.tasks.push({}); }, TypeError);
  assert.throws(() => { identityValue(one.identityRegistry.entries, first).aliases.push('Mutation'); }, TypeError);
  assert.throws(() => { identityValue(changed.identityRegistry.aliases, 'collision').reverse(); }, TypeError);
  assert.throws(() => { one.identityRegistry.entries.extra = {}; }, TypeError);
});

test('versioned edits preserve deletion, reinsertion, numeric keys and explicit order recipes', () => {
  const base = freezeIdentityTree({ 2: ['two'], 10: ['ten'], z: ['z'], a: ['a'] });
  const root = createIdentityDictionary(base), input = ['new'];
  let edited = editIdentityDictionary(root, [{ key: 'z', delete: true }, { key: '3', value: input }]);
  input.push('outside');
  edited = editIdentityDictionary(edited, [{ key: 'z', value: ['replacement'] }, { key: 'a', delete: true }]);
  assert.deepEqual([...identityKeys(edited)], ['2', '3', '10', 'z']);
  assert.deepEqual(identityValue(edited, '3'), ['new']);
  assert.equal(identityValue(edited, 'a'), undefined);
  assert.deepEqual([...identityEntries(root)], Object.entries(base));
  const reordered = { 10: ['ten'], a: ['a'], z: ['z'], 2: ['two'] };
  assert.equal(json(materializeIdentities(createIdentityDictionary(base, reordered))), json(reordered));
  assert.equal(json(materializeIdentities(root)), json(base), 'order recipe cannot mutate shared root');
  assert.throws(() => JSON.stringify(edited), /Materialize/);
  assert.throws(() => createIdentityDictionary({ unfrozen: [] }), /frozen/);
  assert.throws(() => editIdentityDictionary(root, [{ key: '__proto__', value: [] }]), /Unsafe/);
});

test('resident clones own payload and hydrated History while portable boundaries detach everything', () => {
  const states = pair();
  for (const command of commands.slice(0, 5)) states.run(command);
  const resident = states.resident, copy = cloneResidentState(resident);
  assert.equal(copy.tasks, resident.tasks); assert.equal(copy.identityRegistry, resident.identityRegistry);
  for (const key of ['members', 'rules', 'history', 'legacy', 'provenance']) assert.notEqual(copy[key], resident[key]);
  const archive = structuredClone(copy.history.slice(0, 2)), hot = structuredClone(copy.history.slice(2));
  copy.history = [...archive, ...hot]; // The existing archive reader supplies these ordered events.
  assert.equal(hash(materializeResidentState(validateResidentState(copy))), hash(states.flat));
  copy.history[0].command.taskIds.push('synthetic-only');
  copy.members[0].name = 'Synthetic changed'; copy.legacy.synthetic.retained = false;
  assert.equal(hash(materializeResidentState(resident)), hash(states.flat));
  const portable = exportBackup(resident);
  assert.deepEqual(importBackup(portable), states.flat);
  portable.state.tasks[0].label = 'Detached'; portable.state.identityRegistry.aliases.collision.reverse();
  assert.equal(hash(materializeResidentState(resident)), hash(states.flat));
});

test('complete logical validation refuses malformed deltas, member facts and stale Undo guards', () => {
  const states = pair(); states.run(commands[2]);
  for (const change of [
    state => { state.members[0].completedTasks = [first, first]; },
    state => { state.history.at(-1).undo.taskChanges[0].after.value.label = 'Stale'; },
    state => { state.tasks[1] = { ...state.tasks[1], memberIds: ['missing'] }; },
    state => { state.identityRegistry.aliases.collision = ['duplicate', 'duplicate']; },
    state => { state.identityRegistry.entries[first].label = ''; },
  ]) {
    const malformed = materializeResidentState(states.resident); change(malformed);
    assert.throws(() => validateState(malformed), TypeError);
    // Sparse creation must cross complete validation, including History replay.
    assert.throws(() => createResidentState(malformed, states.base), TypeError);
  }
  const copy = cloneResidentState(states.resident);
  copy.identityRegistry = Object.freeze({ ...copy.identityRegistry, entries: editIdentityDictionary(copy.identityRegistry.entries,
    [{ key: first, value: { label: '', kind: 'task' } }]) });
  assert.throws(() => validateResidentState(copy), /nonempty/);
  assert.throws(() => validateOwnedState(copy), /nonempty/);
});

test('alias lookups and deterministic command errors match the flat state without mutations', () => {
  const states = pair(); states.run(commands[0]);
  for (const alias of ['first-alias', 'collision', 'generated-alias', generated, 'missing']) {
    assert.deepEqual(resolveIdentity(alias, states.resident.identityRegistry), resolveIdentity(alias, states.flat.identityRegistry));
    assert.deepEqual(resolvePersistedIdentity(alias, states.resident.identityRegistry), resolvePersistedIdentity(alias, states.flat.identityRegistry));
  }
  for (const command of [commands[0], { type: 'complete-task', memberId: 'member-1', taskId: 'missing', completed: true },
    { type: 'set-rule', ruleId: 'missing', value: true }, { type: 'undo', undoRevision: 999 }]) {
    const before = hash(materializeResidentState(states.resident));
    let expected;
    try { applyCommand(states.flat, command, options); } catch (error) { expected = error; }
    assert.ok(expected);
    assert.throws(() => applyResidentCommand(states.resident, command, options), error => error.constructor === expected.constructor && error.message === expected.message);
    assert.equal(hash(materializeResidentState(states.resident)), before);
  }
});

test('optional registry presence, empty dictionaries and group order survive resident boundaries', () => {
  const { base, state } = fixture();
  for (const registry of [undefined, { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] },
    { ...state.identityRegistry, entries: Object.fromEntries(Object.entries(state.identityRegistry.entries).reverse()),
      aliases: Object.fromEntries(Object.entries(state.identityRegistry.aliases).reverse()), unresolved: ['synthetic-unresolved'] }]) {
    const flat = { ...state }; delete flat.identityRegistry;
    if (registry !== undefined) flat.identityRegistry = registry;
    const resident = createResidentState(flat, base);
    assert.equal(json(materializeResidentState(validateResidentState(resident))), json(flat));
    const changed = applyResidentCommand(resident, commands[0], options);
    assert.equal(json(materializeResidentState(changed)), json(applyCommand(flat, commands[0], options)));
  }
});

test('Undo previews enforce exact row JSON guards without touching the live array', () => {
  const states = pair(); states.run(commands[2]);
  const flat = materializeResidentState(states.resident);
  flat.tasks[1] = Object.fromEntries(Object.entries(flat.tasks[1]).reverse());
  const copy = cloneResidentState(states.resident);
  copy.tasks = freezeIdentityTree(flat.tasks);
  const before = json(materializeResidentState(copy));
  assert.equal(getUndoEligibility(copy).canUndo, false);
  assert.deepEqual(getUndoEligibility(copy), getUndoEligibility(flat));
  assert.equal(json(materializeResidentState(copy)), before);
  assert.throws(() => validateResidentState(copy), /Stale undo/);
  assert.throws(() => validateState(flat), /Stale undo/);
});

test('alias normalization and hydrated historical task snapshots preserve existing semantics', () => {
  const { base, state } = fixture(), resident = createResidentState(state, base), copy = cloneResidentState(resident);
  copy.members[0].completedTasks = ['first-alias'];
  const flat = materializeResidentState(copy);
  assert.equal(hash(materializeResidentState(validateResidentState(copy))), hash(validateState(flat)));
  const edited = applyCommand(state, commands[2], options);
  edited.history[0].undo = { tasks: structuredClone(state.tasks) }; // Retained pre-sparse History boundary.
  const historical = createResidentState(edited, base), before = json(materializeResidentState(historical));
  assert.equal(getUndoEligibility(historical).canUndo, true);
  const restored = applyResidentCommand(historical, { type: 'undo' }, options);
  assert.equal(json(materializeResidentState(historical)), before);
  assert.equal(json(restored.tasks), json(state.tasks));
  assert.equal(hash(materializeResidentState(restored)), hash(applyCommand(edited, { type: 'undo' }, options)));
});

test('format-1 validation and commands never call sparse iterators or value lookup', () => {
  const { base, state } = fixture();
  withIdentityDictionaryCallCountsForTests(counts => {
    assert.equal(json(validateState(state)), json(state));
    assert.equal(json(validateOwnedState(structuredClone(state))), json(state));
    let current = state;
    for (const command of commands) current = applyCommand(current, command, options);
    for (const alias of ['first-alias', 'collision', 'generated-alias', 'missing']) {
      resolveIdentity(alias, current.identityRegistry, 'Synthetic');
      resolvePersistedIdentity(alias, current.identityRegistry, 'Synthetic');
    }
    getUndoEligibility(current);
    assert.deepEqual(counts, { value: 0, keys: 0, entries: 0, validationEntries: 0, materializations: 0, fullCopies: 0 });
    const resident = createResidentState(state, base);
    validateResidentState(resident);
    resolveIdentity('first-alias', resident.identityRegistry);
    assert.ok(counts.validationEntries > 0, 'Counter observes the sparse validation path');
    assert.ok(counts.value > 0, 'Counter observes sparse value lookups');
  });
});

for (const [name, malform] of [
  ['symbol property', state => { state.members[0][Symbol('synthetic')] = true; }],
  ['custom prototype', state => { state.members[0].notes = Object.assign(Object.create({ synthetic: true }), { '100': 'Synthetic note' }); }],
  ['unsafe __proto__ key', state => { state.members[0].notes = JSON.parse('{"__proto__":"synthetic"}'); }],
  ['function value', state => { state.members[0].notes = { '100': () => 'synthetic' }; }],
  ['undefined array entry', state => { state.provenance.synthetic.evidence = [undefined]; }],
  ['circular reference', state => { const notes = {}; notes.self = notes; state.members[0].notes = notes; }],
]) test(`resident and flat validation reject the same ${name}`, () => {
  const { base, state } = fixture(), flat = structuredClone(state), resident = createResidentState(state, base);
  malform(flat); malform(resident);
  let expected;
  try { validateState(flat); } catch (error) { expected = error; }
  assert.ok(expected instanceof TypeError, 'Flat validation rejects the malformed input');
  const sameError = error => error.constructor === expected.constructor && error.message === expected.message;
  assert.throws(() => validateState(resident), sameError);
  assert.throws(() => validateResidentState(resident), sameError);
  assert.throws(() => applyResidentCommand(resident, commands[1], options), sameError);
});
