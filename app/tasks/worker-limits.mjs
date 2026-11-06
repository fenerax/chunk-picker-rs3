import { getHeapStatistics } from 'node:v8';

// Shared by every calculator lane, the process relay and both import stages.
// Measurement, headroom and the distinction between V8 heap and RSS are in
// docs/operator-guide.md. Keep the relay's CLI ceiling equal to the isolate's:
// V8 process flags override Worker.resourceLimits, even with execArgv: [].
export const WORKER_OLD_GENERATION_MB = 2048;
export const TASK_WORKER_RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: WORKER_OLD_GENERATION_MB, maxYoungGenerationSizeMb: 32 });
export const IMPORT_WORKER_RESOURCE_LIMITS = TASK_WORKER_RESOURCE_LIMITS;
export const PUBLISHER_WORKER_RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 });
export const CALCULATOR_PROCESS_RSS_BYTES = 3 * 1024 ** 3;
export const workerMemoryError = () => Object.assign(new Error('Task calculator exceeded its memory ceiling. Retry shortly; saves remain available.'), { code: 'ERR_WORKER_OUT_OF_MEMORY' });

// An inherited --max-old-space-size (including NODE_OPTIONS) can silently
// override resourceLimits. Refuse that configuration instead of running an
// unbounded isolate. Node's young-generation setting spans two semispaces;
// V8's heap_size_limit includes three (old + 1.5 * the young setting).
export function assertWorkerHeapLimit(limits = TASK_WORKER_RESOURCE_LIMITS) {
  if (getHeapStatistics().heap_size_limit > (limits.maxOldGenerationSizeMb + 1.5 * limits.maxYoungGenerationSizeMb) * 1048576) {
    throw workerMemoryError();
  }
}
