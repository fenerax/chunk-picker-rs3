import { setImmediate as yieldTurn } from 'node:timers/promises';

// Callers share one outer abort guard for the file. Yield for worker messages;
// elapsed time is never evidence that a lane has finished.
export async function waitForCondition(operation, predicate, signal) {
  for (;;) {
    signal.throwIfAborted();
    const value = await operation();
    if (predicate(value)) return value;
    await yieldTurn(undefined, { signal });
  }
}

export function predictionLaneIdle(lane) {
  return !lane.queue.active && !lane.queue.depth
    && !lane.prewarm.active && !lane.prewarm.pending
    && !lane.ranking.active && !lane.ranking.pending
    && !lane.retainedWork?.pending && !lane.retainedWork?.cancellationGrace
    && !lane.retainedWork?.stateInputs;
}

export function settlePredictionLane(diagnostics, signal) {
  return waitForCondition(diagnostics, value => predictionLaneIdle(value.predictionLane), signal);
}

// Keep work counters, retained inputs, queue/cache sizes and configuration.
// Only elapsed measurements are omitted (stuckMs/idleMs/deadlineMs are settings).
export function predictionLaneWork(lane) {
  const { worker, queue, timingMs, ...work } = lane;
  const { activeMs, noProgressMs, queuedMs, compileMs, ...workerWork } = worker;
  const { oldestWaitMs, ...queueWork } = queue;
  const stages = Object.fromEntries(Object.entries(timingMs?.stages ?? {}).map(([stage, value]) => {
    const { totalMs, maxMs, meanMs, ...stageWork } = value;
    return [stage, stageWork];
  }));
  return { ...work, worker: workerWork, queue: queueWork, timingCounts: stages };
}
