import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserInteraction, interactionScenarios, measureBrowserInteractions, unlockTimeline, commandTimeline, saveBurstTimeline } from '../scripts/perf/browser-interactions.mjs';

test('Possible Tasks opens its collapsed section and ignores offscreen lazy icons', async () => {
  let now = 0, loaded = false, opened = 0;
  const summary = { textContent: 'Possible Tasks', click: () => { section.open = true; loaded = true; opened++; } };
  const section = { open: false, querySelector: selector => selector === 'summary' ? summary : null };
  const panel = { children: [{}], querySelector: selector => selector === '.task-filter-bar' && loaded ? {} : null };
  const input = { value: '', dispatchEvent() {} };
  const dialog = { open: false };
  const button = { click() {} };
  const target = { querySelectorAll: selector => selector === 'img' ? [{ complete: false,
    getBoundingClientRect: () => ({ top: 2000, bottom: 2020, left: 0, right: 20 }) }] : [] };
  const byId = { 'tool-dialog': dialog, 'chunk-content': target, 'chunk-info': { hidden: false },
    'search-open': { click: () => { dialog.open = true; } } };
  const document = { getElementById: id => byId[id],
    querySelector: selector => selector === '#tool-dialog input[type="search"]' ? input
      : selector === '#tool-dialog .search-results' ? { getAttribute: () => 'false', querySelector: value => value === '.error' ? null : button }
        : selector === '#chunk-content [role="tabpanel"]' ? panel : button,
    querySelectorAll: selector => selector === '#chunk-content details' ? [section] : [] };
  const context = vm.createContext({ document, innerHeight: 900, innerWidth: 1440,
    performance: { now: () => now }, Event: class {},
    requestAnimationFrame: callback => { now += 16; callback(); }, MutationObserver: class { observe() {} disconnect() {} } });
  const result = await vm.runInContext(`(${browserInteraction.toString()})('possible-tasks',1000)`, context);
  assert.equal(result.name, 'possible-tasks');
  assert.equal(opened, 1);
  assert.equal(loaded, true);
  assert.ok(result.durationMs > 0 && result.durationMs < 1000);
});

test('interaction aliases select only fixed UI scenarios without duplicates', () => {
  assert.deepEqual(interactionScenarios(['cold', 'panels', 'search', 'possible-tasks', 'group-view']),
    ['chunk-info', 'possible-tasks', 'search', 'group-view-on', 'group-view-off']);
  assert.deepEqual(interactionScenarios([]), []);
  assert.deepEqual(interactionScenarios(['personal-filter', 'personal-filter-group']),
    ['personal-filter-not-done', 'personal-filter-only-player', 'personal-filter-group']);
  assert.ok(!interactionScenarios().some(name => name.startsWith('personal-filter')));
});

function personalFilterContext({ initial = 'group', groupView = true } = {}) {
  let now = 0, pendingFrames = null;
  const changes = [], events = [];
  const select = { value: initial, dispatchEvent(event) {
    assert.equal(event.type, 'change'); changes.push(select.value); pendingFrames = 3;
  } };
  const byId = { 'tool-dialog': { open: false }, 'group-view': { checked: groupView }, 'duo-personal-filter': select,
    'task-engine-status': { textContent: '1,234 possible tasks' }, 'task-count': { textContent: 'Duo tasks 3' },
    'phone-task-panel': { querySelectorAll: () => [] } };
  const context = vm.createContext({ document: { getElementById: id => byId[id] }, window: { __rs3Perf: { events } },
    innerHeight: 900, innerWidth: 1440, performance: { now: () => now }, Event: class { constructor(type) { this.type = type; } },
    requestAnimationFrame: callback => {
      now += 16;
      // The app marks duo-tasks-shown once rows for the new filter are painted.
      if (pendingFrames !== null && --pendingFrames === 0) { pendingFrames = null; events.push({ name: 'duo-tasks-shown', time: now }); }
      callback();
    }, MutationObserver: class { observe() {} disconnect() {} } });
  return { context, changes, events, run: name => vm.runInContext(`(${browserInteraction.toString()})(${JSON.stringify(name)},1000)`, context) };
}

