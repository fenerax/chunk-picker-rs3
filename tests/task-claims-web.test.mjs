import test from 'node:test';
import assert from 'node:assert/strict';
import { claimAge, taskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';

test('claim times stay short, use the saved time, and handle clock skew', () => {
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  for (const [age, label] of [[0, 'just now'], [120000, '2 min ago'], [7200000, '2 h ago'], [172800000, '2 d ago'], [-60000, 'just now']]) {
    assert.equal(claimAge(new Date(now - age).toISOString(), now), label);
  }
});

test('personal task claim joins resolve saved aliases to the same duo claim', () => {
  const claim = { memberId: 'reed', at: '2026-10-11T10:00:00.000Z' };
  const state = { identityRegistry: { entries: { 'rs3:task:canonical': { category: 'Mining' } }, aliases: { 'old-id': 'rs3:task:canonical' } }, taskClaims: { 'rs3:task:canonical': claim } };
  assert.equal(taskClaim(state, 'old-id'), claim);
  assert.equal(taskClaim(state, 'rs3:task:canonical'), claim);
});

test('one minute clock advances claim labels, pauses hidden pages and resumes without task work', () => {
  const start = Date.parse('2026-10-11T12:00:00.000Z');
  let time = start, nextTimer = 0, intervalStarts = 0;
  const timers = new Map(), documentEvents = new Map(), windowEvents = new Map();
  const eventTarget = events => ({ addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) });
  const node = { dataset: {}, dateTime: new Date(start).toISOString(), textContent: 'just now', title: 'saved date' };
  const second = { dataset: {}, dateTime: new Date(start - 60000).toISOString(), textContent: '1 min ago' };
  const document = { ...eventTarget(documentEvents), hidden: false, querySelectorAll: selector => { assert.equal(selector, '.task-claim-time'); return [node, second]; } };
  const window = eventTarget(windowEvents);
  const clock = createTaskClaimClock({ document, window, now: () => time,
    setInterval(fn, delay) { assert.equal(delay, 60000); intervalStarts++; timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => timers.delete(id) });
  assert.equal(timers.size, 1); assert.equal(intervalStarts, 1);
  time += 60000; [...timers.values()][0](); assert.equal(node.textContent, '1 min ago'); assert.equal(second.textContent, '2 min ago');
  time = start + 7200000; [...timers.values()][0](); assert.equal(node.textContent, '2 h ago'); assert.equal(timers.size, 1); assert.equal(intervalStarts, 1);
  assert.equal(node.dateTime, new Date(start).toISOString()); assert.equal(node.title, 'saved date');
  document.hidden = true; documentEvents.get('visibilitychange')(); assert.equal(timers.size, 0);
  time += 3600000; assert.equal(node.textContent, '2 h ago');
  document.hidden = false; documentEvents.get('visibilitychange')(); assert.equal(node.textContent, '3 h ago'); assert.equal(timers.size, 1);
  documentEvents.get('visibilitychange')(); assert.equal(timers.size, 1);
  windowEvents.get('pagehide')(); assert.equal(timers.size, 0);
  documentEvents.get('visibilitychange')(); assert.equal(timers.size, 0, 'A pagehide pause persists until pageshow');
  time += 3600000; windowEvents.get('pageshow')(); assert.equal(node.textContent, '4 h ago'); assert.equal(timers.size, 1);
  clock.dispose(); assert.equal(timers.size, 0); assert.equal(documentEvents.size, 0); assert.equal(windowEvents.size, 0);
});

test('a VM document without browser timers installs no Node timer', () => {
  const clock = createTaskClaimClock({ document: { querySelectorAll: () => [] } });
  clock.refresh(); clock.dispose();
});
