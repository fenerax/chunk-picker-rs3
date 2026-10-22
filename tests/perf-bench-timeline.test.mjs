import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { unlockTimeline } from '../scripts/perf/browser-interactions.mjs';
import { probeSource, initialViewSource } from '../scripts/perf/probe.mjs';
import { bindTaskViewPreferences } from '../app/web/task-view-preferences.mjs';

test('document-start view survives application preference restoration before calculations', () => {
  for (const view of ['off', 'on']) {
    const stored = new Map(), storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
    const controls = Object.fromEntries(['group-view', 'show-all', 'show-blocked'].map(id => [id, { checked: true, addEventListener() {} }]));
    let callback, parsed = false;
    const context = { localStorage: storage, document: { getElementById: id => parsed ? controls[id] : null },
      MutationObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() {} } };
    vm.runInNewContext(initialViewSource(view), context);
    parsed = true; callback();
    assert.equal(controls['group-view'].checked, view === 'on');
    // The app used to undo the checkbox-only probe here, before its first fetch.
    bindTaskViewPreferences(id => controls[id], () => storage);
    assert.equal(controls['group-view'].checked, view === 'on');
    assert.equal(controls['show-all'].checked, false);
  }
});

test('document probe observes the actual task fetch once and waits two frames for paint', async () => {
  let clock = 0, fetches = 0;
  const frames = [];
  const value = { memberId: 'player1', stateRevision: 4, tasks: ['fixture-private'] };
  class Response { constructor() { this.url = 'http://127.0.0.1/api/tasks'; } async json() { return value; } }
  const response = new Response(), window = { fetch: async () => { fetches++; return response; } };
  const context = { window, Request: class {}, Response, URL, location: { href: 'http://127.0.0.1/' },
    performance: { now: () => ++clock }, requestAnimationFrame: callback => frames.push(callback),
    CanvasRenderingContext2D: class { drawImage() {} }, MutationObserver: class { observe() {} }, document: {} };
  vm.runInNewContext(probeSource, context);
  const received = await window.fetch('/api/tasks?memberId=player1&revision=4');
  assert.equal(received, response);
  assert.equal(await received.json(), value);
  assert.equal(fetches, 1);
  const record = window.__perfProbe.taskResponses[0];
  assert.equal(record.requestStartMs, 1);
  assert.equal(record.memberId, 'player1');
  assert.equal(record.revision, 4);
  assert.doesNotMatch(JSON.stringify(record), /fixture-private|memberId=/);
  const events = window.__rs3Perf.events;
  events.push({ name: 'tasks-shown', time: 4, memberId: 'player1', revision: 4 });
  assert.equal(events.length, 1);
  frames.shift()(); assert.equal(events.length, 1);
  frames.shift()(); assert.equal(events.length, 2);
  assert.equal(events[1].name, 'tasks-painted');
  assert.equal(events[1].revision, 4);
});

test('Unlock ignores old-revision events and paints even when they finish after the click', async () => {
  const source = await readFile(new URL('../scripts/perf/page-load.mjs', import.meta.url), 'utf8');
  const context = vm.createContext({ options: { taskMilestone: 'tasks' }, ASSET_CLASSES: [] });
  vm.runInContext(source.slice(source.indexOf('const taskMilestoneEvent ='), source.indexOf('\nfunction loadedViewport('))
    + '\nglobalThis.metrics = metrics;', context);
  const events = [
    { name: 'tasks-shown', time: 15, memberId: 'player1', revision: 3 },
    { name: 'tasks-painted', time: 25, memberId: 'player1', revision: 3 },
    { name: 'tasks-shown', time: 35, memberId: 'player2', revision: 4 },
    { name: 'tasks-painted', time: 45, memberId: 'player2', revision: 4 },
    { name: 'tasks-shown', time: 50, memberId: 'player1', revision: 4 },
    { name: 'tasks-painted', time: 60, memberId: 'player1', revision: 4 },
  ];
  const snapshot = { events, now: 70, resources: [], probe: { saved: [], longTasks: [], taskResponses: [
    { memberId: 'player1', revision: 3, requestStartMs: 12, startMs: 13, endMs: 14, cache: { hit: true } },
    { memberId: 'player1', revision: 4, requestStartMs: 30, startMs: 31, endMs: 49, cache: { hit: false, evaluationMs: 10 } },
  ] } };
  const result = context.metrics(snapshot, 10, [], null, false, { member: 'player1', revision: 4 });
  assert.equal(result.milestones.tasksShownMs, 40);
  assert.equal(result.milestones.tasksPaintedMs, 50);
  assert.equal(result.taskIdentity.revision, 4);
  result.unlock = { member: 'player1' };
  assert.equal(unlockTimeline(result).calculationRequestSentMs, 20);
  assert.equal(unlockTimeline(result).cacheHit, false);
});

test('timeline response lineage follows the painted revision, not a later unrelated parse', () => {
  const result = { taskIdentity: { memberId: 'player1', revision: 4 }, unlock: { member: 'player1' },
    milestones: { selectedTasksShownMs: 100, tasksPaintedMs: 120 }, taskResponses: [
      { memberId: 'player1', revision: 4, requestStartMs: 10, startMs: 20, endMs: 80, cache: { hit: false } },
      { memberId: 'player1', revision: 3, requestStartMs: 1, startMs: 2, endMs: 90, cache: { hit: true } },
    ] };
  assert.equal(unlockTimeline(result).calculationRequestSentMs, 10);
  assert.equal(unlockTimeline(result).cacheHit, false);
});
