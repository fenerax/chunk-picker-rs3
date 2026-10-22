// Publish only harness-owned messages. Redacting arbitrary app text cannot prove
// that a short name, note, payload or credential has been removed.
const fixed = new Set([
  'Timed out waiting for the scratch benchmark.', 'Chrome exited during startup.',
  'Chrome executable not found; use --chrome PATH.', 'Unsafe Chrome port.',
  'Chrome sandbox initialization failed.', 'Chrome could not start.',
  'Chrome debugger port is already in use.',
  'Node heap limit reached.',
  'CDP connection failed.', 'CDP closed.', 'Benchmark browser probe failed.',
  'Scratch server startup timed out.', 'Scratch server could not start.',
  'Scratch server exited during startup.', 'Scratch server startup failed.',
  'Scratch authentication failed.', 'RSS probe timed out.',
  'Scratch document changed during interaction.',
  'Child process did not exit; scratch retained.',
  'Shutdown failed; benchmark scratch retained for recovery.',
  'Benchmark save import failed.', 'Benchmark child could not start.',
  'App or imported fixture changed between repetitions.',
  'Harness changed during paired measurement.', 'Save SHA256 mismatch; import refused.',
  'Scratch interaction control missing.', 'Scratch interaction content timed out.',
  'Scratch interaction paint timed out.', 'Scratch search failed.',
  'Scratch chunk tasks failed.', 'Scratch group tasks failed.',
  'Source and scratch directories must not overlap.',
  'Source state changed during copy. Retry with a stable snapshot.',
  'No note-free unlocked chunk available for the scratch note save.', 'Scratch note clear did not restore the copied save.',
  'No note-free unlocked chunk available for the scratch save burst.', 'Scratch save burst did not restore the copied save.',
]);
const scenario = '(?:cold|reload|unlock|cold-30mbps|switch-player[12]|prepare-player[12]|chunk-info|possible-tasks|search|note-save|note-clear|save-burst|personal-filter-(?:not-done|only-player|group))';
// API routes and statuses only: asset paths can name chunks, so any other path withholds the message.
const apiFailure = '/api/[a-z-]+ \\((?:\\d{3}|no status)\\)';
const patterns = [
  new RegExp(`^Task status failed in ${scenario}\\.$`),
  new RegExp(`^Unexpected group view in ${scenario}; refusing a mismatched benchmark\\.$`),
  /^CDP (?:Runtime\.evaluate|Page\.(?:enable|navigate|reload|addScriptToEvaluateOnNewDocument)|Network\.(?:enable|setCookie|clearBrowserCache|emulateNetworkConditions)|Browser\.(?:getVersion|close)|Emulation\.setDeviceMetricsOverride) (?:failed|timed out)\.$/,
  /^Benchmark child failed \((?:\d+|SIG[A-Z]+)\)\.$/,
  /^Scratch server exited unexpectedly \((?:\d+|SIG[A-Z]+)\)\.$/,
  /^No locked player[12] chunk available for scratch unlock \((?:any|prepared|unprepared)\)\.$/,
  new RegExp(`^Asset/API failure in ${scenario}: (?:${apiFailure}(?:, ${apiFailure})*|visible tiles); refusing a misleading benchmark\\.$`),
  /^Save burst command \d+ failed \(\d{3}\)\.$/,
];
export const DIAGNOSTIC_PREFIX = 'PERF_DIAGNOSTIC ';
export const SERVER_MEMORY_SAMPLE_INTERVAL_MS = 1000;
const memoryKeys = ['rssBytes', 'heapUsedBytes', 'heapTotalBytes', 'externalBytes', 'arrayBuffersBytes'];
const numericMemory = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function serverMemorySample(usage, heapSizeLimitBytes, sampledAtEpochMs) {
  return { sampledAtEpochMs: numericMemory(sampledAtEpochMs),
    rssBytes: numericMemory(usage?.rss), heapUsedBytes: numericMemory(usage?.heapUsed),
    heapTotalBytes: numericMemory(usage?.heapTotal), externalBytes: numericMemory(usage?.external),
    arrayBuffersBytes: numericMemory(usage?.arrayBuffers), heapSizeLimitBytes: numericMemory(heapSizeLimitBytes) };
}
export function sanitizeMemoryTelemetry(value) {
  if (!value?.last || numericMemory(value.last.sampledAtEpochMs) === null) return null;
  return { sampleIntervalMs: SERVER_MEMORY_SAMPLE_INTERVAL_MS,
    samples: Number.isSafeInteger(value.samples) && value.samples > 0 ? value.samples : null,
    last: Object.fromEntries(['sampledAtEpochMs', ...memoryKeys, 'heapSizeLimitBytes'].map(key => [key, numericMemory(value.last[key])])),
    peak: Object.fromEntries(memoryKeys.map(key => [key, numericMemory(value.peak?.[key])])) };
}
export function recordServerMemory(previous, sample) {
  const last = sanitizeMemoryTelemetry({ last: sample })?.last;
  if (!last) return sanitizeMemoryTelemetry(previous);
  const retained = sanitizeMemoryTelemetry(previous);
  return { sampleIntervalMs: SERVER_MEMORY_SAMPLE_INTERVAL_MS, samples: (retained?.samples ?? 0) + 1, last,
    // Independent sampled maxima, not a simultaneous snapshot or true allocation peak.
    peak: Object.fromEntries(memoryKeys.map(key => {
      const values = [last[key], retained?.peak[key]].filter(value => value !== null && value !== undefined);
      return [key, values.length ? Math.max(...values) : null];
    })) };
}
const classNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'AggregateError']);
const errorCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EADDRINUSE', 'ENOMEM', 'ENOSPC', 'EIO',
  'EMFILE', 'ENFILE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE',
  'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_DLOPEN_FAILED', 'ERR_WORKER_OUT_OF_MEMORY']);
