import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { traceDatasetLoad } from './datasets.mjs';

// Opt-in startup phase log for scripts/perf/startup.mjs; off by default.
// RS3_STARTUP_TIMING_LOG names an absolute file. The server, its calculator
// thread and a calculator process each append one JSON line per phase with a
// wall-clock time, so every isolate shares one timeline. Import this module
// first: it must also see the dataset resolved while other modules load.
const log = process.env.RS3_STARTUP_TIMING_LOG;
const enabled = typeof log === 'string' && path.isAbsolute(log);

export function startupPhase(phase) {
  if (!enabled) return;
  try { appendFileSync(log, `${JSON.stringify({ phase, pid: process.pid, thread: threadId, at: performance.timeOrigin + performance.now() })}\n`); }
  catch { /* Measurement never changes startup. */ }
}

if (enabled) {
  startupPhase('modules-start');
  traceDatasetLoad(stage => startupPhase(`dataset:${stage}`));
}
