// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeltaCommandValidator } from '../app/core/delta-validation.mjs';
import { applyCommand, validateState, createResidentState, materializeResidentState } from '../app/core/state.mjs';
import { adoptResidentState } from '../app/core/resident-copy.mjs';
import { createIdentityDictionary } from '../app/tasks/identity-dictionary.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { alias, deltaAliasCases } from './helpers/delta-alias-fixture.mjs';
import { fixture, commands, first, second, generated, custom, world, now, taskCatalogue } from './helpers/owned-format2-fixture.mjs';

const settings = { world: { ...world, surface: new Set(['100', '101']) }, now, taskCatalogue, random: () => 0 };
const logical = state => materializeResidentState(state);
function outcome(work) {
  try { return { accepted: true, state: work() }; }
  catch (error) { assert(error instanceof TypeError || error instanceof RangeError); return { accepted: false, error }; }
}
function compare(one, two, label) {
  assert.equal(two.accepted, one.accepted, label);
  if (one.accepted) assert.deepEqual(logical(two.state), logical(one.state), label);
}
function residentInput(state, base) {
  // Preserve corrupt input for the real validator; createResidentState would
  // validate it before the differential comparison had started.
  if (state.identityRegistry) state.identityRegistry = { ...state.identityRegistry,
    entries: createIdentityDictionary(base.identityRegistry.entries, state.identityRegistry.entries),
    aliases: createIdentityDictionary(base.identityRegistry.aliases, state.identityRegistry.aliases) };
  return adoptResidentState(state, base);
}
test('delta validation matches the full validator on generated and adversarial inputs', { timeout: 240000 }, async t => {
  let accepted = 0, rejected = 0;
  await t.test('deterministic command streams, both representations and exact inverse states', () => {
    for (const resident of [false, true]) for (const seed of [1, 67, 503]) {
      const { state, base } = fixture(), validator = createDeltaCommandValidator();
      let full = validateState(state), delta = validator.validate(resident ? createResidentState(state, base) : state);
      let random = seed;
      const choose = maximum => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % maximum; };
      const run = command => {
        const before = logical(delta), options = { ...settings, expectedRevision: full.revision };
        const one = outcome(() => applyCommand(full, command, options));
        const two = outcome(() => validator.apply(delta, command, options));
        compare(one, two, `seed ${seed} resident ${resident} ${JSON.stringify(command)}`);
        assert.deepEqual(logical(delta), before, 'earlier immutable snapshot survives success/refusal');
        if (one.accepted) {
          accepted++; full = one.state; delta = two.state;
          assert.deepEqual(logical(delta), validateState(logical(delta)), 'full History replay accepts each delta result');
        } else rejected++;
      };
      // Fixed paths exercise catalogue registration, assigned edits, claims,
      // category timelines, deletion and nonlatest/selective Undo fallbacks.
      for (const command of commands) { run(command); run({ type: 'undo' }); run(command); }
      for (let index = 0; index < 100; index++) {
        const memberId = `member-${choose(2) + 1}`, id = [first, second, custom, generated, 'absent'][choose(5)];
        const candidates = [
          { type: 'set-note', memberId, chunkId: choose(2) ? '100' : '101', note: `Synthetic ${seed}/${index}` },
          { type: 'tick-active-tasks', memberId, taskIds: [id, id] },
          { type: 'undo' },
          { type: 'undo', undoRevision: 1 + choose(Math.max(1, full.revision)) },
          { type: 'set-note', memberId, chunkId: '0', note: 'invalid' },
          { type: 'set-task-status', memberId, taskId: id, favorite: !!choose(2) },
          { type: 'tick-active-tasks', memberId, taskIds: [] },
          { type: 'set-note', memberId: 'absent', chunkId: '100', note: 'invalid' },
          { type: 'set-note', memberId, chunkId: '100', note: null },
          { type: 'set-note', memberId, chunkId: '100', note: 'invalid', extra: true },
          { type: 'set-rule', ruleId: 'access.shared', value: !!choose(2) },
          { type: 'set-task-status', memberId, taskId: id, challengeCompleted: !!choose(2) },
        ];
        run(candidates[choose(candidates.length)]);
      }
      // Force the hot path after the broad sequence, including no-op notes.
      for (const command of [
        { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic final' },
        { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic final' },
        { type: 'undo' },
      ]) run(command);
      assert(Object.isFrozen(delta.history));
      assert.throws(() => delta.history.push({}), TypeError);
      assert.throws(() => { delta.members[0].name = 'Mutated'; }, TypeError);
    }
    assert(accepted > 250); assert(rejected > 100);
    t.diagnostic(`Generated command pairs: ${accepted} accepted, ${rejected} rejected`);
  });
  await t.test('duplicates, roster-dependent rows, JSON boundaries and every inverse component', () => {
    const mutators = [
      state => { state.tasks.push(state.tasks[0]); },
      state => { state.members.push(state.members[0]); },
      state => { state.members[0].unlocked = ['100', '100']; },
      state => { state.members[0].selected = ['100']; state.members[0].unlocked = ['100']; },
      state => { state.members[0].completedTasks = [first, first]; },
      state => { state.members[0].taskStatus = { absent: { favorite: true } }; },
      state => { state.tasks[1].memberIds = ['absent']; },
      state => { state.tasks[1].memberIds = ['member-1', 'member-1']; },
      state => { state.members.pop(); },
      state => { state.members.reverse(); },
      state => { state.schemaVersion = 2; },
      state => { state.revision = Number.MAX_SAFE_INTEGER + 1; },
      state => { state.rules = { absent: true }; },
      state => { state.unrecognized = true; },
      state => { state.members[0].journal = 'x'.repeat(10001); },
      state => { state.members[0].notes = JSON.parse('{"__proto__":"bad"}'); },
      state => { state.members[0].notes = { '100': undefined }; },
      state => { state.members[0][Symbol('synthetic')] = true; },
      state => { state.provenance = { nonJSON: new Date() }; },
      state => { state.provenance = {}; state.provenance.loop = state.provenance; },
      state => { state.history.push(structuredClone(state.history[0])); },
      state => { state.history[0].id = 'wrong'; },
      state => { state.history[0].revision = 999; },
      state => { state.history[0].actor = { kind: 'master', label: 'Synthetic', token: 'synthetic' }; },
      state => { state.history[0].source = 'game-plugin'; },
      state => { state.history[0].undo.extra = true; },
      state => { state.history[0].undo.memberChanges[0].id = 'absent'; },
      state => { state.history[0].undo.memberChanges[0].changes[0].path = ['constructor']; },
      state => { state.history[0].undo.memberChanges[0].changes[0].after.exists = false; },
      state => { state.history[0].undoneRevision = 3; },
      state => { state.history[1].command.undoRevision = 99; },
      state => { state.history[0].undo.memberChanges[0].changes.push(structuredClone(state.history[0].undo.memberChanges[0].changes[0])); },
      state => { state.history[0].undo.rules = { absent: true }; },
      state => { state.history[0].undo.tasks = [{ id: first, label: 'Historical assigned', memberIds: ['absent'] }]; },
      state => { state.history[0].undo.taskChanges = [{ id: first, before: { exists: true, index: 0, value: { id: first, label: 'Bad', memberIds: ['absent'] } }, after: { exists: false } }]; },
      state => { state.history[0].undo.taskClaimChanges = { beforeExists: false, afterExists: true, changes: [{ id: first, before: { exists: false }, after: { exists: true, value: { memberId: 'absent' } } }] }; },
      state => { state.history[0].undo.finishLineChange = { before: { exists: false }, after: { exists: true, value: {} } }; },
      state => { state.history[0].undo.groupGoalChanges = [{}]; },
      state => { state.history[0].undo.ruleReviewChange = {}; },
      state => { state.identityRegistry.aliases['first-alias'] = second; },
      state => { state.members[0].completedTasks = ['first-alias']; },
      state => { state.members[0].taskStatus = { 'first-alias': { favorite: true } }; },
    ];
    for (const resident of [false, true]) for (const [index, mutate] of mutators.entries()) {
      const { base, state } = fixture();
      let input = applyCommand(state, { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic' }, settings);
      input = applyCommand(input, { type: 'undo' }, settings);
      mutate(input);
      const representation = resident ? residentInput(input, base) : input;
      const one = outcome(() => validateState(representation));
      const validator = createDeltaCommandValidator();
      const two = outcome(() => validator.validate(representation));
      compare(one, two, `mutator ${index}, resident ${resident}`);
      compare(outcome(() => applyCommand(representation, { type: 'set-note', memberId: 'member-1', chunkId: '101', note: 'Synthetic' }, settings)),
        outcome(() => validator.apply(representation, { type: 'set-note', memberId: 'member-1', chunkId: '101', note: 'Synthetic' }, settings)),
        `untrusted command mutator ${index}, resident ${resident}`);
    }
  });
  await t.test('cached proofs cannot be forged by a frozen root or a reused revision', () => {
    const { state } = fixture(), validator = createDeltaCommandValidator();
    const certified = validator.validate(state);
    const corrupted = { ...certified, tasks: [...certified.tasks, certified.tasks[0]] };
    Object.freeze(corrupted);
    assert.throws(() => validator.apply(corrupted, { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic' }, settings), /duplicate/);
    assert.equal(certified.revision, corrupted.revision);
    assert.deepEqual(logical(certified), validateState(state));
  });
  for (const resident of [false, true]) for (const row of deltaAliasCases()) await t.test(`${row.name}, resident ${resident}`, () => {
    assert.deepEqual(validateState(row.state), row.state, 'the starting state is fully valid without migration');
    const validator = createDeltaCommandValidator();
    const input = validator.validate(resident ? createResidentState(row.state, row.base) : row.state);
    const options = { ...settings, taskCatalogue: row.catalogue, expectedRevision: input.revision };
    const full = outcome(() => applyCommand(row.state, row.command, options));
    const delta = outcome(() => validator.apply(input, row.command, options));
    assert.equal(full.accepted, row.accepted);
    compare(full, delta, row.name);
    if (!full.accepted) return;
    const saved = state => JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1,
      ...(resident ? ownedCodec(row.base, row.pin).encode(state) : { state }) });
    assert.equal(saved(delta.state), saved(full.state), 'saved envelope bytes match the full command');
    assert.equal(logical(delta.state).members[0].taskStatus[first].challengeCompleted, true);
    assert(!Object.hasOwn(logical(delta.state).members[0].taskStatus, alias));
    assert.deepEqual(logical(delta.state), validateState(logical(delta.state)), 'certified state is a full-validation fixed point');
  });
});
