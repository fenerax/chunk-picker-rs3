// Calculator-isolate preload. Use only for diagnostic runs, never timings.
import './hotspots-cpu-probe.mjs';
import './preview-probe.mjs';
import { registerHooks } from 'node:module';
import { isMainThread, parentPort } from 'node:worker_threads';
import { createProjectionRecorder, instrumentProjection } from './final-projection-builders.mjs';
import { createPhaseRecorder, instrumentEngine } from './incremental-engine-phases.mjs';
if (!isMainThread && parentPort) {
  const recorder = createPhaseRecorder();
  const projection = process.env.RS3_PROJECTION_PROFILE === '1' ? createProjectionRecorder() : undefined;
  globalThis[Symbol.for('rs3.final.projection')] = projection;
  globalThis[Symbol.for('rs3.incremental.profile')] = recorder;
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    return url.endsWith('/app/tasks/engine.mjs') ? { ...result, source: instrumentEngine(projection ? instrumentProjection(String(result.source)) : String(result.source)) } : result;
  } });
  const send = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...rest) => {
    if (!['progress', 'prediction-prepared'].includes(message.type) && !message.__engineProfile)
      { message.__incrementalProfile = recorder.drain(); if (projection) message.__finalProjectionProfile = projection.drain(); }
    return send(message, ...rest);
  };
}