test('personal filter waits for the duo mark after its own change plus two stable frames', async () => {
  const fixture = personalFilterContext();
  const result = await fixture.run('personal-filter-not-done');
  assert.deepEqual(fixture.changes, ['not-done']);
  assert.equal(result.name, 'personal-filter-not-done');
  // Ready at the third frame's duo mark; the fourth completes two stable frames.
  assert.equal(result.durationMs, 64);
  assert.equal(result.completion, 'content-plus-two-animation-frames');
});

test('personal filter steps start from their predecessor and require Group view', async () => {
  const fixture = personalFilterContext({ initial: 'only-player' });
  await fixture.run('personal-filter-not-done');
  assert.deepEqual(fixture.changes, ['group', 'not-done']);
  await fixture.run('personal-filter-only-player');
  await fixture.run('personal-filter-group');
  assert.deepEqual(fixture.changes, ['group', 'not-done', 'only-player', 'group']);
  await assert.rejects(personalFilterContext({ groupView: false }).run('personal-filter-group'), /needs Group view/);
});

test('note command timeline uses one acknowledged command and counts worker receipts', () => {
  const result = { milestones: { tasksShownMs: 900, tasksPaintedMs: 940 }, taskCalculation: { hit: false },
    network: { requests: [{ path: '/api/command', status: 200, startMs: -0.2, endMs: 120 },
      { path: '/api/tasks', status: 200, startMs: 130, endMs: 880 }, { path: '/api/action-session', status: 200, startMs: 1, endMs: 5 }] },
    serverCalculations: [{ memberId: 'player1', revision: 4, startedMs: 140, doneMs: 860 }] };
  const timeline = commandTimeline(result);
  assert.equal(timeline.commandMatch, 'single-command');
  assert.equal(timeline.commandAcknowledgedMs, 120);
  assert.equal(timeline.resultsPaintedMs, 940);
  assert.equal(timeline.acknowledgedToPaintMs, 820);
  assert.equal(timeline.workerCalculations, 1);
  assert.equal(timeline.calculationObserved, true);
  assert.equal(timeline.cacheHit, false);
  assert.equal(timeline.commandSentMs, null, 'a start before the click is not a send time');
  assert.equal(timeline.taskFetches, 1);
  assert.ok(Object.values(timeline).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  result.network.requests.push({ path: '/api/command', status: 200, startMs: 200, endMs: 300 });
  result.serverCalculations = [{ startedMs: 50, doneMs: 10 }];
  const ambiguous = commandTimeline(result);
  assert.equal(ambiguous.commandMatch, 'ambiguous');
  assert.equal(ambiguous.commandAcknowledgedMs, null);
  assert.equal(ambiguous.acknowledgedToPaintMs, null);
  assert.equal(ambiguous.calculationObserved, false);
  assert.equal(commandTimeline().commandMatch, null);
});

test('save burst timeline counts only the page state reads and leaves an unobserved paint missing', () => {
  const result = { burst: { commands: 20, target: 'partner', restored: true },
    milestones: { lastCommittedMs: 410, caughtUpMs: 1200, tasksPaintedMs: null },
    network: { requests: [{ path: '/api/state', status: 200 }, { path: '/api/state', status: 503 }, { path: '/api/state', cancelled: true },
      { path: '/api/tasks', status: 200 }, { path: '/api/definitions', status: 200 }] } };
  const timeline = saveBurstTimeline(result);
  assert.deepEqual({ ...timeline }, { commands: 20, lastCommittedMs: 410, caughtUpMs: 1200, tasksPaintedMs: null, tasksPaintObserved: false,
    stateFetches: 3, stateFetchesFailed: 2, restored: true });
  result.milestones.tasksPaintedMs = 1300;
  assert.equal(saveBurstTimeline(result).tasksPaintObserved, true);
  // No network record is unknown, not zero reads.
  assert.deepEqual([saveBurstTimeline({}).stateFetches, saveBurstTimeline({}).commands, saveBurstTimeline({}).restored], [null, null, false]);
  assert.equal(saveBurstTimeline({ milestones: { caughtUpMs: -1 } }).caughtUpMs, null);
});

test('UI measurements run sequentially through the existing browser and return scalar rows', async () => {
  let active = false;
  const expressions = [], budgets = [];
  const browser = { async evaluate(expression, budget) {
    assert.equal(active, false); active = true;
    expressions.push(expression); budgets.push(budget);
    await Promise.resolve(); active = false;
    const name = expression.match(/\)\("([a-z-]+)",50\)$/)?.[1];
    assert.ok(name);
    return { name, durationMs: 12, completion: 'content-plus-two-animation-frames' };
  } };
  const rows = await measureBrowserInteractions(browser, { timeout: 50, scenarios: ['panels', 'search'] });
  assert.deepEqual(rows.map(row => row.name), ['chunk-info', 'possible-tasks', 'search']);
  assert.equal(expressions.length, 3);
  // The CDP call outlasts the in-page wait, so a slow panel fails as a paint timeout, not a CDP cut-off.
  assert.ok(budgets.every(budget => budget > 50), 'each probe gets a CDP budget beyond its in-page timeout');
  assert.ok(rows.every(row => Object.values(row).every(value => ['number', 'string', 'boolean'].includes(typeof value))));
  await assert.rejects(measureBrowserInteractions(browser, { timeout: NaN }), /Invalid interaction timeout/);
});

