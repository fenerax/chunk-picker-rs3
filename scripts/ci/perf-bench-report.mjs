import { unlockTimeline, commandTimeline, saveBurstTimeline } from '../perf/browser-interactions.mjs';
import { sanitizeMemoryTelemetry } from '../perf/diagnostics.mjs';

const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const NOTE_EDITS = ['note-save', 'note-clear'];
const otherApiRoutes = result => (result.network?.requests ?? []).reduce((routes, request) => {
  if (/^\/api\/[a-z-]+(?:\/[a-z-]+)?$/.test(request.path ?? '') && !['/api/command', '/api/tasks', '/api/events'].includes(request.path)) routes[request.path] = (routes[request.path] ?? 0) + 1;
  return routes;
}, {});
const workerEvents = result => (result.serverCalculations ?? []).slice(0, 8).map(event => ({
  startedMs: numeric(event.startedMs), doneMs: numeric(event.doneMs),
  selectedMember: event.memberId === result.taskIdentity?.memberId,
  matchingRevision: event.revision === result.taskIdentity?.revision }));
export function extractObservations(report) {
  const results = name => (report.suites ?? []).flatMap(suite => (suite.results ?? []).filter(result => name(result.name)));
  return { unlock: results(name => name === 'unlock').map(result => {
    const timeline = unlockTimeline(result);
    return { cacheHit: timeline.cacheHit, calculationObserved: timeline.calculationStartMs !== null && timeline.calculationDoneMs !== null,
      requestMatch: ['observed-task-fetch', 'single-timing-match', 'single-task-request'].includes(timeline.requestMatch) ? timeline.requestMatch : null,
      workerEvents: workerEvents(result) };
  }), noteEdits: results(name => NOTE_EDITS.includes(name)).map(result => {
    // Fixed edit labels only: never the synthetic text, chunk or member.
    const timeline = commandTimeline(result);
    return { edit: result.name === 'note-save' ? 'save' : 'clear', cacheHit: timeline.cacheHit,
      calculationObserved: timeline.calculationObserved, workerCalculations: timeline.workerCalculations,
      commandMatch: ['single-command', 'ambiguous'].includes(timeline.commandMatch) ? timeline.commandMatch : null,
      workerEvents: workerEvents(result) };
  }), saveBursts: results(name => name === 'save-burst').map(result => {
    // Counts and flags only; the burst's chunk, member and text never reach the report.
    const timeline = saveBurstTimeline(result);
    return { commands: timeline.commands, stateFetches: timeline.stateFetches, stateFetchesFailed: timeline.stateFetchesFailed,
      tasksPaintObserved: timeline.tasksPaintObserved, restored: timeline.restored };
  }) };
}
export function failureReadiness(report) {
  const measurement = report?.failedSuite?.failedMeasurement;
  if (!report?.failedSuite) return null;
  const snapshot = measurement?.lastSnapshot;
  const events = new Set(['state-adopted', 'tasks-shown', 'duo-tasks-shown', 'visible-tiles-loaded']);
  const endpoints = new Set(['/api/state', '/api/definitions', '/api/rules', '/api/tasks', '/api/map-info', '/api/display-world']);
  const requests = Array.isArray(measurement?.requests) ? measurement.requests : [];
  return { wallMs: numeric(measurement?.wallMs), hostOomKillDelta: numeric(report.failedSuite?.hostOomKillDelta),
    serverMemoryTelemetry: sanitizeMemoryTelemetry(report.failedSuite?.serverMemoryTelemetry),
    serverExit: { code: Number.isInteger(report.failedSuite?.serverExit?.code) ? report.failedSuite.serverExit.code : null,
      signal: /^SIG(?:KILL|ABRT|SEGV|TERM|INT|TRAP)$/.test(report.failedSuite?.serverExit?.signal ?? '') ? report.failedSuite.serverExit.signal : null },
    tasksReady: typeof snapshot?.tasksReady === 'boolean' ? snapshot.tasksReady : null,
    taskError: typeof snapshot?.taskError === 'boolean' ? snapshot.taskError : null,
    milestones: (Array.isArray(snapshot?.milestones) ? snapshot.milestones : []).filter(event => events.has(event.name))
      .map(event => ({ name: event.name, timeMs: numeric(event.timeMs), visible: numeric(event.visible), failed: numeric(event.failed) })),
    requestCount: requests.length, pendingCount: requests.filter(request => request.pending === true).length,
    failedEndpoints: requests.filter(request => endpoints.has(request.path) && (request.failed === true || request.status >= 400))
      .map(request => ({ path: request.path, status: Number.isInteger(request.status) && request.status >= 100 && request.status < 600 ? request.status : null })) };
}
export function extractMetrics(report) {
  const metrics = {};
  const put = (key, value, signed = false) => { metrics[key] = signed && typeof value === 'number' && Number.isFinite(value) ? value : numeric(value); };
  for (const suite of report.suites ?? []) {
    const prefix = suite.mode === 'throttled' ? 'cold-30mbps' : 'server';
    put(`${prefix}.ready.ms`, suite.server?.coldReadyMs);
    put(`${prefix}.rss-ready.MiB`, numeric(suite.server?.rssReadyBytes) === null ? null : suite.server.rssReadyBytes / 1048576);
    put(`${prefix}.rss-after.MiB`, numeric(suite.server?.rssAfterBytes) === null ? null : suite.server.rssAfterBytes / 1048576);
    put(`${prefix}.rss-total-after.MiB`, numeric(suite.server?.rssAfterTotalBytes) === null ? null : suite.server.rssAfterTotalBytes / 1048576);
    put(`${prefix}.rss-calculators-after.MiB`, numeric(suite.server?.workersRssAfterBytes) === null ? null : suite.server.workersRssAfterBytes / 1048576);
    // Live calculator processes at that sample: a retired lane lowers RSS without any saving.
    put(`${prefix}.calculators-after.count`, suite.server?.workerRssSamples);
    for (const lane of ['foreground', 'death', 'prediction', 'duo']) {
      const resident = suite.server?.residencyAfter?.lanes?.[lane]?.worker?.resident;
      put(`${prefix}.${lane}-resident-after.count`, typeof resident === 'boolean' ? Number(resident) : null);
    }
    // Why a prediction calculator is still alive: busy, or idle after finished warm-ups.
    const prediction = suite.server?.residencyAfter?.lanes?.prediction;
    put(`${prefix}.prediction-busy-after.count`, numeric(prediction?.queue?.active));
    put(`${prefix}.prediction-warm-completed-after.count`, numeric(prediction?.prewarm?.completed));
    put(`${prefix}.prediction-warm-cancelled-after.count`, numeric(prediction?.prewarm?.cancelled));
    put(`${prefix}.rss-sampled-peak.MiB`, numeric(suite.server?.memoryTelemetry?.peak?.rssBytes) === null ? null : suite.server.memoryTelemetry.peak.rssBytes / 1048576);
    put(`${prefix}.heap-sampled-peak.MiB`, numeric(suite.server?.memoryTelemetry?.peak?.heapUsedBytes) === null ? null : suite.server.memoryTelemetry.peak.heapUsedBytes / 1048576);
    for (const result of suite.results ?? []) {
      if (result.durationMs !== undefined) { put(`${result.name}.paint.ms`, result.durationMs); continue; }
      const name = result.name;
      for (const [field, value] of Object.entries(result.milestones ?? {})) {
        if (field.endsWith('Ms')) put(`${name}.${field.replace(/Ms$/, '')}.ms`, value);
      }
      put(`${name}.wire.KiB`, numeric(result.network?.totals?.transferBytes) === null ? null : result.network.totals.transferBytes / 1024);
      put(`${name}.long-task-worst.ms`, result.longTasks?.worstMs);
      // Older harness reports lack the field and stay missing, not zero.
      if (result.supersededRequests !== undefined) put(`${name}.superseded.count`, result.supersededRequests);
      if (name === 'unlock') for (const [field, value] of Object.entries(unlockTimeline(result))) {
        if (field.endsWith('Ms')) put(`unlock.${field.replace(/Ms$/, '')}.ms`, value, field === 'requestToCalculationStartMs');
      }
      if (NOTE_EDITS.includes(name)) {
        const timeline = commandTimeline(result);
        put(`${name}.commandSent.ms`, timeline.commandSentMs);
        put(`${name}.commandRoundTrip.ms`, timeline.commandRoundTripMs);
        put(`${name}.taskFetches.count`, timeline.taskFetches);
        // Other reads in the edit window, by public route name only.
        for (const [route, count] of Object.entries(otherApiRoutes(result))) put(`${name}.api${route.slice(4).replaceAll('/', '.')}.count`, count);
        for (const [lane, value] of Object.entries(result.residencyBefore?.lanes ?? {})) {
          put(`${name}.before.${lane}-resident.count`, typeof value?.worker?.resident === 'boolean' ? Number(value.worker.resident) : null);
          put(`${name}.before.${lane}-starting.count`, typeof value?.worker?.status === 'string' ? Number(['starting', 'waking', 'restarting'].includes(value.worker.status)) : null);
          put(`${name}.before.${lane}-busy.count`, numeric(value?.queue?.active));
          put(`${name}.before.${lane}-queued.count`, numeric(value?.queue?.depth));
          put(`${name}.before.${lane}-warm-pending.count`, numeric(value?.prewarm?.pending));
        }
        put(`${name}.commandAcknowledged.ms`, timeline.commandAcknowledgedMs);
        put(`${name}.acknowledgedToPaint.ms`, timeline.acknowledgedToPaintMs);
      }
      // Milestones above already give lastCommitted, caughtUp and tasksPainted.
      if (name === 'save-burst') put('save-burst.stateFetches.count', saveBurstTimeline(result).stateFetches);
    }
  }
  return metrics;
}

