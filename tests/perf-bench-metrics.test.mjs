import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserInteraction, interactionScenarios, measureBrowserInteractions, unlockTimeline } from '../scripts/perf/browser-interactions.mjs';

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
});

test('UI measurements run sequentially through the existing browser and return scalar rows', async () => {
  let active = false;
  const expressions = [];
  const browser = { async evaluate(expression) {
    assert.equal(active, false); active = true;
    expressions.push(expression);
    await Promise.resolve(); active = false;
    const name = expression.match(/\)\("([a-z-]+)",50\)$/)?.[1];
    assert.ok(name);
    return { name, durationMs: 12, completion: 'content-plus-two-animation-frames' };
  } };
  const rows = await measureBrowserInteractions(browser, { timeout: 50, scenarios: ['panels', 'search'] });
  assert.deepEqual(rows.map(row => row.name), ['chunk-info', 'possible-tasks', 'search']);
  assert.equal(expressions.length, 3);
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
