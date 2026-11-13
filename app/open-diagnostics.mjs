// Optional owned-open diagnostics. No gameplay input, environment switch or
// observer exception can affect the open. Memory belongs to the shared process.
let sequence = 0;
export function beginOpenDiagnostics(observer, pickerId, { now = () => performance.now(), memory = () => process.memoryUsage() } = {}) {
  if (typeof observer !== 'function') return undefined;
  const openId = ++sequence, started = now(), before = memory(), timingMs = {};
  return {
    timingMs,
    finish(status, reason, phase = 'factory') {
      if (phase === 'factory') timingMs.factoryMs = now() - started;
      const after = memory();
      try { observer({ pickerId, openId, status, reason, phase, totalMs: timingMs[`${phase}Ms`] ?? now() - started, timingMs: { ...timingMs },
        memory: { scope: 'shared server process; overlapping opens and GC affect deltas', before, after,
          delta: { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed } } }); } catch { /* Diagnostic only. */ }
    },
  };
}
