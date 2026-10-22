// These probes operate only on the scratch browser supplied by page-load.mjs.
// Only fixed scenario labels and numeric timings leave the renderer.
export const INTERACTION_SCENARIOS = ['chunk-info', 'possible-tasks', 'search', 'group-view-on', 'group-view-off'];

export function interactionScenarios(scenarios = ['panels', 'search', 'group-view']) {
  return [...new Set(scenarios.flatMap(name => name === 'panels' ? ['chunk-info', 'possible-tasks']
    : name === 'group-view' ? ['group-view-on', 'group-view-off'] : INTERACTION_SCENARIOS.includes(name) ? [name] : []))];
}

// Kept self-contained so CDP evaluates the same code tested with DOM fixtures.
export async function browserInteraction(name, timeout) {
  const byId = id => document.getElementById(id);
  const required = node => { if (!node) throw new Error('Scratch interaction control missing.'); return node; };
  const closeDialog = () => { if (byId('tool-dialog')?.open) required(document.querySelector('#tool-dialog .dialog-header button')).click(); };
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const wait = async predicate => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() >= end) throw new Error('Scratch interaction content timed out.');
      await nextFrame();
    }
  };
  const searchReady = () => {
    const results = document.querySelector('#tool-dialog .search-results');
    if (results?.querySelector('.error')) throw new Error('Scratch search failed.');
    return byId('tool-dialog')?.open && results && results.getAttribute('aria-busy') !== 'true'
      && !!results.querySelector('.search-result button');
  };
  const openSearch = async () => {
    closeDialog(); required(byId('search-open')).click();
    await wait(() => document.querySelector('#tool-dialog input[type="search"]'));
    const input = required(document.querySelector('#tool-dialog input[type="search"]'));
    // Public game location, independent of player names, notes and save contents.
    input.value = 'Lumbridge'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(searchReady);
  };
  const chunkReady = () => !byId('chunk-info')?.hidden && !!document.querySelector('#chunk-content [role="tabpanel"]')?.children.length;
  const openChunk = async () => {
    await openSearch(); required(document.querySelector('#tool-dialog .search-result button')).click();
    await wait(chunkReady);
    required(document.querySelector('#chunk-content [data-tab="contents"]')).click();
  };
  const tasksReady = () => {
    const panel = document.querySelector('#chunk-content [role="tabpanel"]');
    if (panel?.querySelector('.error')) throw new Error('Scratch chunk tasks failed.');
    return !!panel?.querySelector('.task-filter-bar');
  };
  let target, ready, action;
  closeDialog();
  if (name === 'search') {
    target = required(byId('tool-dialog')); ready = searchReady;
    action = openSearch;
  } else if (name === 'chunk-info') {
    // Establish Contents as the existing remembered tab outside the measurement.
    await openChunk(); required(byId('chunk-close')).click(); await openSearch();
    target = required(byId('chunk-info')); ready = chunkReady;
    action = () => required(document.querySelector('#tool-dialog .search-result button')).click();
  } else if (name === 'possible-tasks') {
    await openChunk(); target = required(byId('chunk-content')); ready = tasksReady;
    action = async () => {
      required(document.querySelector('#chunk-content [data-tab="tasks"]')).click();
      const section = () => [...document.querySelectorAll('#chunk-content details')]
        .find(node => node.querySelector('summary')?.textContent === 'Possible Tasks');
      await wait(section);
      if (!section().open) required(section().querySelector('summary')).click();
    };
  } else if (name === 'group-view-on' || name === 'group-view-off') {
    const checkbox = required(byId('group-view')), wanted = name === 'group-view-on';
    const groupReady = () => {
      const status = byId('task-engine-status')?.textContent ?? '';
      if (/failed|unavailable|restart required/i.test(status)) throw new Error('Scratch group tasks failed.');
      return /[0-9,]+ possible tasks/.test(status) && !/updating/i.test(byId('task-count')?.textContent ?? '');
    };
    if (checkbox.checked === wanted) {
      const before = performance.now(); checkbox.click();
      await wait(() => groupReady() && (!checkbox.checked || window.__rs3Perf?.events.some(e => e.name === 'duo-tasks-shown' && e.time >= before)));
    }
    target = required(byId('phone-task-panel'));
    ready = () => groupReady() && (!wanted || window.__rs3Perf?.events.some(e => e.name === 'duo-tasks-shown' && e.time >= started));
    action = () => checkbox.click();
  } else throw new Error('Unknown scratch interaction.');

  let changed = true;
  const observer = new MutationObserver(() => { changed = true; });
  observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
  const started = performance.now();
  try {
    await action();
    // Readiness is content-specific; stability spans two completed paint chances.
    // Incremental task row construction mutates the target and resets this count.
    let stable = 0;
    while (stable < 2) {
      if (performance.now() - started >= timeout) throw new Error('Scratch interaction paint timed out.');
      changed = false; await nextFrame();
      const imagesReady = [...target.querySelectorAll('img')].every(image => {
        const box = image.getBoundingClientRect();
        return box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth || image.complete;
      });
      stable = ready() && imagesReady && !changed ? stable + 1 : 0;
    }
    return { name, durationMs: performance.now() - started, completion: 'content-plus-two-animation-frames' };
  } finally { observer.disconnect(); }
}