const frameNames = new Set(['page-load.mjs', 'cdp.mjs', 'probe.mjs', 'inputs.mjs', 'server.mjs',
  'worker.mjs', 'worker-timeline.mjs', 'browser-interactions.mjs', 'network-collector.mjs',
  'diagnostics.mjs', 'perf-bench.mjs', 'perf-bench-import.mjs', 'perf-bench-report.mjs',
  'perf-bench-config.mjs', 'perf-bench-packs.mjs']);
const safeFrame = value => {
  const match = typeof value === 'string' && /^([a-z][a-z0-9-]*\.mjs):\d+:\d+$/.exec(value);
  return !!match && frameNames.has(match[1]);
};
export function safeMessage(value) {
  const message = typeof value === 'string' ? value : '';
  return fixed.has(message) || patterns.some(pattern => pattern.test(message)) ? message : 'Unrecognized error message withheld.';
}
export function safeDiagnostic(error, context = {}) {
  const result = { errorClass: classNames.has(error?.name) ? error.name : 'Error', message: safeMessage(error?.message) };
  if (errorCodes.has(error?.code)) result.code = error.code;
  if (['import', 'copy', 'server-start', 'chrome-start', 'authenticate', 'measure', 'prepare-unlock', 'interactions', 'diagnostics', 'rss', 'screenshots', 'cleanup', 'integrity'].includes(context.stage)) result.stage = context.stage;
  if (new RegExp(`^${scenario}$`).test(context.scenario ?? '')) result.scenario = context.scenario;
  // Basenames and line numbers are enough to locate unknown failures; no stack
  // arguments, absolute paths, exception source snippets or app messages escape.
  const stack = String(error?.stack ?? ''), heading = `${error?.name}: ${error?.message}`;
  const frames = stack.startsWith(heading) ? stack.slice(heading.length) : stack.slice(stack.indexOf('\n') + 1);
  result.frames = frames.split(/\r?\n/).filter(line => /^\s+at /.test(line))
    .flatMap(line => [...line.matchAll(/(?:[/\\])([a-z][a-z0-9-]*\.mjs):(\d+):(\d+)/g)]
      .map(match => `${match[1]}:${match[2]}:${match[3]}`)).filter(safeFrame).slice(0, 6);
  return result;
}
export function safeStderrTail(value) {
  return String(value).split(/\r?\n/).flatMap(line => {
    if (/FATAL ERROR: (?:Reached heap limit|Ineffective mark-compacts near heap limit|.*(?:JavaScript heap out of memory|Allocation failed - process out of memory))/.test(line)) return ['Node heap limit reached.'];
    if (line.startsWith(DIAGNOSTIC_PREFIX)) {
      try {
        const input = JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length));
        const diagnostic = safeDiagnostic({ name: input.errorClass, message: input.message, code: input.code }, input);
        diagnostic.frames = (Array.isArray(input.frames) ? input.frames : []).filter(safeFrame).slice(0, 6);
        return [DIAGNOSTIC_PREFIX + JSON.stringify(diagnostic)];
      } catch { return []; }
    }
    const message = line.replace(/^Performance benchmark failed: /, '');
    return safeMessage(message) === message ? [message] : [];
  }).slice(-8);
}
export function chromeStartupMessage(stderr) {
  if (/No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox helper|sandbox_linux.*InitializeSandbox|apparmor.*denied/i.test(stderr)) return 'Chrome sandbox initialization failed.';
  if (/bind\(\) failed: Address already in use|Cannot start http server for devtools/i.test(stderr)) return 'Chrome debugger port is already in use.';
  return 'Chrome exited during startup.';
}
