// Optional owned-open diagnostics. No gameplay input, environment switch or
// observer exception can affect the open. Memory belongs to the shared process.
export function beginOpenDiagnostics(observer, pickerId, { now = () => performance.now(), memory = () => process.memoryUsage() } = {}) {
  if (typeof observer !== 'function') return undefined;
  const started = now(), before = memory(), timingMs = {};
  return {
    timingMs,
    finish(status, reason) {
      const after = memory();
      try { observer({ pickerId, status, reason, totalMs: now() - started, timingMs: { ...timingMs },
        memory: { scope: 'shared server process; overlapping opens and GC affect deltas', before, after,
          delta: { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed } } }); } catch { /* Diagnostic only. */ }
    },
  };
}