export async function measureBrowserInteractions(browser, { timeout = 180000, scenarios, onScenario = () => {} } = {}) {
  if (!Number.isFinite(timeout) || timeout < 1) throw new Error('Invalid interaction timeout.');
  const rows = [];
  for (const name of interactionScenarios(scenarios)) {
    onScenario(name);
    rows.push(await browser.evaluate(`(${browserInteraction.toString()})(${JSON.stringify(name)},${timeout})`));
  }
  return rows;
}

const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const difference = (end, start) => end !== null && start !== null && end >= start ? end - start : null;

// All times use the page-load scenario clock (the Unlock click is zero).
export function unlockTimeline(result = {}) {
  const milestones = result.milestones ?? {}, shown = numeric(milestones.selectedTasksShownMs ?? milestones.tasksShownMs);
  const responses = (result.taskResponses ?? []).filter(response => numeric(response.endMs) !== null
    && (!result.taskIdentity || response.memberId === result.taskIdentity.memberId && response.revision === result.taskIdentity.revision)
    && (!result.unlock?.member || response.memberId === result.unlock.member) && (shown === null || response.endMs <= shown + 1));
  const selected = responses.toSorted((a, b) => b.endMs - a.endMs)[0];
  const requests = (result.network?.requests ?? []).filter(request => request.path === '/api/tasks' && !request.failed && !request.cancelled
    && numeric(request.startMs) !== null && numeric(request.endMs) !== null && request.status >= 200 && request.status < 400
    && (!selected || request.startMs <= selected.startMs && request.endMs <= selected.endMs + 1 && request.endMs >= selected.startMs - 5));
  // Query strings are deliberately absent: simultaneous matching requests are ambiguous.
  const request = requests.length === 1 ? requests[0] : null;
  const observedRequestStartMs = numeric(selected?.requestStartMs);
  const requestSentMs = observedRequestStartMs ?? numeric(request?.startMs);
  const member = selected?.memberId ?? result.unlock?.member;
  const calculationCandidates = (result.serverCalculations ?? []).filter(calculation => numeric(calculation.startedMs) !== null
    && numeric(calculation.doneMs) !== null && calculation.doneMs >= calculation.startedMs
    && (!member || calculation.memberId === member)
    && (selected?.revision == null || calculation.revision === selected.revision)
    && (selected ? calculation.doneMs <= selected.endMs + 1 : shown !== null && calculation.doneMs <= shown + 1));
  const calculation = calculationCandidates.length === 1 ? calculationCandidates[0] : null;
  const cache = selected?.cache ?? result.taskCalculation ?? {};
  const evaluationMs = numeric(cache.evaluationMs), serverRequestMs = numeric(cache.requestMs);
  const estimatedServerOverheadMs = difference(serverRequestMs, evaluationMs);
  const calculationStartMs = numeric(calculation?.startedMs), calculationDoneMs = numeric(calculation?.doneMs);
  const selectedPaint = numeric(milestones.selectedTasksPaintedMs ?? (result.taskMilestoneEvent !== 'duo-tasks-shown' ? milestones.tasksPaintedMs : null));
  const groupPaint = numeric(milestones.duoTasksPaintedMs ?? (result.taskMilestoneEvent === 'duo-tasks-shown' ? milestones.tasksPaintedMs : null));
  const painted = numeric(milestones.tasksPaintedMs);
  return {
    clickMs: 0, calculationRequestSentMs: requestSentMs,
    requestMatch: observedRequestStartMs !== null ? 'observed-task-fetch' : request ? selected ? 'single-timing-match' : 'single-task-request' : null,
    calculationStartMs, calculationDoneMs, resultsShownMs: shown,
    selectedResultsPaintedMs: selectedPaint, groupResultsPaintedMs: groupPaint, resultsPaintedMs: painted,
    cacheHit: typeof cache.hit === 'boolean' ? cache.hit : null,
    clickToRequestMs: requestSentMs,
    // Unlock command handling can start the worker before the UI fetches tasks.
    // Keep that signed offset; a later cache hit does not erase observed work.
    requestToCalculationStartMs: calculationStartMs !== null && requestSentMs !== null ? calculationStartMs - requestSentMs : null,
    calculationMs: difference(calculationDoneMs, calculationStartMs),
    calculationDoneToPaintMs: difference(painted, calculationDoneMs),
    doneToPaintMs: difference(painted, calculationDoneMs), clickToPaintMs: painted,
    requestToPaintMs: difference(painted, requestSentMs),
    serverRequestMs, evaluationMs, estimatedServerOverheadMs,
    estimatedCalculationStartMs: cache.hit === false && evaluationMs > 0 && requestSentMs !== null && estimatedServerOverheadMs !== null
      ? requestSentMs + estimatedServerOverheadMs : null,
    estimateBasis: estimatedServerOverheadMs === null ? null : 'server-request-minus-evaluation; includes queue, projection and transport uncertainty',
  };
}
