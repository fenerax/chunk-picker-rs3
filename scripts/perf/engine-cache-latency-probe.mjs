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
      wrappers += `function ${name}(...args) { return globalThis[Symbol.for('${symbol}')]('${kind}.${name}', () => native_${name}(...args)); }\n`;
    }
    // These spans contain native serialization and must not be added to its
    // nested total. Unknown function names simply do not match older controls.
    if (kind === 'snapshot') for (const name of ['baseBytes', 'planningBytes', 'referenceBound']) {
      source = source.replace(new RegExp(`function ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)^\\}`, 'm'),
        (_, args, body) => `function ${name}(${args}) { return globalThis[Symbol.for('${symbol}')]('snapshot.${name}', () => {${body}}); }`);
    }
    if (kind === 'eligibility') source = source.replace(/function deserializePrivate\(([^)]*)\) \{([\s\S]*?)^\}/m,
      (_, args, body) => `function deserializePrivate(${args}) { return globalThis[Symbol.for('${symbol}')]('eligibility.deserializePrivate', () => {${body}}); }`);
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
