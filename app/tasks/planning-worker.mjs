import { parentPort } from 'node:worker_threads';
import { decodePlanningBaseline, indexPlanningBaseline, projectChunkPlanning } from './planning-baseline.mjs';

// One decoded member/input at a time; no definitions, engine, saved state or
// hypothetical evaluation. The scheduler owns admission, deadlines and sleep.
let cached;
parentPort.on('message', ({ id, type, state, chunkId, cancellation }) => {
  if (type === 'cancel' || type === 'supersede') return;
  const started = performance.now(), timingMs = {};
  try {
    if (type !== 'chunk-planning') throw new TypeError('Unsupported planning request.');
    if (cached?.key !== state.planningKey) {
      cached = undefined; // Drop the old graph before decoding its replacement.
      let t = performance.now();
      const value = decodePlanningBaseline(state.planningBaseline);
      timingMs.planningDecodeMs = performance.now() - t;
      t = performance.now();
      const index = indexPlanningBaseline(value);
      timingMs.planningIndexMs = performance.now() - t;
      cached = { key: state.planningKey, baseline: value.result, index };
    }
    const t = performance.now();
    const result = projectChunkPlanning(cached.baseline, cached.index, chunkId);
    timingMs.planningProjectionMs = performance.now() - t;
    if (cancellation && Atomics.load(new Int32Array(cancellation), 0)) return parentPort.postMessage({ id, result: { cancelled: true } });
    timingMs.totalMs = performance.now() - started;
    parentPort.postMessage({ id, result, evaluationMs: timingMs.totalMs, timingMs });
  } catch (error) {
    cached = undefined;
    parentPort.postMessage({ id, error: { name: error.name, message: error.message } });
  }
});
setImmediate(() => parentPort.postMessage({ type: 'ready', compileMs: 0 }));
