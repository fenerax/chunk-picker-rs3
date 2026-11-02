// Instrumented runs only; timings are diagnostic, never benchmark evidence.
import { registerHooks } from 'node:module';
import { parentPort, isMainThread } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
const output = process.env.RS3_HOW_TRACE;
if (output && !output.startsWith('/tmp/')) throw Error('TraceLocationError');
if (output && !isMainThread) {
  let stats = {};
  globalThis[Symbol.for('rs3.howSpan')] = (key, fn) => { const start = performance.now(); try { return fn(); } finally {
    const row = stats[key] ??= { count: 0, ms: 0 }; row.count++; row.ms += performance.now() - start;
  } };
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    let source = String(result.source);
    if (url.endsWith('/tasks/engine.mjs')) {
      source = source.replace('function* evaluatePass(', `function evaluatePass(...args) { const it = globalThis[Symbol.for('rs3.howSpan')]('enginePassStarts', () => measuredEvaluatePass(...args)); return { next: (...values) => globalThis[Symbol.for('rs3.howSpan')]('enginePass', () => it.next(...values)) }; }\n  function* measuredEvaluatePass(`);
    }
    if (url.endsWith('/tasks/engine.mjs')) for (const name of ['calculateFreshAccess', 'collectSources']) {
      source = source.replace(`function ${name}() {`, `function ${name}() { return globalThis[Symbol.for('rs3.howSpan')]('${name}', () => measured_${name}()); }\n    function measured_${name}() {`);
    }
    if (url.endsWith('/tasks/how-proof.mjs')) {
      source = source.replace('function finish(', 'function measuredFinish(');
      source = source.replace('  return { task, seed,', `  function finish(...args) { return globalThis[Symbol.for('rs3.howSpan')]('proofFinish', () => measuredFinish(...args)); }\n  return { task, seed,`);
    }
    return { ...result, source };
  } });
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...args) => {
    if (message.id !== undefined && message.type !== 'progress') { appendFileSync(output, JSON.stringify({ stats, timingMs: message.timingMs }) + '\n'); stats = {}; }
    return post(message, ...args);
  };
}
