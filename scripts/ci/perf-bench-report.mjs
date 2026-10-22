import { unlockTimeline } from '../perf/browser-interactions.mjs';
import { sanitizeMemoryTelemetry } from '../perf/diagnostics.mjs';

const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function extractObservations(report) {
  return { unlock: (report.suites ?? []).flatMap(suite => (suite.results ?? []).filter(result => result.name === 'unlock').map(result => {
    const timeline = unlockTimeline(result);
    return { cacheHit: timeline.cacheHit, calculationObserved: timeline.calculationStartMs !== null && timeline.calculationDoneMs !== null,
      requestMatch: ['observed-task-fetch', 'single-timing-match', 'single-task-request'].includes(timeline.requestMatch) ? timeline.requestMatch : null,
      workerEvents: (result.serverCalculations ?? []).slice(0, 8).map(event => ({
        startedMs: numeric(event.startedMs), doneMs: numeric(event.doneMs),
        selectedMember: event.memberId === result.taskIdentity?.memberId,
        matchingRevision: event.revision === result.taskIdentity?.revision })) };
  })) };
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
      if (name === 'unlock') for (const [field, value] of Object.entries(unlockTimeline(result))) {
        if (field.endsWith('Ms')) put(`unlock.${field.replace(/Ms$/, '')}.ms`, value, field === 'requestToCalculationStartMs');
      }
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
  const headline = /^(unlock\.(clickToRequest|requestToCalculationStart|calculation|doneToPaint|clickToPaint)|cold\.tasksPainted|reload\.tasksPainted|cold-30mbps\.tasksPainted|chunk-info\.paint|possible-tasks\.paint|search\.paint|server\.rss-(?:total-)?after)\./;
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
      'Server RSS at ready/after covers the HTTP process and native threads. The separate total-after sample adds calculator process RSS once per process; a failed calculator sample makes the total unavailable. Server sampled peaks use one-second numeric samples and can miss transients; calculators and Chrome are excluded from those peaks. Cold clears browser/server caches but does not flush OS file caches. Profiling is off.', '',
      'The report retains scalar timings, hashes and public tool versions only. Save contents, paths, request bodies, cookies and raw harness reports are excluded.',
      ...(report.failure ? ['', `Failure: ${report.failure}`] : []),
    ])].join('\n') + '\n';
}