function fixture() {
  return {
    unlock: { member: 'player1' }, taskMilestoneEvent: 'tasks-shown',
    milestones: { selectedTasksShownMs: 530, tasksShownMs: 530, tasksPaintedMs: 565 },
    taskResponses: [{ memberId: 'player1', revision: 9, startMs: 490, endMs: 500,
      cache: { hit: false, requestMs: 400, evaluationMs: 350 } }],
    network: { requests: [{ path: '/api/tasks', status: 200, startMs: 50, responseMs: 490, endMs: 498 }] },
    serverCalculations: [{ memberId: 'player1', revision: 9, startedMs: 100, doneMs: 450 }],
  };
}

test('unlock timeline separates observed calculation timestamps from the overhead estimate', () => {
  const timeline = unlockTimeline(fixture());
  assert.equal(timeline.calculationRequestSentMs, 50);
  assert.equal(timeline.calculationStartMs, 100);
  assert.equal(timeline.calculationDoneMs, 450);
  assert.equal(timeline.calculationMs, 350);
  assert.equal(timeline.requestToCalculationStartMs, 50);
  assert.equal(timeline.calculationDoneToPaintMs, 115);
  assert.equal(timeline.doneToPaintMs, 115);
  assert.equal(timeline.clickToPaintMs, 565);
  assert.equal(timeline.selectedResultsPaintedMs, 565);
  assert.equal(timeline.groupResultsPaintedMs, null);
  assert.equal(timeline.estimatedServerOverheadMs, 50);
  assert.match(timeline.estimateBasis, /uncertainty/);
  assert.ok(Object.values(timeline).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
});

test('post-click worker calculation may precede the task fetch and later serve a cache hit', () => {
  const result = fixture();
  result.serverCalculations[0].startedMs = 40;
  result.taskResponses[0].cache = { hit: true, evaluationMs: 410, requestMs: 0.5 };
  const timeline = unlockTimeline(result);
  assert.equal(timeline.cacheHit, true);
  assert.equal(timeline.calculationStartMs, 40);
  assert.equal(timeline.requestToCalculationStartMs, -10);
  assert.equal(timeline.calculationMs, 410);
  assert.equal(timeline.clickToRequestMs + timeline.requestToCalculationStartMs + timeline.calculationMs + timeline.doneToPaintMs, timeline.clickToPaintMs);
});

test('missing worker timestamps never turn a request-minus-evaluation estimate into an observation', () => {
  const result = fixture(); delete result.serverCalculations; delete result.milestones.tasksPaintedMs;
  const timeline = unlockTimeline(result);
  assert.equal(timeline.calculationStartMs, null);
  assert.equal(timeline.calculationDoneMs, null);
  assert.equal(timeline.calculationMs, null);
  assert.equal(timeline.estimatedCalculationStartMs, 100);
  assert.equal(timeline.resultsPaintedMs, null);
  assert.equal(timeline.resultsShownMs, 530);
});

test('cache hits have no invented calculation and impossible timing differences stay null', () => {
  const result = fixture(); result.serverCalculations = [];
  result.taskResponses[0].cache = { hit: true, requestMs: 4, evaluationMs: 0 };
  let timeline = unlockTimeline(result);
  assert.equal(timeline.cacheHit, true);
  assert.equal(timeline.estimatedCalculationStartMs, null);
  assert.equal(timeline.calculationStartMs, null);
  result.taskResponses[0].cache = { hit: false, requestMs: 4, evaluationMs: 40 };
  timeline = unlockTimeline(result);
  assert.equal(timeline.estimatedServerOverheadMs, null);
  assert.equal(timeline.estimatedCalculationStartMs, null);
  assert.equal(unlockTimeline().calculationRequestSentMs, null);
});

test('ambiguous task requests and worker calculations stay unassigned', () => {
  const result = fixture();
  result.network.requests.push({ ...result.network.requests[0], startMs: 60, endMs: 499 });
  result.serverCalculations.push({ ...result.serverCalculations[0], startedMs: 110, doneMs: 460 });
  const timeline = unlockTimeline(result);
  assert.equal(timeline.calculationRequestSentMs, null);
  assert.equal(timeline.calculationStartMs, null);
  assert.equal(timeline.estimatedCalculationStartMs, null);
});

test('observed task fetch selects the member with simultaneous endpoint requests', () => {
  const result = fixture(); result.serverCalculations = [];
  result.taskResponses[0].requestStartMs = 48;
  result.taskResponses[0].cache = { hit: true, requestMs: 4, evaluationMs: 0 };
  result.taskResponses.push({ memberId: 'player2', revision: 9, requestStartMs: 60, startMs: 491, endMs: 501 });
  result.network.requests.push({ ...result.network.requests[0], startMs: 60, endMs: 499 });
  const timeline = unlockTimeline(result);
  assert.equal(timeline.calculationRequestSentMs, 48);
  assert.equal(timeline.requestMatch, 'observed-task-fetch');
  assert.equal(timeline.calculationStartMs, null);
  assert.equal(timeline.calculationDoneMs, null);
  assert.equal(timeline.estimatedCalculationStartMs, null);
  assert.equal(timeline.clickToPaintMs, 565);
  assert.equal(timeline.doneToPaintMs, null);
});

test('selected member/revision and paint scope disambiguate group output', () => {
  const result = fixture(); result.taskMilestoneEvent = 'duo-tasks-shown';
  result.milestones.selectedTasksPaintedMs = 550;
  result.taskResponses.push({ memberId: 'player2', revision: 9, startMs: 492, endMs: 520, cache: { hit: true } });
  result.serverCalculations.push({ memberId: 'player2', revision: 9, startedMs: 95, doneMs: 470 });
  result.serverCalculations.push({ memberId: 'player1', revision: 8, startedMs: 80, doneMs: 420 });
  const timeline = unlockTimeline(result);
  assert.equal(timeline.calculationStartMs, 100);
  assert.equal(timeline.selectedResultsPaintedMs, 550);
  assert.equal(timeline.groupResultsPaintedMs, 565);
});

test('invalid scalar values are dropped instead of becoming misleading zeroes', () => {
  const result = fixture(); result.taskResponses[0].cache = { requestMs: '400', evaluationMs: Infinity };
  result.milestones.tasksPaintedMs = -1;
  const timeline = unlockTimeline(result);
  assert.equal(timeline.serverRequestMs, null);
  assert.equal(timeline.evaluationMs, null);
  assert.equal(timeline.resultsPaintedMs, null);
});
