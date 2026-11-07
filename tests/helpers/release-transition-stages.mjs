import assert from 'node:assert/strict';
import { runManagedTransition } from '../../scripts/private-companion/release-transition.mjs';

export function transitionFixture(rollback = false) {
  const save = { revision: 41, completedTasks: ['kept-current-progress'] };
  const state = { pointer: rollback ? 'new' : 'old', binding: rollback ? 'new' : 'old',
    runtime: rollback ? 'new' : 'old', save, paused: false, journal: null, owner: false, tick: false, calls: [] };
  const expected = structuredClone(save);
  return { state, async run({ rollback: reverse = rollback, recover = false, reversePending = false, point, crash = false } = {}) {
    const source = reverse ? 'new' : 'old', target = reverse ? 'old' : 'new';
    let dead = false, fired = false;
    const fault = { 'before-journal': 'pack-check', 'after-journal': 'journal-intent', 'after-binding': 'binding-commit',
      'after-pointer': 'pointer-commit', 'during-start': 'candidate-start-readiness' }[point];
    const observe = () => ({ binding: state.binding, pointer: state.pointer, sourceBinding: source, targetBinding: target,
      sourcePointer: source, targetPointer: target, allowInversePartial: state.journal?.allowInversePartial ?? false });
    const stage = async name => {
      if (dead) throw Error('Native owner exited; no stage can run.');
      state.calls.push(name);
      if (name === 'ownership') { assert.equal(state.owner, false); state.owner = state.tick = true; }
      if (name === 'pause') state.paused = true;
      if (name === 'owned-stop') {
        assert.ok(state.owner && state.tick);
        if (state.runtime === 'foreign') throw Error('Uncertain runtime owner');
        state.runtime = null;
      }
      if (name === 'verify-install' && state.verificationFailed) throw Error('Installation verification refused.');
      if (name === 'pack-check') { assert.ok(state.paused && state.owner && state.tick); state.checkedRevision = state.save.revision; }
      if (name === 'journal-intent') state.journal = { state: 'journaled', rollback: reverse, allowInversePartial: reversePending };
      if (name === 'observe-pair' || name === 'validate-pair') return observe();
      if (name === 'binding-commit') state.binding = target;
      if (name === 'binding-journal') state.journal.state = 'binding-swapped';
      if (name === 'pointer-commit') state.pointer = target;
      if (name === 'pointer-journal') state.journal.state = 'pointer-swapped';
      if (name === 'starting-journal') state.journal.state = 'starting';
      if (name === 'candidate-start-readiness') { assert.ok(state.owner && state.tick); state.runtime = target; }
      if (name === 'post-start-validation') {
        assert.equal(state.pointer, target); assert.equal(state.binding, target); state.journal.state = 'ready';
      }
      if (name === 'unpause') state.paused = false;
      if (!fired && fault === name) { fired = true; state.fault = point; dead = crash; throw Error('Injected interruption: ' + point); }
      // Restoration is an adapter operation. This fixture's previous readiness
      // refuses exactly as in the native interrupted-start fixture.
      if (name === 'refusal-restoration') throw Error('Watchdog remains paused.');
    };
    try { await runManagedTransition(stage, { packUpgrade: true, recover, reversePending, rollback: reverse }); }
    finally { state.owner = state.tick = false; assert.deepEqual(state.save, expected); }
  } };
}
