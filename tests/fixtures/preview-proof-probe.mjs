// Synthetic proof padding and message-acknowledged ledger inspection only.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const probe = globalThis.__previewProofProbe = { ledger: () => [], namespaces: 0 };
parentPort.on('message', message => {
  if (message.proofProbePort) {
    message.proofProbePort.postMessage({ ledger: probe.ledger(), namespaces: probe.namespaces });
    message.proofProbePort.close();
  }
  if (message.memoryPort) {
    message.memoryPort.postMessage({ memoryUsage: { ...process.memoryUsage(), proofLedger: probe.ledger(), namespaces: probe.namespaces } });
    message.memoryPort.close();
  }
});
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const patches = url.endsWith('/tasks/eligibility-cache.mjs') ? [
    ['const retained = new Map();', 'const retained = new Map();\n globalThis.__previewProofProbe.ledger = () => [...retained.values()].map(({cost, owner}) => ({cost, owner}));'],
    ['function retainResult(result, measure = false) {', `function retainResult(result, measure = false) {
      if (${Number(workerData.proofPaddingBytes) || 0}) Object.defineProperty(result.metrics, 'syntheticPadding', {
        value: new Uint8Array(${Number(workerData.proofPaddingBytes) || 0}), configurable: true });`],
  ] : url.endsWith('/tasks/warm-results.mjs') ? [
    ['export function warmResultNamespace(data, environment) {', 'export function warmResultNamespace(data, environment) {\n globalThis.__previewProofProbe.namespaces++;'],
  ] : [];
  let source = String(result.source);
  for (const [anchor, replacement] of patches) {
    if (!source.includes(anchor)) throw new Error('Preview proof probe anchor changed.');
    source = source.replace(anchor, replacement);
  }
  return patches.length ? { ...result, source } : result;
} });
