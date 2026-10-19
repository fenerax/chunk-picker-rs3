// Privileged operator diagnostics must never affect writer ownership or await IO.
export function reportActivationTiming(callback, phase, started) {
  if (typeof callback !== 'function') return;
  try {
    const reported = callback({ phase, durationMs: performance.now() - started });
    if (reported?.then) void Promise.resolve(reported).catch(() => {});
  } catch { /* Diagnostics cannot interrupt activation or lock cleanup. */ }
}
