// Diagnostic preload for the existing calculator-only trial tools. Run separately
// from latency trials. It samples before/after explicit GC without heap contents.
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!['/scripts/perf/preview-engine.mjs', '/scripts/perf/hotspots-engine.mjs'].some(suffix => url.endsWith(suffix))) return loaded;
  let source = String(loaded.source);
  const replace = (from, to) => { if (source.split(from).length !== 2) throw Error('MemoryProbeAnchorError'); source = source.replace(from, to); };
  if (url.endsWith('/preview-engine.mjs')) replace("new URL('./preview-probe.mjs', import.meta.url).href", "new URL('./final-projection-memory-probe.mjs', import.meta.url).href");
  const logging = '    console.log(JSON.stringify(report));';
  const expected = url.endsWith('/preview-engine.mjs') ? 1 : 3;
  if (source.split(logging).length !== expected + 1) throw Error('MemoryProbeAnchorError');
  source = source.replaceAll(logging, '    report.memoryDiagnostic = await worker.getMemoryUsage();\n    report.parentMemoryDiagnostic = { before: process.memoryUsage() }; globalThis.gc?.(); report.parentMemoryDiagnostic.after = process.memoryUsage();\n    console.log(JSON.stringify(report));');
  return { ...loaded, source };
} });
