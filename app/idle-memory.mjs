// Collect only after calculator retirement and a quiet turn. Async V8 GC still
// pauses the main isolate; never attach it to an HTTP request or save promise.
export function createIdleMemoryReclaimer({ idle, release = () => {},
  collect = typeof globalThis.gc === 'function' ? () => globalThis.gc({ type: 'major', execution: 'async', flavor: 'last-resort' }) : undefined,
  clock = { setTimeout, clearTimeout }, delayMs = 1000 } = {}) {
  let timer, generation = 0, closed = false, collecting = false, wanted = false;
  const counts = { collections: 0, failures: 0, released: 0 };
  let last;
  function cancel() { generation++; clock.clearTimeout(timer); timer = undefined; }
  function schedule() {
    if (closed || !wanted || timer !== undefined || collecting) return;
    const own = generation;
    timer = clock.setTimeout(async () => {
      timer = undefined;
      if (closed || own !== generation) return;
      // false cancels the idle episode; null waits for another lane's teardown.
      const ready = idle();
      if (ready === false) { wanted = false; return; }
      if (ready !== true) { schedule(); return; }
      wanted = false;
      collecting = true;
      const before = process.memoryUsage(), started = performance.now();
      try {
        release(); counts.released++;
        if (collect) { await collect(); counts.collections++; }
        const after = process.memoryUsage();
        last = { durationMs: performance.now() - started, rssBefore: before.rss, rssAfter: after.rss,
          heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed,
          externalBefore: before.external, externalAfter: after.external,
          arrayBuffersBefore: before.arrayBuffers, arrayBuffersAfter: after.arrayBuffers };
      }
      catch { counts.failures++; }
      finally { collecting = false; schedule(); }
    }, delayMs);
    timer?.unref?.();
  }
  return {
    sleep() { wanted = true; cancel(); schedule(); },
    wake() { wanted = false; cancel(); },
    close() { closed = true; wanted = false; cancel(); },
    diagnostics: () => ({ available: !!collect, pending: timer !== undefined, collecting, ...counts, ...(last ? { last } : {}) }),
  };
}
