// Diagnostic timings only. Preload with NODE_OPTIONS=--import=<this-file> and
// RS3_CACHE_LATENCY_TRACE=/tmp/<file>. Never use instrumented runs as baselines.
import { registerHooks } from 'node:module';
import { parentPort, isMainThread } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const output = process.env.RS3_CACHE_LATENCY_TRACE;
if (output && !path.resolve(output).startsWith('/tmp/')) throw new Error('TraceLocationError');
if (output && !isMainThread && parentPort) {
  const stats = new Map(), symbol = 'rs3.cacheLatencySpan';
  globalThis[Symbol.for(symbol)] = (name, operation) => {
    const began = performance.now();
    try { const value = operation(); const bytes = typeof value === 'number' ? value : value?.byteLength; if (typeof bytes === 'number') { const row = stats.get(name) ?? { count: 0, ms: 0 }; (row.bytes ??= []).push(bytes); stats.set(name, row); } return value; } finally {
      const row = stats.get(name) ?? { count: 0, ms: 0 };
      row.count++; row.ms += performance.now() - began; stats.set(name, row);
    }
  };
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    const kind = url.endsWith('/tasks/snapshot-cache.mjs') ? 'snapshot'
      : url.endsWith('/tasks/eligibility-cache.mjs') ? 'eligibility' : undefined;
    if (!kind) return result;
    let source = String(result.source), wrappers = '';
    for (const name of ['serialize', 'deserialize', 'gzipSync', 'gunzipSync', 'zstdCompressSync', 'zstdDecompressSync', 'automaticTravelInputKey']) {
      const expression = new RegExp(`\\b${name}\\b(?=[^;]*? from )`);
      if (!expression.test(source)) continue;
      source = source.replace(expression, `${name} as native_${name}`);
      wrappers += `const ${name} = (...args) => globalThis[Symbol.for('${symbol}')]('${kind}.${name}', () => native_${name}(...args));\n`;
    }
    // Include the shallow baseline projection in the diagnostic too. This span
    // contains snapshot.serialize and must not be added to that nested total.
    if (kind === 'snapshot') source = source.replace(/function baseBytes\(([^)]*)\) \{([\s\S]*?)^\}/m,
      (_, args, body) => `function baseBytes(${args}) { return globalThis[Symbol.for('${symbol}')]('snapshot.baseBytes', () => {${body}}); }`);
    return { ...result, source: source + '\n' + wrappers };
  } });
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...rest) => {
    if (message.id !== undefined && !['progress', 'prediction-prepared'].includes(message.type) && stats.size) {
      appendFileSync(output, JSON.stringify({ spans: Object.fromEntries(stats), evaluationMs: message.evaluationMs, timingMs: message.timingMs }) + '\n');
      stats.clear();
    }
    return post(message, ...rest);
  };
}
