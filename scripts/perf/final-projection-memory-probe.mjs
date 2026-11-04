// Worker-only diagnostic: count weakly observed pass maps after two GC turns.
// This preload never changes calculator results or installs native handles.
import './preview-probe.mjs';
import { registerHooks } from 'node:module';
import { isMainThread, parentPort } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
if (!isMainThread) {
  const maps = [], graphs = [], wires = [], graphScratch = [];
  const cacheStats = { leafCalls: 0, leafHits: 0, genericCalls: 0, genericHits: 0 };
  const producerQueries = { total: 0, empty: 0, single: 0, candidates: 0, pathCopies: 0 };
  globalThis[Symbol.for('rs3.projectionMemoryMaps')] = maps;
  globalThis[Symbol.for('rs3.projectionMemoryGraphs')] = graphs;
  globalThis[Symbol.for('rs3.projectionMemoryWires')] = wires;
  globalThis[Symbol.for('rs3.projectionMemoryProducers')] = producerQueries;
  globalThis[Symbol.for('rs3.projectionMemoryCache')] = cacheStats;
  globalThis[Symbol.for('rs3.projectionMemoryGraphScratch')] = graphScratch;
  registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (url.endsWith('/app/tasks/engine.mjs')) {
      const source = String(loaded.source), anchor = '      const candidates = producers.get(name) ?? [];';
      if (source.split(anchor).length !== 2) throw Error('MemoryProbeAnchorError');
      if (source.split('new Set(visiting)').length < 3) throw Error('MemoryProbeAnchorError');
      const ownMap = '    if (projectionFast) projectionOwnSources = new Map();';
      const prepared = source.includes(ownMap) ? source.replace(ownMap, "    if (projectionFast) { projectionOwnSources = new Map(); globalThis[Symbol.for('rs3.projectionMemoryMaps')].push(new WeakRef(projectionOwnSources)); }") : source;
      return { ...loaded, source: prepared.replace(anchor, `${anchor}\n      { const counts = globalThis[Symbol.for('rs3.projectionMemoryProducers')]; counts.total++; counts.candidates += candidates.length; counts.empty += candidates.length === 0 ? 1 : 0; counts.single += candidates.length === 1 ? 1 : 0; }`).replaceAll('new Set(visiting)', "(globalThis[Symbol.for('rs3.projectionMemoryProducers')].pathCopies++, new Set(visiting))") };
    }
    if (url.endsWith('/app/tasks/eligibility-cache.mjs')) {
      const source = String(loaded.source), anchor = '  if (measure) resultMeasurements.set(result, { wire: new WeakRef(wire), overlay: 0 });';
      if (source.split(anchor).length !== 2) throw Error('MemoryProbeAnchorError');
      return { ...loaded, source: source.replace(anchor, `  globalThis[Symbol.for('rs3.projectionMemoryWires')].push({ ref: new WeakRef(wire), bytes: wire.byteLength, backing: wire.buffer.byteLength });\n${anchor}`) };
    }
    if (url.endsWith('/app/tasks/unknown-drop-warnings.mjs')) {
      const source = String(loaded.source), anchor = '  contexts.set(result, context);';
      if (source.split(anchor).length !== 2) throw Error('MemoryProbeAnchorError');
      return { ...loaded, source: source.replace(anchor, `  globalThis[Symbol.for('rs3.projectionMemoryGraphs')].push({ nodes: nodes.length, parentSets: nodes.filter(node => node.parents).length, parentless: nodes.filter(node => !node.parents?.size).length, tasks: tasks.size, items: items.size });\n  globalThis[Symbol.for('rs3.projectionMemoryGraphScratch')].push(new WeakRef(nodes));\n  if (typeof choiceMemo !== 'undefined' && choiceMemo) globalThis[Symbol.for('rs3.projectionMemoryGraphScratch')].push(new WeakRef(choiceMemo));\n${anchor}`) };
    }
    if (!url.endsWith('/app/tasks/obligation-cache.mjs')) return loaded;
    const anchor = '  const entries = new Map(), masks = new Map();';
    const source = String(loaded.source);
    if (source.split(anchor).length !== 2) throw Error('MemoryProbeAnchorError');
    let measured = source.replace(anchor, `${anchor}\n  globalThis[Symbol.for('rs3.projectionMemoryMaps')].push(new WeakRef(entries), new WeakRef(masks));`);
    const replace = (from, to) => { if (measured.split(from).length !== 2) throw Error('MemoryProbeAnchorError'); measured = measured.replace(from, to); };
    const counter = "globalThis[Symbol.for('rs3.projectionMemoryCache')]";
    const leafSignature = measured.includes('    evaluateLeaf(task, visiting, compute, copyOnMiss) {') ? '    evaluateLeaf(task, visiting, compute, copyOnMiss) {' : '    evaluateLeaf(task, visiting, compute) {';
    replace(leafSignature, `${leafSignature} ${counter}.leafCalls++;`);
    const genericSignature = measured.includes('    evaluate(task, visiting, compute, copyOnMiss) {') ? '    evaluate(task, visiting, compute, copyOnMiss) {' : '    evaluate(task, visiting, compute) {';
    replace(genericSignature, `${genericSignature} ${counter}.genericCalls++;`);
    replace('      if (cached?.leaf) return cached.value;', `      if (cached?.leaf) { ${counter}.leafHits++; return cached.value; }`);
    replace('      if (cached && !(cached.reads & path)) {', `      if (cached && !(cached.reads & path)) { ${counter}.genericHits++;`);
    measured = measured.replaceAll('new Set(visiting)', "(globalThis[Symbol.for('rs3.projectionMemoryProducers')].pathCopies++, new Set(visiting))");
    return { ...loaded, source: measured };
  } });
  parentPort.on('message', async message => {
    if (message?.type !== 'cancel' || message.id !== -1 || !message.memoryPort) return;
    const before = process.memoryUsage(), heapBefore = getHeapStatistics();
    const gcAvailable = typeof globalThis.gc === 'function';
    globalThis.gc?.(); await new Promise(resolve => setImmediate(resolve)); globalThis.gc?.();
    const alive = maps.map(ref => ref.deref()).filter(Boolean);
    const heap = getHeapStatistics();
    const liveWires = wires.filter(wire => wire.ref.deref());
    message.memoryPort.postMessage({ memoryUsage: { before, after: process.memoryUsage(), gcAvailable,
      graphScratchCreated: graphScratch.length, graphScratchAlive: graphScratch.filter(ref => ref.deref()).length,
      producerQueries, cacheStats, proofWires: { created: wires.length, live: liveWires.length, liveBytes: liveWires.reduce((n, wire) => n + wire.bytes, 0), liveBackingBytes: liveWires.reduce((n, wire) => n + wire.backing, 0) },
      graphs, passMapsCreated: maps.length, passMapsAlive: alive.length, liveEntries: alive.reduce((n, map) => n + map.size, 0),
      heap: { before: { total: heapBefore.total_heap_size, physical: heapBefore.total_physical_size, used: heapBefore.used_heap_size },
        total: heap.total_heap_size, physical: heap.total_physical_size, used: heap.used_heap_size, external: heap.external_memory, malloced: heap.malloced_memory } } });
  });
}