export function distribution(values, { signed = false } = {}) {
  const sorted = values.filter(value => signed ? typeof value === 'number' && Number.isFinite(value) : numeric(value) !== null).sort((a, b) => a - b);
  const n = sorted.length, middle = Math.floor(n / 2);
  return { n, median: n ? n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted.at(-1) : null };
}

export function compareSamples(samples, runs) {
  const views = [...new Set(samples.map(sample => sample.groupView))];
  const summary = [];
  for (const groupView of views) {
    const rows = samples.filter(sample => sample.groupView === groupView);
    const names = [...new Set(rows.flatMap(row => Object.keys(row.metrics)))].sort();
    for (const metric of names) {
      const signed = metric === 'unlock.requestToCalculationStart.ms';
      const a = distribution(rows.filter(row => row.arm === 'A').map(row => row.metrics[metric]), { signed });
      const b = distribution(rows.filter(row => row.arm === 'B').map(row => row.metrics[metric]), { signed });
      const complete = a.n === runs && b.n === runs;
      const verdict = !complete ? 'missing' : runs < 3 ? 'noise' : b.max < a.min ? 'win' : b.min > a.max ? 'loss' : 'noise';
      summary.push({ groupView, metric, a, b, delta: a.median === null || b.median === null ? null : b.median - a.median,
        percent: a.median > 0 && b.median !== null ? (b.median / a.median - 1) * 100 : null, verdict });
    }
  }
  return summary;
}

