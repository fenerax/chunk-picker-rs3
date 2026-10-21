import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalculationFeedback, calculationLabel } from '../app/web/calculation-feedback.mjs';

test('quick operations stay quiet; long operations clear on success or failure', () => {
  const timers = new Map(), shown = [];
  const feedback = createCalculationFeedback({ show: text => shown.push(text), setTimer: (fn, delay) => { assert.equal(delay, 1000); const id = Symbol(); timers.set(id, fn); return id; }, clearTimer: id => timers.delete(id) });
  feedback.begin('Quick')();
  assert.deepEqual(shown, ['']); assert.equal(timers.size, 0);
  const end = feedback.begin('Updating tasks'); [...timers.values()][0]();
  assert.equal(shown.at(-1), 'Updating tasks'); end(); assert.equal(shown.at(-1), '');
});

test('overlapping work keeps the remaining operation visible when another finishes', () => {
  const timers = [], shown = [];
  const feedback = createCalculationFeedback({ show: text => shown.push(text), setTimer: fn => timers.push(fn), clearTimer() {} });
  const first = feedback.begin('Saving chunk'), second = feedback.begin('Updating both players');
  timers.forEach(fn => fn()); first(); assert.equal(shown.at(-1), 'Updating both players');
  second(); assert.equal(shown.at(-1), ''); timers.forEach(fn => fn()); assert.equal(shown.at(-1), '');
});

test('messages name the requested player and distinguish roll, save and task calculations', () => {
  const state = { members: [{ id: 'a', name: 'Player A' }, { id: 'b', name: 'Player B' }] };
  assert.match(calculationLabel('/api/command', { type: 'roll', count: 2, memberId: 'b' }, state, 'a'), /roll choices for Player B/);
  assert.match(calculationLabel('/api/command', { type: 'set-chunk', memberId: 'b' }, state, 'a'), /Player B’s chunk/);
  assert.match(calculationLabel('/api/tasks?memberId=a', undefined, state, 'a', true), /both players/);
  assert.equal(calculationLabel('/api/prediction-intent', {}, state, 'a'), '');
});
