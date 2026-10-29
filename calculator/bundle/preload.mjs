import { registerHooks } from 'node:module';
import { workerData, isMainThread, parentPort, threadId } from 'node:worker_threads';
import { loadBundle } from './load.mjs';

if (!isMainThread && workerData?.calculatorBundle) {
  const loaded = await loadBundle(workerData.calculatorBundle, {
    expectedDatasetDigest: workerData.datasetDigest, expectedManifestSha256: workerData.bundleManifestSha256,
  });
  // The owned-process host's explicit preload slot enables its memory-port
  // handshake. Preserve that diagnostic API without changing task messages.
  parentPort.on('message', message => {
    if (message?.type === 'cancel' && message.id === -1 && message.memoryPort) {
      message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage() });
      message.memoryPort.close();
    }
  });
  globalThis[Symbol.for('rs3.calculator.bundle.provider')] = loaded.provider;
  for (const key of Object.keys(workerData)) delete workerData[key];
  Object.assign(workerData, loaded.init);
  const runtime = new URL('../../app/dataset-runtime.mjs', import.meta.url).href;
  const datasets = new URL('../../app/datasets.mjs', import.meta.url).href;
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === runtime && new URL(specifier, context.parentURL).href === datasets) {
      return { url: new URL('./provider.mjs', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
}