const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
export function markdownTable(summary) {
  return ['| Group | Metric | A median [min–max] | B median [min–max] | B−A | Runs A/B | Result |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...summary.map(row => `| ${row.groupView} | ${row.metric} | ${number(row.a.median)} [${number(row.a.min)}–${number(row.a.max)}] | ${number(row.b.median)} [${number(row.b.min)}–${number(row.b.max)}] | ${number(row.delta)} | ${row.a.n}/${row.b.n} | ${row.verdict} |`)].join('\n');
}

export function reportMarkdown(report, { short = false } = {}) {
  const headline = /^(unlock\.(clickToRequest|requestToCalculationStart|calculation|doneToPaint|clickToPaint)|cold\.tasksPainted|reload\.tasksPainted|cold-30mbps\.tasksPainted|chunk-info\.paint|possible-tasks\.paint|search\.paint|note-(?:save|clear)\.(?:commandAcknowledged|tasksPainted)|personal-filter-[a-z-]+\.paint|save-burst\.(?:lastCommitted|caughtUp|tasksPainted|stateFetches)|server\.rss-(?:total-)?after)\./;
  const rows = short ? report.summary.filter(row => headline.test(row.metric)) : report.summary;
  return ['# App performance A/B', '', `A: \`${report.base}\`; B: \`${report.candidate}\`.`,
    `Completed: ${report.complete}. ${report.samples.length} measured app/view trials; ${report.request.runs} repetitions per arm/view.`, '',
    ...(report.executionPolicy ? [`Execution policy: ${report.executionPolicy.workerMode === 'process' ? 'process' : 'unspecified'} calculator workers; server old-generation heap ${number(numeric(report.executionPolicy.serverHeapMiB))} MiB; calculator old-generation heap ${number(numeric(report.executionPolicy.calculatorHeapMiB))} MiB. Keep different worker/heap policies separate.`, ''] : []),
    ...(report.runner ? [`Runner: ${number(numeric(report.runner.totalMemoryMiB))} MiB RAM, ${number(numeric(report.runner.freeMemoryMiB))} MiB free at start, ${number(numeric(report.runner.cpuCount))} CPUs.`, ''] : []),
    'Lower is better. A win/loss requires at least three complete samples per arm and strictly non-overlapping observed min–max ranges. Overlap is noise; absent observations are missing. This is a conservative descriptive rule, not a confidence interval.', '',
    'Request → calculation start is signed: a negative value means Unlock handling started the worker before the browser task fetch. The other breakdown parts are durations; their sum still equals click → paint. An HTTP cache hit can follow fresh post-click worker calculation.', '',
    ...(report.diagnostic ? [`Failure context: ${JSON.stringify(report.failureContext)}.`,
      `Diagnostic: ${JSON.stringify(report.diagnostic)}.`, ''] : []),
    markdownTable(rows), '', ...(short ? [] : [
    'Unlock starts at the browser click handler. Request sent is the observed task fetch call. Calculation start/done are worker receipt/completion timestamps from the same harness preload on both apps, aligned by epoch clocks. They exclude process relay/queue time before worker receipt. Cache reuse can omit worker events; missing start/done stays missing. Results painted means the matching task DOM event plus two animation frames. Group on waits for both lists.', '',
      'Note save/clear start at the Save chunk note click with fixed synthetic text on a note-free unlocked scratch chunk; clear restores the copied save. Command acknowledged is the end of the one successful command response (missing if a retry makes it ambiguous). Tasks painted is the current task paint at the new revision, as for Unlock. Personal filter rows are Group view only: the select change through the next duo task mark plus two stable frames; Group off records them as missing.', '',
      'Save burst sends 20 sequential partner note saves/clears from a second scratch session outside the browser (even, so the copied save is restored); zero is the page clock just before the first send. Last committed is the final command response; caught up is the first save-status confirmation of the final revision. Tasks painted is the selected member\'s task paint at that revision and stays missing when the page reuses unchanged results without one. State reads count the page\'s /api/state requests in the window; a per-event client and a draining client differ there by design.', '',
      'Server RSS at ready/after covers the HTTP process and native threads. The separate total-after sample adds calculator process RSS once per process; a failed calculator sample makes the total unavailable. Server sampled peaks use one-second numeric samples and can miss transients; calculators and Chrome are excluded from those peaks. Cold clears browser/server caches but does not flush OS file caches. Profiling is off.', '',
      'The report retains scalar timings, hashes and public tool versions only. Save contents, paths, request bodies, cookies and raw harness reports are excluded.',
      ...(report.failure ? ['', `Failure: ${report.failure}`] : []),
    ])].join('\n') + '\n';
}
