// Test-only observations. No collection, heap sizing or GC scheduling is forced.
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

export function overlappingGC(events, window) {
  return events.filter(event => event.startedAtMs < window.endedAtMs && event.endedAtMs > window.startedAtMs);
}
export function createRuntimeDiagnostics({ limit = 128, observeGC = true } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw new TypeError('Bounded diagnostic capacity required');
  const gcEvents = [], operations = [], phases = [];
  const append = (list, value) => { list.push(value); if (list.length > limit) list.splice(0, list.length - limit); };
  const memory = () => ({ ...process.memoryUsage(), heapSizeLimit: getHeapStatistics().heap_size_limit });
  const recordGC = entries => {
    for (const entry of entries) {
      const startedAtMs = performance.timeOrigin + entry.startTime;
      append(gcEvents, { startedAtMs, endedAtMs: startedAtMs + entry.duration, durationMs: entry.duration, kind: entry.detail?.kind ?? null });
    }
  };
  const observer = observeGC ? new PerformanceObserver(list => recordGC(list.getEntries())) : null;
  observer?.observe({ entryTypes: ['gc'] });
  return {
    recordGC,
    phase(event) {
      if (typeof event?.phase !== 'string' || !Number.isFinite(event.durationMs) || event.durationMs < 0) return;
      append(phases, { ...event, atMs: performance.timeOrigin + performance.now() });
    },
    async capture(name, action, metadata = {}) {
      const sampleStartedAtMs = performance.timeOrigin + performance.now(), before = memory(), cpu = process.cpuUsage();
      const startedAtMs = performance.timeOrigin + performance.now(); let failed = null;
      try { return await action(); }
      catch (error) { failed = error.code ?? error.name; throw error; }
      finally {
        const endedAtMs = performance.timeOrigin + performance.now(), cpuUsage = process.cpuUsage(cpu), after = memory();
        append(operations, { name, ...metadata, startedAtMs, endedAtMs, durationMs: endedAtMs - startedAtMs, sampleStartedAtMs,
          sampleEndedAtMs: performance.timeOrigin + performance.now(), before, after, cpuUsage, failed });
      }
    },
    snapshot() {
      if (observer) recordGC(observer.takeRecords());
      return { pid: process.pid, capacity: limit, observedGC: Boolean(observer), memory: memory(), gcEvents: structuredClone(gcEvents),
        operations: operations.map(operation => ({ ...structuredClone(operation), gc: overlappingGC(gcEvents, operation),
          phases: phases.filter(phase => phase.atMs >= operation.startedAtMs && phase.atMs <= operation.endedAtMs) })) };
    },
    close() { observer?.disconnect(); },
  };
}
